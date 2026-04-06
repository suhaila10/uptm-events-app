import { router, Stack } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { auth } from '../src/screens/firebase';

export default function RootLayout() {
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setInitialRoute('/(tabs)/dashboard');
      } else {
        setInitialRoute('/login');
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Navigate only after loading is done and layout is ready
  useEffect(() => {
    if (!loading && initialRoute) {
      // Small delay ensures the navigation system is fully ready
      setTimeout(() => {
        router.replace(initialRoute);
      }, 100);
    }
  }, [loading, initialRoute]);

  // Show loading screen while checking auth
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2E3B55' }}>
        <ActivityIndicator size="large" color="white" />
        <Text style={{ color: 'white', marginTop: 10 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#2E3B55' },
        headerTintColor: 'white',
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event-detail" options={{ headerShown: false }} />
      <Stack.Screen name="dashboard" options={{ headerShown: false }} />
      <Stack.Screen name="my-requests" options={{ headerShown: false }} />
      <Stack.Screen name="my-events" options={{ headerShown: false }} />
      <Stack.Screen name="request-event" options={{ headerShown: false }} />
      <Stack.Screen name="qr-scanner" options={{ headerShown: false }} />
      <Stack.Screen name="certificate" options={{ title: 'Certificate' }} />
      <Stack.Screen name="attendance/[eventId]" options={{ headerShown: false }}/>
      <Stack.Screen name="(tabs)/events" options={{ headerShown: false }} />
    </Stack>
  );
}