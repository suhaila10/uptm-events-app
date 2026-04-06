// src/screens/Register.js
import { Picker } from '@react-native-picker/picker';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import uptmLogo from '../assets/images/uptm.png';
import { auth, db } from '../src/screens/firebase';

export default function RegisterScreen() {
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('student');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Password validation states
  const [passwordErrors, setPasswordErrors] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    symbol: false,
  });

  // Password validation function - now as useCallback
  const validatePassword = useCallback((pass) => {
    const errors = {
      length: pass.length >= 8,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /[0-9]/.test(pass),
      symbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass),
    };
    setPasswordErrors(errors);
    return Object.values(errors).every(Boolean);
  }, []);

  // Compute if password is valid without calling validatePassword in render
  const isPasswordValid = useMemo(() => {
    if (password.length === 0) return false;
    return (
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    );
  }, [password]);

  const getUserIDPlaceholder = () => {
    switch (role) {
      case 'student': return 'AM2408016647';
      case 'lecturer': return 'LEC001234';
      case 'organizer': return 'ORG0001';
      case 'admin': return 'ADM0001';
      default: return 'Enter User ID';
    }
  };

  const getUserIDLabel = () => {
    switch (role) {
      case 'student': return 'Student ID *';
      case 'lecturer': return 'Lecturer ID *';
      case 'organizer': return 'Staff ID *';
      case 'admin': return 'Admin ID *';
      default: return 'User ID *';
    }
  };

  const validateUserID = (id) => {
    if (!id) return 'User ID is required';
    const cleanId = id.trim().toUpperCase();
    if (cleanId.length < 6 || cleanId.length > 20) {
      return 'User ID must be between 6-20 characters';
    }
    switch (role) {
      case 'student':
        if (!/^AM\d+$/.test(cleanId)) {
          return 'Student ID should start with "AM" followed by numbers';
        }
        break;
      case 'lecturer':
        if (!/^LEC\d+$/.test(cleanId)) {
          return 'Lecturer ID should start with "LEC" followed by numbers';
        }
        break;
      case 'organizer':
        if (!/^ORG\d+$/.test(cleanId)) {
          return 'Organizer ID should start with "ORG" followed by numbers';
        }
        break;
      case 'admin':
        if (!/^ADM\d+$/.test(cleanId)) {
          return 'Admin ID should start with "ADM" followed by numbers';
        }
        break;
    }
    return '';
  };

  const validateEmailDomain = (email, role) => {
    const emailDomain = email.split('@')[1];
    if (role === 'student') {
      if (!emailDomain?.includes('student.uptm.edu.my')) {
        return 'Students must use @student.uptm.edu.my email';
      }
    } else {
      if (!emailDomain?.includes('uptm.edu.my')) {
        return 'Staff must use @uptm.edu.my email';
      }
    }
    return '';
  };

  const checkUserIdExists = async (userId) => {
    try {
      const userDoc = await getDoc(doc(db, 'users_by_id', userId.toUpperCase()));
      return userDoc.exists();
    } catch (error) {
      console.error('Error checking user ID:', error);
      return false;
    }
  };

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setUserId('');
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    validatePassword(text);
  };

  const handleRegister = async () => {
    // Validate all inputs
    if (!userId || !email || !password || !name) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    // Validate User ID format
    const idError = validateUserID(userId);
    if (idError) {
      Alert.alert('Validation Error', idError);
      return;
    }

    // Validate email domain
    const emailError = validateEmailDomain(email, role);
    if (emailError) {
      Alert.alert('Validation Error', emailError);
      return;
    }

    // Validate password strength
    if (!isPasswordValid) {
      Alert.alert(
        'Weak Password',
        'Password must contain:\n' +
        '• At least 8 characters\n' +
        '• At least one uppercase letter\n' +
        '• At least one lowercase letter\n' +
        '• At least one number\n' +
        '• At least one special character (!@#$%^&*)'
      );
      return;
    }

    setLoading(true);

    try {
      // Check if User ID already exists
      const userIdExists = await checkUserIdExists(userId);
      if (userIdExists) {
        Alert.alert(
          'Error',
          'This User ID is already registered. Please use a different ID or login.'
        );
        setLoading(false);
        return;
      }

      // Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update display name
      await updateProfile(user, { displayName: name });

      // Prepare user data
      const cleanUserId = userId.trim().toUpperCase();
      const userData = {
        userId: cleanUserId,
        email: email.toLowerCase(),
        name: name.trim(),
        role: role,
        authUid: user.uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isActive: true,
        emailVerified: false,
        lastLogin: null,
        profileComplete: false,
      };

      // Role-specific data
      switch (role) {
        case 'student':
          userData.userType = 'student';
          userData.matricNumber = cleanUserId;
          userData.yearOfStudy = new Date().getFullYear();
          userData.semester = 1;
          userData.program = 'To be updated';
          break;
        case 'lecturer':
          userData.userType = 'staff';
          userData.position = 'Lecturer';
          userData.department = 'General';
          userData.faculty = 'To be updated';
          break;
        case 'organizer':
          userData.userType = 'staff';
          userData.position = 'Event Organizer';
          userData.canCreateEvents = true;
          userData.canManageEvents = true;
          break;
        case 'admin':
          userData.userType = 'staff';
          userData.position = 'Administrator';
          userData.canCreateEvents = true;
          userData.canManageEvents = true;
          userData.canManageUsers = true;
          userData.canManageSystem = true;
          break;
      }

      // Save to Firestore
      await setDoc(doc(db, 'users', user.uid), userData);
      await setDoc(doc(db, 'users_by_id', cleanUserId), { ...userData, uid: user.uid });

      if (role === 'student') {
        await setDoc(doc(db, 'students', cleanUserId), {
          uid: user.uid,
          userId: cleanUserId,
          name: name.trim(),
          email: email.toLowerCase(),
          matricNumber: cleanUserId,
          createdAt: Timestamp.now(),
          totalEventsAttended: 0,
          totalPoints: 0,
        });
      } else if (role === 'lecturer') {
        await setDoc(doc(db, 'lecturers', cleanUserId), {
          uid: user.uid,
          userId: cleanUserId,
          name: name.trim(),
          email: email.toLowerCase(),
          position: 'Lecturer',
          createdAt: Timestamp.now(),
        });
      }

      // Save user data to SecureStore
      await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
      await SecureStore.setItemAsync('user_id', user.uid);

      Alert.alert('Success', `Welcome ${name}! Your User ID is: ${cleanUserId}`);
      router.replace('/dashboard');
    } catch (error) {
      console.error('Registration error:', error);
      
      // Handle specific Firebase auth errors
      if (error.code === 'auth/weak-password') {
        Alert.alert('Weak Password', 'Password should be at least 6 characters.');
      } else if (error.code === 'auth/email-already-in-use') {
        Alert.alert('Email Already Used', 'This email is already registered. Please login or use a different email.');
      } else if (error.code === 'auth/invalid-email') {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
      } else {
        Alert.alert('Registration Failed', error.message);
      }
      
      // If user was created but Firestore failed, clean up auth user
      if (auth.currentUser) {
        try {
          await auth.currentUser.delete();
        } catch (deleteError) {
          console.warn('Could not delete auth user:', deleteError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoContainer}>
          <Image source={uptmLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>UPTM Digital Event</Text>
          <Text style={styles.subtitle}>Create your account</Text>
        </View>

        <View style={styles.formContainer}>
          {/* User ID */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{getUserIDLabel()}</Text>
            <TextInput
              style={styles.input}
              placeholder={getUserIDPlaceholder()}
              placeholderTextColor="#999"
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="characters"
              editable={!loading}
            />
            <Text style={styles.hint}>This will be your permanent User ID for login</Text>
          </View>

          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Full Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Norsuhaila binti Ismail"
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email Address *</Text>
            <TextInput
              style={styles.input}
              placeholder={
                role === 'student'
                  ? 'username@student.uptm.edu.my'
                  : 'username@uptm.edu.my'
              }
              placeholderTextColor="#999"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
            />
            <Text style={styles.hint}>
              {role === 'student'
                ? 'Must use official UPTM student email'
                : 'Must use official UPTM staff email'}
            </Text>
          </View>

          {/* Password with toggle and strength indicator */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password *</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[
                  styles.input, 
                  styles.passwordInput,
                  !isPasswordValid && password.length > 0 && styles.inputError
                ]}
                placeholder="Enter strong password"
                placeholderTextColor="#999"
                value={password}
                onChangeText={handlePasswordChange}
                secureTextEntry={!showPassword}
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
                disabled={loading}
              >
                <Icon
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={24}
                  color="#666"
                />
              </TouchableOpacity>
            </View>

            {/* Password strength indicator */}
            {password.length > 0 && (
              <View style={styles.passwordStrengthContainer}>
                <Text style={styles.passwordStrengthTitle}>Password must contain:</Text>
                
                <View style={styles.requirementRow}>
                  <Icon 
                    name={passwordErrors.length ? 'check-circle' : 'cancel'} 
                    size={16} 
                    color={passwordErrors.length ? '#4CAF50' : '#f44336'} 
                  />
                  <Text style={[styles.requirementText, passwordErrors.length && styles.requirementMet]}>
                    At least 8 characters
                  </Text>
                </View>

                <View style={styles.requirementRow}>
                  <Icon 
                    name={passwordErrors.uppercase ? 'check-circle' : 'cancel'} 
                    size={16} 
                    color={passwordErrors.uppercase ? '#4CAF50' : '#f44336'} 
                  />
                  <Text style={[styles.requirementText, passwordErrors.uppercase && styles.requirementMet]}>
                    At least one uppercase letter (A-Z)
                  </Text>
                </View>

                <View style={styles.requirementRow}>
                  <Icon 
                    name={passwordErrors.lowercase ? 'check-circle' : 'cancel'} 
                    size={16} 
                    color={passwordErrors.lowercase ? '#4CAF50' : '#f44336'} 
                  />
                  <Text style={[styles.requirementText, passwordErrors.lowercase && styles.requirementMet]}>
                    At least one lowercase letter (a-z)
                  </Text>
                </View>

                <View style={styles.requirementRow}>
                  <Icon 
                    name={passwordErrors.number ? 'check-circle' : 'cancel'} 
                    size={16} 
                    color={passwordErrors.number ? '#4CAF50' : '#f44336'} 
                  />
                  <Text style={[styles.requirementText, passwordErrors.number && styles.requirementMet]}>
                    At least one number (0-9)
                  </Text>
                </View>

                <View style={styles.requirementRow}>
                  <Icon 
                    name={passwordErrors.symbol ? 'check-circle' : 'cancel'} 
                    size={16} 
                    color={passwordErrors.symbol ? '#4CAF50' : '#f44336'} 
                  />
                  <Text style={[styles.requirementText, passwordErrors.symbol && styles.requirementMet]}>
                    At least one special character (!@#$%^&*)
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Role Picker */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Account Type *</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={role}
                onValueChange={handleRoleChange}
                enabled={!loading}
                style={styles.picker}
              >
                <Picker.Item label="🎓 Student" value="student" />
                <Picker.Item label="👨‍🏫 Lecturer" value="lecturer" />
                <Picker.Item label="⚙️ Administrator" value="admin" />
              </Picker>
            </View>
            <Text style={styles.hint}>
              Select the role that matches your position at UPTM
            </Text>
          </View>

          {/* Register Button */}
          <TouchableOpacity
            style={[
              styles.button, 
              loading && styles.buttonDisabled,
              !isPasswordValid && password.length > 0 && styles.buttonDisabled
            ]}
            onPress={handleRegister}
            disabled={loading || (password.length > 0 && !isPasswordValid)}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <Text style={styles.dividerText}>Already have an account?</Text>
          </View>

          {/* Login Link */}
          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => router.push('/login')}
            disabled={loading}
          >
            <Text style={styles.loginButtonText}>Login to Existing Account</Text>
          </TouchableOpacity>

          {/* Important Notes */}
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>ℹ️ Important Notes:</Text>
            <Text style={styles.noteItem}>• Your User ID is permanent and cannot be changed</Text>
            <Text style={styles.noteItem}>• Keep your User ID and password secure</Text>
            <Text style={styles.noteItem}>• Use your official UPTM email address</Text>
            <Text style={styles.noteItem}>• Password must be strong (8+ chars, uppercase, lowercase, numbers, symbols)</Text>
            <Text style={styles.noteItem}>• Contact admin if you need assistance</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>UPTM Event System v1.0</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2E3B55',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  formContainer: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#fafafa',
    color: '#333',
  },
  inputError: {
    borderColor: '#f44336',
    borderWidth: 2,
  },
  passwordContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeIcon: {
    position: 'absolute',
    right: 15,
    top: 13,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#fafafa',
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    color: '#333',
  },
  button: {
    backgroundColor: '#ff6b6b',
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 20,
    alignItems: 'center',
  },
  dividerText: {
    fontSize: 14,
    color: '#666',
  },
  loginButton: {
    borderWidth: 2,
    borderColor: '#ff6b6b',
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  loginButtonText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  notes: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  notesTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  noteItem: {
    fontSize: 12,
    color: '#495057',
    lineHeight: 20,
  },
  footer: {
    marginTop: 30,
    alignItems: 'center',
  },
  footerText: {
    color: '#999',
    fontSize: 12,
  },
  // New styles for password strength indicator
  passwordStrengthContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  passwordStrengthTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 5,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  requirementText: {
    fontSize: 11,
    color: '#868e96',
    marginLeft: 5,
  },
  requirementMet: {
    color: '#4CAF50',
    textDecorationLine: 'none',
  },
});