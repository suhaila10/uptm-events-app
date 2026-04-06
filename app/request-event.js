import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker'; // <-- new import
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { addDoc, collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'; // <-- new
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { auth, db, storage } from '../src/screens/firebase';

export default function RequestEventScreen() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);        // <-- new
  const [uploadProgress, setUploadProgress] = useState(0); // <-- new
  const [existingRequests, setExistingRequests] = useState([]);
  const [activeSection, setActiveSection] = useState('basic');
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    media: false,
    datetime: false,
    location: false,
    category: false,
    capacity: false,
    rsvp: false,
    visibility: false
  });

  // Banner states
  const [bannerPreview, setBannerPreview] = useState('');
  const [showAIOptions, setShowAIOptions] = useState(false);
  const [bannerAIUrl, setBannerAIUrl] = useState('');

  // Duration states
  const [durationHours, setDurationHours] = useState(2);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [durationMode, setDurationMode] = useState('calculate');

  // Date picker state
  const [showStartDate, setShowStartDate] = useState(false);
  const [showStartTime, setShowStartTime] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);
  const [showRSVPDate, setShowRSVPDate] = useState(false);
  const [showRSVPTime, setShowRSVPTime] = useState(false);

  // Form state - Comprehensive fields
  const [formData, setFormData] = useState({
    // BASIC EVENT INFO
    title: '',
    description: '',
    shortDescription: '',
    eventCode: '',
    
    // DATE & TIME
    startDate: null,
    endDate: null,
    duration: 120,
    
    // LOCATION
    venue: 'UPTM Main Hall',
    room: '',
    isOnline: false,
    meetingLink: '',
    
    // EVENT CATEGORY
    category: 'workshop',
    faculty: 'FCOM',
    targetAudience: ['students'],
    
    // CAPACITY & REGISTRATION
    capacity: '50',
    minAttendees: '10',
    registrationOpen: true,
    requiresApproval: false,
    
    // STATUS
    status: 'pending',
    isFeatured: false,
    
    // IMAGES & FILES
    bannerImage: '',
    materials: [],

    // RSVP SETTINGS
    requiresRSVP: true,
    rsvpDeadline: null,
    preparationTime: 24,
    allowWalkIn: false,
    cancellationDeadline: 7,
  });

  // Category options
  const categoryOptions = [
    { value: 'workshop', label: 'Workshop'},
    { value: 'industrial_talk', label: 'Industrial Talk'},
    { value: 'seminar', label: 'Seminar'},
    { value: 'competition', label: 'Competition'},
    { value: 'social', label: 'Social' },
    { value: 'club_meeting', label: 'Club Meeting' },
    { value: 'conference', label: 'Conference'},
    { value: 'training', label: 'Training'},
    { value: 'webinar', label: 'Webinar'},
  ];

  const facultyOptions = [
    { value: 'FCOM', label: 'FCOM', full: 'Computing' },
    { value: 'FABA', label: 'FABA', full: 'Business' },
    { value: 'FESSH', label: 'FESSH', full: 'Education' },
    { value: 'IPS', label: 'IPS', full: 'Technology' },
    { value: 'IGS', label: 'IGS', full: 'Education' },
    { value: 'CIGLS', label: 'CIGLS', full: 'Business'},
    { value: 'GENERAL', label: 'ALL', full: 'All Faculties' },
  ];

  const audienceOptions = [
    { value: 'students', label: 'Students' },
    { value: 'lecturers', label: 'Lecturers' },
    { value: 'staff', label: 'Staff' },
    { value: 'alumni', label: 'Alumni' },
    { value: 'public', label: 'Public'},
  ];

  // Format functions
  const formatDate = (date) => {
    if (!date) return 'Select Date';
    return date.toLocaleDateString('en-MY', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatTime = (date) => {
    if (!date) return 'Select Time';
    return date.toLocaleTimeString('en-MY', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDateTime = (date) => {
    if (!date) return 'Not set';
    return `${formatDate(date)} at ${formatTime(date)}`;
  };

  // Load user data on mount
  useEffect(() => {
    loadUserData();
    (async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant media library permissions to upload images.');
      }
    })();
  }, []);

  const loadUserData = async () => {
    try {
      const userId = await SecureStore.getItemAsync('user_id');
      const userDataString = await SecureStore.getItemAsync('user_data');
      
      if (!userId) {
        Alert.alert('Error', 'Please login first');
        router.replace('/login');
        return;
      }

      setUser({ uid: userId });
      
      if (userDataString) {
        const parsed = JSON.parse(userDataString);
        setUserData(parsed);
        
        if (parsed.role !== 'student' && parsed.role !== 'lecturer') {
          Alert.alert(
            'Access Denied',
            'Only students and lecturers can request events.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
          return;
        }
      }

      await fetchPendingRequests(userId);
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequests = async (userId) => {
    try {
      const q = query(
        collection(db, 'event_requests'),
        where('requesterId', '==', userId),
        where('status', 'in', ['pending', 'revision_needed'])
      );
      const snapshot = await getDocs(q);
      const requests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setExistingRequests(requests);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAudienceChange = (audience) => {
    setFormData(prev => {
      const audiences = [...prev.targetAudience];
      if (audiences.includes(audience)) {
        return { ...prev, targetAudience: audiences.filter(a => a !== audience) };
      } else {
        return { ...prev, targetAudience: [...audiences, audience] };
      }
    });
  };

  // Date picker handlers
  const onStartDateChange = (event, selectedDate) => {
    setShowStartDate(false);
    if (selectedDate) {
      const currentDate = formData.startDate || new Date();
      const newDate = new Date(selectedDate);
      newDate.setHours(currentDate.getHours(), currentDate.getMinutes());
      setFormData(prev => ({ ...prev, startDate: newDate }));
      setTimeout(() => setShowStartTime(true), 500);
    }
  };

  const onStartTimeChange = (event, selectedTime) => {
    setShowStartTime(false);
    if (selectedTime) {
      const currentDate = formData.startDate || new Date();
      const newDateTime = new Date(currentDate);
      newDateTime.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setFormData(prev => ({ ...prev, startDate: newDateTime }));
      calculateDurationFromDates();
    }
  };

  const onEndDateChange = (event, selectedDate) => {
    setShowEndDate(false);
    if (selectedDate) {
      const currentDate = formData.endDate || new Date();
      const newDate = new Date(selectedDate);
      newDate.setHours(currentDate.getHours(), currentDate.getMinutes());
      setFormData(prev => ({ ...prev, endDate: newDate }));
      setTimeout(() => setShowEndTime(true), 500);
    }
  };

  const onEndTimeChange = (event, selectedTime) => {
    setShowEndTime(false);
    if (selectedTime) {
      const currentDate = formData.endDate || new Date();
      const newDateTime = new Date(currentDate);
      newDateTime.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setFormData(prev => ({ ...prev, endDate: newDateTime }));
      calculateDurationFromDates();
    }
  };

  const onRSVPDateChange = (event, selectedDate) => {
    setShowRSVPDate(false);
    if (selectedDate) {
      const currentDate = formData.rsvpDeadline || new Date();
      const newDate = new Date(selectedDate);
      newDate.setHours(currentDate.getHours(), currentDate.getMinutes());
      setFormData(prev => ({ ...prev, rsvpDeadline: newDate }));
      setTimeout(() => setShowRSVPTime(true), 500);
    }
  };

  const onRSVPTimeChange = (event, selectedTime) => {
    setShowRSVPTime(false);
    if (selectedTime) {
      const currentDate = formData.rsvpDeadline || new Date();
      const newDateTime = new Date(currentDate);
      newDateTime.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setFormData(prev => ({ ...prev, rsvpDeadline: newDateTime }));
    }
  };

  // Duration functions
  const calculateDurationFromDates = () => {
    if (formData.startDate && formData.endDate) {
      const diffMs = formData.endDate - formData.startDate;
      if (diffMs > 0) {
        const totalMinutes = Math.round(diffMs / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        setDurationHours(hours);
        setDurationMinutes(minutes);
        setFormData(prev => ({ ...prev, duration: totalMinutes }));
      }
    }
  };

  const handleDurationManualChange = () => {
    const totalMinutes = (durationHours * 60) + durationMinutes;
    setFormData(prev => ({ ...prev, duration: totalMinutes }));
    
    if (formData.startDate) {
      const end = new Date(formData.startDate.getTime() + (totalMinutes * 60 * 1000));
      setFormData(prev => ({ ...prev, endDate: end }));
    }
  };

  // Generate event code
  const generateEventCode = () => {
    const prefix = formData.category.toUpperCase().substring(0, 3);
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${year}-${randomNum}`;
  };

  // Validate form
  const validateForm = () => {
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Please enter an event title');
      return false;
    }
    if (!formData.description.trim()) {
      Alert.alert('Error', 'Please enter a full description');
      return false;
    }
    if (!formData.shortDescription.trim()) {
      Alert.alert('Error', 'Please enter a short description');
      return false;
    }
    if (!formData.startDate) {
      Alert.alert('Error', 'Please select start date and time');
      return false;
    }
    if (!formData.endDate) {
      Alert.alert('Error', 'Please select end date and time');
      return false;
    }

    if (formData.endDate <= formData.startDate) {
      Alert.alert('Error', 'End date must be after start date');
      return false;
    }

    if (!formData.isOnline && !formData.venue) {
      Alert.alert('Error', 'Venue is required for physical events');
      return false;
    }

    if (formData.isOnline && !formData.meetingLink) {
      Alert.alert('Error', 'Meeting link is required for online events');
      return false;
    }

    if (formData.requiresRSVP && formData.rsvpDeadline && formData.rsvpDeadline >= formData.startDate) {
      Alert.alert('Error', 'RSVP deadline must be before event start date');
      return false;
    }

    if (existingRequests.length >= 3) {
      Alert.alert('Error', 'You have too many pending requests. Max 3 allowed.');
      return false;
    }

    return true;
  };

  // --- NEW: Image picker and upload to Firebase Storage ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setBannerPreview(asset.uri);
      await uploadImage(asset.uri);
    }
  };

  const uploadImage = async (uri) => {
    if (!user?.uid) {
      Alert.alert('Error', 'You must be logged in to upload images');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Create a blob from the image URI
      const response = await fetch(uri);
      const blob = await response.blob();

      // Create a unique filename
      const filename = `event-requests/${user.uid}/${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);

      // Upload with progress tracking
      const uploadTask = uploadBytesResumable(storageRef, blob);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
          setUploading(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setFormData(prev => ({ ...prev, bannerImage: downloadURL }));
          setUploading(false);
          Alert.alert('Success', 'Image uploaded successfully!');
        }
      );
    } catch (error) {
      console.error('Upload preparation error:', error);
      Alert.alert('Error', 'Failed to prepare image for upload');
      setUploading(false);
    }
  };
  // --- End new functions ---

  // Handle AI image URL
  const handleAIUpload = () => {
    if (!bannerAIUrl.trim()) {
      Alert.alert('Error', 'Please enter an AI-generated image URL');
      return;
    }
    
    setFormData(prev => ({
      ...prev,
      bannerImage: bannerAIUrl
    }));
    setBannerPreview(bannerAIUrl);
    setShowAIOptions(false);
    Alert.alert('Success', 'AI-generated image URL added successfully');
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const eventCode = formData.eventCode || generateEventCode();

      const requestData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        shortDescription: formData.shortDescription.trim(),
        eventCode: eventCode,
        
        requesterId: user.uid,
        requesterName: userData?.name || 'Unknown',
        requesterEmail: auth.currentUser?.email,
        requesterRole: userData?.role,
        requesterUserId: userData?.userId || userData?.studentId || '',
        
        startDate: Timestamp.fromDate(formData.startDate),
        endDate: Timestamp.fromDate(formData.endDate),
        duration: formData.duration,
        durationHours: durationHours,
        durationMinutes: durationMinutes,
        durationDisplay: `${durationHours}h ${durationMinutes}m`,
        
        venue: formData.venue.trim(),
        room: formData.room.trim(),
        isOnline: formData.isOnline,
        meetingLink: formData.isOnline ? formData.meetingLink.trim() : '',
        
        category: formData.category,
        faculty: formData.faculty,
        targetAudience: formData.targetAudience,
        
        capacity: parseInt(formData.capacity) || 30,
        minAttendees: parseInt(formData.minAttendees) || 5,
        registrationOpen: formData.registrationOpen,
        requiresApproval: formData.requiresApproval,
        
        requiresRSVP: formData.requiresRSVP,
        rsvpDeadline: formData.rsvpDeadline ? Timestamp.fromDate(formData.rsvpDeadline) : null,
        preparationTime: parseInt(formData.preparationTime) || 24,
        allowWalkIn: formData.allowWalkIn,
        cancellationDeadline: parseInt(formData.cancellationDeadline) || 7,
        
        bannerImage: formData.bannerImage.trim(), // Now can be either URL or uploaded image URL
        
        attendees: [],
        attendeesCount: 0,
        waitlistCount: 0,
        
        status: 'pending',
        isFeatured: false,
        
        submittedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      await addDoc(collection(db, 'event_requests'), requestData);
      
      Alert.alert(
        'Success',
        `✅ Event request submitted successfully!\n\nEvent Code: ${eventCode}\n\nAdmin will review within 1-2 business days.`,
        [{ text: 'OK', onPress: () => router.push('/my-requests') }]
      );
    } catch (error) {
      console.error('Error submitting request:', error);
      Alert.alert('Error', 'Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickLogin = () => {
    setEmail('admin@uptm.edu.my');
    setPassword('admin123');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000080" />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  // If user is admin/organizer, redirect
  if (userData?.role === 'admin' || userData?.role === 'organizer') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Icon name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Request Event</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.redirectContainer}>
          <Icon name="info" size={60} color="#000080" />
          <Text style={styles.redirectTitle}>You have event creation permissions</Text>
          <Text style={styles.redirectText}>
            As an {userData.role}, you can create events directly.
          </Text>
          <TouchableOpacity
            style={styles.redirectButton}
            onPress={() => router.push('/create-event')}
          >
            <Text style={styles.redirectButtonText}>Go to Create Event</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Event</Text>
        <TouchableOpacity onPress={() => {}}>
          <Icon name="info" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        {['basic', 'media', 'datetime', 'location', 'category', 'capacity', 'rsvp'].map((section, index) => (
          <View
            key={section}
            style={[
              styles.progressStep,
              { backgroundColor: activeSection === section ? '#000080' : '#ddd' }
            ]}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          
          {/* Pending Requests Alert */}
          {existingRequests.length > 0 && (
            <View style={styles.pendingAlert}>
              <Icon name="pending-actions" size={24} color="#856404" />
              <View style={styles.pendingContent}>
                <Text style={styles.pendingTitle}>
                  You have {existingRequests.length} pending request(s)
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/my-requests')}
                  style={styles.viewPendingButton}
                >
                  <Text style={styles.viewPendingText}>View Requests</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.form}>
            {/* Section Navigation */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionNav}>
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'basic' && styles.navButtonActive]}
                onPress={() => setActiveSection('basic')}
              >
                <Icon name="info" size={16} color={activeSection === 'basic' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'basic' && styles.navButtonTextActive]}>Basic</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'media' && styles.navButtonActive]}
                onPress={() => setActiveSection('media')}
              >
                <Icon name="image" size={16} color={activeSection === 'media' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'media' && styles.navButtonTextActive]}>Media</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'datetime' && styles.navButtonActive]}
                onPress={() => setActiveSection('datetime')}
              >
                <Icon name="access-time" size={16} color={activeSection === 'datetime' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'datetime' && styles.navButtonTextActive]}>Time</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'location' && styles.navButtonActive]}
                onPress={() => setActiveSection('location')}
              >
                <Icon name="place" size={16} color={activeSection === 'location' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'location' && styles.navButtonTextActive]}>Location</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'category' && styles.navButtonActive]}
                onPress={() => setActiveSection('category')}
              >
                <Icon name="category" size={16} color={activeSection === 'category' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'category' && styles.navButtonTextActive]}>Category</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'capacity' && styles.navButtonActive]}
                onPress={() => setActiveSection('capacity')}
              >
                <Icon name="people" size={16} color={activeSection === 'capacity' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'capacity' && styles.navButtonTextActive]}>Capacity</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, activeSection === 'rsvp' && styles.navButtonActive]}
                onPress={() => setActiveSection('rsvp')}
              >
                <Icon name="event" size={16} color={activeSection === 'rsvp' ? '#fff' : '#000080'} />
                <Text style={[styles.navButtonText, activeSection === 'rsvp' && styles.navButtonTextActive]}>RSVP</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Section 1: Basic Information */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('basic')}>
                <View style={styles.sectionTitle}>
                  <Icon name="info" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Basic Information</Text>
                </View>
                <Icon name={expandedSections.basic ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.basic && (
                <View style={styles.sectionContent}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      Event Title <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={formData.title}
                      onChangeText={(text) => handleChange('title', text)}
                      placeholder="e.g., Study Group: Advanced JavaScript"
                      placeholderTextColor="#999"
                      editable={!submitting}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      Short Description <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      value={formData.shortDescription}
                      onChangeText={(text) => handleChange('shortDescription', text)}
                      placeholder="Brief description for listings..."
                      placeholderTextColor="#999"
                      multiline
                      numberOfLines={2}
                      maxLength={150}
                      editable={!submitting}
                    />
                    <Text style={styles.charCount}>{formData.shortDescription.length}/150</Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      Full Description <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      value={formData.description}
                      onChangeText={(text) => handleChange('description', text)}
                      placeholder="Detailed description..."
                      placeholderTextColor="#999"
                      multiline
                      numberOfLines={4}
                      editable={!submitting}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Event Code (Optional)</Text>
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginRight: 10 }]}
                        value={formData.eventCode}
                        onChangeText={(text) => handleChange('eventCode', text)}
                        placeholder="Auto-generated"
                        placeholderTextColor="#999"
                        editable={!submitting}
                      />
                      <TouchableOpacity
                        style={styles.generateButton}
                        onPress={() => handleChange('eventCode', generateEventCode())}
                      >
                        <Icon name="auto-awesome" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Section 2: Media (UPDATED with image picker & upload) */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('media')}>
                <View style={styles.sectionTitle}>
                  <Icon name="image" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Media</Text>
                </View>
                <Icon name={expandedSections.media ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.media && (
                <View style={styles.sectionContent}>
                  {/* Banner Preview */}
                  {(bannerPreview || formData.bannerImage) ? (
                    <View style={styles.bannerPreviewContainer}>
                      <Image 
                        source={{ uri: bannerPreview || formData.bannerImage }} 
                        style={styles.bannerPreview}
                        onError={() => setBannerPreview('')}
                      />
                      <TouchableOpacity
                        style={styles.removeImageButton}
                        onPress={() => {
                          setBannerPreview('');
                          handleChange('bannerImage', '');
                        }}
                      >
                        <Icon name="close" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {/* Upload Progress */}
                  {uploading && (
                    <View style={styles.progressContainer}>
                      <Text style={styles.progressText}>Uploading: {Math.round(uploadProgress)}%</Text>
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
                      </View>
                    </View>
                  )}

                  {/* Upload Options */}
                  <View style={styles.mediaOptions}>
                    {/* NEW: Pick from device */}
                    <TouchableOpacity style={styles.mediaCard} onPress={pickImage} disabled={uploading}>
                      <Icon name="photo-library" size={32} color="#000080" />
                      <Text style={styles.mediaTitle}>Pick from Gallery</Text>
                      <Text style={styles.mediaHint}>JPEG, PNG (max 5MB)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.mediaCard}>
                      <Icon name="link" size={32} color="#000080" />
                      <Text style={styles.mediaTitle}>Image URL</Text>
                      <TextInput
                        style={styles.mediaInput}
                        placeholder="https://example.com/image.jpg"
                        placeholderTextColor="#999"
                        value={formData.bannerImage}
                        onChangeText={(text) => handleChange('bannerImage', text)}
                        editable={!uploading}
                      />
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.mediaCard}
                      onPress={() => setShowAIOptions(!showAIOptions)}
                    >
                      <Icon name="auto-awesome" size={32} color="#000080" />
                      <Text style={styles.mediaTitle}>AI Generation</Text>
                      <Text style={styles.mediaHint}>Generate with AI tools</Text>
                      
                      {showAIOptions && (
                        <View style={styles.aiOptions}>
                          <TextInput
                            style={styles.mediaInput}
                            placeholder="Paste AI image URL..."
                            placeholderTextColor="#999"
                            value={bannerAIUrl}
                            onChangeText={setBannerAIUrl}
                          />
                          <View style={styles.aiActions}>
                            <TouchableOpacity 
                              style={styles.aiConfirmButton}
                              onPress={handleAIUpload}
                            >
                              <Text style={styles.aiButtonText}>Use</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={styles.aiCancelButton}
                              onPress={() => setShowAIOptions(false)}
                            >
                              <Text style={styles.aiButtonText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* AI Tools Links */}
                  <View style={styles.aiTools}>
                    <Text style={styles.aiToolsText}>Popular AI tools:</Text>
                    <TouchableOpacity onPress={() => Alert.alert('Info', 'Open Canva AI in browser')}>
                      <Text style={styles.aiToolLink}>Canva AI</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert('Info', 'Open Bing Creator in browser')}>
                      <Text style={styles.aiToolLink}>Bing</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert('Info', 'Open Ideogram in browser')}>
                      <Text style={styles.aiToolLink}>Ideogram</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* ... (rest of sections remain unchanged) ... */}
            {/* Section 3: Date & Time */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('datetime')}>
                <View style={styles.sectionTitle}>
                  <Icon name="access-time" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Date & Time</Text>
                </View>
                <Icon name={expandedSections.datetime ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.datetime && (
                <View style={styles.sectionContent}>
                  {/* Start Date/Time */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Start Date & Time <Text style={styles.required}>*</Text></Text>
                    <View style={styles.dateTimeRow}>
                      <TouchableOpacity 
                        style={styles.datePickerButton}
                        onPress={() => setShowStartDate(true)}
                      >
                        <Icon name="calendar-today" size={20} color="#000080" />
                        <Text style={styles.datePickerText}>
                          {formData.startDate ? formatDate(formData.startDate) : 'Select Date'}
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={styles.timePickerButton}
                        onPress={() => formData.startDate ? setShowStartTime(true) : Alert.alert('Error', 'Select date first')}
                      >
                        <Icon name="access-time" size={20} color="#000080" />
                        <Text style={styles.timePickerText}>
                          {formData.startDate ? formatTime(formData.startDate) : 'Time'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* End Date/Time */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>End Date & Time <Text style={styles.required}>*</Text></Text>
                    <View style={styles.dateTimeRow}>
                      <TouchableOpacity 
                        style={styles.datePickerButton}
                        onPress={() => setShowEndDate(true)}
                      >
                        <Icon name="calendar-today" size={20} color="#000080" />
                        <Text style={styles.datePickerText}>
                          {formData.endDate ? formatDate(formData.endDate) : 'Select Date'}
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={styles.timePickerButton}
                        onPress={() => formData.endDate ? setShowEndTime(true) : Alert.alert('Error', 'Select date first')}
                      >
                        <Icon name="access-time" size={20} color="#000080" />
                        <Text style={styles.timePickerText}>
                          {formData.endDate ? formatTime(formData.endDate) : 'Time'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Duration */}
                  <View style={styles.durationCard}>
                    <View style={styles.durationHeader}>
                      <Icon name="timer" size={20} color="#000080" />
                      <Text style={styles.durationLabel}>Total Duration: </Text>
                      <Text style={styles.durationValue}>{durationHours}h {durationMinutes}m</Text>
                    </View>
                    
                    <View style={styles.durationTabs}>
                      <TouchableOpacity
                        style={[styles.durationTab, durationMode === 'calculate' && styles.durationTabActive]}
                        onPress={() => {
                          setDurationMode('calculate');
                          calculateDurationFromDates();
                        }}
                      >
                        <Text style={[styles.durationTabText, durationMode === 'calculate' && styles.durationTabTextActive]}>
                          Calculate
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[styles.durationTab, durationMode === 'manual' && styles.durationTabActive]}
                        onPress={() => setDurationMode('manual')}
                      >
                        <Text style={[styles.durationTabText, durationMode === 'manual' && styles.durationTabTextActive]}>
                          Manual
                        </Text>
                      </TouchableOpacity>
                    </View>
                    
                    {durationMode === 'manual' && (
                      <View style={styles.manualDuration}>
                        <View style={styles.durationInputs}>
                          <View style={styles.durationInputGroup}>
                            <TextInput
                              style={styles.durationInput}
                              value={String(durationHours)}
                              onChangeText={(text) => {
                                setDurationHours(parseInt(text) || 0);
                                handleDurationManualChange();
                              }}
                              keyboardType="numeric"
                              maxLength={2}
                            />
                            <Text style={styles.durationUnit}>hours</Text>
                          </View>
                          <View style={styles.durationInputGroup}>
                            <TextInput
                              style={styles.durationInput}
                              value={String(durationMinutes)}
                              onChangeText={(text) => {
                                setDurationMinutes(Math.min(59, parseInt(text) || 0));
                                handleDurationManualChange();
                              }}
                              keyboardType="numeric"
                              maxLength={2}
                            />
                            <Text style={styles.durationUnit}>min</Text>
                          </View>
                        </View>
                        
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetButtons}>
                          <TouchableOpacity 
                            style={styles.presetButton}
                            onPress={() => { setDurationHours(1); setDurationMinutes(0); handleDurationManualChange(); }}
                          >
                            <Text style={styles.presetButtonText}>1h</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.presetButton}
                            onPress={() => { setDurationHours(2); setDurationMinutes(0); handleDurationManualChange(); }}
                          >
                            <Text style={styles.presetButtonText}>2h</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.presetButton}
                            onPress={() => { setDurationHours(3); setDurationMinutes(0); handleDurationManualChange(); }}
                          >
                            <Text style={styles.presetButtonText}>3h</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.presetButton}
                            onPress={() => { setDurationHours(4); setDurationMinutes(0); handleDurationManualChange(); }}
                          >
                            <Text style={styles.presetButtonText}>4h</Text>
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={styles.presetButton}
                            onPress={() => { setDurationHours(8); setDurationMinutes(0); handleDurationManualChange(); }}
                          >
                            <Text style={styles.presetButtonText}>Full Day</Text>
                          </TouchableOpacity>
                        </ScrollView>
                      </View>
                    )}

                    {formData.startDate && formData.endDate && (
                      <View style={styles.dateSummary}>
                        <Icon name="info" size={16} color="#000080" />
                        <Text style={styles.dateSummaryText}>
                          From {formatDateTime(formData.startDate)} to {formatDateTime(formData.endDate)}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* Section 4: Location */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('location')}>
                <View style={styles.sectionTitle}>
                  <Icon name="place" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Location</Text>
                </View>
                <Icon name={expandedSections.location ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.location && (
                <View style={styles.sectionContent}>
                  <View style={styles.switchContainer}>
                    <Text style={styles.switchLabel}>Online Event</Text>
                    <Switch
                      value={formData.isOnline}
                      onValueChange={(value) => handleChange('isOnline', value)}
                      trackColor={{ false: '#ddd', true: '#000080' }}
                      thumbColor={formData.isOnline ? '#fff' : '#f4f3f4'}
                    />
                  </View>

                  {formData.isOnline ? (
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Meeting Link <Text style={styles.required}>*</Text></Text>
                      <TextInput
                        style={styles.input}
                        value={formData.meetingLink}
                        onChangeText={(text) => handleChange('meetingLink', text)}
                        placeholder="https://meet.google.com/xxx-yyyy-zzz"
                        placeholderTextColor="#999"
                      />
                    </View>
                  ) : (
                    <>
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Venue <Text style={styles.required}>*</Text></Text>
                        <TextInput
                          style={styles.input}
                          value={formData.venue}
                          onChangeText={(text) => handleChange('venue', text)}
                          placeholder="e.g., UPTM Main Hall"
                          placeholderTextColor="#999"
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Room</Text>
                        <TextInput
                          style={styles.input}
                          value={formData.room}
                          onChangeText={(text) => handleChange('room', text)}
                          placeholder="e.g., Block C, Room 301"
                          placeholderTextColor="#999"
                        />
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>

            {/* Section 5: Category */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('category')}>
                <View style={styles.sectionTitle}>
                  <Icon name="category" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Category</Text>
                </View>
                <Icon name={expandedSections.category ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.category && (
                <View style={styles.sectionContent}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Event Type</Text>
                    <View style={styles.categoryGrid}>
                      {categoryOptions.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.categoryButton,
                            formData.category === option.value && styles.categoryButtonActive
                          ]}
                          onPress={() => handleChange('category', option.value)}
                        >
                          <Text style={styles.categoryIcon}>{option.icon}</Text>
                          <Text style={[
                            styles.categoryButtonText,
                            formData.category === option.value && styles.categoryButtonTextActive
                          ]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Faculty</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.facultyRow}>
                        {facultyOptions.map((option) => (
                          <TouchableOpacity
                            key={option.value}
                            style={[
                              styles.facultyButton,
                              formData.faculty === option.value && styles.facultyButtonActive
                            ]}
                            onPress={() => handleChange('faculty', option.value)}
                          >
                            <Text style={styles.facultyIcon}>{option.icon}</Text>
                            <Text style={[
                              styles.facultyButtonText,
                              formData.faculty === option.value && styles.facultyButtonTextActive
                            ]}>
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Target Audience</Text>
                    <View style={styles.audienceGrid}>
                      {audienceOptions.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={styles.audienceCheckbox}
                          onPress={() => handleAudienceChange(option.value)}
                        >
                          <Icon
                            name={formData.targetAudience.includes(option.value) ? 'check-box' : 'check-box-outline-blank'}
                            size={24}
                            color="#000080"
                          />
                          <Text style={styles.audienceLabel}>
                            {option.icon} {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Section 6: Capacity */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('capacity')}>
                <View style={styles.sectionTitle}>
                  <Icon name="people" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>Capacity</Text>
                </View>
                <Icon name={expandedSections.capacity ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.capacity && (
                <View style={styles.sectionContent}>
                  <View style={styles.capacityCards}>
                    <View style={styles.capacityCard}>
                      <Text style={styles.capacityLabel}>Maximum Capacity</Text>
                      <TextInput
                        style={styles.capacityInput}
                        value={formData.capacity}
                        onChangeText={(text) => handleChange('capacity', text)}
                        keyboardType="numeric"
                        placeholder="50"
                      />
                      <Text style={styles.capacityHint}>people</Text>
                    </View>
                    
                    <View style={styles.capacityCard}>
                      <Text style={styles.capacityLabel}>Minimum Attendees</Text>
                      <TextInput
                        style={styles.capacityInput}
                        value={formData.minAttendees}
                        onChangeText={(text) => handleChange('minAttendees', text)}
                        keyboardType="numeric"
                        placeholder="10"
                      />
                      <Text style={styles.capacityHint}>to proceed</Text>
                    </View>
                  </View>

                  <View style={styles.registrationOptions}>
                    <TouchableOpacity 
                      style={styles.optionLabel}
                      onPress={() => handleChange('registrationOpen', !formData.registrationOpen)}
                    >
                      <Icon
                        name={formData.registrationOpen ? 'check-box' : 'check-box-outline-blank'}
                        size={24}
                        color="#000080"
                      />
                      <View>
                        <Text style={styles.optionTitle}>Open registration immediately</Text>
                        <Text style={styles.optionHint}>Students can register right away</Text>
                      </View>
                    </TouchableOpacity>
                    
                    
                  </View>
                </View>
              )}
            </View>

            {/* Section 7: RSVP Settings */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('rsvp')}>
                <View style={styles.sectionTitle}>
                  <Icon name="event" size={24} color="#000080" />
                  <Text style={styles.sectionTitleText}>RSVP Settings</Text>
                </View>
                <Icon name={expandedSections.rsvp ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color="#000080" />
              </TouchableOpacity>
              
              {expandedSections.rsvp && (
                <View style={styles.sectionContent}>
                  <View style={styles.rsvpCards}>
                    <TouchableOpacity
                      style={[styles.rsvpCard, formData.requiresRSVP && styles.rsvpCardActive]}
                      onPress={() => handleChange('requiresRSVP', true)}
                    >
                      <Icon 
                        name={formData.requiresRSVP ? 'check-circle' : 'radio-button-unchecked'} 
                        size={32} 
                        color={formData.requiresRSVP ? '#000080' : '#999'} 
                      />
                      <Text style={[styles.rsvpCardTitle, formData.requiresRSVP && styles.rsvpCardTitleActive]}>
                        Students MUST RSVP
                      </Text>
                      <Text style={styles.rsvpCardHint}>Track attendance, prepare materials</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={[styles.rsvpCard, !formData.requiresRSVP && styles.rsvpCardActive]}
                      onPress={() => handleChange('requiresRSVP', false)}
                    >
                      <Icon 
                        name={!formData.requiresRSVP ? 'check-circle' : 'radio-button-unchecked'} 
                        size={32} 
                        color={!formData.requiresRSVP ? '#000080' : '#999'} 
                      />
                      <Text style={[styles.rsvpCardTitle, !formData.requiresRSVP && styles.rsvpCardTitleActive]}>
                        Optional Attendance
                      </Text>
                      <Text style={styles.rsvpCardHint}>Open to walk-ins, casual gatherings</Text>
                    </TouchableOpacity>
                  </View>

                  {formData.requiresRSVP && (
                    <View style={styles.rsvpDetails}>
                      <Text style={styles.rsvpDetailsTitle}>RSVP Configuration</Text>
                      
                      {/* RSVP Deadline */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>RSVP Deadline</Text>
                        <View style={styles.dateTimeRow}>
                          <TouchableOpacity 
                            style={styles.datePickerButton}
                            onPress={() => setShowRSVPDate(true)}
                          >
                            <Icon name="calendar-today" size={20} color="#000080" />
                            <Text style={styles.datePickerText}>
                              {formData.rsvpDeadline ? formatDate(formData.rsvpDeadline) : 'Select Date'}
                            </Text>
                          </TouchableOpacity>
                          
                          <TouchableOpacity 
                            style={styles.timePickerButton}
                            onPress={() => formData.rsvpDeadline ? setShowRSVPTime(true) : Alert.alert('Error', 'Select date first')}
                          >
                            <Icon name="access-time" size={20} color="#000080" />
                            <Text style={styles.timePickerText}>
                              {formData.rsvpDeadline ? formatTime(formData.rsvpDeadline) : 'Time'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Cancellation Deadline */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Cancellation Deadline</Text>
                        <View style={styles.pickerContainer}>
                          {[1, 2, 3, 7, 14].map((days) => (
                            <TouchableOpacity
                              key={days}
                              style={[
                                styles.dayButton,
                                formData.cancellationDeadline === days && styles.dayButtonActive
                              ]}
                              onPress={() => handleChange('cancellationDeadline', days)}
                            >
                              <Text style={[
                                styles.dayButtonText,
                                formData.cancellationDeadline === days && styles.dayButtonTextActive
                              ]}>
                                {days}d
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Preparation Time */}
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Preparation Time</Text>
                        <View style={styles.pickerContainer}>
                          {[1, 2, 4, 12, 24, 48].map((hours) => (
                            <TouchableOpacity
                              key={hours}
                              style={[
                                styles.hourButton,
                                formData.preparationTime === hours && styles.hourButtonActive
                              ]}
                              onPress={() => handleChange('preparationTime', hours)}
                            >
                              <Text style={[
                                styles.hourButtonText,
                                formData.preparationTime === hours && styles.hourButtonTextActive
                              ]}>
                                {hours}h
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Allow Walk-ins */}
                      <TouchableOpacity 
                        style={styles.optionLabel}
                        onPress={() => handleChange('allowWalkIn', !formData.allowWalkIn)}
                      >
                        <Icon
                          name={formData.allowWalkIn ? 'check-box' : 'check-box-outline-blank'}
                          size={24}
                          color="#000080"
                        />
                        <View>
                          <Text style={styles.optionTitle}>Allow walk-ins after deadline</Text>
                          <Text style={styles.optionHint}>Limited resources available</Text>
                        </View>
                      </TouchableOpacity>

                      {/* Rules Preview */}
                      <View style={styles.rulesPreview}>
                        <Icon name="info" size={16} color="#000080" />
                        <Text style={styles.rulesPreviewText}>
                          Cancellation blocked {formData.cancellationDeadline || 7} day(s) before event
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Guidelines */}
            <View style={styles.guidelines}>
              <Text style={styles.guidelinesTitle}>Before Submitting:</Text>
              <Text style={styles.guidelineText}>✓ Ensure all details are accurate</Text>
              <Text style={styles.guidelineText}>✓ Check date and time conflicts</Text>
              <Text style={styles.guidelineText}>✓ Verify venue availability</Text>
              <Text style={styles.guidelineText}>✓ Admin will review within 1-2 business days</Text>
              <Text style={styles.guidelineText}>✓ You can track status in "My Requests"</Text>
            </View>

            {/* Submit Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.submitButton, (submitting || uploading) && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={submitting || uploading || existingRequests.length >= 3}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="send" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Submit Event Request</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => router.back()}
                disabled={submitting}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Date/Time Pickers */}
      {showStartDate && (
        <DateTimePicker
          value={formData.startDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onStartDateChange}
          minimumDate={new Date()}
        />
      )}

      {showStartTime && (
        <DateTimePicker
          value={formData.startDate || new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onStartTimeChange}
        />
      )}

      {showEndDate && (
        <DateTimePicker
          value={formData.endDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onEndDateChange}
          minimumDate={formData.startDate || new Date()}
        />
      )}

      {showEndTime && (
        <DateTimePicker
          value={formData.endDate || new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onEndTimeChange}
        />
      )}

      {showRSVPDate && (
        <DateTimePicker
          value={formData.rsvpDeadline || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onRSVPDateChange}
          minimumDate={new Date()}
          maximumDate={formData.startDate || undefined}
        />
      )}

      {showRSVPTime && (
        <DateTimePicker
          value={formData.rsvpDeadline || new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onRSVPTimeChange}
        />
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
  progressBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  progressStep: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    color: '#000080',
    marginTop: 20,
    fontSize: 16,
  },
  redirectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  redirectTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  redirectText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  redirectButton: {
    backgroundColor: '#000080',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
  },
  redirectButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  pendingAlert: {
    flexDirection: 'row',
    backgroundColor: '#fff3cd',
    margin: 15,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  pendingContent: {
    flex: 1,
    marginLeft: 10,
  },
  pendingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 5,
  },
  viewPendingButton: {
    alignSelf: 'flex-start',
  },
  viewPendingText: {
    color: '#000080',
    fontSize: 12,
    fontWeight: '600',
  },
  form: {
    padding: 20,
  },
  sectionNav: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#000080',
    backgroundColor: 'transparent',
  },
  navButtonActive: {
    backgroundColor: '#000080',
  },
  navButtonText: {
    fontSize: 12,
    color: '#000080',
    marginLeft: 4,
  },
  navButtonTextActive: {
    color: '#fff',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 10,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000080',
    marginLeft: 10,
  },
  sectionContent: {
    padding: 15,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  required: {
    color: '#e74c3c',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  generateButton: {
    width: 50,
    height: 50,
    backgroundColor: '#000080',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Media styles
  bannerPreviewContainer: {
    position: 'relative',
    marginBottom: 15,
  },
  bannerPreview: {
    width: '100%',
    height: 150,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 30,
    height: 30,
    backgroundColor: '#000080',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    marginBottom: 15,
  },
  progressText: {
    fontSize: 12,
    color: '#000080',
    marginBottom: 5,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#ddd',
    borderRadius: 3,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: '#000080',
    borderRadius: 3,
  },
  mediaOptions: {
    gap: 15,
  },
  mediaCard: {
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  mediaTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 10,
    marginBottom: 5,
  },
  mediaHint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
  },
  mediaInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    fontSize: 12,
    backgroundColor: '#fff',
  },
  aiOptions: {
    marginTop: 10,
    width: '100%',
  },
  aiActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  aiConfirmButton: {
    flex: 1,
    backgroundColor: '#000080',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
  },
  aiCancelButton: {
    flex: 1,
    backgroundColor: '#e74c3c',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
  },
  aiButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  aiTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  aiToolsText: {
    fontSize: 12,
    color: '#666',
  },
  aiToolLink: {
    fontSize: 12,
    color: '#000080',
    fontWeight: '600',
  },
  // Date & Time styles
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  datePickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  timePickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  datePickerText: {
    fontSize: 14,
    color: '#333',
  },
  timePickerText: {
    fontSize: 14,
    color: '#333',
  },
  durationCard: {
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginTop: 10,
  },
  durationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  durationLabel: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  durationValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000080',
  },
  durationTabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 15,
  },
  durationTab: {
    flex: 1,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  durationTabActive: {
    backgroundColor: '#000080',
    borderColor: '#000080',
  },
  durationTabText: {
    fontSize: 13,
    color: '#666',
  },
  durationTabTextActive: {
    color: '#fff',
  },
  manualDuration: {
    gap: 15,
  },
  durationInputs: {
    flexDirection: 'row',
    gap: 15,
  },
  durationInputGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  durationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    textAlign: 'center',
  },
  durationUnit: {
    fontSize: 12,
    color: '#666',
    width: 40,
  },
  presetButtons: {
    flexDirection: 'row',
  },
  presetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#000080',
    borderRadius: 4,
    marginRight: 8,
  },
  presetButtonText: {
    fontSize: 12,
    color: '#000080',
  },
  dateSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  dateSummaryText: {
    flex: 1,
    fontSize: 12,
    color: '#000080',
  },
  // Location styles
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  switchLabel: {
    fontSize: 14,
    color: '#333',
  },
  // Category styles
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryButton: {
    width: '31%',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  categoryButtonActive: {
    backgroundColor: '#000080',
    borderColor: '#000080',
  },
  categoryIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  categoryButtonText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
  categoryButtonTextActive: {
    color: '#fff',
  },
  facultyRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 5,
  },
  facultyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    gap: 4,
  },
  facultyButtonActive: {
    backgroundColor: '#000080',
    borderColor: '#000080',
  },
  facultyIcon: {
    fontSize: 14,
  },
  facultyButtonText: {
    fontSize: 12,
    color: '#666',
  },
  facultyButtonTextActive: {
    color: '#fff',
  },
  audienceGrid: {
    gap: 10,
  },
  audienceCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audienceLabel: {
    fontSize: 14,
    color: '#333',
  },
  // Capacity styles
  capacityCards: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 20,
  },
  capacityCard: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  capacityLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  capacityInput: {
    fontSize: 24,
    fontWeight: '600',
    color: '#000080',
    textAlign: 'center',
    padding: 0,
  },
  capacityHint: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  registrationOptions: {
    gap: 12,
  },
  optionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  optionHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  // RSVP styles
  rsvpCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 15,
  },
  rsvpCard: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  rsvpCardActive: {
    borderColor: '#000080',
    backgroundColor: '#f0f8ff',
  },
  rsvpCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  rsvpCardTitleActive: {
    color: '#000080',
  },
  rsvpCardHint: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
  },
  rsvpDetails: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
  },
  rsvpDetailsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000080',
    marginBottom: 15,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayButton: {
    width: 50,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  dayButtonActive: {
    backgroundColor: '#000080',
    borderColor: '#000080',
  },
  dayButtonText: {
    fontSize: 12,
    color: '#666',
  },
  dayButtonTextActive: {
    color: '#fff',
  },
  hourButton: {
    width: 60,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  hourButtonActive: {
    backgroundColor: '#000080',
    borderColor: '#000080',
  },
  hourButtonText: {
    fontSize: 12,
    color: '#666',
  },
  hourButtonTextActive: {
    color: '#fff',
  },
  rulesPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  rulesPreviewText: {
    fontSize: 12,
    color: '#000080',
    flex: 1,
  },
  // Guidelines
  guidelines: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  guidelinesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000080',
    marginBottom: 10,
  },
  guidelineText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 5,
    lineHeight: 20,
  },
  // Buttons
  buttonContainer: {
    marginBottom: 30,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#000080',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000080',
  },
  cancelButtonText: {
    color: '#000080',
    fontSize: 16,
    fontWeight: '600',
  },
});