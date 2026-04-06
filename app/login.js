import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import Captcha from '../components/Captcha'; // adjust path
import { auth, db } from '../src/screens/firebase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const validateForm = () => {
    let isValid = true;
    setEmailError('');
    setPasswordError('');

    if (!email) {
      setEmailError('Email is required');
      isValid = false;
    } else if (!email.includes('@') || !email.includes('.')) {
      setEmailError('Please enter a valid email address');
      isValid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      isValid = false;
    }

    return isValid;
  };

  const getErrorMessage = (error) => {
    console.log('Firebase error code:', error.code);
    console.log('Firebase error message:', error.message);

    switch (error.code) {
      // Email/Password specific errors
      case 'auth/invalid-email':
        return {
          field: 'email',
          message: 'Invalid email address format.'
        };
      case 'auth/user-disabled':
        return {
          field: 'email',
          message: 'This account has been disabled. Please contact support.'
        };
      case 'auth/user-not-found':
        return {
          field: 'email',
          message: 'No account found with this email address.'
        };
      case 'auth/wrong-password':
        return {
          field: 'password',
          message: 'Incorrect password. Please try again.'
        };
      case 'auth/invalid-credential':
        return {
          field: 'general',
          message: 'Invalid email or password. Please check your credentials.'
        };
      case 'auth/too-many-requests':
        return {
          field: 'general',
          message: 'Too many failed login attempts. Please try again later or reset your password.'
        };
      case 'auth/network-request-failed':
        return {
          field: 'general',
          message: 'Network error. Please check your internet connection.'
        };
      default:
        return {
          field: 'general',
          message: 'Login failed. Please try again.'
        };
    }
  };

  const handleLogin = async () => {
    // Clear previous errors
    setEmailError('');
    setPasswordError('');

    // Validate form
    if (!captchaVerified) {
  Alert.alert('Verification Required', 'Please complete the CAPTCHA');
  return;
}

    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Get user data from Firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (userDoc.exists()) {
        const userData = { id: userDoc.id, ...userDoc.data() };

        // Save to SecureStore
        await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
        await SecureStore.setItemAsync('user_id', user.uid);

        console.log('✅ Login successful for user:', user.email);
        
        // Show success message with user's name if available
        const welcomeName = userData.name || user.email?.split('@')[0] || 'User';
        Alert.alert(
          'Welcome Back!', 
          `Successfully signed in as ${welcomeName}`,
          [{ text: 'Continue', onPress: () => router.replace('/dashboard') }]
        );
      } else {
        // User exists in Auth but not in Firestore
        console.error('User document not found in Firestore');
        Alert.alert(
          'Account Error',
          'Your account exists but profile data is missing. Please contact support.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Login error details:', error);
      
      // Get user-friendly error message
      const errorInfo = getErrorMessage(error);
      
      // Set field-specific error
      if (errorInfo.field === 'email') {
        setEmailError(errorInfo.message);
      } else if (errorInfo.field === 'password') {
        setPasswordError(errorInfo.message);
      } else {
        // Show general error alert
        Alert.alert(
          'Login Failed',
          errorInfo.message,
          [
            { 
              text: 'Try Again', 
              style: 'cancel' 
            },
            { 
              text: 'Reset Password', 
              onPress: () => handleForgotPassword() 
            }
          ]
        );
      }

      // Additional logging for debugging
      if (error.code === 'auth/wrong-password') {
        console.log('⚠️ Wrong password attempt for email:', email);
      } else if (error.code === 'auth/user-not-found') {
        console.log('⚠️ Login attempt for non-existent email:', email);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (!email) {
      Alert.alert(
        'Email Required',
        'Please enter your email address in the email field to reset your password.'
      );
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    sendPasswordResetEmail(auth, email)
      .then(() => {
        Alert.alert(
          'Password Reset Email Sent',
          `Check your inbox at ${email} for instructions to reset your password.`
        );
      })
      .catch((error) => {
        console.error('Password reset error:', error);
        let message = 'Failed to send reset email. Please try again.';
        if (error.code === 'auth/user-not-found') {
          setEmailError('No account found with this email address.');
        } else if (error.code === 'auth/invalid-email') {
          setEmailError('Invalid email address.');
        } else {
          Alert.alert('Error', message);
        }
      })
      .finally(() => setLoading(false));
  };

  const handleQuickLogin = () => {
    setEmail('admin@uptm.edu.my');
    setPassword('admin123');
    setEmailError('');
    setPasswordError('');
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
        <Animated.View
          style={[
            styles.logoContainer,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
          ]}
        >
          <Image
            source={require('../assets/images/uptm.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>UPTM Digital Event</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.formContainer,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
          ]}
        >
          {/* Email Input */}
          <View style={styles.inputContainer}>
            <View style={[
              styles.inputWrapper,
              emailFocused && styles.inputWrapperFocused,
              emailError && styles.inputWrapperError
            ]}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="your.email@uptm.edu.my"
                placeholderTextColor="#aaa"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (emailError) setEmailError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                editable={!loading}
              />
            </View>
            {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
          </View>

          {/* Password Input with show/hide */}
          <View style={styles.inputContainer}>
            <View style={[
              styles.inputWrapper,
              passwordFocused && styles.inputWrapperFocused,
              passwordError && styles.inputWrapperError
            ]}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="••••••••"
                  placeholderTextColor="#aaa"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (passwordError) setPasswordError('');
                  }}
                  secureTextEntry={!showPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  editable={!loading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  disabled={loading}
                >
                  <Text style={styles.eyeButtonText}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          {/* Forgot password */}
          <TouchableOpacity
            style={styles.forgotButton}
            onPress={handleForgotPassword}
            disabled={loading}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <Captcha onVerify={setCaptchaVerified} />

          {/* Sign In Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Quick Login */}
          <TouchableOpacity
            style={styles.quickLogin}
            onPress={handleQuickLogin}
            disabled={loading}
          >
            <Text style={styles.quickLoginText}>
               Use demo: student2@uptm.edu.my / Suhailastudent1!
            </Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Register Link */}
          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => router.push('/register')}
            disabled={loading}
          >
            <Text style={styles.registerButtonText}>Create New Account</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.Text style={[styles.footerText, { opacity: fadeAnim }]}>
          UPTM Event System v1.0
        </Animated.Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2E3B55',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  inputContainer: {
    marginBottom: 15,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#fafafa',
  },
  inputWrapperFocused: {
    borderColor: '#2E3B55',
    borderWidth: 2,
    backgroundColor: 'white',
  },
  inputWrapperError: {
    borderColor: '#dc3545',
    borderWidth: 2,
    backgroundColor: '#fff8f8',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  input: {
    fontSize: 16,
    color: '#333',
    paddingVertical: 8,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eyeButtonText: {
    color: '#2E3B55',
    fontWeight: '600',
    fontSize: 14,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 5,
    fontWeight: '500',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
    marginTop: 5,
  },
  forgotText: {
    color: '#2E3B55',
    fontSize: 14,
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#2E3B55',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#2E3B55',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  buttonDisabled: {
    backgroundColor: '#a0a0a0',
    shadowOpacity: 0.1,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  quickLogin: {
    padding: 12,
    backgroundColor: '#e8f0fe',
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 20,
  },
  quickLoginText: {
    color: '#2E3B55',
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#999',
    fontSize: 14,
  },
  registerButton: {
    borderWidth: 2,
    borderColor: '#2E3B55',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  registerButtonText: {
    color: '#2E3B55',
    fontSize: 16,
    fontWeight: '600',
  },
  footerText: {
    marginTop: 30,
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
  },
});