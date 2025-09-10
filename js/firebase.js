// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "", // 문제 시 'dashboard-7bb43.appspot.com'으로 변경
  appId: "",
};

export const app = initializeApp(firebaseConfig);

// 로그인 유지: **세션 단위** (탭/창 닫으면 해제)
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });

export const db = getFirestore(app);
export const storage = getStorage(app);
