// auth.js
// Google Sign-In wrapper. Replaces the roadtrip/planner123 passcode gate —
// who can view/edit is now enforced by Firestore security rules based on
// the signed-in user's email, not a shared string typed into a prompt box.

import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import { app } from "./firebase.js";

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export function signIn() {
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

/**
 * Subscribes to auth state. Calls onChange(user) with the Firebase user
 * object, or null when signed out.
 */
export function subscribeToAuth(onChange) {
  return onAuthStateChanged(auth, onChange);
}
