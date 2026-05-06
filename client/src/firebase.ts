import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBi6sOCU2DneeN2_gB4r1QMbyJ43inBCeo",
  authDomain: "chat-001a1.firebaseapp.com",
  projectId: "chat-001a1",
  storageBucket: "chat-001a1.firebasestorage.app",
  messagingSenderId: "746096149912",
  appId: "1:746096149912:web:1c5a3ae4d3db80ce2757ed",
  measurementId: "G-GGBZN2328J"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
