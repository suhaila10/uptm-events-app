import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { auth, db } from '../../src/screens/firebase';

const { width } = Dimensions.get('window');

export default function DashboardScreen() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [myEvents, setMyEvents] = useState([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [stats, setStats] = useState({
    totalEvents: 0,
    upcomingEvents: 0,
    attendedEvents: 0,
    certificates: 0
  });
  
  const unsubscribeRef = useRef(null);
  const requestsUnsubscribeRef = useRef(null);

  // Load user from storage on mount
  useEffect(() => {
    loadUserFromStorage();
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
      if (requestsUnsubscribeRef.current) requestsUnsubscribeRef.current();
    };
  }, []);

  // Subscribe to events when userData is available
  useEffect(() => {
    if (userData) {
      subscribeToEvents();
    }
  }, [userData]);

  // Subscribe to pending requests when user and role are known
  useEffect(() => {
    if (user?.uid && (userData?.role === 'student' || userData?.role === 'lecturer')) {
      subscribeToPendingRequests(user.uid);
    }
  }, [user, userData]);

  const loadUserFromStorage = async () => {
    try {
      const userId = await SecureStore.getItemAsync('user_id');
      const userDataString = await SecureStore.getItemAsync('user_data');
      
      if (userId) {
        setUser({ uid: userId });
      }
      
      if (userDataString) {
        console.log('User data from AsyncStorage:', userDataString);
        const parsed = JSON.parse(userDataString);
        console.log('Parsed user data:', parsed);
        setUserData(parsed);
      } else {
        // No user data – redirect to login
        router.replace('/login');
      }
    } catch (error) {
      console.error('Error loading user from storage:', error);
    }
  };

  const subscribeToPendingRequests = (userId) => {
    const q = query(
      collection(db, 'event_requests'),
      where('requesterId', '==', userId),
      where('status', 'in', ['pending', 'revision_needed'])
    );

    requestsUnsubscribeRef.current = onSnapshot(q, (snapshot) => {
      setPendingRequests(snapshot.size);
    }, (error) => {
      console.error('Error fetching pending requests:', error);
    });
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getStatusColor = (status) => {
    if (!status) return '#9E9E9E';
    
    switch(status.toLowerCase()) {
      case 'published': return '#4CAF50';
      case 'draft': return '#FF9800';
      case 'cancelled': return '#F44336';
      case 'completed': return '#2196F3';
      default: return '#9E9E9E';
    }
  };

  const subscribeToEvents = () => {
    setLoading(true);
    const now = new Date();

    try {
      const allEventsQuery = query(collection(db, 'events'));

      const unsubscribe = onSnapshot(allEventsQuery,
        (snapshot) => {
          let upcomingCount = 0;
          let totalEvents = 0;
          let myEventsCount = 0;
          const upcomingList = [];
          const myEventsList = [];

          snapshot.forEach((doc) => {
            const eventData = {
              id: doc.id,
              ...doc.data(),
              date: doc.data().date?.toDate() || null
            };
            
            totalEvents++;

            if (eventData.date && eventData.date >= now && eventData.status !== 'cancelled') {
              upcomingCount++;
              upcomingList.push(eventData);
            }

            const isUserAttendee = eventData.attendees && 
                Array.isArray(eventData.attendees) && 
                eventData.attendees.includes(user?.uid);

            if ((userData?.role === 'student' || userData?.role === 'lecturer') && isUserAttendee) {
              myEventsCount++;
              myEventsList.push(eventData);
            }

            if ((userData?.role === 'organizer' || userData?.role === 'admin')) {
              if (eventData.organizerId === user?.uid || isUserAttendee) {
                myEventsCount++;
                if (!myEventsList.some(e => e.id === eventData.id)) {
                  myEventsList.push(eventData);
                }
              }
            }
          });

          upcomingList.sort((a, b) => (a.date || 0) - (b.date || 0));
          myEventsList.sort((a, b) => (b.date || 0) - (a.date || 0));

          setUpcomingEvents(upcomingList.slice(0, 3));
          setMyEvents(myEventsList);
          
          let certificates = 0;
          if (userData?.role === 'student' || userData?.role === 'lecturer') {
            certificates = myEventsList.filter(event => 
              event.date && event.date < now && event.status === 'completed'
            ).length;
          }

          setStats({
            totalEvents,
            upcomingEvents: upcomingCount,
            attendedEvents: myEventsCount,
            certificates
          });
          
          setLoading(false);
        },
        (error) => {
          console.error('Error fetching events:', error);
          
          setStats({
            totalEvents: 0,
            upcomingEvents: 0,
            attendedEvents: 0,
            certificates: 0
          });
          setUpcomingEvents([]);
          setMyEvents([]);
          
          handleFirebaseError(error);
          setLoading(false);
        }
      );

      unsubscribeRef.current = unsubscribe;
      
    } catch (error) {
      console.error('Error setting up event subscriptions:', error);
      setLoading(false);
    }
  };

  const handleFirebaseError = (error) => {
    if (error.code === 'failed-precondition') {
      Alert.alert(
        'Database Setup Required',
        'The database needs to be configured. Please try again in a few moments or contact support.',
        [{ text: 'OK' }]
      );
    } else if (error.code === 'permission-denied') {
      Alert.alert(
        'Access Denied',
        'You do not have permission to view events.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Connection Error',
        'Unable to load events. Please check your connection.',
        [{ text: 'OK' }]
      );
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    try {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      subscribeToEvents();
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      setTimeout(() => setRefreshing(false), 1000);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Logout', 
          style: 'destructive',
          onPress: async () => {
            try {
              if (unsubscribeRef.current) {
                unsubscribeRef.current();
              }
              if (requestsUnsubscribeRef.current) {
                requestsUnsubscribeRef.current();
              }
              
              await signOut(auth);
              await SecureStore.deleteItemAsync('user_data');
              await SecureStore.deleteItemAsync('user_id');
              router.replace('/login');
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleQuickAction = (action) => {
    switch(action) {
      case 'requestEvent':
        if (userData?.role === 'student' || userData?.role === 'lecturer') {
          router.push('/request-event');
        } else if (userData?.role === 'organizer' || userData?.role === 'admin') {
          router.push('/create-event');
        } else {
          Alert.alert('Access Denied', 'You cannot create or request events.');
        }
        break;
      case 'scanQR':
        if (userData?.role === 'organizer' || userData?.role === 'admin') {
          router.push('/qr-scanner');
        } else {
          Alert.alert('Access Denied', 'Only organizers can scan QR codes.');
        }
        break;
      case 'browseEvents':
        router.push('/events');
        break;
      case 'myCertificates':
        Alert.alert('Coming Soon', 'Certificate feature will be available soon!');
        break;
      case 'profile':
        router.push('/profile');
        break;
      case 'myEvents':
        router.push('/my-events');
        break;
      case 'myRequests':
        router.push('/my-requests');
        break;
      default:
        console.warn('Unknown action:', action);
    }
  };

  const renderEventItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.eventCard}
      onPress={() => router.push(`/event-detail?id=${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={[styles.eventDate, { backgroundColor: '#2E3B55' }]}>
        <Text style={styles.eventDateDay}>
          {item.date?.getDate() || '?'}
        </Text>
        <Text style={styles.eventDateMonth}>
          {item.date?.toLocaleString('default', { month: 'short' }) || '???'}
        </Text>
      </View>
      
      <View style={styles.eventInfo}>
        <View style={styles.eventHeader}>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {item.title || 'Untitled Event'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>
              {item.status?.toUpperCase() || 'UNKNOWN'}
            </Text>
          </View>
        </View>
        
        <View style={styles.eventDetails}>
          <View style={styles.eventDetailRow}>
            <Icon name="location-on" size={14} color="#666" />
            <Text style={styles.eventDetailText} numberOfLines={1}>
              {item.venue || 'Online'}
            </Text>
          </View>
          
          <View style={styles.eventDetailRow}>
            <Icon name="schedule" size={14} color="#666" />
            <Text style={styles.eventDetailText}>
              {item.date?.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
              }) || 'Time not set'}
            </Text>
          </View>

          <View style={styles.eventDetailRow}>
            <Icon name="people" size={14} color="#666" />
            <Text style={styles.eventDetailText}>
              {item.attendeesCount || 0} attending
            </Text>
          </View>
        </View>
        
        <View style={styles.eventFooter}>
          <Text style={styles.eventTime}>
            {item.date?.toLocaleDateString([], { 
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </Text>
          <View style={styles.viewButton}>
            <Text style={styles.viewButtonText}>View Details</Text>
            <Icon name="arrow-forward" size={14} color="#2E3B55" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  const QuickActionCard = ({ icon, title, onPress, color, disabled = false, badge = null }) => (
    <TouchableOpacity 
      style={[styles.actionCard, disabled && styles.actionCardDisabled]} 
      onPress={disabled ? null : onPress}
      disabled={disabled}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={[styles.actionIconContainer, { 
        backgroundColor: disabled ? '#CCCCCC' : color 
      }]}>
        <Icon name={icon} size={24} color="white" />
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.actionTitle, disabled && styles.actionTitleDisabled]}>
        {title}
        {disabled && ' (Soon)'}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: '#2E3B55' }]}>
        <StatusBar barStyle="light-content" backgroundColor="#2E3B55" />
        <Icon name="event" size={60} color="white" />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2E3B55" />
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: '#2E3B55' }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName} numberOfLines={1}>
              {userData?.name || user?.email || 'User'}
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Icon name="logout" size={20} color="white" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(userData?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>
                {userData?.role?.toUpperCase() || 'USER'}
              </Text>
            </View>
            {userData?.userId && (
              <Text style={styles.studentId} numberOfLines={1}>
                ID: {userData.userId}
              </Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView 
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#2E3B55']}
            tintColor="#2E3B55"
          />
        }
      >
        {/* Stats Cards */}
        <View style={styles.section}>
          <View style={styles.statsGrid}>
            <View style={[styles.webStatCard, { backgroundColor: '#667eea' }]}>
              <Text style={styles.webStatLabel}>UPCOMING EVENTS</Text>
              <Text style={styles.webStatValue}>{stats.upcomingEvents}</Text>
            </View>

            <View style={[styles.webStatCard, { backgroundColor: '#f5576c' }]}>
              <Text style={styles.webStatLabel}>MY EVENTS</Text>
              <Text style={styles.webStatValue}>{myEvents.length}</Text>
            </View>

            <View style={[styles.webStatCard, { backgroundColor: '#4facfe' }]}>
  <Text style={styles.webStatLabel}>ATTENDED</Text>
  <Text style={styles.webStatValue}>{stats.attendedEvents}</Text>
</View>

            <View style={[styles.webStatCard, { backgroundColor: '#43e97b' }]}>
              <Text style={styles.webStatLabel}>TOTAL EVENTS</Text>
              <Text style={styles.webStatValue}>{stats.totalEvents}</Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            {(userData?.role === 'student' || userData?.role === 'lecturer') ? (
              <QuickActionCard
                icon="add-circle-outline"
                title="Request Event"
                onPress={() => handleQuickAction('requestEvent')}
                color="#3498db"
                badge={pendingRequests > 0 ? pendingRequests : null}
              />
            ) : (
              <QuickActionCard
                icon="add-circle"
                title="Create Event"
                onPress={() => handleQuickAction('requestEvent')}
                color="#2ecc71"
                disabled={!(userData?.role === 'organizer' || userData?.role === 'admin')}
              />
            )}
            
            <QuickActionCard
              icon="list-alt"
              title="Browse Events"
              onPress={() => handleQuickAction('browseEvents')}
              color="#9b59b6"
            />
            
            {(userData?.role === 'student' || userData?.role === 'lecturer') && (
              <QuickActionCard
                icon="pending-actions"
                title="My Requests"
                onPress={() => handleQuickAction('myRequests')}
                color="#f39c12"
                badge={pendingRequests > 0 ? pendingRequests : null}
              />
            )}
            
            <QuickActionCard
              icon="event"
              title="My Events"
              onPress={() => handleQuickAction('myEvents')}
              color="#E91E63"
            />
          </View>
        </View>

        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {userData?.role === 'organizer' || userData?.role === 'admin' 
                ? 'Your Upcoming Events' 
                : 'Upcoming Events You Might Like'}
            </Text>
            {upcomingEvents.length > 0 && (
              <TouchableOpacity 
                onPress={() => router.push('/events')}
                activeOpacity={0.7}
              >
                <Text style={styles.seeAll}>View All →</Text>
              </TouchableOpacity>
            )}
          </View>

          {upcomingEvents.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon name="event-busy" size={60} color="#ddd" />
              <Text style={styles.emptyTitle}>No Upcoming Events</Text>
              <Text style={styles.emptyText}>
                {userData?.role === 'organizer' || userData?.role === 'admin'
                  ? 'Create your first event to get started!'
                  : userData?.role === 'student' || userData?.role === 'lecturer'
                  ? 'Request an event or check back later.'
                  : 'Check back later for new events.'}
              </Text>
              {(userData?.role === 'organizer' || userData?.role === 'admin') && (
                <TouchableOpacity 
                  style={styles.createFirstButton}
                  onPress={() => router.push('/create-event')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.createFirstButtonText}>Create First Event</Text>
                </TouchableOpacity>
              )}
              {(userData?.role === 'student' || userData?.role === 'lecturer') && (
                <TouchableOpacity 
                  style={[styles.createFirstButton, { backgroundColor: '#3498db' }]}
                  onPress={() => router.push('/request-event')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.createFirstButtonText}>Request an Event</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.eventsListContainer}>
              {upcomingEvents.map((event, index) => (
                <React.Fragment key={event.id}>
                  {renderEventItem({ item: event })}
                  {index < upcomingEvents.length - 1 && <View style={styles.separator} />}
                </React.Fragment>
              ))}
            </View>
          )}
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <View style={[styles.announcementCard, { backgroundColor: 'white' }]}>
            {userData?.role === 'student' && (
              <>
                <Text style={styles.activityText}>📌 Register for upcoming events to receive certificates</Text>
                <Text style={styles.activityText}>✅ Attendance is taken via QR code scanning</Text>
                <Text style={styles.activityText}>📄 Certificates are automatically generated after event completion</Text>
                <Text style={styles.activityText}>🔍 Check "My Requests" to track your event requests</Text>
              </>
            )}
            {userData?.role === 'lecturer' && (
              <>
                <Text style={styles.activityText}>📌 You can attend events and receive certificates</Text>
                <Text style={styles.activityText}>🔒 Request events through the "Request Event" button</Text>
                <Text style={styles.activityText}>📱 Use mobile app for QR code scanning</Text>
                <Text style={styles.activityText}>🔍 Track your requests in "My Requests"</Text>
              </>
            )}
            {(userData?.role === 'organizer' || userData?.role === 'admin') && (
              <>
                <Text style={styles.activityText}>📊 Create and manage events from the dashboard</Text>
                <Text style={styles.activityText}>📱 Generate QR codes for attendance tracking</Text>
                <Text style={styles.activityText}>📄 Monitor real-time attendance and generate reports</Text>
                <Text style={styles.activityText}>🔍 Track attendee check-ins via QR scanner</Text>
                {userData?.role === 'admin' && (
                  <Text style={styles.activityText}>👥 Review and approve event requests from students</Text>
                )}
              </>
            )}
            {!userData?.role && (
              <Text style={[styles.activityText, { color: '#e74c3c' }]}>
                ⚠️ Your account role is not assigned. Please contact administrator.
              </Text>
            )}
          </View>
        </View>

        {/* Bottom Spacing */}
        <View style={{ height: 30 }} />
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
    backgroundColor: '#2E3B55',
  },
  loadingText: {
    color: 'white',
    fontSize: 18,
    marginTop: 20,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    backgroundColor: '#2E3B55',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greeting: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
  },
  userName: {
    color: 'white',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 2,
  },
  logoutButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    borderWidth: 3,
    borderColor: 'white',
  },
  avatarText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  userDetails: {
    flex: 1,
  },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 15,
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  roleText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  studentId: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  content: {
    flex: 1,
    marginTop: -15,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 25,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 15,
  },
  seeAll: {
    color: '#3498db',
    fontSize: 14,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  webStatCard: {
    width: (width - 55) / 2,
    borderRadius: 10,
    padding: 20,
    minHeight: 100,
    justifyContent: 'center',
    marginBottom: 15,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  webStatLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginBottom: 10,
    fontWeight: '500',
  },
  webStatValue: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCard: {
    width: '48%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  actionCardDisabled: {
    opacity: 0.6,
  },
  actionIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    position: 'relative',
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    textAlign: 'center',
  },
  actionTitleDisabled: {
    color: '#999',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#e74c3c',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  eventsListContainer: {},
  eventCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  eventDate: {
    width: 60,
    height: 60,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  eventDateDay: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  eventDateMonth: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  eventInfo: {
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 70,
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  eventDetails: {
    marginBottom: 10,
  },
  eventDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventDetailText: {
    fontSize: 13,
    color: '#7f8c8d',
    marginLeft: 5,
    flex: 1,
  },
  eventFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventTime: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
  },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewButtonText: {
    fontSize: 12,
    color: '#3498db',
    fontWeight: '600',
    marginRight: 5,
  },
  separator: {
    height: 10,
  },
  emptyContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 40,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 15,
  },
  emptyText: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 20,
  },
  createFirstButton: {
    marginTop: 20,
    backgroundColor: '#2ecc71',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 5,
  },
  createFirstButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  announcementCard: {
    borderRadius: 10,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  activityText: {
    fontSize: 14,
    color: '#7f8c8d',
    lineHeight: 22,
    marginBottom: 8,
  },
});