// CashJoy Firebase Config
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyKILFvcDwzG9Di6mhA_1hDaDFRJbvq2g",
  authDomain: "cashjoy-9c5ca.firebaseapp.com",
  projectId: "cashjoy-9c5ca",
  storageBucket: "cashjoy-9c5ca.firebasestorage.app",
  messagingSenderId: "633225791274",
  appId: "1:633225791274:web:6962b55ef2cb9baf02c053",
  measurementId: "G-DDC3FLR19G"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ---------- USER ----------
export function genReferralCode(uid){ return 'CJ' + uid.slice(0, 6).toUpperCase(); }

export async function createUserDoc(user, extra = {}){
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const data = {
    uid: user.uid,
    name: extra.name || user.displayName || 'New User',
    email: user.email,
    photoURL: user.photoURL || '',
    balance: 0, pending: 0, lifetime: 0,
    level: 1, tier: 'Bronze', streak: 0,
    referralCode: genReferralCode(user.uid),
    referredBy: extra.referredBy || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  await setDoc(doc(db, 'leaderboard', user.uid), {
    uid: user.uid, name: data.name, earned: 0, offers: 0,
    updatedAt: serverTimestamp(),
  });
  if (extra.referredBy) await creditReferral(extra.referredBy, user.uid, data.name);
  return data;
}

export async function getUser(uid){
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

export function subscribeUser(uid, cb){
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    cb(snap.exists() ? snap.data() : null);
  });
}

// ---------- BALANCE ----------
export async function creditBalance(uid, amount, type, meta = {}){
  if (!amount) return;
  await updateDoc(doc(db, 'users', uid), {
    balance: increment(amount),
    lifetime: amount > 0 ? increment(amount) : increment(0),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(collection(db, 'users', uid, 'transactions')), {
    type, amount, meta, createdAt: serverTimestamp(),
  });
  if (amount > 0){
    try {
      await updateDoc(doc(db, 'leaderboard', uid), {
        earned: increment(amount), updatedAt: serverTimestamp(),
      });
    } catch(e){}
  }
}

export function subscribeTransactions(uid, cb, max = 20){
  const q = query(
    collection(db, 'users', uid, 'transactions'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ---------- OFFERS ----------
export async function completeOffer(uid, offer){
  const ref = doc(db, 'users', uid, 'completedOffers', String(offer.id));
  const snap = await getDoc(ref);
  if (snap.exists()) return { ok: false, reason: 'already_completed' };
  await setDoc(ref, {
    offerId: offer.id, title: offer.title, reward: offer.reward,
    completedAt: serverTimestamp(),
  });
  await creditBalance(uid, offer.reward, 'offer', { offerId: offer.id, title: offer.title });
  return { ok: true, reward: offer.reward };
}

export function subscribeCompletedOffers(uid, cb){
  return onSnapshot(collection(db, 'users', uid, 'completedOffers'), (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ---------- SURVEYS ----------
export async function submitSurvey(uid, survey, answers){
  await setDoc(doc(collection(db, 'users', uid, 'surveyResponses')), {
    surveyId: survey.id, title: survey.title, answers,
    reward: survey.reward, submittedAt: serverTimestamp(),
  });
  await creditBalance(uid, survey.reward, 'survey', { surveyId: survey.id, title: survey.title });
  return { ok: true, reward: survey.reward };
}

export function subscribeSurveyResponses(uid, cb){
  return onSnapshot(collection(db, 'users', uid, 'surveyResponses'), (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ---------- REFERRALS ----------
export async function findUserByReferralCode(code){
  const q = query(collection(db, 'users'), where('referralCode', '==', code), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function creditReferral(referrerUid, newUserUid, newUserName){
  await setDoc(doc(db, 'users', referrerUid, 'referrals', newUserUid), {
    uid: newUserUid, name: newUserName, joinedAt: serverTimestamp(),
  });
  await creditBalance(referrerUid, 5, 'referral', {
    referredUser: newUserName, referredUid: newUserUid,
  });
}

export function subscribeReferrals(uid, cb){
  return onSnapshot(collection(db, 'users', uid, 'referrals'), (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ---------- LEADERBOARD ----------
export function subscribeLeaderboard(cb, top = 20){
  const q = query(collection(db, 'leaderboard'), orderBy('earned', 'desc'), limit(top));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d, i) => ({ rank: i + 1, id: d.id, ...d.data() })));
  });
}

// ---------- EXPORTS ----------
export {
  auth, db, provider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signOut, onAuthStateChanged,
  updateProfile, sendPasswordResetEmail
};
