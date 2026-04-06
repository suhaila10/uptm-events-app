// src/firebase.js (Mobile version)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Same config as your web app
const firebaseConfig = {
  apiKey: "AIzaSyBlWoHvzvZTKktBxaeCBOEn8b04bGPxSxQ",
  authDomain: "uptm-digital-event-535bb.firebaseapp.com",
  projectId: "uptm-digital-event-535bb",
  storageBucket: "uptm-digital-event-535bb.firebasestorage.app",
  messagingSenderId: "580334388654",
  appId: "1:580334388654:web:a067571894eb566140743f",
  measurementId: "G-GJ1X4WYPLL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with AsyncStorage persistence
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
