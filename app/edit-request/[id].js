import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker'; // <-- new
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
import { auth, db, storage } from '../../src/screens/firebase'; // ensure storage is exported

export default function EditRequestScreen() {
    const { id } = useLocalSearchParams();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);                // <-- new
    const [uploadProgress, setUploadProgress] = useState(0);          // <-- new
    const [originalRequest, setOriginalRequest] = useState(null);
    const [expandedSections, setExpandedSections] = useState({
        basic: true,
        media: false,
        datetime: false,
        location: false,
        category: false,
        capacity: false,
        rsvp: false
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

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        shortDescription: '',
        eventCode: '',
        startDate: null,
        endDate: null,
        duration: 120,
        venue: 'UPTM Main Hall',
        room: '',
        isOnline: false,
        meetingLink: '',
        category: 'workshop',
        faculty: 'FCOM',
        targetAudience: ['students'],
        capacity: '50',
        minAttendees: '10',
        registrationOpen: true,
        requiresApproval: false,
        requiresRSVP: true,
        rsvpDeadline: null,
        preparationTime: 24,
        allowWalkIn: false,
        cancellationDeadline: 7,
        bannerImage: '',
        additionalNotes: '',
        materials: []
    });

    // Category options (same as before)
    const categoryOptions = [
        { value: 'workshop', label: 'Workshop' },
        { value: 'industrial_talk', label: 'Industrial Talk' },
        { value: 'seminar', label: 'Seminar' },
        { value: 'competition', label: 'Competition' },
        { value: 'social', label: 'Social' },
        { value: 'club_meeting', label: 'Club Meeting' },
        { value: 'conference', label: 'Conference' },
        { value: 'training', label: 'Training' },
        { value: 'webinar', label: 'Webinar' },
    ];

    const facultyOptions = [
        { value: 'FCOM', label: 'FCOM', full: 'Computing' },
        { value: 'FABA', label: 'FABA', full: 'Business' },
        { value: 'FESSH', label: 'FESSH', full: 'Education' },
        { value: 'IPS', label: 'IPS', full: 'Technology'},
        { value: 'IGS', label: 'IGS', full: 'Education' },
        { value: 'CIGLS', label: 'CIGLS', full: 'Business' },
        { value: 'GENERAL', label: 'ALL', full: 'All Faculties' },
    ];

    const audienceOptions = [
        { value: 'students', label: 'Students' },
        { value: 'lecturers', label: 'Lecturers' },
        { value: 'staff', label: 'Staff'},
        { value: 'alumni', label: 'Alumni'},
        { value: 'public', label: 'Public' },
    ];

    // Format functions (same as before)
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

    const formatDateFromTimestamp = (timestamp) => {
        if (!timestamp) return null;
        try {
            return timestamp.toDate();
        } catch {
            return null;
        }
    };

    // Request media library permissions on mount
    useEffect(() => {
        (async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission needed', 'Please grant media library permissions to upload images.');
            }
        })();
    }, []);

    // Fetch the existing request
    useEffect(() => {
        const fetchRequest = async () => {
            try {
                const user = auth.currentUser;
                if (!user) {
                    Alert.alert('Error', 'Please login first');
                    router.replace('/login');
                    return;
                }

                const userId = await SecureStore.getItemAsync('user_id');
                if (!userId || userId !== user.uid) {
                    Alert.alert('Error', 'Session expired. Please login again.');
                    router.replace('/login');
                    return;
                }

                const requestDoc = await getDoc(doc(db, 'event_requests', id));

                if (!requestDoc.exists()) {
                    Alert.alert('Error', 'Request not found');
                    router.back();
                    return;
                }

                const requestData = requestDoc.data();

                if (requestData.requesterId !== user.uid) {
                    Alert.alert('Error', 'You do not have permission to edit this request');
                    router.back();
                    return;
                }

                if (requestData.status !== 'revision_needed') {
                    Alert.alert('Error', 'This request cannot be edited in its current state');
                    router.back();
                    return;
                }

                setOriginalRequest(requestData);

                if (requestData.startDate && requestData.endDate) {
                    const start = requestData.startDate.toDate();
                    const end = requestData.endDate.toDate();
                    const diffMs = end - start;
                    const totalMinutes = Math.round(diffMs / (1000 * 60));
                    const hours = Math.floor(totalMinutes / 60);
                    const minutes = totalMinutes % 60;
                    setDurationHours(hours);
                    setDurationMinutes(minutes);
                }

                setFormData({
                    title: requestData.title || '',
                    description: requestData.description || '',
                    shortDescription: requestData.shortDescription || '',
                    eventCode: requestData.eventCode || '',
                    startDate: formatDateFromTimestamp(requestData.startDate),
                    endDate: formatDateFromTimestamp(requestData.endDate),
                    duration: requestData.duration || 120,
                    venue: requestData.venue || 'UPTM Main Hall',
                    room: requestData.room || '',
                    isOnline: requestData.isOnline || false,
                    meetingLink: requestData.meetingLink || '',
                    category: requestData.category || 'workshop',
                    faculty: requestData.faculty || 'FCOM',
                    targetAudience: requestData.targetAudience || ['students'],
                    capacity: String(requestData.capacity || 50),
                    minAttendees: String(requestData.minAttendees || 10),
                    registrationOpen: requestData.registrationOpen !== undefined ? requestData.registrationOpen : true,
                    requiresApproval: requestData.requiresApproval || false,
                    requiresRSVP: requestData.requiresRSVP !== undefined ? requestData.requiresRSVP : true,
                    rsvpDeadline: formatDateFromTimestamp(requestData.rsvpDeadline),
                    preparationTime: requestData.preparationTime || 24,
                    allowWalkIn: requestData.allowWalkIn || false,
                    cancellationDeadline: requestData.cancellationDeadline || 7,
                    bannerImage: requestData.bannerImage || '',
                    additionalNotes: requestData.additionalNotes || '',
                    materials: requestData.materials || []
                });

                if (requestData.bannerImage) {
                    setBannerPreview(requestData.bannerImage);
                }

                setLoading(false);
            } catch (error) {
                console.error('Error fetching request:', error);
                Alert.alert('Error', 'Failed to load request');
                router.back();
            }
        };

        fetchRequest();
    }, [id]);

    // Toggle sections
    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    // Handle form changes
    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (field === 'startDate' || field === 'endDate') {
            setTimeout(calculateDurationFromDates, 100);
        }
    };

    // Handle audience selection
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

    // Date picker handlers (same as before)
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
        if (!auth.currentUser?.uid) {
            Alert.alert('Error', 'You must be logged in to upload images');
            return;
        }

        setUploading(true);
        setUploadProgress(0);

        try {
            const response = await fetch(uri);
            const blob = await response.blob();
            const filename = `event-requests/${auth.currentUser.uid}/${Date.now()}.jpg`;
            const storageRef = ref(storage, filename);

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

    // Banner functions (AI)
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

    // Validate form (unchanged)
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

        return true;
    };

    // Submit updated request
    const handleSubmit = async () => {
        if (!validateForm()) return;

        setSubmitting(true);

        try {
            const requestRef = doc(db, 'event_requests', id);

            const updateData = {
                title: formData.title.trim() || '',
                description: formData.description.trim() || '',
                shortDescription: formData.shortDescription.trim() || '',
                eventCode: formData.eventCode || originalRequest?.eventCode || '',
                startDate: Timestamp.fromDate(formData.startDate),
                endDate: Timestamp.fromDate(formData.endDate),
                duration: formData.duration || 0,
                durationHours: durationHours || 0,
                durationMinutes: durationMinutes || 0,
                durationDisplay: `${durationHours || 0}h ${durationMinutes || 0}m`,
                venue: formData.venue.trim() || 'UPTM Main Hall',
                room: formData.room.trim() || '',
                isOnline: formData.isOnline || false,
                meetingLink: formData.isOnline ? (formData.meetingLink.trim() || '') : '',
                category: formData.category || 'workshop',
                faculty: formData.faculty || 'FCOM',
                targetAudience: formData.targetAudience || ['students'],
                capacity: parseInt(formData.capacity) || 50,
                minAttendees: parseInt(formData.minAttendees) || 10,
                registrationOpen: formData.registrationOpen !== undefined ? formData.registrationOpen : true,
                requiresApproval: formData.requiresApproval || false,
                requiresRSVP: formData.requiresRSVP !== undefined ? formData.requiresRSVP : true,
                preparationTime: parseInt(formData.preparationTime) || 24,
                allowWalkIn: formData.allowWalkIn || false,
                cancellationDeadline: parseInt(formData.cancellationDeadline) || 7,
                bannerImage: formData.bannerImage || '',
                additionalNotes: formData.additionalNotes.trim() || '',
                status: 'pending',
                updatedAt: Timestamp.now(),
                revisionHistory: [
                    ...(originalRequest?.revisionHistory || []),
                    {
                        reviewedAt: originalRequest?.reviewedAt || null,
                        reviewNotes: originalRequest?.reviewNotes || null,
                        resubmittedAt: Timestamp.now()
                    }
                ],
                reviewNotes: null,
                reviewedAt: null
            };

            if (formData.rsvpDeadline) {
                updateData.rsvpDeadline = Timestamp.fromDate(formData.rsvpDeadline);
            } else {
                updateData.rsvpDeadline = null;
            }

            await updateDoc(requestRef, updateData);

            Alert.alert(
                'Success',
                '✅ Request updated successfully! It has been sent back for admin review.',
                [{ text: 'OK', onPress: () => router.push('/my-requests') }]
            );

        } catch (error) {
            console.error('Error updating request:', error);
            Alert.alert('Error', `Failed to update request: ${error.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#000080" />
                <Text style={styles.loadingText}>Loading request...</Text>
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
                <Text style={styles.headerTitle}>Edit Request</Text>
                <View style={{ width: 24 }} />
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <ScrollView showsVerticalScrollIndicator={false}>
                    {/* Admin Feedback Banner */}
                    {originalRequest?.reviewNotes && (
                        <View style={styles.feedbackBanner}>
                            <Icon name="info" size={24} color="#856404" />
                            <View style={styles.feedbackContent}>
                                <Text style={styles.feedbackTitle}>Admin Feedback Required:</Text>
                                <Text style={styles.feedbackText}>{originalRequest.reviewNotes}</Text>
                            </View>
                        </View>
                    )}

                    {/* Progress Bar */}
                    <View style={styles.progressBar}>
                        {['basic', 'media', 'datetime', 'location', 'category', 'capacity', 'rsvp'].map((section, index) => (
                            <View
                                key={section}
                                style={[
                                    styles.progressStep,
                                    { backgroundColor: Object.values(expandedSections).some(v => v === true) ? '#000080' : '#ddd' }
                                ]}
                            />
                        ))}
                    </View>

                    {/* Section Navigation */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionNav}>
                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.basic && styles.navButtonActive]}
                            onPress={() => toggleSection('basic')}
                        >
                            <Icon name="info" size={16} color={expandedSections.basic ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.basic && styles.navButtonTextActive]}>Basic</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.media && styles.navButtonActive]}
                            onPress={() => toggleSection('media')}
                        >
                            <Icon name="image" size={16} color={expandedSections.media ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.media && styles.navButtonTextActive]}>Media</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.datetime && styles.navButtonActive]}
                            onPress={() => toggleSection('datetime')}
                        >
                            <Icon name="access-time" size={16} color={expandedSections.datetime ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.datetime && styles.navButtonTextActive]}>Time</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.location && styles.navButtonActive]}
                            onPress={() => toggleSection('location')}
                        >
                            <Icon name="place" size={16} color={expandedSections.location ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.location && styles.navButtonTextActive]}>Location</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.category && styles.navButtonActive]}
                            onPress={() => toggleSection('category')}
                        >
                            <Icon name="category" size={16} color={expandedSections.category ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.category && styles.navButtonTextActive]}>Category</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.capacity && styles.navButtonActive]}
                            onPress={() => toggleSection('capacity')}
                        >
                            <Icon name="people" size={16} color={expandedSections.capacity ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.capacity && styles.navButtonTextActive]}>Capacity</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.navButton, expandedSections.rsvp && styles.navButtonActive]}
                            onPress={() => toggleSection('rsvp')}
                        >
                            <Icon name="event" size={16} color={expandedSections.rsvp ? '#fff' : '#000080'} />
                            <Text style={[styles.navButtonText, expandedSections.rsvp && styles.navButtonTextActive]}>RSVP</Text>
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
                                    <Text style={styles.label}>Event Code</Text>
                                    <TextInput
                                        style={[styles.input, styles.readOnlyInput]}
                                        value={formData.eventCode}
                                        onChangeText={(text) => handleChange('eventCode', text)}
                                        placeholder="Auto-generated"
                                        editable={false}
                                    />
                                    <Text style={styles.hint}>Event code is automatically generated</Text>
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

                    {/* Section 3: Date & Time (unchanged, keep as before) */}
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
                                </View>
                            </View>
                        )}
                    </View>

                    {/* Section 4: Location (unchanged) */}
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

                    {/* Section 5: Category (unchanged) */}
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

                    {/* Section 6: Capacity (unchanged) */}
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

                                    <TouchableOpacity
                                        style={styles.optionLabel}
                                        onPress={() => handleChange('requiresApproval', !formData.requiresApproval)}
                                    >
                                        <Icon
                                            name={formData.requiresApproval ? 'check-box' : 'check-box-outline-blank'}
                                            size={24}
                                            color="#000080"
                                        />
                                        <View>
                                            <Text style={styles.optionTitle}>Require approval for registration</Text>
                                            <Text style={styles.optionHint}>Manually approve each attendee</Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>

                    {/* Section 7: RSVP Settings (unchanged) */}
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
                                    </View>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Additional Notes (unchanged) */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.sectionTitle}>
                                <Icon name="note" size={24} color="#000080" />
                                <Text style={styles.sectionTitleText}>Additional Notes</Text>
                            </View>
                        </View>

                        <View style={styles.sectionContent}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Notes for Admin</Text>
                                <TextInput
                                    style={[styles.input, styles.textarea]}
                                    value={formData.additionalNotes}
                                    onChangeText={(text) => handleChange('additionalNotes', text)}
                                    placeholder="Any special requirements or notes for the admin..."
                                    placeholderTextColor="#999"
                                    multiline
                                    numberOfLines={3}
                                    editable={!submitting}
                                />
                            </View>
                        </View>
                    </View>

                    {/* Submit Buttons (unchanged) */}
                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={[styles.submitButton, (submitting || uploading) && styles.buttonDisabled]}
                            onPress={handleSubmit}
                            disabled={submitting || uploading}
                        >
                            {submitting ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <>
                                    <Icon name="save" size={20} color="#fff" />
                                    <Text style={styles.submitButtonText}>Update & Resubmit</Text>
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
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Date/Time Pickers (unchanged) */}
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
    feedbackBanner: {
        flexDirection: 'row',
        backgroundColor: '#fff3cd',
        margin: 15,
        padding: 15,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#ffeaa7',
    },
    feedbackContent: {
        flex: 1,
        marginLeft: 10,
    },
    feedbackTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#856404',
        marginBottom: 5,
    },
    feedbackText: {
        fontSize: 13,
        color: '#856404',
        lineHeight: 18,
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
    sectionNav: {
        flexDirection: 'row',
        padding: 15,
        backgroundColor: '#fff',
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
        marginHorizontal: 15,
        marginBottom: 15,
        borderRadius: 10,
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
    hint: {
        fontSize: 11,
        color: '#666',
        marginTop: 5,
        fontStyle: 'italic',
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
    readOnlyInput: {
        backgroundColor: '#f5f5f5',
        color: '#666',
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
    // Buttons
    buttonContainer: {
        margin: 15,
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