// js/auth.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistencia local
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Error al configurar persistencia:", error);
});

// ========================================
// REGISTRO CON VERIFICACIÓN DE EMAIL
// ========================================
export async function registerUser(email, pass) {
  const e = (email || "").trim();
  
  // Crear usuario
  const userCredential = await createUserWithEmailAndPassword(auth, e, pass);
  const user = userCredential.user;
  
  // Enviar email de verificación
  try {
    await sendEmailVerification(user, {
      url: window.location.origin + '/index.html', // URL de retorno después de verificar
      handleCodeInApp: false
    });
    console.log("✅ Email de verificación enviado a:", email);
  } catch (error) {
    console.error("⚠️ Error al enviar email de verificación:", error);
    throw new Error("VERIFICATION_EMAIL_FAILED");
  }
  
  return userCredential;
}

// ========================================
// LOGIN
// ========================================
export async function loginUser(email, pass) {
  const e = (email || "").trim();
  return await signInWithEmailAndPassword(auth, e, pass);
}

// ========================================
// LOGOUT
// ========================================
export async function logoutUser() {
  return await signOut(auth);
}

// ========================================
// OBSERVADOR DE CAMBIOS DE AUTENTICACIÓN
// ========================================
export function onUserChanged(cb) {
  return onAuthStateChanged(auth, cb);
}

// ========================================
// OBTENER TOKEN
// ========================================
export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken(false);
}

// ========================================
// REENVIAR EMAIL DE VERIFICACIÓN
// ========================================
export async function resendVerificationEmail() {
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error("No hay usuario autenticado");
  }
  
  if (user.emailVerified) {
    throw new Error("El correo ya está verificado");
  }
  
  await sendEmailVerification(user, {
    url: window.location.origin + '/index.html',
    handleCodeInApp: false
  });
  
  return true;
}

// ========================================
// RECUPERAR CONTRASEÑA
// ========================================
export async function resetPassword(email) {
  const e = (email || "").trim();
  
  await sendPasswordResetEmail(auth, e, {
    url: window.location.origin + '/index.html',
    handleCodeInApp: false
  });
  
  return true;
}

// ========================================
// VERIFICAR SI EMAIL ESTÁ VERIFICADO
// ========================================
export function isEmailVerified() {
  const user = auth.currentUser;
  return user ? user.emailVerified : false;
}

// ========================================
// RECARGAR DATOS DEL USUARIO
// ========================================
export async function reloadUser() {
  const user = auth.currentUser;
  if (user) {
    await user.reload();
    return user;
  }
  return null;
}

// ========================================
// LOGIN CON GOOGLE
// ========================================
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  
  // Opcional: solicitar acceso a información adicional
  provider.addScope('profile');
  provider.addScope('email');
  
  // Forzar selección de cuenta cada vez
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  
  // Abrir popup de Google
  const result = await signInWithPopup(auth, provider);
  
  // Usuario autenticado
  const user = result.user;
  
  // Obtener el token de Google si lo necesitas
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;
  
  return { user, token };
}