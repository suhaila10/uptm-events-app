import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  SafeAreaView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { db } from '../../src/screens/firebase';

export default function EventsScreen() {
  
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load user data on mount
  useEffect(() => {
    loadUserFromStorage();
  }, []);

  const loadUserFromStorage = async () => {
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
      console.error('Error loading user from storage:', error);
    }
  };

  // Once userData is loaded, fetch events
  useEffect(() => {
    if (userData) {
      const unsubscribe = fetchEvents();
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [userData]);

  // Categorize events into sections
  const categorizeEvents = (eventsList) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayEvents = [];
    const upcomingEvents = [];
    const pastEvents = [];

    eventsList.forEach(event => {
      if (!event.eventDate) {
        upcomingEvents.push(event); // Events without date go to upcoming
        return;
      }

      const eventDate = new Date(event.eventDate);
      const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

      if (eventDateOnly.getTime() === today.getTime()) {
        todayEvents.push(event);
      } else if (eventDate < now) {
        pastEvents.push(event);
      } else {
        upcomingEvents.push(event);
      }
    });

    // Sort each section
    const sortByDate = (a, b) => {
      if (!a.eventDate && !b.eventDate) return 0;
      if (!a.eventDate) return 1;
      if (!b.eventDate) return -1;
      return a.eventDate - b.eventDate;
    };

    todayEvents.sort(sortByDate);
    upcomingEvents.sort(sortByDate);
    pastEvents.sort(sortByDate).reverse(); // Past events: most recent first

    const sections = [];
    
    if (todayEvents.length > 0) {
      sections.push({ title: 'Today', data: todayEvents });
    }
    if (upcomingEvents.length > 0) {
      sections.push({ title: 'Upcoming', data: upcomingEvents });
    }
    if (pastEvents.length > 0) {
      sections.push({ title: 'Past', data: pastEvents });
    }

    return sections;
  };

  const fetchEvents = () => {
    setLoading(true);
    let q;

    try {
      if (userData?.role === 'organizer' || userData?.role === 'admin') {
        // Organizers see all events
        q = query(collection(db, 'events'));
      } else {
        // Students and lecturers see published events
        q = query(
          collection(db, 'events'),
          where('status', '==', 'published')
        );
      }

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const eventsData = [];

        snapshot.forEach((doc) => {
          const eventData = doc.data();
          const event = { 
            id: doc.id, 
            ...eventData,
            title: eventData.title || 'Untitled Event',
            location: eventData.location || eventData.venue || 'Location TBD',
            attendeesCount: eventData.attendeesCount || eventData.currentAttendees || 0,
            capacity: eventData.capacity || 0,
            eventDate: eventData.date 
              ? eventData.date.toDate() 
              : null
          };
          eventsData.push(event);
        });

        setEvents(eventsData);
        setLoading(false);
      });

      return unsubscribe;
    } catch (error) {
      console.error('Error fetching events:', error);
      
      // Fallback for index errors
      if (error.code === 'failed-precondition') {
        console.log('Falling back to simple query...');
        const fallbackQuery = query(collection(db, 'events'));
        const fallbackUnsubscribe = onSnapshot(fallbackQuery, (snapshot) => {
          const eventsData = [];
          
          snapshot.forEach((doc) => {
            const eventData = doc.data();
            const event = { 
              id: doc.id, 
              ...eventData,
              title: eventData.title || 'Untitled Event',
              location: eventData.location || eventData.venue || 'Location TBD',
              attendeesCount: eventData.attendeesCount || eventData.currentAttendees || 0,
              capacity: eventData.capacity || 0,
              eventDate: eventData.date 
                ? eventData.date.toDate() 
                : null
            };
            
            // Filter published events client-side for students/lecturers
            if (userData?.role === 'organizer' || userData?.role === 'admin' || 
                eventData.status === 'published') {
              eventsData.push(event);
            }
          });

          setEvents(eventsData);
          setLoading(false);
        });
        
        return fallbackUnsubscribe;
      }
      
      Alert.alert('Error', 'Failed to load events');
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchEvents();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const renderEventItem = ({ item }) => {
    const eventDate = item.eventDate;
    const day = eventDate ? eventDate.getDate() : '?';
    const month = eventDate ? eventDate.toLocaleString('default', { month: 'short' }) : '???';
    const time = eventDate ? eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBD';
    const dateStr = eventDate ? eventDate.toLocaleDateString() : 'Date TBD';

    // Determine if event is today for special styling
    const isToday = eventDate && new Date(eventDate).toDateString() === new Date().toDateString();
    const cardBackgroundColor = isToday ? '#E8F0FE' : 'white';

    return (
      <TouchableOpacity 
        style={[styles.eventCard, { backgroundColor: cardBackgroundColor }]}
        onPress={() => router.push(`/event-detail?id=${item.id}`)}
      >
        <View style={[styles.eventDate, { backgroundColor: '#2E3B55' }]}>
          <Text style={styles.eventDateDay}>{day}</Text>
          <Text style={styles.eventDateMonth}>{month}</Text>
        </View>
        
        <View style={styles.eventInfo}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {isToday && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>Today</Text>
              </View>
            )}
            {!isToday && (
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.statusText}>{item.status || 'draft'}</Text>
              </View>
            )}
          </View>
          
          <View style={styles.eventDetails}>
            <View style={styles.eventDetailRow}>
              <Ionicons name="location-on" size={14} color="#666" />
              <Text style={styles.eventDetailText} numberOfLines={1}>
                {item.location}
              </Text>
            </View>
            
            <View style={styles.eventDetailRow}>
              <Ionicons name="event" size={14} color="#666" />
              <Text style={styles.eventDetailText}>{dateStr} • {time}</Text>
            </View>
            
            <View style={styles.eventDetailRow}>
              <Ionicons name="people" size={14} color="#666" />
              <Text style={styles.eventDetailText}>
                {item.attendeesCount}/{item.capacity || '∞'} attendees
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section: { title } }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      <View style={styles.sectionHeaderLine} />
    </View>
  );

  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case 'published': return '#4CAF50';
      case 'draft': return '#FF9800';
      case 'cancelled': return '#F44336';
      default: return '#2196F3';
    }
  };

  const goBack = () => {
    router.back();
  };

  const sections = categorizeEvents(events);

  if (loading && events.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2E3B55" />
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>All Events</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Ionicons name="event" size={50} color="#ccc" />
          <Text>Loading events...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2E3B55" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>All Events</Text>
        <View style={{ width: 24 }} />
      </View>

      <SectionList
        sections={sections}
        renderItem={renderEventItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#2E3B55']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="event-busy" size={60} color="#ddd" />
            <Text style={styles.emptyTitle}>No Events Available</Text>
            <Text style={styles.emptyText}>
              {userData?.role === 'organizer' || userData?.role === 'admin'
                ? 'Create your first event to get started!'
                : 'There are no events to display at the moment.'}
            </Text>
            {(userData?.role === 'organizer' || userData?.role === 'admin') && (
              <TouchableOpacity 
                style={styles.createFirstButton}
                onPress={() => router.push('/create-event')}
              >
                <Text style={styles.createFirstButtonText}>Create First Event</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
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
  },
  listContent: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 15,
    paddingHorizontal: 5,
  },
  sectionHeaderText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E3B55',
    marginRight: 10,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  eventCard: {
    borderRadius: 15,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  eventDate: {
    width: 70,
    height: 70,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  eventDateDay: {
    color: 'white',
    fontSize: 28,
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
    color: '#333',
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  statusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  todayBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  todayBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  eventDetails: {
    marginBottom: 5,
  },
  eventDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventDetailText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 5,
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
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
    lineHeight: 20,
  },
  createFirstButton: {
    marginTop: 20,
    backgroundColor: '#2E3B55',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  createFirstButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});