// js/firebase-config.js

// CONFIGURACIÓN PARA CLOUD RUN CON FIREBASE AUTH
// 
// Como el sitio está alojado en Cloud Run (no Firebase Hosting),
// debemos usar authDomain de Firebase (.firebaseapp.com) porque
// Cloud Run no tiene los handlers OAuth de Firebase (/__/auth/handler)

export const firebaseConfig = {
  apiKey: "AIzaSyBieuI5VcIRskIYjInss9TlkggcIeaDRZI",
  authDomain: "geoipt-a8b68.firebaseapp.com", // ⬅️ DEBE ser .firebaseapp.com para Cloud Run
  projectId: "geoipt-a8b68",
  storageBucket: "geoipt-a8b68.firebasestorage.app",
  messagingSenderId: "1057527927342",
  appId: "1:1057527927342:web:32c0d0328c92b68997c5bf"
};

// CÓMO FUNCIONA:
// 1. Usuario en geoipt.cl hace clic en "Login con Google"
// 2. Se abre popup que va a geoipt-a8b68.firebaseapp.com (que SÍ tiene los handlers)
// 3. Google autentica y redirige al handler de Firebase
// 4. Firebase devuelve el token a tu app en geoipt.cl
// 5. Usuario queda autenticado en geoipt.cl
//
// REQUISITO: geoipt.cl debe estar en "Authorized domains" en Firebase Console ✓