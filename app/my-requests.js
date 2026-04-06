import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { db } from '../src/screens/firebase';

export default function MyRequestsScreen() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    loadUserId();
  }, []);

  const loadUserId = async () => {
    try {
      const id = await SecureStore.getItemAsync('user_id');
      if (id) {
        setUserId(id);
        subscribeToRequests(id);
      } else {
        router.replace('/login');
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const subscribeToRequests = (uid) => {
    const q = query(
      collection(db, 'event_requests'),
      where('requesterId', '==', uid)
    );

    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRequests(data);
      setLoading(false);
      setRefreshing(false);
    }, (error) => {
      console.error('Error fetching requests:', error);
      setLoading(false);
      setRefreshing(false);
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      return timestamp.toDate().toLocaleDateString('en-MY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return '#d4edda';
      case 'rejected': return '#f8d7da';
      case 'revision_needed': return '#fff3cd';
      default: return '#e6f3ff';
    }
  };

  const getStatusTextColor = (status) => {
    switch (status) {
      case 'approved': return '#155724';
      case 'rejected': return '#721c24';
      case 'revision_needed': return '#856404';
      default: return '#000080';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return 'check-circle';
      case 'rejected': return 'cancel';
      case 'revision_needed': return 'edit';
      default: return 'pending';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'revision_needed': return 'Revision Needed';
      default: return 'Pending Review';
    }
  };

  const getStatusActionText = (status) => {
    switch (status) {
      case 'revision_needed': return 'Revise Request';
      case 'approved': return 'View Details';
      case 'rejected': return 'View Feedback';
      default: return 'View Details';
    }
  };

  const handleRequestPress = (item) => {
    if (item.status === 'revision_needed') {
      // Navigate to edit screen for revision
      router.push(`/edit-request/${item.id}`);
    } else {
      // Navigate to view details for other statuses
      router.push(`/request-details/${item.id}`);
    }
  };

  const filteredRequests = filter === 'all'
    ? requests
    : requests.filter(req => req.status === filter);

  const onRefresh = () => {
    setRefreshing(true);
    if (userId) {
      subscribeToRequests(userId);
    }
  };

  const renderRequest = ({ item }) => {
    const statusColor = getStatusColor(item.status);
    const statusTextColor = getStatusTextColor(item.status);
    const statusIcon = getStatusIcon(item.status);
    const statusText = getStatusText(item.status);
    const actionText = getStatusActionText(item.status);

    return (
      <TouchableOpacity
        style={styles.requestCard}
        onPress={() => handleRequestPress(item)}
        activeOpacity={0.7}
      >
        {/* Status Badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Icon name={statusIcon} size={16} color={statusTextColor} />
          <Text style={[styles.statusText, { color: statusTextColor }]}>
            {statusText}
          </Text>
        </View>

        {/* Event Title */}
        <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>

        {/* Event Code */}
        {item.eventCode && (
          <View style={styles.eventCodeContainer}>
            <Icon name="confirmation-number" size={12} color="#666" />
            <Text style={styles.eventCodeText}>{item.eventCode}</Text>
          </View>
        )}

        {/* Details Grid */}
        <View style={styles.detailsGrid}>
          <View style={styles.detailRow}>
            <Icon name="calendar-today" size={14} color="#000080" />
            <Text style={styles.detailText}>{formatDate(item.startDate)}</Text>
          </View>

          <View style={styles.detailRow}>
            <Icon name="location-on" size={14} color="#000080" />
            <Text style={styles.detailText} numberOfLines={1}>
              {item.isOnline ? '🌐 Online Event' : `📍 ${item.venue}`}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Icon name="category" size={14} color="#000080" />
            <Text style={styles.detailText}>
              {item.category?.replace('_', ' ') || 'Event'}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Icon name="people" size={14} color="#000080" />
            <Text style={styles.detailText}>{item.capacity || 30} participants</Text>
          </View>
        </View>

        {/* Short Description */}
        {item.shortDescription && (
          <Text style={styles.description} numberOfLines={2}>
            {item.shortDescription}
          </Text>
        )}

        {/* Review Notes - Show if exists */}
        {item.reviewNotes && (
          <View style={[styles.feedback, { backgroundColor: statusColor }]}>
            <Icon name="comment" size={14} color={statusTextColor} />
            <Text style={[styles.feedbackText, { color: statusTextColor }]} numberOfLines={2}>
              {item.reviewNotes}
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.date}>Submitted: {formatDate(item.submittedAt)}</Text>
          <Icon name="chevron-right" size={20} color="#999" />
        </View>

        {/* Action Button - Show for revision needed */}
        {item.status === 'revision_needed' && (
          <TouchableOpacity
            style={styles.reviseButton}
            onPress={() => router.push(`/edit-request/${item.id}`)}
          >
            <Icon name="edit" size={16} color="#fff" />
            <Text style={styles.reviseButtonText}>{actionText}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000080" />
        <Text style={styles.loadingText}>Loading your requests...</Text>
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
        <Text style={styles.headerTitle}>My Event Requests</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Icon name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filterButtons}>
            {['all', 'pending', 'approved', 'rejected', 'revision_needed'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.filterButton,
                  filter === type && styles.filterButtonActive
                ]}
                onPress={() => setFilter(type)}
              >
                <Text style={[
                  styles.filterButtonText,
                  filter === type && styles.filterButtonTextActive
                ]}>
                  {type === 'revision_needed' ? 'NEEDS REVISION' : type.toUpperCase()} 
                  ({type === 'all'
                    ? requests.length
                    : requests.filter(r => r.status === type).length}
                  )
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Requests List */}
      <FlatList
        data={filteredRequests}
        renderItem={renderRequest}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#000080']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="info" size={60} color="#ccc" />
            <Text style={styles.emptyTitle}>No requests found</Text>
            <Text style={styles.emptyText}>
              {filter !== 'all' 
                ? `You don't have any ${filter} requests.`
                : "You haven't submitted any event requests yet."}
            </Text>
            <TouchableOpacity
              style={styles.requestButton}
              onPress={() => router.push('/request-event')}
            >
              <Text style={styles.requestButtonText}>Request an Event</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Stats Footer */}
      {requests.length > 0 && (
        <View style={styles.statsFooter}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{requests.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {requests.filter(r => r.status === 'pending').length}
            </Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {requests.filter(r => r.status === 'approved').length}
            </Text>
            <Text style={styles.statLabel}>Approved</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {requests.filter(r => r.status === 'revision_needed').length}
            </Text>
            <Text style={styles.statLabel}>Revisions</Text>
          </View>
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
    backgroundColor: '#000080',
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
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#666',
  },
  filterContainer: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterButtons: {
    flexDirection: 'row',
    paddingHorizontal: 15,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#000080',
    marginRight: 10,
  },
  filterButtonActive: {
    backgroundColor: '#000080',
  },
  filterButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#000080',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  list: {
    padding: 15,
    paddingBottom: 80,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 5,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  eventCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  eventCodeText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontFamily: 'monospace',
  },
  detailsGrid: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
    flex: 1,
  },
  description: {
    fontSize: 13,
    color: '#7f8c8d',
    lineHeight: 18,
    marginBottom: 12,
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  feedbackText: {
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  date: {
    fontSize: 11,
    color: '#999',
  },
  reviseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f39c12',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  reviseButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 60,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 20,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  requestButton: {
    backgroundColor: '#000080',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statsFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000080',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#eee',
  },
});