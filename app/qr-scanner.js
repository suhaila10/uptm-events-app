import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../src/screens/firebase';

const { width, height } = Dimensions.get('window');

// Allow check-in up to 24 hours after event ends
const LATE_CHECKIN_HOURS = 24;

export default function QRScannerScreen() {
  const params = useLocalSearchParams();
  const eventIdFromParams = params.eventId || null;
  const eventCodeFromParams = params.eventCode || null;
  
  const [scanning, setScanning] = useState(true);
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [manualEventCode, setManualEventCode] = useState('');
  const [manualUserId, setManualUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentScans, setRecentScans] = useState([]);
  const [eventDetails, setEventDetails] = useState(null);
  const [eventId, setEventId] = useState(eventIdFromParams);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [availableEvents, setAvailableEvents] = useState([]);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [showEventCodeEntry, setShowEventCodeEntry] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState('scan');
  const [simulatedScan, setSimulatedScan] = useState(false);
  
  // Camera permissions
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (eventId) {
      fetchEventDetails(eventId);
    } else if (eventCodeFromParams) {
      fetchEventByCode(eventCodeFromParams);
    }
  }, [eventId, eventCodeFromParams]);

  // ========== TIME VALIDATION ==========
  const isCheckinTimeValid = (event) => {
    if (!event || !event.startDate) {
      // No start date – allow check-in
      return true;
    }

    const now = new Date();
    const start = event.startDate.toDate();
    const duration = event.duration || 120; // default 2 hours if not specified
    const end = new Date(start.getTime() + duration * 60000);
    
    // Calculate the cutoff time (24 hours after event ends)
    const lateCutoff = new Date(end.getTime() + LATE_CHECKIN_HOURS * 60 * 60000);
    
    // Allow check-in from event start up to 24 hours after event ends
    return now >= start && now <= lateCutoff;
  };

  const fetchEventDetails = async (id) => {
    try {
      setLoading(true);
      const eventRef = doc(db, 'events', id);
      const eventDoc = await getDoc(eventRef);
      
      if (eventDoc.exists()) {
        const eventData = eventDoc.data();
        setEventDetails({ 
          id: eventDoc.id, 
          ...eventData,
          attendees: eventData.attendees || [],
          startDate: eventData.startDate || eventData.date,
          duration: eventData.duration
        });
        console.log('Event loaded:', eventData.title);
      } else {
        Alert.alert('Error', 'Event not found');
      }
    } catch (error) {
      console.error('Error fetching event:', error);
      Alert.alert('Error', 'Failed to load event details');
    } finally {
      setLoading(false);
    }
  };

  const fetchEventByCode = async (eventCode) => {
    if (!eventCode?.trim()) {
      Alert.alert('Error', 'Please enter a valid event code');
      return;
    }

    try {
      setLoading(true);
      setFetchingEvents(true);
      
      const eventsRef = collection(db, 'events');
      const q = query(eventsRef, where('eventCode', '==', eventCode.trim()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const events = [];
        querySnapshot.forEach((doc) => {
          events.push({ 
            id: doc.id, 
            ...doc.data(), 
            attendees: doc.data().attendees || [],
            startDate: doc.data().startDate || doc.data().date,
            duration: doc.data().duration
          });
        });
        
        if (events.length === 1) {
          setEventDetails(events[0]);
          setEventId(events[0].id);
          Alert.alert('Success', `Event loaded: ${events[0].title}`);
          setShowEventCodeEntry(false);
        } else {
          setAvailableEvents(events);
          setShowEventSelector(true);
        }
      } else {
        Alert.alert('Not Found', 'No event found with this code');
      }
    } catch (error) {
      console.error('Error fetching event by code:', error);
      Alert.alert('Error', 'Failed to find event');
    } finally {
      setLoading(false);
      setFetchingEvents(false);
    }
  };

  const checkAttendancePermission = async (userId) => {
    if (!eventDetails) {
      Alert.alert('Error', 'No event selected');
      return false;
    }

    if (!eventDetails.requiresRSVP) {
      return true;
    }

    const attendees = eventDetails.attendees || [];
    const userRSVPd = attendees.includes(userId);
    
    if (!userRSVPd) {
      Alert.alert(
        'RSVP Required',
        '❌ This event requires RSVP. User has not RSVP\'d for this event.'
      );
      return false;
    }
    return true;
  };

  const markAttendance = async (userId, method = 'qr') => {
    if (!userId || !eventDetails) {
      Alert.alert('Error', 'Missing user ID or event details');
      return;
    }

    // --- TIME VALIDATION ---
    if (!isCheckinTimeValid(eventDetails)) {
      const start = eventDetails.startDate?.toDate();
      const duration = eventDetails.duration || 120;
      const end = start ? new Date(start.getTime() + duration * 60000) : null;
      const lateCutoff = end ? new Date(end.getTime() + LATE_CHECKIN_HOURS * 60 * 60000) : null;

      Alert.alert(
        '⏰ Check-in Not Allowed',
        `Check-in is only available until ${lateCutoff?.toLocaleString()}.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setLoading(true);
      
      const userDoc = await getDoc(doc(db, 'users', userId));
      
      if (!userDoc.exists()) {
        Alert.alert('Error', `❌ User ${userId} not found in database`);
        return;
      }

      const userData = userDoc.data();

      const hasPermission = await checkAttendancePermission(userId);
      if (!hasPermission) {
        return;
      }

      const attendanceRef = doc(db, 'attendance', `${eventDetails.id}_${userId}`);
      const existingAttendance = await getDoc(attendanceRef);
      
      if (existingAttendance.exists()) {
        const attendanceData = existingAttendance.data();
        const checkInTime = attendanceData.timestamp?.toDate?.() 
          ? attendanceData.timestamp.toDate().toLocaleTimeString() 
          : 'earlier';
        
        Alert.alert(
          'Already Checked In',
          `⚠️ ${userData.name || userData.displayName || 'User'} already checked in at ${checkInTime}`,
          [{ text: 'OK' }]
        );
        
        const newScan = {
          id: Date.now().toString(),
          userId: userId,
          userName: userData.name || userData.displayName || 'Unknown',
          userMatric: userData.matricNumber || userData.studentId || 'N/A',
          userEmail: userData.email || 'N/A',
          eventTitle: eventDetails.title,
          eventCode: eventDetails.eventCode,
          time: new Date().toLocaleTimeString(),
          date: new Date().toLocaleDateString(),
          status: 'duplicate',
          requiresRSVP: eventDetails.requiresRSVP
        };
        
        setRecentScans(prev => [newScan, ...prev.slice(0, 9)]);
        return;
      }

      await setDoc(attendanceRef, {
        eventId: eventDetails.id,
        eventCode: eventDetails.eventCode,
        eventTitle: eventDetails.title,
        userId,
        userName: userData.name || userData.displayName || 'Unknown',
        userEmail: userData.email || 'N/A',
        userMatric: userData.matricNumber || userData.studentId || 'N/A',
        userFaculty: userData.faculty || 'N/A',
        userRole: userData.role || 'student',
        timestamp: serverTimestamp(),
        status: 'present',
        method: method,
        markedBy: auth.currentUser?.uid || 'system',
        markedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Organizer',
        markedByRole: auth.currentUser ? 'organizer' : 'system',
        eventType: eventDetails.requiresRSVP ? 'rsvp_required' : 'open_event',
        rsvpVerified: eventDetails.requiresRSVP ? true : false
      });

      if (eventDetails.hasOwnProperty('currentAttendees')) {
        const eventRef = doc(db, 'events', eventDetails.id);
        await updateDoc(eventRef, {
          currentAttendees: (eventDetails.currentAttendees || 0) + 1,
          lastAttendance: serverTimestamp()
        });
      }

      const newScan = {
        id: Date.now().toString(),
        userId: userId,
        userName: userData.name || userData.displayName || 'Unknown',
        userMatric: userData.matricNumber || userData.studentId || 'N/A',
        userEmail: userData.email || 'N/A',
        eventTitle: eventDetails.title,
        eventCode: eventDetails.eventCode,
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        status: 'success',
        requiresRSVP: eventDetails.requiresRSVP,
        rsvpVerified: eventDetails.requiresRSVP
      };
      
      setRecentScans(prev => [newScan, ...prev.slice(0, 9)]);

      const rsvpMessage = eventDetails.requiresRSVP 
        ? '✓ RSVP verified' 
        : '🌐 Open event (no RSVP required)';
      
      Alert.alert(
        '✅ Attendance Recorded!',
        `Name: ${userData.name || userData.displayName}\n` +
        `ID: ${userData.matricNumber || userData.studentId || 'N/A'}\n` +
        `Email: ${userData.email || 'N/A'}\n\n` +
        `${rsvpMessage}\n` +
        `Event: ${eventDetails.title}\n` +
        `Time: ${new Date().toLocaleTimeString()}`,
        [
          {
            text: 'Scan Again',
            onPress: () => setScanning(true)
          }
        ]
      );
      
    } catch (error) {
      console.error('Error recording attendance:', error);
      Alert.alert('Error', '❌ Failed to record attendance: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const parseQRData = (qrData) => {
    try {
      console.log('Parsing QR data:', qrData);
      
      if (qrData.startsWith('{')) {
        const parsed = JSON.parse(qrData);
        
        // Handle attendance QR (includes both event and user)
        if (parsed.type === 'attendance') {
          console.log('📱 Attendance QR detected for user:', parsed.userId);
          return {
            type: 'attendance',
            eventId: parsed.eventId,
            eventCode: parsed.eventCode,
            userId: parsed.userId
          };
        }
        
        // Handle event checkin QR
        if (parsed.type === 'event_checkin') {
          return {
            type: 'event_checkin',
            eventId: parsed.eventId,
            eventCode: parsed.eventCode,
            hash: parsed.hash
          };
        }
        
        // Handle user ID only QR
        if (parsed.userId) {
          return {
            type: 'user_id',
            userId: parsed.userId
          };
        }
        
        return {
          type: parsed.type || 'event_checkin',
          eventId: parsed.eventId,
          eventCode: parsed.eventCode,
          userId: parsed.userId
        };
      }
      
      // Handle plain text user ID
      if (qrData.length < 50 && !qrData.includes('-') && !qrData.includes(':')) {
        return {
          type: 'user_id',
          userId: qrData
        };
      }
      
      // Handle event code format (like WOR-2026-506)
      if (qrData.includes('-') && qrData.length > 5 && qrData.length < 50) {
        return {
          type: 'event_checkin',
          eventCode: qrData,
          eventId: null
        };
      }
      
      // Handle EVENT: format
      if (qrData.startsWith('EVENT:')) {
        const parts = qrData.split(':');
        return {
          type: 'event_checkin',
          eventId: parts[1],
          eventCode: parts[2],
          hash: parts[3]
        };
      }
      
      return {
        type: 'unknown',
        raw: qrData
      };
    } catch (error) {
      console.error('Error parsing QR data:', error);
      return {
        type: 'unknown',
        raw: qrData
      };
    }
  };

  const handleQRScan = async (qrData) => {
    try {
      setLoading(true);
      
      const parsedData = parseQRData(qrData);
      console.log('✅ Parsed QR data:', parsedData);
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert(
          'Login Required',
          'Please login to scan QR codes',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Login', onPress: () => router.push('/login') }
          ]
        );
        return;
      }
      
      // Handle attendance QR (contains both event and user)
      if (parsedData.type === 'attendance') {
        console.log('🎫 Processing attendance QR for user:', parsedData.userId);
        
        // Load the event if not already loaded
        if (!eventDetails || eventDetails.id !== parsedData.eventId) {
          if (parsedData.eventId) {
            await fetchEventDetails(parsedData.eventId);
          } else if (parsedData.eventCode) {
            await fetchEventByCode(parsedData.eventCode);
          }
        }
        
        // Mark attendance for the user
        if (parsedData.userId && eventDetails) {
          Vibration.vibrate(100);
          await markAttendance(parsedData.userId, 'qr');
        } else if (parsedData.userId && !eventDetails) {
          Alert.alert('Error', 'Failed to load event information. Please try again.');
        } else {
          Alert.alert('Error', 'Invalid attendance QR code: missing user ID');
        }
        return;
      }
      
      // Handle user ID QR (student QR code without event info)
      if (parsedData.type === 'user_id' || parsedData.userId) {
        const userId = parsedData.userId || parsedData.raw;
        
        if (!eventDetails) {
          Alert.alert(
            'No Event Selected',
            'Please select an event first before scanning student QR codes',
            [
              { text: 'Cancel' },
              { text: 'Enter Event Code', onPress: () => setShowEventCodeEntry(true) }
            ]
          );
          return;
        }
        
        Vibration.vibrate(100);
        await markAttendance(userId, 'qr');
        return;
      }
      
      // Handle event QR (for organizers to load event)
      if (parsedData.type === 'event_checkin') {
        if (parsedData.eventId) {
          await fetchEventDetails(parsedData.eventId);
          setAttendanceMode('scan');
          Vibration.vibrate(100);
          Alert.alert(
            '✅ Event Loaded',
            `Event: ${eventDetails?.title || 'Event loaded'}\n\nReady to scan attendance QR codes.`,
            [{ text: 'OK' }]
          );
        } 
        else if (parsedData.eventCode) {
          await fetchEventByCode(parsedData.eventCode);
          setAttendanceMode('scan');
          Vibration.vibrate(100);
        }
        else {
          Alert.alert('Invalid QR', 'QR code does not contain valid event information');
        }
        return;
      }
      
      Alert.alert(
        'Unknown QR Format',
        'This QR code format is not recognized. Try manual entry.',
        [
          { text: 'Cancel' },
          { text: 'Manual Entry', onPress: () => setManualEntryVisible(true) }
        ]
      );
      
    } catch (error) {
      console.error('❌ Scan error:', error);
      Vibration.vibrate([100, 100, 100]);
      Alert.alert(
        'Scan Failed',
        error.message || 'Invalid QR code',
        [{ text: 'Try Again', onPress: () => setScanning(true) }]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (loading || !scanning) return;
    
    // Disable scanning while processing
    setScanning(false);
    
    try {
      await handleQRScan(data);
    } catch (error) {
      console.error('Scan error:', error);
      Alert.alert('Error', 'Failed to process QR code');
    } finally {
      // Re-enable scanning after a delay
      setTimeout(() => {
        setScanning(true);
      }, 2000);
    }
  };

  const handleManualUserSubmit = () => {
    if (!manualUserId.trim()) {
      Alert.alert('Error', 'Please enter a User ID');
      return;
    }
    
    if (!eventDetails) {
      Alert.alert('Error', 'Please select an event first');
      return;
    }
    
    setManualEntryVisible(false);
    markAttendance(manualUserId.trim(), 'manual');
    setManualUserId('');
  };

  const handleManualEventCodeSubmit = () => {
    if (!manualEventCode.trim()) {
      Alert.alert('Error', 'Please enter an event code');
      return;
    }
    
    setShowEventCodeEntry(false);
    fetchEventByCode(manualEventCode.trim());
    setManualEventCode('');
  };

  const simulateScan = () => {
    if (!scanning || loading) return;
    
    setScanning(false);
    setSimulatedScan(true);
    Vibration.vibrate(100);
    
    if (!eventDetails) {
      const sampleEventQR = `EVENT:${eventId || 'event_CSW2024001'}:CSW-2024-001:abc123`;
      Alert.alert(
        'Simulation',
        'Scanning event QR code...',
        [{ text: 'OK', onPress: () => handleQRScan(sampleEventQR) }]
      );
    } else {
      // Simulate an attendance QR with both event and user info
      const sampleAttendanceQR = JSON.stringify({
        type: 'attendance',
        eventId: eventDetails.id,
        eventCode: eventDetails.eventCode,
        userId: auth.currentUser?.uid || 'student123',
        userName: auth.currentUser?.displayName || 'Test Student'
      });
      
      Alert.alert(
        'Simulation',
        `Scanning attendance QR code for:\nEvent: ${eventDetails.title}\nUser: Test Student`,
        [{ text: 'OK', onPress: () => handleQRScan(sampleAttendanceQR) }]
      );
    }
  };

  const getEventTypeIcon = () => {
    if (!eventDetails) return 'help-outline';
    return eventDetails.requiresRSVP ? 'lock-closed-outline' : 'globe-outline';
  };

  const getEventTypeText = () => {
    if (!eventDetails) return 'No event selected';
    return eventDetails.requiresRSVP ? 'RSVP Required' : 'Open Event (No RSVP needed)';
  };

  // ========== RENDER ==========
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#2E3B55" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance Scanner</Text>
        <TouchableOpacity onPress={() => setShowEventCodeEntry(true)}>
          <Ionicons name="qr-code-outline" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Event Info Bar */}
      {eventDetails ? (
        <View style={[
          styles.eventBar,
          eventDetails.requiresRSVP ? styles.rsvpEvent : styles.openEvent
        ]}>
          <Ionicons name={getEventTypeIcon()} size={16} color="white" />
          <Text style={styles.eventBarText} numberOfLines={1}>
            {eventDetails.title} • {eventDetails.requiresRSVP ? 'RSVP Required' : 'Open'}
          </Text>
          <TouchableOpacity onPress={() => setEventDetails(null)}>
            <Ionicons name="close-outline" size={16} color="white" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.noEventBar}>
          <Ionicons name="information-circle-outline" size={16} color="#fff" />
          <Text style={styles.noEventBarText}>No event selected - Scan attendance QR or enter code</Text>
        </View>
      )}

      {/* Camera Scanner */}
      <View style={styles.scannerContainer}>
        {!permission?.granted ? (
          <View style={styles.permissionContainer}>
            <Ionicons name="camera-outline" size={60} color="#fff" />
            <Text style={styles.permissionText}>
              Camera permission is required to scan QR codes
            </Text>
            <TouchableOpacity 
              style={styles.permissionButton}
              onPress={requestPermission}
            >
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'pdf417'],
            }}
            onBarcodeScanned={scanning ? handleBarcodeScanned : undefined}
          >
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerFrame}>
                <View style={styles.cornerTL} />
                <View style={styles.cornerTR} />
                <View style={styles.cornerBL} />
                <View style={styles.cornerBR} />
                
                {scanning && !loading && (
                  <View style={styles.scanLine} />
                )}
              </View>
              
              <View style={styles.scannerInfo}>
                <Text style={styles.scannerText}>
                  {loading ? 'Processing...' : 
                   eventDetails ? 'Scan attendance QR code' : 'Scan event QR code first'}
                </Text>
                <Text style={styles.scannerSubtext}>
                  {loading ? 'Please wait' : 
                   eventDetails ? 'Point camera at attendee QR code' : 'Or enter event code manually'}
                </Text>
              </View>
            </View>
          </CameraView>
        )}
      </View>

      {/* Instructions */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>How to check-in:</Text>
          
          <View style={styles.instructionStep}>
            <View style={[styles.stepNumber, eventDetails && styles.stepCompleted]}>
              <Text style={styles.stepNumberText}>
                {eventDetails ? '✓' : '1'}
              </Text>
            </View>
            <Text style={styles.instructionText}>
              {eventDetails 
                ? `Event: ${eventDetails.title} (${eventDetails.requiresRSVP ? '🔒 RSVP' : '🌐 Open'})`
                : 'Select an event by scanning QR or entering code'}
            </Text>
          </View>
          
          <View style={styles.instructionStep}>
            <View style={[styles.stepNumber, !eventDetails && styles.stepDisabled]}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <Text style={[styles.instructionText, !eventDetails && styles.textDisabled]}>
              Scan attendance QR code from student's phone
            </Text>
          </View>
          
          <View style={styles.instructionStep}>
            <View style={[styles.stepNumber, !eventDetails && styles.stepDisabled]}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <Text style={[styles.instructionText, !eventDetails && styles.textDisabled]}>
              {eventDetails?.requiresRSVP
                ? '🔒 System verifies RSVP before check-in'
                : '🌐 All students can check in (RSVP optional)'}
            </Text>
          </View>

          {eventDetails && (
            <View style={styles.eventStats}>
              <View style={styles.statItem}>
                <Ionicons name="people-outline" size={16} color="#2E3B55" />
                <Text style={styles.statText}>
                  RSVP'd: {eventDetails.attendees?.length || 0}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#27ae60" />
                <Text style={styles.statText}>
                  Checked-in: {recentScans.filter(s => s.status === 'success').length}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.scanButton,
              (!eventDetails || loading || !scanning) && styles.buttonDisabled
            ]}
            onPress={simulateScan}
            disabled={!eventDetails || loading || !scanning}
          >
            <View style={styles.scanButtonContent}>
              {loading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={24} color="white" />
                  <Text style={styles.scanButtonText}>
                    {eventDetails ? 'Simulate Attendance Scan' : 'Scan Event QR First'}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, !eventDetails && styles.buttonDisabled]}
              onPress={() => {
                setManualEntryVisible(true);
                setAttendanceMode('manual-user');
              }}
              disabled={!eventDetails || loading}
            >
              <Ionicons name="person-outline" size={20} color={eventDetails ? "#2E3B55" : "#999"} />
              <Text style={[styles.secondaryButtonText, !eventDetails && styles.textDisabled]}>
                Enter User ID
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowEventCodeEntry(true)}
              disabled={loading}
            >
              <Ionicons name="calendar-outline" size={20} color="#2E3B55" />
              <Text style={styles.secondaryButtonText}>
                Enter Event Code
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Scans */}
        {recentScans.length > 0 && (
          <View style={styles.recentScans}>
            <Text style={styles.recentTitle}>Recent Check-ins</Text>
            {recentScans.map((scan) => (
              <View key={scan.id} style={styles.recentItem}>
                <View style={styles.recentIcon}>
                  <Ionicons 
                    name={scan.status === 'success' ? 'checkmark-circle' : 'alert-circle'} 
                    size={20} 
                    color={scan.status === 'success' ? '#4CAF50' : '#FFA000'} 
                  />
                </View>
                <View style={styles.recentInfo}>
                  <Text style={styles.recentName}>{scan.userName}</Text>
                  <Text style={styles.recentDetails}>
                    {scan.userMatric || scan.userEmail} • {scan.eventTitle}
                  </Text>
                  <Text style={styles.recentTime}>
                    {scan.time} {scan.date} • {scan.requiresRSVP ? '🔒 RSVP' : '🌐 Open'}
                    {scan.rsvpVerified && ' ✓ Verified'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Manual User ID Entry Modal */}
      <Modal
        visible={manualEntryVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setManualEntryVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Enter User ID</Text>
              <TouchableOpacity onPress={() => setManualEntryVisible(false)}>
                <Ionicons name="close-outline" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {eventDetails && (
              <View style={styles.modalEventInfo}>
                <Ionicons 
                  name={eventDetails.requiresRSVP ? 'lock-closed-outline' : 'globe-outline'} 
                  size={16} 
                  color={eventDetails.requiresRSVP ? '#f39c12' : '#27ae60'} 
                />
                <Text style={styles.modalEventText} numberOfLines={2}>
                  {eventDetails.title} • {eventDetails.requiresRSVP ? 'RSVP Required' : 'Open Event'}
                </Text>
              </View>
            )}
            
            <TextInput
              style={styles.input}
              placeholder="Enter User ID (e.g., student123)"
              value={manualUserId}
              onChangeText={setManualUserId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#999"
            />
            
            <Text style={styles.inputHint}>
              Enter the User ID, email, or matric number of the attendee
              {eventDetails?.requiresRSVP && '\n⚠️ User must have RSVP\'d for this event'}
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setManualEntryVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.submitButton, !manualUserId.trim() && styles.buttonDisabled]}
                onPress={handleManualUserSubmit}
                disabled={!manualUserId.trim()}
              >
                <Text style={styles.submitButtonText}>Mark Present</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Event Code Entry Modal */}
      <Modal
        visible={showEventCodeEntry}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEventCodeEntry(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Enter Event Code</Text>
              <TouchableOpacity onPress={() => setShowEventCodeEntry(false)}>
                <Ionicons name="close-outline" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.input}
              placeholder="e.g., CSW-2024-001"
              value={manualEventCode}
              onChangeText={setManualEventCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholderTextColor="#999"
            />
            
            <Text style={styles.inputHint}>
              Enter the event code provided by the organizer
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setShowEventCodeEntry(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.submitButton, !manualEventCode.trim() && styles.buttonDisabled]}
                onPress={handleManualEventCodeSubmit}
                disabled={!manualEventCode.trim()}
              >
                <Text style={styles.submitButtonText}>Load Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Event Selector Modal (for multiple events with same code) */}
      <Modal
        visible={showEventSelector}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEventSelector(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: height * 0.7 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Event</Text>
              <TouchableOpacity onPress={() => setShowEventSelector(false)}>
                <Ionicons name="close-outline" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView>
              {fetchingEvents ? (
                <View style={styles.loadingEvents}>
                  <ActivityIndicator size="large" color="#2E3B55" />
                  <Text>Loading events...</Text>
                </View>
              ) : (
                availableEvents.map((event) => (
                  <TouchableOpacity
                    key={event.id}
                    style={styles.eventOption}
                    onPress={() => {
                      setEventDetails(event);
                      setEventId(event.id);
                      setShowEventSelector(false);
                      Alert.alert('Success', `Event loaded: ${event.title}`);
                    }}
                  >
                    <View style={styles.eventOptionLeft}>
                      <Ionicons 
                        name={event.requiresRSVP ? 'lock-closed-outline' : 'globe-outline'} 
                        size={24} 
                        color={event.requiresRSVP ? '#f39c12' : '#27ae60'} 
                      />
                      <View style={styles.eventOptionInfo}>
                        <Text style={styles.eventOptionTitle}>
                          {event.title}
                        </Text>
                        <Text style={styles.eventOptionCode}>
                          Code: {event.eventCode}
                        </Text>
                        <Text style={styles.eventOptionMeta}>
                          RSVP'd: {event.attendees?.length || 0} • Capacity: {event.capacity || 'N/A'}
                        </Text>
                      </View>
                    </View>
                    <View style={[
                      styles.eventOptionBadge,
                      { backgroundColor: event.requiresRSVP ? '#f39c12' : '#27ae60' }
                    ]}>
                      <Text style={styles.eventOptionBadgeText}>
                        {event.requiresRSVP ? 'RSVP' : 'Open'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2E3B55',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  eventBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  rsvpEvent: {
    backgroundColor: '#f39c12',
  },
  openEvent: {
    backgroundColor: '#27ae60',
  },
  eventBarText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  noEventBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e74c3c',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  noEventBarText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  scannerContainer: {
    height: 280,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    position: 'relative',
  },
  cornerTL: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 25,
    height: 25,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: '#4CAF50',
  },
  cornerTR: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 25,
    height: 25,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: '#4CAF50',
  },
  cornerBL: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 25,
    height: 25,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: '#4CAF50',
  },
  cornerBR: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 25,
    height: 25,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: '#4CAF50',
  },
  scanLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: '#4CAF50',
    top: '50%',
    transform: [{ translateY: -1 }],
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 5,
  },
  scannerInfo: {
    position: 'absolute',
    bottom: 15,
    alignItems: 'center',
  },
  scannerText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
  },
  scannerSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 5,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 20,
  },
  permissionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  instructions: {
    backgroundColor: 'white',
    margin: 15,
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2E3B55',
    marginBottom: 15,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2E3B55',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepCompleted: {
    backgroundColor: '#27ae60',
  },
  stepDisabled: {
    backgroundColor: '#ccc',
  },
  stepNumberText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  textDisabled: {
    color: '#ccc',
  },
  eventStats: {
    flexDirection: 'row',
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#ecf0f1',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  statText: {
    fontSize: 13,
    color: '#2c3e50',
    marginLeft: 5,
    fontWeight: '500',
  },
  buttonContainer: {
    paddingHorizontal: 15,
  },
  scanButton: {
    backgroundColor: '#2E3B55',
    borderRadius: 15,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  scanButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2E3B55',
    marginHorizontal: 5,
  },
  secondaryButtonText: {
    color: '#2E3B55',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  recentScans: {
    backgroundColor: 'white',
    marginHorizontal: 15,
    marginBottom: 20,
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2E3B55',
    marginBottom: 15,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recentIcon: {
    marginRight: 12,
  },
  recentInfo: {
    flex: 1,
  },
  recentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  recentDetails: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  recentTime: {
    fontSize: 11,
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E3B55',
  },
  modalEventInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  modalEventText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
    flex: 1,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#fafafa',
    marginBottom: 10,
  },
  inputHint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  submitButton: {
    backgroundColor: '#2E3B55',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingEvents: {
    padding: 40,
    alignItems: 'center',
    gap: 10,
  },
  eventOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  eventOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  eventOptionInfo: {
    marginLeft: 12,
    flex: 1,
  },
  eventOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  eventOptionCode: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  eventOptionMeta: {
    fontSize: 11,
    color: '#999',
  },
  eventOptionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 10,
  },
  eventOptionBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});