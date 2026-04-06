import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
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
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { auth, db } from '../src/screens/firebase';

const { width } = Dimensions.get('window');

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams();
  const eventId = id;

  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasCheckedIn, setHasCheckedIn] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState(null); // 'present' or 'late'
  const [registering, setRegistering] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [cancelling, setCancelling] = useState(false);
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [attendanceStats, setAttendanceStats] = useState({
    registered: 0,
    attended: 0,
    late: 0,
    attendanceRate: 0
  });
  const [attendees, setAttendees] = useState([]);
  const [showAttendeesModal, setShowAttendeesModal] = useState(false);

  useEffect(() => {
    loadUserData();
  }, []);

  useEffect(() => {
    if (eventId && user) {
      fetchEventDetails();
    }
  }, [eventId, user]);

  const loadUserData = async () => {
    try {
      const userId = await SecureStore.getItemAsync('user_id');
      const userDataString = await SecureStore.getItemAsync('user_data');
      
      if (userId) {
        setUser({ uid: userId });
      }
      
      if (userDataString) {
        setUserData(JSON.parse(userDataString));
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const getDaysUntilEvent = () => {
    if (!event) return 0;
    const eventStart = (event.startDate || event.date)?.toDate();
    if (!eventStart) return 0;
    const now = new Date();
    const diffTime = eventStart - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const canCancelRegistration = () => {
    if (!event || !isRegistered) return false;
    const eventStartDate = (event.startDate || event.date)?.toDate();
    if (!eventStartDate) return false;
    const now = new Date();
    const daysUntilEvent = Math.ceil((eventStartDate - now) / (1000 * 60 * 60 * 24));
    const cancellationDeadline = event.cancellationDeadline || 7;
    return daysUntilEvent >= cancellationDeadline && eventStartDate > now;
  };

  const getCancellationDeadlineDate = () => {
    if (!event) return null;
    const eventStartDate = (event.startDate || event.date)?.toDate();
    if (!eventStartDate) return null;
    const cancellationDeadline = event.cancellationDeadline || 7;
    return new Date(eventStartDate.getTime() - (cancellationDeadline * 24 * 60 * 60 * 1000));
  };

  const isRsvpDeadlinePassed = () => {
    if (!event || !event.rsvpDeadline) return false;
    return event.rsvpDeadline.toDate() < new Date();
  };

  const checkUserCheckedIn = async (userId) => {
    try {
      const attendanceQuery = query(
        collection(db, 'attendance'),
        where('eventId', '==', eventId),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(attendanceQuery);
      if (!snapshot.empty) {
        const record = snapshot.docs[0].data();
        setCheckInStatus(record.status || 'present');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking attendance:', error);
      return false;
    }
  };

  // ENHANCED: Fetch attendees with attendance status
  const fetchAttendeesWithStatus = async () => {
    if (!event?.attendees || event.attendees.length === 0) {
      setAttendees([]);
      return;
    }
    
    try {
      const attendeesData = [];
      for (const userId of event.attendees) {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          // Check attendance status for this user
          const attendanceQuery = query(
            collection(db, 'attendance'),
            where('eventId', '==', eventId),
            where('userId', '==', userId)
          );
          const attendanceSnap = await getDocs(attendanceQuery);
          
          let attendanceStatus = 'not_marked';
          let checkInTime = null;
          let checkInMethod = null;
          let isLate = false;
          
          if (!attendanceSnap.empty) {
            const attendanceRecord = attendanceSnap.docs[0].data();
            attendanceStatus = attendanceRecord.status || 'present';
            checkInTime = attendanceRecord.timestamp?.toDate();
            checkInMethod = attendanceRecord.method || 'qr';
            isLate = attendanceStatus === 'late';
          }
          
          attendeesData.push({
            id: userId,
            name: userDoc.data().name || userDoc.data().displayName || 'Unknown',
            email: userDoc.data().email || 'N/A',
            matricNumber: userDoc.data().matricNumber || userDoc.data().studentId || 'N/A',
            registered: true,
            present: !attendanceSnap.empty,
            attendanceStatus: attendanceStatus,
            isLate: isLate,
            checkInTime: checkInTime,
            checkInMethod: checkInMethod
          });
        } else {
          attendeesData.push({
            id: userId,
            name: 'Unknown User',
            email: 'N/A',
            matricNumber: 'N/A',
            registered: true,
            present: false,
            attendanceStatus: 'not_marked',
            isLate: false,
            checkInTime: null,
            checkInMethod: null
          });
        }
      }
      
      // Sort attendees: present/late first, then registered
      attendeesData.sort((a, b) => {
        if (a.present === b.present) {
          if (a.isLate === b.isLate) return 0;
          return a.isLate ? 1 : -1; // Present first, then late
        }
        return a.present ? -1 : 1;
      });
      
      setAttendees(attendeesData);
    } catch (error) {
      console.error('Error fetching attendees:', error);
    }
  };

  const calculateAttendanceStats = async () => {
    try {
      const attendanceQuery = query(
        collection(db, 'attendance'),
        where('eventId', '==', eventId)
      );
      const snapshot = await getDocs(attendanceQuery);
      const attended = snapshot.size;
      const late = snapshot.docs.filter(doc => doc.data().status === 'late').length;
      const registered = event?.attendeesCount || 0;
      const attendanceRate = registered > 0 ? Math.round((attended / registered) * 100) : 0;
      setAttendanceStats({ registered, attended, late, attendanceRate });
    } catch (error) {
      console.error('Error calculating stats:', error);
    }
  };

  // Helper function to format dates
  const formatDate = (timestamp) => {
    if (!timestamp) return null;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return {
      full: date.toLocaleString('en-MY', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      time: date.toLocaleTimeString('en-MY', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      dateOnly: date.toLocaleDateString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
      dateObj: date
    };
  };

  // Calculate duration in hours and minutes
  const calculateDuration = (start, end) => {
    if (!start || !end) return null;
    const startDate = start.toDate ? start.toDate() : new Date(start);
    const endDate = end.toDate ? end.toDate() : new Date(end);
    const diffMs = endDate - startDate;
    const diffMins = Math.round(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    return { hours, minutes, total: diffMins };
  };

  const fetchEventDetails = async () => {
    try {
      const eventRef = doc(db, 'events', eventId);
      const eventDoc = await getDoc(eventRef);
      
      if (eventDoc.exists()) {
        const eventData = eventDoc.data();
        const eventDate = (eventData.startDate || eventData.date)?.toDate() || null;
        const now = new Date();
        
        const targetAudience = Array.isArray(eventData.targetAudience) 
          ? eventData.targetAudience 
          : eventData.targetAudience 
            ? [eventData.targetAudience] 
            : [];
        
        // Calculate duration
        const duration = calculateDuration(eventData.startDate, eventData.endDate);
        
        const formattedEvent = { 
          id: eventDoc.id, 
          ...eventData,
          targetAudience,
          eventDate: eventDate,
          isPastEvent: eventDate ? eventDate < now : false,
          isCancelled: eventData.status === 'cancelled',
          isFull: (eventData.attendeesCount || 0) >= (eventData.capacity || 0),
          canRegister: !(eventDate < now) && 
                      !((eventData.attendeesCount || 0) >= (eventData.capacity || 0)) && 
                      eventData.status !== 'cancelled' && 
                      eventData.registrationOpen &&
                      !isRsvpDeadlinePassed(),
          canRegisterWalkIn: !(eventDate < now) && 
                            !((eventData.attendeesCount || 0) >= (eventData.capacity || 0)) && 
                            eventData.status !== 'cancelled' && 
                            eventData.registrationOpen &&
                            isRsvpDeadlinePassed() &&
                            eventData.allowWalkIn,
          availableSpots: (eventData.capacity || 0) - (eventData.attendeesCount || 0),
          formattedDate: eventDate ? eventDate.toLocaleDateString('en-MY', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          }) : 'Date not set',
          formattedTime: eventDate ? eventDate.toLocaleTimeString('en-MY', {
            hour: '2-digit',
            minute: '2-digit'
          }) : 'Time not set',
          formattedDateTime: eventDate ? eventDate.toLocaleString('en-MY', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : 'Date not set',
          rsvpDeadlineFormatted: eventData.rsvpDeadline ? 
            eventData.rsvpDeadline.toDate().toLocaleString('en-MY', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }) : null,
          duration: duration,
          durationText: duration ? 
            `${duration.hours}h ${duration.minutes}m` : 
            (eventData.duration ? `${eventData.duration} min` : 'N/A')
        };
        
        setEvent(formattedEvent);
        
        const userId = user?.uid;
        if (userId) {
          if (eventData.attendees && Array.isArray(eventData.attendees)) {
            setIsRegistered(eventData.attendees.includes(userId));
          }
          const checkedIn = await checkUserCheckedIn(userId);
          setHasCheckedIn(checkedIn);
        }

        await calculateAttendanceStats();
        
        // Fetch attendees with status if user is organizer or admin
        if (user?.uid === eventData.organizerId || userData?.role === 'admin') {
          await fetchAttendeesWithStatus();
        }
      } else {
        Alert.alert('Error', 'Event not found');
        router.back();
      }
    } catch (error) {
      console.error('Error fetching event:', error);
      Alert.alert('Error', 'Failed to load event details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchEventDetails();
  };

  // ========== CANCEL EVENT FUNCTION ==========
  const handleCancelEvent = async () => {
    Alert.alert(
      'Cancel Event',
      'Are you sure you want to cancel this event?\n\n• All registrations will be cancelled\n• Event will be marked as cancelled\n• Registration will be closed\n\nThis action can be reversed later.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const eventRef = doc(db, 'events', eventId);
              await updateDoc(eventRef, {
                status: 'cancelled',
                registrationOpen: false,
                updatedAt: Timestamp.now(),
                cancellationReason: 'Cancelled by organizer',
                cancelledAt: Timestamp.now()
              });
              Alert.alert('Success', '✅ Event cancelled successfully.');
              await fetchEventDetails();
            } catch (error) {
              console.error('Error cancelling event:', error);
              Alert.alert('Error', 'Failed to cancel event. Please try again.');
            } finally {
              setCancelling(false);
            }
          }
        }
      ]
    );
  };

  // ========== REOPEN EVENT FUNCTION ==========
  const handleReopenEvent = async () => {
    Alert.alert(
      'Reopen Event',
      'Reopen this event for registration?\n\n• Event will be marked as published\n• Registration will be reopened\n• Previous attendees will need to re-register',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Reopen',
          onPress: async () => {
            setCancelling(true);
            try {
              const eventRef = doc(db, 'events', eventId);
              await updateDoc(eventRef, {
                status: 'published',
                registrationOpen: true,
                updatedAt: Timestamp.now(),
                cancellationReason: null
              });
              Alert.alert('Success', '✅ Event reopened successfully. Registration is now open.');
              await fetchEventDetails();
            } catch (error) {
              console.error('Error reopening event:', error);
              Alert.alert('Error', 'Failed to reopen event. Please try again.');
            } finally {
              setCancelling(false);
            }
          }
        }
      ]
    );
  };

  const handleRegistration = async () => {
    const userId = auth.currentUser?.uid || user?.uid;
    if (!userId) {
      Alert.alert('Login Required', 'Please login to register for events', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/login') }
      ]);
      return;
    }

    // Prevent multiple registrations by checking isRegistered again
    if (isRegistered) {
      Alert.alert('Already Registered', 'You are already registered for this event.');
      return;
    }

    setRegistering(true);
    
    try {
      const eventRef = doc(db, 'events', eventId);
      
      // Double-check registration status from Firestore to prevent race conditions
      const freshEventDoc = await getDoc(eventRef);
      const freshEventData = freshEventDoc.data();
      
      if (freshEventData.attendees?.includes(userId)) {
        Alert.alert('Already Registered', 'You are already registered for this event.');
        setIsRegistered(true);
        setRegistering(false);
        return;
      }

      if (event?.rsvpDeadline) {
        const deadlineDate = event.rsvpDeadline.toDate();
        if (deadlineDate < new Date()) {
          if (event.allowWalkIn) {
            Alert.alert(
              '⚠️ RSVP Deadline Passed',
              'RSVP deadline has passed, but this event allows walk-ins.\n\n' +
              '• You can still attend\n' +
              '• Food/materials may be limited\n' +
              '• Registration is still recommended\n\n' +
              'Do you want to continue as a walk-in?',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => setRegistering(false) },
                { 
                  text: 'Continue as Walk-in', 
                  onPress: async () => {
                    await updateDoc(eventRef, {
                      attendees: arrayUnion(userId),
                      attendeesCount: (event?.attendeesCount || 0) + 1,
                      registeredAt: Timestamp.now()
                    });
                    setIsRegistered(true);
                    Alert.alert('Success', '✅ You have been registered as a walk-in! Please note that food/materials may be limited.');
                    await fetchEventDetails();
                    setRegistering(false);
                  }
                }
              ]
            );
          } else {
            Alert.alert('Registration Closed', '❌ RSVP deadline has passed. Registration is closed.');
            setRegistering(false);
          }
          return;
        }
      }

      // Proceed with registration
      await updateDoc(eventRef, {
        attendees: arrayUnion(userId),
        attendeesCount: (event?.attendeesCount || 0) + 1,
        registeredAt: Timestamp.now()
      });
      
      setIsRegistered(true);
      Alert.alert('Success', '🎉 Successfully registered for event!');
      await fetchEventDetails();
      
    } catch (error) {
      console.error('Error updating registration:', error);
      Alert.alert('Error', 'Failed to update registration. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  const handleCancelRegistration = async () => {
    const userId = auth.currentUser?.uid || user?.uid;
    if (!userId || !isRegistered) return;

    const eventStartDate = (event?.startDate || event?.date)?.toDate();
    if (!eventStartDate) {
      Alert.alert('Error', 'Event date not found');
      return;
    }
    
    const now = new Date();
    const daysUntilEvent = Math.ceil((eventStartDate - now) / (1000 * 60 * 60 * 24));
    const cancellationDeadline = event?.cancellationDeadline || 7;
    
    if (daysUntilEvent < cancellationDeadline) {
      Alert.alert(
        'Cannot Cancel',
        `❌ You cannot cancel your registration less than ${cancellationDeadline} days before the event.\n\nThis helps organizers prepare food and materials.`
      );
      return;
    }

    if (eventStartDate < now) {
      Alert.alert('Cannot Cancel', '❌ Cannot cancel registration after event has started.');
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
            setRegistering(true);
            try {
              const eventRef = doc(db, 'events', eventId);
              await updateDoc(eventRef, {
                attendees: arrayRemove(userId),
                attendeesCount: Math.max(0, (event?.attendeesCount || 1) - 1),
                cancelledAt: Timestamp.now()
              });
              setIsRegistered(false);
              Alert.alert('Success', 'Registration cancelled successfully');
              await fetchEventDetails();
            } catch (error) {
              console.error('Error cancelling registration:', error);
              Alert.alert('Error', 'Failed to cancel registration. Please try again.');
            } finally {
              setRegistering(false);
            }
          }
        }
      ]
    );
  };

  const shareEvent = async () => {
    try {
      if (!event) return;
      
      const message = `Check out this event: ${event.title}\n\n` +
        `Date: ${event.formattedDateTime}\n` +
        `Location: ${event.isOnline ? 'Online' : event.venue || 'TBD'}\n` +
        `Available Spots: ${event.availableSpots}\n\n` +
        `Download the UPTM Events app to register!`;
      
      await Share.share({
        message: message,
        title: event.title
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const openMeetingLink = () => {
    if (event && event.meetingLink) {
      Linking.openURL(event.meetingLink).catch(err => {
        Alert.alert('Error', 'Could not open the meeting link');
      });
    }
  };

  const getStatusColor = (status) => {
    if (!status) return '#9E9E9E';
    switch(status.toLowerCase()) {
      case 'published': return '#4CAF50';
      case 'draft': return '#FF9800';
      case 'cancelled': return '#F44336';
      case 'completed': return '#2196F3';
      case 'ongoing': return '#3498db';
      default: return '#9E9E9E';
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      workshop: '#3498db',
      seminar: '#9b59b6',
      conference: '#2ecc71',
      competition: '#e74c3c',
      social: '#f39c12',
      training: '#1abc9c',
      lecture: '#34495e',
      webinar: '#e84393'
    };
    return colors[category?.toLowerCase()] || '#3498db';
  };

  // Function to format time for check-in
  const formatCheckInTime = (date) => {
    if (!date) return 'N/A';
    return date.toLocaleTimeString('en-MY', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E3B55" />
        <Text style={styles.loadingText}>Loading event details...</Text>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Event Details</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="info" size={60} color="#ccc" />
          <Text style={styles.emptyTitle}>Event Not Found</Text>
          <Text style={styles.emptyText}>The event you're looking for doesn't exist or has been removed.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOrganizer = user?.uid === event.organizerId || userData?.role === 'admin';
  const startDate = formatDate(event.startDate || event.date);
  const endDate = formatDate(event.endDate);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Event Details</Text>
        <TouchableOpacity onPress={shareEvent}>
          <Icon name="share" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#2E3B55']}
          />
        }
      >
        {/* Hero Section */}
        <View style={[styles.heroSection, event.isCancelled && styles.heroCancelled]}>
          {event.bannerImage ? (
            <Image source={{ uri: event.bannerImage }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroPlaceholder, { backgroundColor: getCategoryColor(event.category) }]}>
              <Icon name="event" size={50} color="#fff" />
            </View>
          )}
          
          <View style={styles.heroOverlay}>
            <View style={styles.categoryRow}>
              <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(event.category) }]}>
                <Text style={styles.categoryText}>
                  {event.category?.charAt(0).toUpperCase() + event.category?.slice(1) || 'Event'}
                </Text>
              </View>
              
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(event.status) }]}>
                <Text style={styles.statusText}>{event.status?.toUpperCase() || 'UNKNOWN'}</Text>
              </View>

              {event.isFeatured && !event.isCancelled && (
                <View style={styles.featuredBadge}>
                  <Icon name="star" size={12} color="#333" />
                  <Text style={styles.featuredText}>FEATURED</Text>
                </View>
              )}
            </View>

            <Text style={styles.heroTitle}>{event.title}</Text>

            {event.eventCode && (
              <View style={styles.eventCodeContainer}>
                <Icon name="confirmation-number" size={14} color="#fff" />
                <Text style={styles.eventCode}>Code: {event.eventCode}</Text>
              </View>
            )}

            {/* Quick Stats */}
            <View style={styles.quickStats}>
              <View style={styles.statItem}>
                <Icon name="people" size={20} color="#fff" />
                <Text style={styles.statNumber}>{event.attendeesCount || 0}</Text>
                <Text style={styles.statLabel}>Registered</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="check-circle" size={20} color="#fff" />
                <Text style={styles.statNumber}>{attendanceStats.attended}</Text>
                <Text style={styles.statLabel}>Attended</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="warning" size={20} color="#fff" />
                <Text style={styles.statNumber}>{attendanceStats.late}</Text>
                <Text style={styles.statLabel}>Late</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="trending-up" size={20} color="#fff" />
                <Text style={styles.statNumber}>{attendanceStats.attendanceRate}%</Text>
                <Text style={styles.statLabel}>Rate</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Cancellation Notice */}
        {event.isCancelled && (
          <View style={styles.cancellationNotice}>
            <Icon name="warning" size={24} color="#e74c3c" />
            <View style={styles.cancellationTextContainer}>
              <Text style={styles.cancellationTitle}>Event Cancelled</Text>
              <Text style={styles.cancellationMessage}>
                This event has been cancelled by the organizer.
                {event.cancellationReason && ` Reason: ${event.cancellationReason}`}
              </Text>
            </View>
          </View>
        )}

        {/* Event Meta */}
        <View style={styles.metaContainer}>
          <View style={styles.metaItem}>
            <Icon name="calendar-today" size={16} color="#2E3B55" />
            <Text style={styles.metaLabel}>Start:</Text>
            <Text style={styles.metaValue}>{startDate?.full || event.formattedDateTime}</Text>
          </View>
          
          <View style={styles.metaItem}>
            <Icon name="schedule" size={16} color="#2E3B55" />
            <Text style={styles.metaLabel}>End:</Text>
            <Text style={styles.metaValue}>{endDate?.full || 'Same day'}</Text>
          </View>
          
          <View style={styles.metaItem}>
            <Icon name="access-time" size={16} color="#2E3B55" />
            <Text style={styles.metaLabel}>Duration:</Text>
            <Text style={styles.metaValue}>{event.durationText}</Text>
          </View>
          
          <View style={styles.metaItem}>
            {event.isOnline ? (
              <>
                <Icon name="videocam" size={16} color="#2E3B55" />
                <Text style={styles.metaLabel}>Location:</Text>
                <Text style={styles.metaValue}>Online Event</Text>
              </>
            ) : (
              <>
                <Icon name="location-on" size={16} color="#2E3B55" />
                <Text style={styles.metaLabel}>Venue:</Text>
                <Text style={styles.metaValue}>
                  {event.venue}
                  {event.room && ` (${event.room})`}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* QR Code Scanner Card */}
        <View style={styles.qrCard}>
          <View style={styles.qrCardContent}>
            <View style={[styles.qrIconContainer, { backgroundColor: isRegistered ? '#2E3B55' : '#ccc' }]}>
              <Icon name="qr-code-scanner" size={28} color="#fff" />
            </View>
            <View style={styles.qrCardText}>
              <Text style={styles.qrCardTitle}>Event Check-in</Text>
              <Text style={styles.qrCardSubtitle}>
                {isRegistered 
                  ? hasCheckedIn 
                    ? checkInStatus === 'late' 
                      ? '⚠️ You checked in late' 
                      : '✓ You have already checked in'
                    : 'Scan QR code to check in' 
                  : 'Register first to check in'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.qrButton,
              isRegistered && !hasCheckedIn ? styles.qrButtonActive : styles.qrButtonDisabled
            ]}
            onPress={() => {
              if (isRegistered && !hasCheckedIn) {
                router.push({
                  pathname: '/qr-scanner',
                  params: { 
                    eventId: event.id, 
                    eventCode: event.eventCode,
                    eventTitle: event.title
                  }
                });
              } else if (isRegistered && hasCheckedIn) {
                Alert.alert('Already Checked In', `You have already checked in${checkInStatus === 'late' ? ' (late)' : ''} to this event.`);
              } else {
                Alert.alert('Not Registered', 'Please register for this event first.');
              }
            }}
            disabled={!isRegistered || hasCheckedIn}
          >
            <Icon name="qr-code" size={20} color="#fff" />
            <Text style={styles.qrButtonText}>
              {isRegistered 
                ? hasCheckedIn ? (checkInStatus === 'late' ? 'Checked In (Late)' : 'Checked In') : 'Scan QR'
                : 'Register First'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'overview' && styles.activeTab]}
            onPress={() => setActiveTab('overview')}
          >
            <Text style={[styles.tabText, activeTab === 'overview' && styles.activeTabText]}>Overview</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'description' && styles.activeTab]}
            onPress={() => setActiveTab('description')}
          >
            <Text style={[styles.tabText, activeTab === 'description' && styles.activeTabText]}>Description</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'details' && styles.activeTab]}
            onPress={() => setActiveTab('details')}
          >
            <Text style={[styles.tabText, activeTab === 'details' && styles.activeTabText]}>Details</Text>
          </TouchableOpacity>

          {isOrganizer && (
            <TouchableOpacity
              style={[styles.tab, activeTab === 'organizer' && styles.activeTab]}
              onPress={() => setActiveTab('organizer')}
            >
              <Text style={[styles.tabText, activeTab === 'organizer' && styles.activeTabText]}>Organizer</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'overview' && (
            <View>
              <Text style={styles.sectionTitle}>Event Overview</Text>
              
              <View style={styles.overviewCard}>
                <Text style={styles.cardSubtitle}>Short Description</Text>
                <Text style={styles.shortDescription}>
                  {event.shortDescription || 'No short description provided.'}
                </Text>
              </View>

              {/* PRETTY INFO GRID */}
              <View style={styles.infoGrid}>
                <View style={styles.infoCard}>
                  <View style={[styles.infoIconContainer, { backgroundColor: '#3498db20' }]}>
                    <Icon name="school" size={28} color="#3498db" />
                  </View>
                  <Text style={styles.infoTitle}>Faculty</Text>
                  <Text style={styles.infoText}>{event.faculty || 'All'}</Text>
                </View>
                
                <View style={styles.infoCard}>
                  <View style={[styles.infoIconContainer, { backgroundColor: '#f39c1220' }]}>
                    <Icon name="access-time" size={28} color="#f39c12" />
                  </View>
                  <Text style={styles.infoTitle}>Duration</Text>
                  <Text style={styles.infoText}>{event.durationText}</Text>
                </View>
                
                <View style={styles.infoCard}>
                  <View style={[styles.infoIconContainer, { backgroundColor: '#27ae6020' }]}>
                    <Icon name="group" size={28} color="#27ae60" />
                  </View>
                  <Text style={styles.infoTitle}>Audience</Text>
                  <Text style={styles.infoText}>
                    {event.targetAudience?.length > 0 
                      ? event.targetAudience.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
                      : 'Everyone'}
                  </Text>
                </View>
                
                <View style={styles.infoCard}>
                  <View style={[styles.infoIconContainer, { backgroundColor: '#e74c3c20' }]}>
                    <Icon name="how-to-reg" size={28} color="#e74c3c" />
                  </View>
                  <Text style={styles.infoTitle}>Registration</Text>
                  <Text style={styles.infoText}>
                    {event.requiresApproval ? 'Approval' : 'Open'}
                  </Text>
                </View>
              </View>

              <View style={styles.highlightsSection}>
                <Text style={styles.cardSubtitle}>Event Highlights</Text>
                <View style={styles.highlightsList}>
                  <Text style={styles.highlightItem}>✓ Digital Certificate of Participation</Text>
                  <Text style={styles.highlightItem}>✓ Networking opportunities</Text>
                  <Text style={styles.highlightItem}>✓ Practical hands-on sessions</Text>
                  <Text style={styles.highlightItem}>✓ Refreshments provided</Text>
                  <Text style={styles.highlightItem}>✓ Learning materials</Text>
                </View>
              </View>
            </View>
          )}

          {activeTab === 'description' && (
            <View>
              <Text style={styles.sectionTitle}>Full Description</Text>
              <View style={styles.descriptionContent}>
                <Text style={styles.description}>
                  {event.description || 'No detailed description provided.'}
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'details' && (
            <View>
              <Text style={styles.sectionTitle}>Event Details</Text>
              
              <View style={styles.detailSection}>
                <Text style={styles.cardSubtitle}>
                  {event.isOnline ? '📍 Online Event Details' : '📍 Venue Details'}
                </Text>
                
                {event.isOnline ? (
                  <View>
                    <Text style={styles.detailText}>Meeting Platform: Google Meet / Zoom</Text>
                    {event.meetingLink && (
                      <TouchableOpacity onPress={openMeetingLink} style={styles.linkButton}>
                        <Icon name="link" size={16} color="#3498db" />
                        <Text style={styles.linkText}>Click here to join</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <View>
                    <Text style={styles.detailText}>Venue: {event.venue || 'TBD'}</Text>
                    {event.room && <Text style={styles.detailText}>Room: {event.room}</Text>}
                    <Text style={styles.detailText}>Campus: UPTM University</Text>
                  </View>
                )}
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.cardSubtitle}>⏰ Timing Details</Text>
                <Text style={styles.detailText}>Start: {startDate?.full || event.formattedDateTime}</Text>
                <Text style={styles.detailText}>End: {endDate?.full || 'Same day'}</Text>
                <Text style={styles.detailText}>Duration: {event.durationText}</Text>
                <Text style={styles.detailText}>Check-in: Available during event time</Text>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.cardSubtitle}>📋 Registration Details</Text>
                <Text style={styles.detailText}>Capacity: {event.capacity} attendees</Text>
                <Text style={styles.detailText}>Minimum Required: {event.minAttendees || 5} attendees</Text>
                <Text style={styles.detailText}>Registration Status: {event.registrationOpen ? 'Open' : 'Closed'}</Text>
                <Text style={styles.detailText}>Approval Required: {event.requiresApproval ? 'Yes' : 'No'}</Text>
                {event.requiresRSVP && (
                  <>
                    {event.rsvpDeadlineFormatted && (
                      <Text style={styles.detailText}>RSVP Deadline: {event.rsvpDeadlineFormatted}</Text>
                    )}
                    <Text style={styles.detailText}>Cancellation Deadline: {event.cancellationDeadline || 7} days before</Text>
                  </>
                )}
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.cardSubtitle}>✓ Requirements</Text>
                <View style={styles.requirementsList}>
                  <Text style={styles.requirementItem}>• Valid UPTM Student/Staff ID</Text>
                  <Text style={styles.requirementItem}>• Registration confirmation (if required)</Text>
                  {event.isOnline && <Text style={styles.requirementItem}>• Stable internet connection</Text>}
                  {!event.isOnline && <Text style={styles.requirementItem}>• Face mask (if required)</Text>}
                  <Text style={styles.requirementItem}>• Arrive on time to avoid late marking</Text>
                </View>
              </View>
            </View>
          )}

          {activeTab === 'organizer' && isOrganizer && (
            <View>
              <Text style={styles.sectionTitle}>Organizer Dashboard</Text>
              
              {/* Event Status Alert */}
              {event.isCancelled ? (
                <View style={styles.cancelledAlert}>
                  <Icon name="warning" size={24} color="#e74c3c" />
                  <View style={styles.alertContent}>
                    <Text style={styles.alertTitle}>Event Cancelled</Text>
                    <Text style={styles.alertText}>
                      This event has been cancelled. You can reopen it if needed.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.activeAlert}>
                  <Icon name="check-circle" size={24} color="#27ae60" />
                  <View style={styles.alertContent}>
                    <Text style={styles.alertTitle}>Event Active</Text>
                    <Text style={styles.alertText}>
                      Event is currently {event.registrationOpen ? 'open' : 'closed'} for registration.
                    </Text>
                  </View>
                </View>
              )}
              
              {/* Quick Actions */}
              <View style={styles.quickActions}>
                <Text style={styles.cardSubtitle}>Quick Actions</Text>
                <View style={styles.webRecommendBanner}>
                  <Icon name="info" size={24} color="#0288d1" />
                  <View style={styles.webRecommendContent}>
                    <Text style={styles.webRecommendTitle}>📱 Web App Recommended</Text>
                    <Text style={styles.webRecommendText}>
                      For advanced organizer features like printing QR codes, viewing RSVP lists, 
                      downloading certificates, and managing attendees, please use the web version 
                      of UPTM Digital Events.
                    </Text>
                  </View>
                </View>
                <View style={styles.actionGrid}>
                  <TouchableOpacity 
                    style={styles.actionButton}
                    onPress={() => router.push(`/attendance/${event.id}`)}
                  >
                    <Icon name="qr-code-scanner" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Manage Attendance</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.actionButton}
                    onPress={() => {
                      fetchAttendeesWithStatus();
                      setShowAttendeesModal(true);
                    }}
                  >
                    <Icon name="people" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>
                      View Attendees ({event.attendeesCount || 0})
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* Event Management */}
              <View style={styles.eventManagement}>
                <Text style={styles.cardSubtitle}>Event Management</Text>
                
                {!event.isCancelled ? (
                  <View style={styles.cancelSection}>
                    <View style={styles.warningHeader}>
                      <Icon name="warning" size={20} color="#e74c3c" />
                      <Text style={styles.warningTitle}>Cancel Event</Text>
                    </View>
                    <Text style={styles.cancelDescription}>
                      Cancelling will close registration and notify all registered attendees. This action is reversible.
                    </Text>
                    <TouchableOpacity 
                      onPress={handleCancelEvent}
                      disabled={cancelling}
                      style={[styles.cancelButton, cancelling && styles.disabledButton]}
                    >
                      {cancelling ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.cancelButtonText}>Cancel This Event</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.reopenSection}>
                    <View style={styles.successHeader}>
                      <Icon name="check-circle" size={20} color="#27ae60" />
                      <Text style={styles.successTitle}>Reopen Event</Text>
                    </View>
                    <Text style={styles.reopenDescription}>
                      Reopen this event to allow new registrations. Previous registrations will need to re-register.
                    </Text>
                    <TouchableOpacity 
                      onPress={handleReopenEvent}
                      disabled={cancelling}
                      style={[styles.reopenButton, cancelling && styles.disabledButton]}
                    >
                      {cancelling ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.reopenButtonText}>Reopen This Event</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              
              {/* Statistics */}
              <View style={styles.statsCard}>
                <Text style={styles.cardSubtitle}>Event Statistics</Text>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statNumberLarge}>{event.attendeesCount || 0}</Text>
                    <Text style={styles.statLabelSmall}>Registered</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statNumberLarge}>{event.availableSpots}</Text>
                    <Text style={styles.statLabelSmall}>Available</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statNumberLarge}>
                      {Math.round(((event.attendeesCount || 0) / (event.capacity || 1)) * 100)}%
                    </Text>
                    <Text style={styles.statLabelSmall}>Capacity</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statNumberLarge}>{attendanceStats.attendanceRate}%</Text>
                    <Text style={styles.statLabelSmall}>Attendance</Text>
                  </View>
                </View>
                
                <View style={styles.registrationStatus}>
                  <Text style={styles.statusLabel}>Registration Status: </Text>
                  <Text style={[
                    styles.statusValue,
                    event.registrationOpen ? styles.statusOpen : styles.statusClosed
                  ]}>
                    {event.registrationOpen ? 'OPEN' : 'CLOSED'}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Registration Card - Only show for non-organizers */}
        {!isOrganizer && (
          <View style={styles.registrationCard}>
            <View style={styles.registrationHeader}>
              <Text style={styles.registrationTitle}>Registration</Text>
              <View style={[
                styles.registrationStatusBadge,
                event.isCancelled && styles.statusCancelled,
                event.isPastEvent && styles.statusEnded,
                !event.registrationOpen && !event.isCancelled && !event.isPastEvent && styles.statusClosed,
                event.isFull && styles.statusFull,
                event.canRegister && styles.statusOpen,
                event.canRegisterWalkIn && styles.statusWalkIn
              ]}>
                <Text style={styles.registrationStatusText}>
                  {event.isCancelled ? 'Cancelled' :
                   event.isPastEvent ? 'Ended' :
                   !event.registrationOpen ? 'Closed' :
                   event.isFull ? 'Full' :
                   event.canRegisterWalkIn ? 'Walk-in' :
                   event.canRegister ? 'Open' : 'Closed'}
                </Text>
              </View>
            </View>

            {isRegistered && !event.isCancelled && !event.isPastEvent && (
              <View style={[
                styles.checkinStatus,
                hasCheckedIn ? (checkInStatus === 'late' ? styles.lateCheckIn : styles.checkedIn) : styles.notCheckedIn
              ]}>
                <Icon 
                  name={hasCheckedIn ? (checkInStatus === 'late' ? "warning" : "check-circle") : "access-time"} 
                  size={20} 
                  color={hasCheckedIn ? (checkInStatus === 'late' ? "#f39c12" : "#27ae60") : "#e67e22"} 
                />
                <Text style={[
                  styles.checkinText,
                  hasCheckedIn ? (checkInStatus === 'late' ? styles.lateCheckInText : styles.checkedInText) : styles.notCheckedInText
                ]}>
                  {hasCheckedIn ? (checkInStatus === 'late' ? '⚠️ Checked in (Late)' : '✓ Checked in') : '⏳ Not checked in'}
                </Text>
              </View>
            )}

            {event.requiresRSVP && event.rsvpDeadlineFormatted && (
              <View style={[
                styles.deadlineInfo,
                isRsvpDeadlinePassed() && styles.deadlinePassed
              ]}>
                <View style={styles.deadlineHeader}>
                  <Icon name="access-time" size={16} color={isRsvpDeadlinePassed() ? "#e74c3c" : "#f39c12"} />
                  <Text style={styles.deadlineTitle}>RSVP Deadline</Text>
                </View>
                <Text style={styles.deadlineDatetime}>{event.rsvpDeadlineFormatted}</Text>
                {isRsvpDeadlinePassed() ? (
                  <View style={styles.deadlineStatusPassed}>
                    <Text style={styles.deadlineStatusText}>
                      ❌ Deadline passed{event.allowWalkIn ? ' (Walk-ins allowed)' : ''}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.deadlineStatusActive}>
                    <Text style={styles.deadlineStatusText}>
                      ⏳ Closes in {Math.ceil((event.rsvpDeadline.toDate() - new Date()) / (1000 * 60 * 60))} hours
                    </Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.capacitySection}>
              <View style={styles.capacityHeader}>
                <Text style={styles.capacityLabel}>Available Spots: </Text>
                <Text style={[
                  styles.availableSpots,
                  event.availableSpots <= 5 && styles.spotsCritical,
                  event.availableSpots <= 10 && event.availableSpots > 5 && styles.spotsWarning
                ]}>
                  {event.availableSpots} / {event.capacity}
                </Text>
              </View>
              
              <View style={styles.capacityBar}>
                <View style={[
                  styles.capacityFill,
                  { width: `${Math.min(100, ((event.attendeesCount || 0) / (event.capacity || 1)) * 100)}%` }
                ]} />
              </View>
            </View>

            {/* Separate buttons for Register and Cancel */}
            {!isRegistered ? (
              <TouchableOpacity
                style={[
                  styles.registerButton,
                  event.canRegister ? styles.registerActiveButton : 
                  event.canRegisterWalkIn ? styles.walkinButton : styles.registerDisabledButton,
                  (registering || (!event.canRegister && !event.canRegisterWalkIn)) && styles.registerDisabledButton
                ]}
                onPress={handleRegistration}
                disabled={registering || (!event.canRegister && !event.canRegisterWalkIn)}
              >
                {registering ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.registerButtonText}>
                    {event.requiresApproval ? 'Request Approval' :
                     event.canRegisterWalkIn ? 'Register as Walk-in' :
                     'Register Now'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.registerButton, styles.cancelRegisterButton]}
                onPress={handleCancelRegistration}
                disabled={registering}
              >
                {registering ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.registerButtonText}>Cancel Registration</Text>
                )}
              </TouchableOpacity>
            )}

            {isRegistered && (
              <View style={styles.cancellationRules}>
                {canCancelRegistration() ? (
                  <Text style={styles.cancellationAllowed}>
                    ✅ You can cancel until{' '}
                    {getCancellationDeadlineDate()?.toLocaleDateString()}
                  </Text>
                ) : (
                  <Text style={styles.cancellationBlocked}>
                    🔒 Cannot cancel - less than {event.cancellationDeadline || 7} days before
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Organizer Info */}
        <View style={styles.organizerCard}>
          <Text style={styles.cardTitle}>Event Organizer</Text>
          <View style={styles.organizerInfo}>
            <View style={styles.organizerAvatar}>
              <Text style={styles.avatarText}>
                {event.organizerName?.charAt(0) || 'U'}
              </Text>
            </View>
            <View style={styles.organizerDetails}>
              <Text style={styles.organizerName}>{event.organizerName || 'UPTM Organizer'}</Text>
              <View style={styles.organizerContact}>
                <Icon name="email" size={14} color="#666" />
                <Text style={styles.organizerEmail}>{event.organizerEmail || 'organizer@uptm.edu.my'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Important Info */}
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Important Information</Text>
          <View style={styles.notesList}>
            <Text style={styles.noteItem}>• Bring your student/staff ID for verification</Text>
            <Text style={styles.noteItem}>• Attendance via QR code scanning</Text>
            <Text style={styles.noteItem}>• Arrive on time - late arrivals will be marked as "Late"</Text>
            <Text style={styles.noteItem}>• Digital certificate issued after event</Text>
            {event.requiresRSVP && !event.isPastEvent && !event.isCancelled && (
              <Text style={styles.noteItem}>• Cancellation allowed up to {event.cancellationDeadline || 7} days before</Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* ENHANCED Attendees Modal with Late Status */}
      <Modal
        visible={showAttendeesModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAttendeesModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Attendees</Text>
                <View style={styles.modalStats}>
                  <Text style={styles.modalStatText}>
                    Total: {attendees.length} | 
                    Present: {attendees.filter(a => a.attendanceStatus === 'present').length} | 
                    Late: {attendees.filter(a => a.attendanceStatus === 'late').length} |
                    Not Checked: {attendees.filter(a => !a.present).length}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowAttendeesModal(false)}>
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <ScrollView>
              {attendees.length === 0 ? (
                <Text style={styles.modalEmpty}>No attendees registered yet</Text>
              ) : (
                attendees.map((attendee) => (
                  <View key={attendee.id} style={styles.attendeeItem}>
                    <View style={styles.attendeeAvatar}>
                      <Text style={styles.attendeeAvatarText}>
                        {attendee.name?.charAt(0)?.toUpperCase() || 'U'}
                      </Text>
                    </View>
                    <View style={styles.attendeeInfo}>
                      <Text style={styles.attendeeName}>{attendee.name}</Text>
                      <Text style={styles.attendeeEmail}>{attendee.email}</Text>
                      {attendee.matricNumber !== 'N/A' && (
                        <Text style={styles.attendeeMatric}>Matric: {attendee.matricNumber}</Text>
                      )}
                      {attendee.checkInTime && (
                        <Text style={[
                          styles.attendeeTime,
                          attendee.isLate && styles.attendeeLateTime
                        ]}>
                          {attendee.isLate ? '⚠️ Late check-in: ' : '✓ Checked in: '}
                          {formatCheckInTime(attendee.checkInTime)} via {attendee.checkInMethod?.toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={[
                      styles.attendeeStatusBadge,
                      attendee.attendanceStatus === 'present' ? styles.presentBadge : 
                      attendee.attendanceStatus === 'late' ? styles.lateBadge : 
                      styles.registeredBadge
                    ]}>
                      <Icon 
                        name={attendee.attendanceStatus === 'present' ? "check-circle" : 
                              attendee.attendanceStatus === 'late' ? "warning" : "pending"} 
                        size={16} 
                        color={attendee.attendanceStatus === 'present' ? "#27ae60" : 
                               attendee.attendanceStatus === 'late' ? "#f39c12" : 
                               "#f39c12"} 
                      />
                      <Text style={[
                        styles.attendeeStatusText,
                        attendee.attendanceStatus === 'present' ? styles.presentText : 
                        attendee.attendanceStatus === 'late' ? styles.lateText : 
                        styles.registeredText
                      ]}>
                        {attendee.attendanceStatus === 'present' ? 'Present' : 
                         attendee.attendanceStatus === 'late' ? 'Late' : 
                         'Registered'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableOpacity 
                style={styles.closeModalButton}
                onPress={() => setShowAttendeesModal(false)}
              >
                <Text style={styles.closeModalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Certificate Modal placeholder */}
      <Modal
        visible={showCertificateModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCertificateModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate Certificates</Text>
              <TouchableOpacity onPress={() => setShowCertificateModal(false)}>
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalText}>Certificate generation coming soon!</Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
  
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2E3B55',
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2E3B55',
  },
  loadingText: {
    color: '#fff',
    marginTop: 20,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
  heroSection: {
    height: 250,
    position: 'relative',
  },
  heroCancelled: {
    opacity: 0.8,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 20,
  },
  categoryRow: {
    flexDirection: 'row',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 5,
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 5,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  featuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 15,
  },
  featuredText: {
    color: '#333',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  heroTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  eventCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  eventCode: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginLeft: 5,
  },
  quickStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 2,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
  },
  cancellationNotice: {
    flexDirection: 'row',
    backgroundColor: '#fee',
    padding: 15,
    margin: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fbb',
  },
  cancellationTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  cancellationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e74c3c',
  },
  cancellationMessage: {
    fontSize: 14,
    color: '#c0392b',
    marginTop: 4,
  },
  metaContainer: {
    backgroundColor: 'white',
    margin: 15,
    marginTop: 0,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  metaLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginLeft: 5,
    marginRight: 5,
    minWidth: 70,
  },
  metaValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  // QR Card Styles
  qrCard: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginBottom: 15,
    padding: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  qrCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  qrIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  qrCardText: {
    flex: 1,
  },
  qrCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  qrCardSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  qrButtonActive: {
    backgroundColor: '#2E3B55',
  },
  qrButtonDisabled: {
    backgroundColor: '#ccc',
  },
  qrButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginTop: 5,
    borderRadius: 10,
    padding: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#2E3B55',
  },
  tabText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  tabContent: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginTop: 10,
    marginBottom: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2E3B55',
    marginBottom: 15,
  },
  overviewCard: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
  },
  cardSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  shortDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  // PRETTY INFO GRID - New styles
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  infoCard: {
    width: '48%',
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  infoIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 5,
  },
  highlightsSection: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
  },
  highlightsList: {
    marginTop: 5,
  },
  highlightItem: {
    fontSize: 13,
    color: '#666',
    marginBottom: 5,
    lineHeight: 18,
  },
  descriptionContent: {
    minHeight: 100,
  },
  description: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 5,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  linkText: {
    color: '#3498db',
    marginLeft: 5,
    fontSize: 14,
  },
  requirementsList: {
    marginTop: 5,
  },
  requirementItem: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
  },
  // Organizer Tools Styles
  cancelledAlert: {
    flexDirection: 'row',
    backgroundColor: '#fee',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#fbb',
  },
  activeAlert: {
    flexDirection: 'row',
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#c3e6cb',
  },
  alertContent: {
    flex: 1,
    marginLeft: 10,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  alertText: {
    fontSize: 14,
    color: '#666',
  },
  quickActions: {
    marginBottom: 20,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionButton: {
    width: '48%',
    backgroundColor: '#2E3B55',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  eventManagement: {
    marginBottom: 20,
  },
  cancelSection: {
    backgroundColor: '#fee',
    padding: 15,
    borderRadius: 8,
  },
  reopenSection: {
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 8,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e74c3c',
    marginLeft: 8,
  },
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#27ae60',
    marginLeft: 8,
  },
  cancelDescription: {
    fontSize: 13,
    color: '#c0392b',
    marginBottom: 12,
    lineHeight: 18,
  },
  reopenDescription: {
    fontSize: 13,
    color: '#27ae60',
    marginBottom: 12,
    lineHeight: 18,
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  reopenButton: {
    backgroundColor: '#27ae60',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  reopenButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  statsCard: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 10,
  },
  statNumberLarge: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E3B55',
  },
  statLabelSmall: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  registrationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  statusOpen: {
    color: '#27ae60',
  },
  statusClosed: {
    color: '#e74c3c',
  },
  exportSection: {
    marginBottom: 10,
  },
  exportButtons: {
    marginTop: 10,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  exportButtonText: {
    fontSize: 14,
    color: '#2E3B55',
    marginLeft: 10,
    flex: 1,
  },
  // Registration Card
  registrationCard: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginBottom: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  registrationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  registrationTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  registrationStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusCancelled: {
    backgroundColor: '#e74c3c',
  },
  statusEnded: {
    backgroundColor: '#7f8c8d',
  },
  statusClosed: {
    backgroundColor: '#95a5a6',
  },
  statusFull: {
    backgroundColor: '#c0392b',
  },
  statusOpen: {
    backgroundColor: '#27ae60',
  },
  statusWalkIn: {
    backgroundColor: '#f39c12',
  },
  registrationStatusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  checkinStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
  },
  checkedIn: {
    backgroundColor: '#e8f5e9',
    borderColor: '#27ae60',
  },
  notCheckedIn: {
    backgroundColor: '#fff3e0',
    borderColor: '#e67e22',
  },
  checkinText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  checkedInText: {
    color: '#27ae60',
  },
  notCheckedInText: {
    color: '#e67e22',
  },
  deadlineInfo: {
    backgroundColor: '#fff9e6',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#f1c40f',
  },
  deadlinePassed: {
    backgroundColor: '#fee',
    borderColor: '#e74c3c',
  },
  deadlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  deadlineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginLeft: 5,
  },
  deadlineDatetime: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 10,
  },
  deadlineStatusPassed: {
    backgroundColor: '#e74c3c',
    padding: 8,
    borderRadius: 5,
  },
  deadlineStatusActive: {
    backgroundColor: '#f39c12',
    padding: 8,
    borderRadius: 5,
  },
  deadlineStatusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  capacitySection: {
    marginBottom: 20,
  },
  capacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  capacityLabel: {
    fontSize: 14,
    color: '#666',
  },
  availableSpots: {
    fontSize: 14,
    fontWeight: '600',
  },
  spotsCritical: {
    color: '#e74c3c',
  },
  spotsWarning: {
    color: '#f39c12',
  },
  capacityBar: {
    height: 8,
    backgroundColor: '#ecf0f1',
    borderRadius: 4,
    overflow: 'hidden',
  },
  capacityFill: {
    height: '100%',
    backgroundColor: '#2E3B55',
  },
  registerButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  registerActiveButton: {
    backgroundColor: '#27ae60',
  },
  cancelRegisterButton: {
    backgroundColor: '#e74c3c',
  },
  walkinButton: {
    backgroundColor: '#f39c12',
  },
  registerDisabledButton: {
    backgroundColor: '#bdc3c7',
  },
  registerButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cancellationRules: {
    marginBottom: 10,
  },
  cancellationAllowed: {
    fontSize: 12,
    color: '#27ae60',
    textAlign: 'center',
  },
  cancellationBlocked: {
    fontSize: 12,
    color: '#e74c3c',
    textAlign: 'center',
  },
  // Organizer Card
  organizerCard: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginBottom: 15,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  organizerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  organizerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2E3B55',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  organizerDetails: {
    flex: 1,
  },
  organizerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  organizerContact: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  organizerEmail: {
    fontSize: 14,
    color: '#666',
    marginLeft: 5,
  },
  infoCard: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginBottom: 30,
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  notesList: {
    marginTop: 5,
  },
  noteItem: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    lineHeight: 18,
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalStats: {
    marginTop: 5,
  },
  modalStatText: {
    fontSize: 12,
    color: '#666',
  },
  modalBody: {
    padding: 20,
    alignItems: 'center',
  },
  modalText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  modalEmpty: {
    padding: 40,
    textAlign: 'center',
    color: '#999',
    fontSize: 16,
  },
  attendeeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  attendeeAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2E3B55',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  attendeeAvatarText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  attendeeInfo: {
    flex: 1,
  },
  attendeeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  attendeeEmail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  attendeeMatric: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  attendeeTime: {
    fontSize: 10,
    color: '#27ae60',
    marginTop: 2,
  },
  attendeeStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    marginLeft: 10,
  },
  presentBadge: {
    backgroundColor: '#e8f5e9',
  },
  registeredBadge: {
    backgroundColor: '#fff3e0',
  },
  attendeeStatusText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  presentText: {
    color: '#27ae60',
  },
  registeredText: {
    color: '#f39c12',
  },
  modalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  closeModalButton: {
    backgroundColor: '#2E3B55',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  webRecommendBanner: {
    flexDirection: 'row',
    backgroundColor: '#e1f5fe',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#4fc3f7',
    alignItems: 'center',
  },
  webRecommendContent: {
    flex: 1,
    marginLeft: 10,
  },
  webRecommendTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0288d1',
    marginBottom: 4,
  },
  webRecommendText: {
    fontSize: 13,
    color: '#0277bd',
    lineHeight: 18,
  },
  lateBadge: {
  backgroundColor: '#fff3e0',
},
lateText: {
  color: '#f39c12',
},
attendeeLateTime: {
  fontSize: 10,
  color: '#f39c12',
  marginTop: 2,
  fontWeight: '500',
},
});