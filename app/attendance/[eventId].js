import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { auth, db } from '../../src/screens/firebase';

export default function AttendanceManagementScreen() {
  const { eventId } = useLocalSearchParams();
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [event, setEvent] = useState(null);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [manualUserId, setManualUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [stats, setStats] = useState({
    registered: 0,
    present: 0,
    late: 0,
    absent: 0
  });

  // Refs to manage the Firestore listener
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    loadUserData();
  }, []);

  useEffect(() => {
    if (eventId && user) {
      fetchEventData();
      // Clean up previous listener
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // Set up new real-time listener
      const unsubscribe = setupRealtimeAttendance();
      unsubscribeRef.current = unsubscribe;
    }
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
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

  const fetchEventData = async () => {
    try {
      setLoading(true);
      setError('');

      // Fetch event details
      const eventDoc = await getDoc(doc(db, 'events', eventId));
      
      if (!eventDoc.exists()) {
        setError('Event not found');
        router.back();
        return;
      }

      const eventData = {
        id: eventDoc.id,
        ...eventDoc.data(),
        date: eventDoc.data().date?.toDate?.() || new Date()
      };
      setEvent(eventData);

      // Fetch registered users
      await fetchRegisteredUsers(eventData);

    } catch (error) {
      console.error('Error fetching event data:', error);
      setError('Failed to load event data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchRegisteredUsers = async (eventData) => {
    try {
      if (eventData.attendees && eventData.attendees.length > 0) {
        const users = [];
        
        // Process in batches to avoid too many requests
        for (const authUid of eventData.attendees) {
          try {
            const userDoc = await getDoc(doc(db, 'users', authUid));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              users.push({
                id: authUid,
                userId: userData.userId || userData.matricNumber || 'N/A',
                name: userData.name || 'Unknown User',
                email: userData.email || 'N/A',
                registered: true
              });
            } else {
              users.push({
                id: authUid,
                userId: 'N/A',
                name: 'Unknown User',
                email: 'N/A',
                registered: false
              });
            }
          } catch (error) {
            console.error(`Error fetching user ${authUid}:`, error);
          }
        }
        
        setRegisteredUsers(users);
      } else {
        setRegisteredUsers([]);
      }
    } catch (error) {
      console.error('Error fetching registered users:', error);
    }
  };

  const setupRealtimeAttendance = () => {
    console.log('Setting up real-time attendance listener for event:', eventId);
    const attendanceQuery = query(
      collection(db, 'attendance'),
      where('eventId', '==', eventId),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(
      attendanceQuery,
      (snapshot) => {
        console.log('📡 Attendance snapshot received, docs count:', snapshot.docs.length);
        const records = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate?.()
        }));
        setAttendanceRecords(records);
        
        // Update stats
        const present = records.filter(r => r.status === 'present').length;
        const late = records.filter(r => r.status === 'late').length;
        const absent = records.filter(r => r.status === 'absent').length;
        
        setStats({
          registered: registeredUsers.length,
          present,
          late,
          absent
        });
      },
      (error) => {
        console.warn('❌ Realtime listener error:', error);
        if (error.message?.includes('index')) {
          Alert.alert(
            'Missing Firestore Index',
            'Please create the required composite index in the Firebase console. Check the browser console for the exact link.'
          );
        }
      }
    );

    return unsubscribe;
  };

  const markAttendance = async (userId, status = 'present') => {
    try {
      console.log('Marking attendance for:', { userId, status, eventId });
      setIsProcessing(true);
      setError('');

      if (!userId || !userId.trim()) {
        Alert.alert('Error', 'User ID is required');
        setIsProcessing(false);
        return;
      }

      const trimmedUserId = userId.trim().toUpperCase();

      // First, check if user exists in users_by_id collection using the custom userId
      const userByIdDoc = await getDoc(doc(db, 'users_by_id', trimmedUserId));
      
      if (!userByIdDoc.exists()) {
        Alert.alert('Error', `User with ID "${trimmedUserId}" not found in the system`);
        setIsProcessing(false);
        return;
      }

      const userByIdData = userByIdDoc.data();
      const authUid = userByIdData.authUid;
      
      // Now get the full user document using the auth UID
      const userDoc = await getDoc(doc(db, 'users', authUid));
      
      if (!userDoc.exists()) {
        Alert.alert('Error', 'User data not found');
        setIsProcessing(false);
        return;
      }

      const fullUserData = userDoc.data();
      
      // Check if user is registered for this event
      const isRegistered = event?.attendees?.includes(authUid);

      // Use batch for atomic operations
      const batch = writeBatch(db);

      // Register user if not registered
      if (!isRegistered) {
        // Ask for confirmation
        Alert.alert(
          'Register User',
          `${fullUserData.name || 'User'} (${trimmedUserId}) is not registered. Register them now?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setIsProcessing(false) },
            {
              text: 'Register & Mark',
              onPress: async () => {
                try {
                  // Register user to event
                  const eventRef = doc(db, 'events', eventId);
                  batch.update(eventRef, {
                    attendees: arrayUnion(authUid),
                    attendeesCount: increment(1)
                  });

                  // Update local state
                  setEvent(prev => ({
                    ...prev,
                    attendees: [...(prev?.attendees || []), authUid],
                    attendeesCount: (prev?.attendeesCount || 0) + 1
                  }));

                  setRegisteredUsers(prev => [...prev, {
                    id: authUid,
                    userId: trimmedUserId,
                    name: fullUserData.name || 'New User',
                    email: fullUserData.email || 'N/A',
                    registered: true
                  }]);

                  // Proceed with attendance marking
                  await completeAttendanceMarking(batch, authUid, fullUserData, status);
                } catch (error) {
                  console.error('Error during registration + attendance:', error);
                  Alert.alert('Error', `Failed: ${error.message}`);
                  setIsProcessing(false);
                }
              }
            }
          ]
        );
        return;
      }

      // User is already registered, proceed with attendance
      await completeAttendanceMarking(batch, authUid, fullUserData, status);

    } catch (error) {
      console.error('Error marking attendance:', error);
      Alert.alert('Error', `Failed to mark attendance: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const completeAttendanceMarking = async (batch, authUid, userData, status) => {
    try {
      const existingRecord = attendanceRecords.find(r => r.userId === authUid);
      const shouldIncrementCount = status === 'present' && (!existingRecord || existingRecord.status !== 'present');

      // Create attendance record
      const attendanceId = `${eventId}_${authUid}`;
      const attendanceRef = doc(db, 'attendance', attendanceId);
      
      const attendanceData = {
        eventId,
        userId: authUid,
        userName: userData.name || 'Unknown User',
        userEmail: userData.email || 'N/A',
        userMatric: userData.userId || userData.matricNumber || 'N/A',
        userFaculty: userData.faculty || 'N/A',
        status,
        timestamp: serverTimestamp(),
        markedBy: auth.currentUser?.uid || user?.uid || 'system',
        markedByName: userData?.displayName || userData?.name || 'Organizer',
        updatedAt: serverTimestamp()
      };

      batch.set(attendanceRef, attendanceData, { merge: true });

      // Update event stats if needed
      if (shouldIncrementCount) {
        const eventRef = doc(db, 'events', eventId);
        batch.update(eventRef, {
          attendedCount: increment(1)
        });

        setEvent(prev => ({
          ...prev,
          attendedCount: (prev?.attendedCount || 0) + 1
        }));
      }

      // Optimistically update local attendance records
      setAttendanceRecords(prev => {
        const existingIndex = prev.findIndex(r => r.userId === authUid);
        const newRecord = { 
          ...attendanceData, 
          id: attendanceId,
          timestamp: new Date() // temporary local timestamp
        };
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = newRecord;
          return updated;
        } else {
          return [newRecord, ...prev];
        }
      });

      // Commit batch
      await batch.commit();
      console.log('✅ Batch commit successful for', authUid, status);

      // Show success message
      Alert.alert(
        'Success',
        `✅ Attendance marked as ${status} for ${userData.name || authUid}`
      );

      setManualUserId('');
      setShowManualModal(false);

    } catch (error) {
      console.error('❌ Error in completeAttendanceMarking:', error);
      throw error;
    }
  };

  const getAttendanceStatus = (authUid) => {
    const record = attendanceRecords.find(r => r.userId === authUid);
    return record ? record.status : 'not_marked';
  };

  const getAttendanceRecord = (authUid) => {
    return attendanceRecords.find(r => r.userId === authUid);
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'present': return '#28a745';
      case 'late': return '#ffc107';
      case 'absent': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'present': return 'check-circle';
      case 'late': return 'access-time';
      case 'absent': return 'cancel';
      default: return 'help';
    }
  };

  const filteredAttendees = registeredUsers.filter(attendee => {
    const matchesSearch = 
      attendee.userId?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      attendee.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      attendee.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const status = getAttendanceStatus(attendee.id);
    const matchesFilter = filter === 'all' || status === filter;
    
    return matchesSearch && matchesFilter;
  });

  const exportAttendance = () => {
    if (attendanceRecords.length === 0) {
      Alert.alert('No Data', 'No attendance records to export');
      return;
    }

    const presentList = attendanceRecords.filter(r => r.status === 'present');
    const lateList = attendanceRecords.filter(r => r.status === 'late');
    const absentList = attendanceRecords.filter(r => r.status === 'absent');

    let summary = `📊 ATTENDANCE SUMMARY\n`;
    summary += `Event: ${event?.title}\n`;
    summary += `Date: ${event?.date?.toLocaleDateString()}\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    summary += `📈 STATISTICS:\n`;
    summary += `• Total Registered: ${stats.registered}\n`;
    summary += `• Present: ${stats.present}\n`;
    summary += `• Late: ${stats.late}\n`;
    summary += `• Absent: ${stats.absent}\n`;
    summary += `• Not Marked: ${stats.registered - (stats.present + stats.late + stats.absent)}\n\n`;

    if (presentList.length > 0) {
      summary += `✅ PRESENT (${presentList.length}):\n`;
      presentList.forEach(r => {
        summary += `  • ${r.userName} (${r.userMatric})\n`;
      });
      summary += `\n`;
    }

    if (lateList.length > 0) {
      summary += `⏰ LATE (${lateList.length}):\n`;
      lateList.forEach(r => {
        summary += `  • ${r.userName} (${r.userMatric})\n`;
      });
      summary += `\n`;
    }

    if (absentList.length > 0) {
      summary += `❌ ABSENT (${absentList.length}):\n`;
      absentList.forEach(r => {
        summary += `  • ${r.userName} (${r.userMatric})\n`;
      });
      summary += `\n`;
    }

    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `Generated: ${new Date().toLocaleString()}`;
    
    Alert.alert('Attendance Report', summary);
  };

  const openQRScanner = () => {
    if (!event) {
      Alert.alert('Error', 'Event data not loaded');
      return;
    }

    // Navigate to your existing QR scanner screen
    router.push({
      pathname: '/qr-scanner',
      params: { 
        eventId: event.id,
        eventCode: event.eventCode,
        eventTitle: event.title,
        requiresRSVP: event.requiresRSVP ? 'true' : 'false'
      }
    });
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchEventData();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2E3B55" />
        <Text style={styles.loadingText}>Loading Attendance Management...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance Management</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Icon name="refresh" size={24} color="#fff" />
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
        {/* Event Info Card */}
        {event && (
          <View style={styles.eventCard}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.eventCode}>Code: {event.eventCode}</Text>
            <View style={styles.eventDetails}>
              <Text style={styles.eventDetail}>📅 {event.date?.toLocaleDateString()}</Text>
              <Text style={styles.eventDetail}>📍 {event.venue}</Text>
            </View>
            
            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Icon name="people" size={20} color="#2E3B55" />
                <Text style={styles.statNumber}>{stats.registered}</Text>
                <Text style={styles.statLabel}>Registered</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="check-circle" size={20} color="#28a745" />
                <Text style={styles.statNumber}>{stats.present}</Text>
                <Text style={styles.statLabel}>Present</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="access-time" size={20} color="#ffc107" />
                <Text style={styles.statNumber}>{stats.late}</Text>
                <Text style={styles.statLabel}>Late</Text>
              </View>
              <View style={styles.statItem}>
                <Icon name="cancel" size={20} color="#dc3545" />
                <Text style={styles.statNumber}>{stats.absent}</Text>
                <Text style={styles.statLabel}>Absent</Text>
              </View>
            </View>
          </View>
        )}

        {/* Error Message */}
        {error ? (
          <View style={styles.errorCard}>
            <Icon name="error" size={24} color="#dc3545" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.actionGrid}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={openQRScanner}
          >
            <Icon name="qr-code-scanner" size={32} color="#fff" />
            <Text style={styles.actionButtonText}>Open Scanner</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => setShowManualModal(true)}
          >
            <Icon name="person-add" size={32} color="#fff" />
            <Text style={styles.actionButtonText}>Manual Entry</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={exportAttendance}
          >
            <Icon name="download" size={32} color="#fff" />
            <Text style={styles.actionButtonText}>Summary</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => setShowFilterModal(true)}
          >
            <Icon name="filter-list" size={32} color="#fff" />
            <Text style={styles.actionButtonText}>Filter</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by ID, name, or email"
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholderTextColor="#999"
          />
          {searchTerm ? (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <Icon name="close" size={20} color="#999" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Current Filter Indicator */}
        {filter !== 'all' && (
          <View style={styles.filterIndicator}>
            <Text style={styles.filterText}>Filter: {filter.toUpperCase()}</Text>
            <TouchableOpacity onPress={() => setFilter('all')}>
              <Icon name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        )}

        {/* Attendance List */}
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>
            Attendees ({filteredAttendees.length})
          </Text>

          {filteredAttendees.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="people-outline" size={60} color="#ccc" />
              <Text style={styles.emptyStateText}>
                {searchTerm || filter !== 'all' 
                  ? 'No matching attendees found' 
                  : 'No registered attendees yet'}
              </Text>
            </View>
          ) : (
            filteredAttendees.map((attendee) => {
              const status = getAttendanceStatus(attendee.id);
              const record = getAttendanceRecord(attendee.id);
              
              return (
                <View key={attendee.id} style={styles.attendeeCard}>
                  <View style={styles.attendeeHeader}>
                    <View style={styles.attendeeAvatar}>
                      <Text style={styles.avatarText}>
                        {attendee.name?.charAt(0)?.toUpperCase() || 'U'}
                      </Text>
                    </View>
                    <View style={styles.attendeeInfo}>
                      <Text style={styles.attendeeName}>{attendee.name || 'Unknown User'}</Text>
                      <Text style={styles.attendeeId} numberOfLines={1}>
                        ID: {attendee.userId}
                      </Text>
                      <Text style={styles.attendeeEmail}>{attendee.email || 'N/A'}</Text>
                    </View>
                    <View style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(status) }
                    ]}>
                      <Icon name={getStatusIcon(status)} size={14} color="#fff" />
                      <Text style={styles.statusText}>
                        {status.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {record?.timestamp && (
                    <Text style={styles.timestamp}>
                      ⏱️ {record.timestamp.toLocaleTimeString()}
                    </Text>
                  )}

                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={[styles.smallActionButton, { backgroundColor: '#28a745' }]}
                      onPress={() => markAttendance(attendee.userId, 'present')}
                      disabled={isProcessing || status === 'present'}
                    >
                      <Icon name="check-circle" size={16} color="#fff" />
                      <Text style={styles.smallActionText}>Present</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallActionButton, { backgroundColor: '#ffc107' }]}
                      onPress={() => markAttendance(attendee.userId, 'late')}
                      disabled={isProcessing || status === 'late'}
                    >
                      <Icon name="access-time" size={16} color="#fff" />
                      <Text style={styles.smallActionText}>Late</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallActionButton, { backgroundColor: '#dc3545' }]}
                      onPress={() => markAttendance(attendee.userId, 'absent')}
                      disabled={isProcessing || status === 'absent'}
                    >
                      <Icon name="cancel" size={16} color="#fff" />
                      <Text style={styles.smallActionText}>Absent</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Manual Entry Modal */}
      <Modal
        visible={showManualModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowManualModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Manual Attendance Entry</Text>
              <TouchableOpacity onPress={() => setShowManualModal(false)}>
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Enter User ID (e.g., AM2408016647)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="AM2408016647"
              value={manualUserId}
              onChangeText={setManualUserId}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholderTextColor="#999"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#28a745' }]}
                onPress={() => markAttendance(manualUserId, 'present')}
                disabled={isProcessing}
              >
                <Icon name="check-circle" size={20} color="#fff" />
                <Text style={styles.modalButtonText}>Present</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#ffc107' }]}
                onPress={() => markAttendance(manualUserId, 'late')}
                disabled={isProcessing}
              >
                <Icon name="access-time" size={20} color="#fff" />
                <Text style={styles.modalButtonText}>Late</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#dc3545' }]}
                onPress={() => markAttendance(manualUserId, 'absent')}
                disabled={isProcessing}
              >
                <Icon name="cancel" size={20} color="#fff" />
                <Text style={styles.modalButtonText}>Absent</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalNote}>
              💡 Note: Enter the student's matric number (e.g., AM2408016647) or staff ID (e.g., LEC001234). 
              The user will be automatically registered if not already registered for this event.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Filter Modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter by Status</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {['all', 'present', 'late', 'absent', 'not_marked'].map((filterOption) => (
              <TouchableOpacity
                key={filterOption}
                style={[
                  styles.filterOption,
                  filter === filterOption && styles.filterOptionSelected
                ]}
                onPress={() => {
                  setFilter(filterOption);
                  setShowFilterModal(false);
                }}
              >
                <Text style={[
                  styles.filterOptionText,
                  filter === filterOption && styles.filterOptionTextSelected
                ]}>
                  {filterOption.replace('_', ' ').toUpperCase()}
                </Text>
                {filter === filterOption && (
                  <Icon name="check" size={20} color="#2E3B55" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Processing Overlay */}
      {isProcessing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#2E3B55" />
          <Text style={styles.processingText}>Processing...</Text>
        </View>
      )}
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
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    color: '#666',
    marginTop: 20,
    fontSize: 16,
  },
  eventCard: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  eventTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  eventCode: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  eventDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 15,
  },
  eventDetail: {
    fontSize: 13,
    color: '#666',
    marginRight: 15,
    marginBottom: 5,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 5,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  errorCard: {
    backgroundColor: '#f8d7da',
    margin: 15,
    padding: 15,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f5c6cb',
  },
  errorText: {
    color: '#721c24',
    marginLeft: 10,
    flex: 1,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginHorizontal: 15,
    marginBottom: 15,
  },
  actionButton: {
    backgroundColor: '#2E3B55',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    width: '22%',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 11,
    marginTop: 5,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: '#333',
  },
  filterIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f4fd',
    marginHorizontal: 15,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  filterText: {
    fontSize: 12,
    color: '#2E3B55',
    marginRight: 8,
    fontWeight: '600',
  },
  listContainer: {
    backgroundColor: '#fff',
    margin: 15,
    marginTop: 5,
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#999',
    marginTop: 10,
    textAlign: 'center',
  },
  attendeeCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  attendeeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attendeeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2E3B55',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  attendeeInfo: {
    flex: 1,
  },
  attendeeName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  attendeeId: {
    fontSize: 11,
    color: '#666',
    marginBottom: 2,
  },
  attendeeEmail: {
    fontSize: 11,
    color: '#999',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 70,
  },
  statusText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 4,
  },
  timestamp: {
    fontSize: 10,
    color: '#999',
    marginTop: 8,
    marginBottom: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  smallActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
    flex: 1,
    marginHorizontal: 3,
    justifyContent: 'center',
  },
  smallActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 15,
    fontSize: 14,
    marginBottom: 15,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 3,
    justifyContent: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  modalNote: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  filterOptionSelected: {
    backgroundColor: '#f0f7ff',
  },
  filterOptionText: {
    fontSize: 16,
    color: '#333',
  },
  filterOptionTextSelected: {
    color: '#2E3B55',
    fontWeight: '600',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  processingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#2E3B55',
    fontWeight: '600',
  },
});