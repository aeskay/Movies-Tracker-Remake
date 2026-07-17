import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDwBYOpY6YUQ25Kl31xn7DoJn7cz3J7cjo",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "movie-tracker-b7be2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "movie-tracker-b7be2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "movie-tracker-b7be2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "107801496324",
  appId: process.env.FIREBASE_APP_ID || "1:107801496324:web:0e00f5f7929c3a17b2de51"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
