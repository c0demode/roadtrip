// firebase.js
// Initializes Firebase and exports the Firestore instance used across the app.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyACr4J3jK2_ecsxtUfMh9t3rCnX_zWv8Ck",
  authDomain: "trip-planner-ad952.firebaseapp.com",
  projectId: "trip-planner-ad952",
  storageBucket: "trip-planner-ad952.firebasestorage.app",
  messagingSenderId: "892454695472",
  appId: "1:892454695472:web:778991d873628c5be533f5",
};
// Note: dropped measurementId/analytics — not needed for this app.
// This config is safe to keep client-side; Firestore access is governed by
// security rules (see firestore.rules), not by keeping this object secret.

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
