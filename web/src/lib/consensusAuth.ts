/*
 * Consensus sign-in = Straitly sign-in (same Firebase project, straitly-5a121). Owned by the backend; the UI imports:
 *   signInWithGoogle(), signInWithGithub(), signInWithEmail(email, pw), signUpWithEmail(email, pw, name?),
 *   resetPassword(email), signOut()
 *   onAuth(cb)  -> cb(user | null) whenever the session changes (cookie is kept in sync automatically)
 *   fetchMe()   -> { user, free_searches_left }
 *   authErrorMessage(err) -> short human message for a Firebase error
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";

// Public web config (not secret), same values as the Straitly console.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAixuh8EeFeskqGy8X3lEgrWgyiZj-xZos", // gitleaks:allow (Firebase web keys are public; access is enforced by Firebase Auth rules)
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "straitly-5a121.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "straitly-5a121",
  storageBucket: "straitly-5a121.firebasestorage.app",
  messagingSenderId: "724422518185",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:724422518185:web:180cee3ae8ebf509c150b8",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
const google = new GoogleAuthProvider();
google.setCustomParameters({ prompt: "select_account" });
// Straitly offers GitHub too; accounts created that way must be able to sign in here.
const github = new GithubAuthProvider();

export interface ConsensusUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface Me {
  user: ConsensusUser | null;
  /** null when signed in (no limit), else 0 or 1. */
  free_searches_left: number | null;
  free_search_id: string | null;
}

const toUser = (u: User): ConsensusUser => ({ uid: u.uid, email: u.email, name: u.displayName, picture: u.photoURL });

async function syncSession(u: User | null) {
  if (u) {
    const idToken = await u.getIdToken();
    const r = await fetch("/api/v3/session", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ idToken }) });
    if (!r.ok) throw new Error("session_failed");
  } else {
    await fetch("/api/v3/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
  }
}

let ready: Promise<void> | null = null;
const listeners = new Set<(u: ConsensusUser | null) => void>();
let current: ConsensusUser | null | undefined;

/** Keeps the httpOnly cookie in step with Firebase (sign-in, sign-out and the hourly token refresh). */
function start() {
  if (ready) return ready;
  ready = new Promise<void>((resolve) => {
    onIdTokenChanged(auth, async (u) => {
      try {
        await syncSession(u);
      } catch {
        /* the next refresh retries */
      }
      current = u ? toUser(u) : null;
      listeners.forEach((l) => l(current!));
      resolve();
    });
  });
  return ready;
}

export function onAuth(cb: (u: ConsensusUser | null) => void): () => void {
  listeners.add(cb);
  void start();
  if (current !== undefined) cb(current);
  return () => listeners.delete(cb);
}

/** Resolves once the session cookie matches the signed-in user (call before retrying a gated search). */
export const authReady = () => start();

async function finish(u: User): Promise<ConsensusUser> {
  await syncSession(u);
  current = toUser(u);
  listeners.forEach((l) => l(current!));
  return current;
}

export async function signInWithGoogle(): Promise<ConsensusUser> {
  const r = await signInWithPopup(auth, google);
  return finish(r.user);
}

export async function signInWithGithub(): Promise<ConsensusUser> {
  const r = await signInWithPopup(auth, github);
  return finish(r.user);
}

export async function signInWithEmail(email: string, password: string): Promise<ConsensusUser> {
  const r = await signInWithEmailAndPassword(auth, email.trim(), password);
  return finish(r.user);
}

export async function signUpWithEmail(email: string, password: string, name?: string): Promise<ConsensusUser> {
  const r = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name?.trim()) await updateProfile(r.user, { displayName: name.trim() }).catch(() => {});
  void sendEmailVerification(r.user).catch(() => {});
  return finish(r.user);
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());

export async function signOut() {
  await fbSignOut(auth);
  await syncSession(null);
  current = null;
  listeners.forEach((l) => l(null));
}

export async function fetchMe(): Promise<Me> {
  const r = await fetch("/api/v3/me", { credentials: "same-origin" });
  if (!r.ok) return { user: null, free_searches_left: 1, free_search_id: null };
  return r.json();
}

export interface HistoryEntry {
  id: string;
  query: string;
  since: string | null;
  until: string | null;
  sources: ("reddit" | "x")[];
  at: string;
}

/** Signed-in user's recent searches, newest first. Open one with GET /api/v3/search?id=<id>. Empty when signed out. */
export async function fetchHistory(): Promise<HistoryEntry[]> {
  const r = await fetch("/api/v3/history", { credentials: "same-origin" });
  if (!r.ok) return [];
  return ((await r.json()) as { searches: HistoryEntry[] }).searches;
}

/** Remove one search from history, or everything when id is omitted. */
export async function deleteHistory(id?: string): Promise<void> {
  await fetch(`/api/v3/history${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE", credentials: "same-origin" });
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email. Sign up instead.",
    "auth/email-already-in-use": "That email already has an account (maybe from Straitly). Sign in instead.",
    "auth/weak-password": "Use at least 6 characters.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
    "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/unauthorized-domain": "Sign-in isn't enabled for this domain yet.",
    "auth/account-exists-with-different-credential": "This email already signs in another way (Google, GitHub or password). Use that.",
    "auth/cancelled-popup-request": "Sign-in window was closed.",
    "auth/missing-password": "Enter your password.",
  };
  return map[code] ?? "Couldn't sign you in. Please try again.";
}
