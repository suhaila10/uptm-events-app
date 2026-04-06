import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  arrayRemove,
  collection,
  doc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../src/screens/firebase';

const { width } = Dimensions.get('window');

export default function MyEventsScreen() {
  // ========== STATE ==========
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('upcoming'); // 'upcoming', 'past', 'attended', 'unattended', 'all'
  const [cancelling, setCancelling] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    upcoming: 0,
    past: 0,
    locked: 0,
    attended: 0,
    unattended: 0
  });
  const [attendanceRecords, setAttendanceRecords] = useState({});

  // ========== HELPER FUNCTIONS ==========
  const getDaysUntilEvent = (eventDate) => {
    if (!eventDate) return 0;
    const eventStart = eventDate.toDate();
    const now = new Date();
    const diffTime = eventStart - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const canCancelRegistration = (event) => {
    if (!event) return false;
    const eventStartDate = (event.startDate || event.date)?.toDate();
    if (!eventStartDate) return false;
    const now = new Date();
    const daysUntilEvent = Math.ceil((eventStartDate - now) / (1000 * 60 * 60 * 24));
    const cancellationDeadline = event.cancellationDeadline || 7;
    return daysUntilEvent >= cancellationDeadline && eventStartDate > now;
  };

  const getCancellationDeadlineDate = (event) => {
    if (!event) return null;
    const eventStartDate = (event.startDate || event.date)?.toDate();
    if (!eventStartDate) return null;
    const cancellationDeadline = event.cancellationDeadline || 7;
    return new Date(eventStartDate.getTime() - (cancellationDeadline * 24 * 60 * 60 * 1000));
  };

  const getEventStatus = (event) => {
    if (!event || !event.date) return { label: 'Unknown', color: '#95a5a6' };
    const eventDate = event.date.toDate();
    const now = new Date();
    if (eventDate < now) return { label: 'Completed', color: '#6c757d' };
    const daysUntil = getDaysUntilEvent(event.date);
    const cancellationDeadline = event.cancellationDeadline || 7;
    if (daysUntil < cancellationDeadline) return { label: 'Locked', color: '#e74c3c' };
    if (daysUntil < 1) return { label: 'Today', color: '#dc3545' };
    if (daysUntil < 2) return { label: 'Tomorrow', color: '#fd7e14' };
    return { label: 'Upcoming', color: '#28a745' };
  };

  const getAttendanceStatus = (eventId) => {
    const record = attendanceRecords[eventId];
    if (!record) return { label: 'Not Marked', color: '#95a5a6', icon: 'help-circle-outline' };
    
    switch (record.status) {
      case 'present':
        return { label: 'Present', color: '#28a745', icon: 'checkmark-circle-outline' };
      case 'late':
        return { label: 'Late', color: '#fd7e14', icon: 'time-outline' };
      case 'absent':
        return { label: 'Absent', color: '#dc3545', icon: 'close-circle-outline' };
      default:
        return { label: 'Not Marked', color: '#95a5a6', icon: 'help-circle-outline' };
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Date not set';
    const date = timestamp.toDate();
    return {
      full: date.toLocaleDateString('en-MY', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      dateOnly: date.toLocaleDateString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
      timeOnly: date.toLocaleTimeString('en-MY', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  };

  const formatDeadline = (date) => {
    return date.toLocaleDateString('en-MY', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // ========== FETCH ATTENDANCE RECORDS ==========
  const fetchAttendanceRecords = async (userId, eventIds) => {
    try {
      if (eventIds.length === 0) return {};

      // Firebase doesn't support 'in' with more than 10 items
      // Process in batches of 10
      const records = {};
      const batchSize = 10;
      
      for (let i = 0; i < eventIds.length; i += batchSize) {
        const batch = eventIds.slice(i, i + batchSize);
        const attendanceQuery = query(
          collection(db, 'attendance'),
          where('userId', '==', userId),
          where('eventId', 'in', batch)
        );
        
        const attendanceSnap = await getDocs(attendanceQuery);
        attendanceSnap.forEach(doc => {
          const data = doc.data();
          records[data.eventId] = {
            id: doc.id,
            ...data
          };
        });
      }
      
      return records;
    } catch (error) {
      console.error('Error fetching attendance:', error);
      return {};
    }
  };

  // ========== FETCH EVENTS ==========
  const fetchMyEvents = async () => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) {
        router.replace('/login');
        return;
      }

      const eventsQuery = query(
        collection(db, 'events'),
        where('attendees', 'array-contains', userId)
      );

      const querySnapshot = await getDocs(eventsQuery);
      const eventsData = [];
      const eventIds = [];
      
      let upcomingCount = 0;
      let pastCount = 0;
      let lockedCount = 0;

      querySnapshot.forEach((docSnap) => {
        const eventData = {
          id: docSnap.id,
          ...docSnap.data(),
          date: docSnap.data().date || docSnap.data().startDate
        };

        if (!eventData.date) return;

        const eventDate = eventData.date.toDate();
        const now = new Date();
        const isPast = eventDate < now;
        const daysUntil = getDaysUntilEvent(eventData.date);
        const deadline = eventData.cancellationDeadline || 7;

        if (isPast) {
          pastCount++;
        } else {
          upcomingCount++;
          if (daysUntil < deadline) {
            lockedCount++;
          }
        }

        eventsData.push(eventData);
        eventIds.push(docSnap.id);
      });

      // Fetch attendance records for these events
      const attendance = await fetchAttendanceRecords(userId, eventIds);
      setAttendanceRecords(attendance);

      // Calculate attended/unattended counts
      let attendedCount = 0;
      let unattendedCount = 0;
      
      eventsData.forEach(event => {
        const record = attendance[event.id];
        if (record) {
          if (record.status === 'present' || record.status === 'late') {
            attendedCount++;
          } else {
            unattendedCount++;
          }
        } else {
          // No attendance record means not marked
          if (event.date?.toDate() < new Date()) {
            unattendedCount++; // Past events without attendance are unattended
          }
        }
      });

      eventsData.sort((a, b) => {
        const dateA = a.date?.toDate() || new Date(0);
        const dateB = b.date?.toDate() || new Date(0);
        return dateA - dateB;
      });

      setEvents(eventsData);
      setStats({
        total: eventsData.length,
        upcoming: upcomingCount,
        past: pastCount,
        locked: lockedCount,
        attended: attendedCount,
        unattended: unattendedCount
      });
      
    } catch (error) {
      console.error('Error fetching my events:', error);
      Alert.alert('Error', 'Failed to load your events. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMyEvents();
  }, []);

  // ========== CANCEL REGISTRATION ==========
  const handleCancelRegistration = async (event) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    if (!canCancelRegistration(event)) {
      const daysUntil = getDaysUntilEvent(event.date);
      const deadline = event.cancellationDeadline || 7;
      
      Alert.alert(
        'Cannot Cancel',
        `❌ You cannot cancel your registration less than ${deadline} days before the event.\n\n` +
        `This helps organizers prepare food, materials, and seating arrangements.\n\n` +
        `If you have an emergency, please contact the organizer directly.`
      );
      return;
    }

    Alert.alert(
      'Cancel Registration',
      'Are you sure you want to cancel your registration?\n\n' +
      '• Your spot will be given to someone else\n' +
      '• You will not receive a certificate\n' +
      '• You can re-register if spots are still available',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancelling(event.id);
            
            try {
              const eventRef = doc(db, 'events', event.id);
              
              await updateDoc(eventRef, {
                attendees: arrayRemove(userId),
                attendeesCount: (event.attendeesCount || 1) - 1,
                cancelledAt: Timestamp.now()
              });

              await fetchMyEvents();
              Alert.alert('Success', '✅ Registration cancelled successfully.');
            } catch (error) {
              console.error('Error cancelling registration:', error);
              Alert.alert('Error', '❌ Failed to cancel registration. Please try again.');
            } finally {
              setCancelling(null);
            }
          }
        }
      ]
    );
  };

  // ========== CHECK ATTENDANCE & SHOW CERTIFICATE ==========
  const checkAttendanceAndShowCertificate = async (event) => {
    try {
      const userId = auth.currentUser?.uid;
      
      const attendanceQuery = query(
        collection(db, 'attendance'),
        where('eventId', '==', event.id),
        where('userId', '==', userId)
      );
      
      const attendanceSnap = await getDocs(attendanceQuery);
      
      if (attendanceSnap.empty) {
        Alert.alert(
          'Not Eligible',
          'You did not attend this event. Certificate is only available for attendees.'
        );
        return;
      }
      
      const record = attendanceSnap.docs[0].data();
      if (record.status !== 'present' && record.status !== 'late') {
        Alert.alert(
          'Not Eligible',
          'Certificate is only available for attendees who were present or excused late.'
        );
        return;
      }
      
      Alert.alert(
        'Certificate Available',
        'Your certificate is ready to view!',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'View Certificate',
            onPress: () => {
              router.push(`/certificate?eventId=${event.id}`);
            }
          }
        ]
      );
      
    } catch (error) {
      console.error('Error checking attendance:', error);
      Alert.alert('Error', 'Failed to verify attendance.');
    }
  };

  // ========== FILTER EVENTS ==========
  const getFilteredEvents = () => {
    const now = new Date();
    
    switch(filter) {
      case 'upcoming':
        return events.filter(e => e.date?.toDate() >= now);
      case 'past':
        return events.filter(e => e.date?.toDate() < now);
      case 'attended': {
        const attendedIds = Object.entries(attendanceRecords)
          .filter(([_, record]) => record.status === 'present' || record.status === 'late')
          .map(([eventId]) => eventId);
        return events.filter(e => attendedIds.includes(e.id));
      }
      case 'unattended': {
        return events.filter(e => {
          const record = attendanceRecords[e.id];
          // If event is in the past and no attendance record OR record shows absent
          if (e.date?.toDate() < now) {
            return !record || record.status === 'absent';
          }
          return false;
        });
      }
      case 'all':
      default:
        return events;
    }
  };

  const filteredEvents = getFilteredEvents();

  // ========== RENDER EVENT CARD ==========
  const renderEventCard = (event) => {
    const status = getEventStatus(event);
    const attendance = getAttendanceStatus(event.id);
    const isPast = event.date?.toDate() < new Date();
    const canCancel = canCancelRegistration(event);
    const daysUntil = getDaysUntilEvent(event.date);
    const deadline = event.cancellationDeadline || 7;
    const deadlineDate = getCancellationDeadlineDate(event);
    const formattedDate = formatDate(event.date);

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => router.push(`/event-detail?id=${event.id}`)}
        activeOpacity={0.7}
      >
        {/* Status Badge - Event Status */}
        <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
          <Text style={styles.statusText}>{status.label}</Text>
        </View>

        {/* Attendance Badge - Only show for past events */}
        {isPast && (
          <View style={[styles.attendanceBadge, { backgroundColor: attendance.color }]}>
            <Ionicons name={attendance.icon} size={12} color="white" />
            <Text style={styles.statusText}>{attendance.label}</Text>
          </View>
        )}

        <View style={styles.eventContent}>
          {/* Left Column - Date */}
          <View style={styles.eventDateContainer}>
            <Text style={styles.eventDateDay}>
              {event.date?.toDate().getDate() || '?'}
            </Text>
            <Text style={styles.eventDateMonth}>
              {event.date?.toDate().toLocaleString('default', { month: 'short' }) || '???'}
            </Text>
            <Text style={styles.eventDateTime}>
              {formattedDate.timeOnly}
            </Text>
          </View>

          {/* Right Column - Details */}
          <View style={styles.eventDetails}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title || 'Untitled Event'}
            </Text>

            <View style={styles.eventMeta}>
              <Ionicons name="location-outline" size={14} color="#666" />
              <Text style={styles.eventMetaText} numberOfLines={1}>
                {event.venue || 'Online'}
              </Text>
            </View>

            <View style={styles.eventMeta}>
              <Ionicons name="people-outline" size={14} color="#666" />
              <Text style={styles.eventMetaText}>
                {event.attendeesCount || 0} attending • Capacity: {event.capacity}
              </Text>
            </View>

            {!isPast && (
              <View style={[
                styles.cancellationInfo,
                canCancel ? styles.cancellationAllowed : styles.cancellationBlocked
              ]}>
                {canCancel ? (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={12} color="#155724" />
                    <Text style={styles.cancellationText}>
                      Cancel until {deadlineDate ? formatDeadline(deadlineDate) : `${deadline} days before`}
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="lock-closed-outline" size={12} color="#721c24" />
                    <Text style={styles.cancellationText}>
                      Cannot cancel - less than {deadline} days before
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              {!isPast && (
                <TouchableOpacity
                  style={[
                    styles.cancelButton,
                    (!canCancel || cancelling === event.id) && styles.cancelButtonDisabled
                  ]}
                  onPress={() => handleCancelRegistration(event)}
                  disabled={!canCancel || cancelling === event.id}
                >
                  {cancelling === event.id ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons 
                        name={!canCancel ? "lock-closed-outline" : "close-circle-outline"} 
                        size={16} 
                        color="white" 
                      />
                      <Text style={styles.cancelButtonText}>
                        {!canCancel ? 'Locked' : 'Cancel'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {isPast && (
                <TouchableOpacity
                  style={[
                    styles.certificateButton,
                    attendance.label === 'Present' || attendance.label === 'Late' 
                      ? styles.certificateActive 
                      : styles.certificateDisabled
                  ]}
                  onPress={() => checkAttendanceAndShowCertificate(event)}
                  disabled={attendance.label !== 'Present' && attendance.label !== 'Late'}
                >
                  <Ionicons name="ribbon-outline" size={16} color="white" />
                  <Text style={styles.certificateButtonText}>
                    {attendance.label === 'Present' || attendance.label === 'Late' 
                      ? 'Certificate' 
                      : 'Not Eligible'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.qrButton}
                onPress={() => router.push({
                  pathname: '/qr-scanner',
                  params: { eventId: event.id }
                })}
              >
                <Ionicons name="qr-code-outline" size={16} color="#2E3B55" />
                <Text style={styles.qrButtonText}>QR Code</Text>
              </TouchableOpacity>
            </View>

            {/* Organizer Info */}
            <View style={styles.organizerInfo}>
              <Ionicons name="person-outline" size={12} color="#999" />
              <Text style={styles.organizerText} numberOfLines={1}>
                {event.organizerName || 'UPTM'} • {event.organizerEmail || ''}
              </Text>
            </View>

            {/* Tags */}
            <View style={styles.tagsContainer}>
              {event.category && (
                <View style={[styles.tag, { backgroundColor: '#e8f4fc' }]}>
                  <Text style={[styles.tagText, { color: '#3498db' }]}>
                    {event.category}
                  </Text>
                </View>
              )}
              {event.faculty && (
                <View style={[styles.tag, { backgroundColor: '#e7f6e7' }]}>
                  <Text style={[styles.tagText, { color: '#28a745' }]}>
                    {event.faculty}
                  </Text>
                </View>
              )}
              {event.requiresRSVP && (
                <View style={[styles.tag, { backgroundColor: '#fff3cd' }]}>
                  <Ionicons name="lock-closed-outline" size={10} color="#856404" />
                  <Text style={[styles.tagText, { color: '#856404', marginLeft: 2 }]}>
                    RSVP
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ========== RENDER ==========
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E3B55" />
        <Text style={styles.loadingText}>Loading your events...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Events</Text>
        <TouchableOpacity onPress={() => router.push('/events')}>
          <Ionicons name="search-outline" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Stats Cards */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.statsScroll}
        contentContainerStyle={styles.statsContainer}
      >
        <View style={[styles.statCard, { backgroundColor: '#667eea' }]}>
          <Text style={styles.statLabel}>TOTAL</Text>
          <Text style={styles.statValue}>{stats.total}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#43e97b' }]}>
          <Text style={styles.statLabel}>UPCOMING</Text>
          <Text style={styles.statValue}>{stats.upcoming}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#4facfe' }]}>
          <Text style={styles.statLabel}>PAST</Text>
          <Text style={styles.statValue}>{stats.past}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#f093fb' }]}>
          <Text style={styles.statLabel}>LOCKED</Text>
          <Text style={styles.statValue}>{stats.locked}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#28a745' }]}>
          <Text style={styles.statLabel}>ATTENDED</Text>
          <Text style={styles.statValue}>{stats.attended}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#dc3545' }]}>
          <Text style={styles.statLabel}>UNATTENDED</Text>
          <Text style={styles.statValue}>{stats.unattended}</Text>
        </View>
      </ScrollView>

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'upcoming' && styles.activeFilter]}
            onPress={() => setFilter('upcoming')}
          >
            <Text style={[styles.filterText, filter === 'upcoming' && styles.activeFilterText]}>
              Upcoming ({stats.upcoming})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'past' && styles.activeFilter]}
            onPress={() => setFilter('past')}
          >
            <Text style={[styles.filterText, filter === 'past' && styles.activeFilterText]}>
              Past ({stats.past})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'attended' && styles.activeFilter]}
            onPress={() => setFilter('attended')}
          >
            <Text style={[styles.filterText, filter === 'attended' && styles.activeFilterText]}>
              Attended ({stats.attended})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'unattended' && styles.activeFilter]}
            onPress={() => setFilter('unattended')}
          >
            <Text style={[styles.filterText, filter === 'unattended' && styles.activeFilterText]}>
              Unattended ({stats.unattended})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'all' && styles.activeFilter]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterText, filter === 'all' && styles.activeFilterText]}>
              All ({stats.total})
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Events List */}
      <ScrollView
        style={styles.eventsList}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchMyEvents();
            }}
            colors={['#2E3B55']}
          />
        }
      >
        {filteredEvents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={60} color="#ddd" />
            <Text style={styles.emptyTitle}>No Events Found</Text>
            <Text style={styles.emptyText}>
              {filter === 'upcoming' 
                ? "You haven't registered for any upcoming events."
                : filter === 'past'
                ? "You haven't attended any events yet."
                : filter === 'attended'
                ? "You haven't attended any events yet."
                : filter === 'unattended'
                ? "You don't have any unattended events."
                : "You haven't registered for any events."}
            </Text>
            <TouchableOpacity
              style={styles.browseButton}
              onPress={() => router.push('/events')}
            >
              <Text style={styles.browseButtonText}>Browse Events</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredEvents.map(event => renderEventCard(event))
        )}

        {/* Important Reminders */}
        {filter === 'upcoming' && filteredEvents.length > 0 && (
          <View style={styles.remindersCard}>
            <View style={styles.remindersHeader}>
              <Ionicons name="information-circle-outline" size={20} color="#3498db" />
              <Text style={styles.remindersTitle}>Important Reminders</Text>
            </View>
            <View style={styles.remindersList}>
              <Text style={styles.reminderItem}>• Arrive 15 minutes before event starts</Text>
              <Text style={styles.reminderItem}>• Bring your student ID for verification</Text>
              <Text style={styles.reminderItem}>• QR code scanning for attendance</Text>
              <Text style={styles.reminderItem}>
                • Cancellation allowed up to {filteredEvents[0]?.cancellationDeadline || 7} days before
              </Text>
            </View>
          </View>
        )}

        {/* Attendance Summary */}
        {stats.past > 0 && (
          <View style={styles.attendanceSummary}>
            <Text style={styles.summaryTitle}>Attendance Summary</Text>
            <View style={styles.summaryBars}>
              <View style={styles.summaryBarItem}>
                <View style={styles.summaryBarLabel}>
                  <Text style={styles.summaryBarLabelText}>Attended</Text>
                  <Text style={styles.summaryBarValue}>{stats.attended}</Text>
                </View>
                <View style={styles.summaryBarTrack}>
                  <View 
                    style={[
                      styles.summaryBarFill, 
                      { 
                        width: `${stats.past > 0 ? (stats.attended / stats.past) * 100 : 0}%`,
                        backgroundColor: '#28a745'
                      }
                    ]} 
                  />
                </View>
              </View>
              <View style={styles.summaryBarItem}>
                <View style={styles.summaryBarLabel}>
                  <Text style={styles.summaryBarLabelText}>Unattended</Text>
                  <Text style={styles.summaryBarValue}>{stats.unattended}</Text>
                </View>
                <View style={styles.summaryBarTrack}>
                  <View 
                    style={[
                      styles.summaryBarFill, 
                      { 
                        width: `${stats.past > 0 ? (stats.unattended / stats.past) * 100 : 0}%`,
                        backgroundColor: '#dc3545'
                      }
                    ]} 
                  />
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => router.push('/events')}
          >
            <Ionicons name="list-outline" size={20} color="#3498db" />
            <Text style={styles.quickActionText}>Browse More Events</Text>
          </TouchableOpacity>
          
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2E3B55',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statsScroll: {
    maxHeight: 100,
    marginTop: 15,
  },
  statsContainer: {
    paddingHorizontal: 15,
  },
  statCard: {
    width: 100,
    height: 80,
    borderRadius: 10,
    padding: 12,
    marginRight: 10,
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 5,
  },
  statValue: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  filterScroll: {
    maxHeight: 50,
    marginTop: 15,
    marginBottom: 10,
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 15,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2E3B55',
    marginRight: 10,
  },
  activeFilter: {
    backgroundColor: '#2E3B55',
  },
  filterText: {
    fontSize: 12,
    color: '#2E3B55',
    fontWeight: '500',
  },
  activeFilterText: {
    color: 'white',
    fontWeight: 'bold',
  },
  eventsList: {
    flex: 1,
    paddingHorizontal: 15,
  },
  eventCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    position: 'relative',
  },
  statusBadge: {
    position: 'absolute',
    top: 15,
    right: 15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 2,
  },
  attendanceBadge: {
    position: 'absolute',
    top: 15,
    left: 15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  eventContent: {
    flexDirection: 'row',
    marginTop: 30,
  },
  eventDateContainer: {
    width: 60,
    alignItems: 'center',
    marginRight: 15,
  },
  eventDateDay: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E3B55',
  },
  eventDateMonth: {
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase',
  },
  eventDateTime: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
  },
  eventDetails: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
    paddingRight: 70,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventMetaText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 5,
    flex: 1,
  },
  cancellationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
    marginBottom: 8,
  },
  cancellationAllowed: {
    backgroundColor: '#d4edda',
  },
  cancellationBlocked: {
    backgroundColor: '#f8d7da',
  },
  cancellationText: {
    fontSize: 10,
    marginLeft: 4,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 8,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc3545',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    marginRight: 8,
  },
  cancelButtonDisabled: {
    backgroundColor: '#e74c3c',
    opacity: 0.7,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  certificateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    marginRight: 8,
  },
  certificateActive: {
    backgroundColor: '#28a745',
  },
  certificateDisabled: {
    backgroundColor: '#95a5a6',
  },
  certificateButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f4fc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
  },
  qrButtonText: {
    color: '#2E3B55',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  organizerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#ecf0f1',
  },
  organizerText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 4,
    flex: 1,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  emptyContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 15,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: '#3498db',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  browseButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  remindersCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 15,
    marginTop: 10,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#3498db',
  },
  remindersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  remindersTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginLeft: 8,
  },
  remindersList: {
    marginLeft: 5,
  },
  reminderItem: {
    fontSize: 13,
    color: '#666',
    lineHeight: 22,
  },
  attendanceSummary: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginTop: 10,
    marginBottom: 15,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
  },
  summaryBars: {
    gap: 15,
  },
  summaryBarItem: {
    gap: 5,
  },
  summaryBarLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryBarLabelText: {
    fontSize: 13,
    color: '#666',
  },
  summaryBarValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2c3e50',
  },
  summaryBarTrack: {
    height: 8,
    backgroundColor: '#ecf0f1',
    borderRadius: 4,
    overflow: 'hidden',
  },
  summaryBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 15,
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  certificateAction: {
    borderColor: '#28a745',
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3498db',
    marginLeft: 5,
  },
});