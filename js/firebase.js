// js/firebase.js
// Firebase - 단일 Auth 인스턴스 + 세션 지속성(탭/창 닫으면 해제)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// TODO: 실제 값으로 교체
const firebaseConfig = {
  apiKey: "AIzaSyAFlG7wqAr--sQPup19ztOS5wZk4Kq_xpE",
  authDomain: "dashboard-7bb43.firebaseapp.com",
  projectId: "dashboard-7bb43",
  storageBucket: "dashboard-7bb43.firebasestorage.app",
  appId: "1:271394458680:web:9948d64b646bcefdfb6acd",
};

export const app = initializeApp(firebaseConfig);

// 중요: initializeAuth 로 **한 번만** 생성하고, 세션 지속성 지정
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });

export const db = getFirestore(app);
export const storage = getStorage(app);
