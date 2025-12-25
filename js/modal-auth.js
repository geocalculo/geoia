// js/modal-auth.js
import { 
  loginUser, 
  registerUser, 
  onUserChanged, 
  logoutUser,
  resendVerificationEmail,
  reloadUser,
  isEmailVerified,
  loginWithGoogle
} from './auth.js';

const modal = document.getElementById('auth-modal');
const btnLogin = document.getElementById('btn-login');
const btnCerrar = document.getElementById('close-modal');

const tabs = document.querySelectorAll('.auth-tab');
const loginForm = document.getElementById('login-form');
const registroForm = document.getElementById('registro-form');

const loginMessage = document.getElementById('login-message');
const registroMessage = document.getElementById('registro-message');

let isLoggingOut = false;

// ========================================
// ABRIR/CERRAR MODAL
// ========================================

function abrirModal() {
  modal.classList.remove('hidden');
}

function cerrarModal() {
  modal.classList.add('hidden');
  limpiarFormularios();
}

btnLogin?.addEventListener('click', (e) => {
  e.preventDefault();
  const currentHandler = btnLogin.onclick;
  if (currentHandler === abrirModal) {
    abrirModal();
  }
});

btnCerrar?.addEventListener('click', cerrarModal);

modal?.addEventListener('click', (e) => {
  if (e.target === modal) cerrarModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
    cerrarModal();
  }
});

// ========================================
// ALTERNAR ENTRE TABS
// ========================================

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    if (tabName === 'login') {
      loginForm.classList.remove('hidden');
      registroForm.classList.add('hidden');
    } else {
      loginForm.classList.add('hidden');
      registroForm.classList.remove('hidden');
    }
    
    limpiarMensajes();
  });
});

// ========================================
// LOGIN
// ========================================

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const submitBtn = loginForm.querySelector('.auth-submit');
  
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ingresando...';
    loginMessage.textContent = '';
    
    const userCredential = await loginUser(email, password);
    const user = userCredential.user;
    
    // Verificar si el email está verificado (solo para cuentas de email/password)
    if (user.providerData[0]?.providerId === 'password' && !user.emailVerified) {
      loginMessage.innerHTML = `
        ⚠️ Debes verificar tu correo antes de continuar.<br>
        <a href="#" id="resend-verification" style="color: #2563eb; text-decoration: underline;">
          Reenviar email de verificación
        </a>
      `;
      loginMessage.className = 'auth-message error';
      
      document.getElementById('resend-verification')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await resendVerificationEmail();
          loginMessage.textContent = '✓ Email de verificación reenviado. Revisa tu bandeja de entrada.';
          loginMessage.className = 'auth-message success';
        } catch (error) {
          loginMessage.textContent = 'Error al reenviar email. Intenta más tarde.';
          loginMessage.className = 'auth-message error';
        }
      });
      
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ingresar';
      return;
    }
    
    // Login exitoso
    loginMessage.textContent = '✓ Sesión iniciada';
    loginMessage.className = 'auth-message success';
    
    setTimeout(() => {
      cerrarModal();
    }, 1000);
    
  } catch (error) {
    console.error('Error en login:', error);
    loginMessage.textContent = getErrorMessage(error.code);
    loginMessage.className = 'auth-message error';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ingresar';
  }
});

// ========================================
// LOGIN CON GOOGLE
// ========================================

const googleBtn = document.getElementById('google-login-btn');

googleBtn?.addEventListener('click', async () => {
  try {
    googleBtn.disabled = true;
    googleBtn.textContent = 'Conectando con Google...';
    loginMessage.textContent = '';
    
    const { user } = await loginWithGoogle();
    
    console.log('✅ Usuario autenticado con Google:', user.email);
    
    loginMessage.textContent = '✓ Sesión iniciada con Google';
    loginMessage.className = 'auth-message success';
    
    setTimeout(() => {
      cerrarModal();
    }, 1000);
    
  } catch (error) {
    console.error('Error en login con Google:', error);
    
    if (error.code === 'auth/popup-closed-by-user') {
      loginMessage.textContent = 'Ventana cerrada. Intenta nuevamente.';
    } else if (error.code === 'auth/popup-blocked') {
      loginMessage.textContent = 'Popup bloqueado. Permite popups para este sitio.';
    } else if (error.code === 'auth/cancelled-popup-request') {
      loginMessage.textContent = 'Solicitud cancelada.';
    } else {
      loginMessage.textContent = 'Error al iniciar sesión con Google';
    }
    
    loginMessage.className = 'auth-message error';
  } finally {
    googleBtn.disabled = false;
    googleBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
        <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.184l-2.909-2.258c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9.003 18z" fill="#34A853"/>
        <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
        <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.039-3.71z" fill="#EA4335"/>
      </svg>
      Continuar con Google
    `;
  }
});

// ========================================
// REGISTRO
// ========================================

registroForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('registro-email').value;
  const password = document.getElementById('registro-password').value;
  const passwordConfirm = document.getElementById('registro-password-confirm').value;
  const submitBtn = registroForm.querySelector('.auth-submit');
  
  if (password !== passwordConfirm) {
    registroMessage.textContent = 'Las contraseñas no coinciden';
    registroMessage.className = 'auth-message error';
    return;
  }
  
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registrando...';
    registroMessage.textContent = '';
    
    await registerUser(email, password);
    
    registroMessage.innerHTML = `
      ✓ Cuenta creada. <strong>Revisa tu correo (${email})</strong> 
      y verifica tu cuenta para poder iniciar sesión.
    `;
    registroMessage.className = 'auth-message success';
    
    setTimeout(() => {
      tabs[0].click();
      loginMessage.textContent = 'Verifica tu correo para iniciar sesión';
      loginMessage.className = 'auth-message';
    }, 3000);
    
  } catch (error) {
    console.error('Error en registro:', error);
    
    if (error.message === 'VERIFICATION_EMAIL_FAILED') {
      registroMessage.textContent = 'Cuenta creada pero no se pudo enviar el email de verificación. Intenta iniciar sesión.';
    } else {
      registroMessage.textContent = getErrorMessage(error.code);
    }
    
    registroMessage.className = 'auth-message error';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Registrarse';
  }
});

// ========================================
// ESTADO DE AUTENTICACIÓN
// ========================================

onUserChanged((user) => {
  if (user) {
    const emailCorto = user.email.split('@')[0];
    const verificado = user.emailVerified ? '✓' : '⚠️';
    btnLogin.textContent = `${verificado} ${emailCorto} | Salir`;
    btnLogin.classList.add('logged-in');
    
    if (!user.emailVerified) {
      btnLogin.style.background = '#f59e0b';
      btnLogin.title = 'Email no verificado. Algunas funciones pueden estar limitadas.';
    } else {
      btnLogin.style.background = '#16a34a';
      btnLogin.title = 'Email verificado';
    }
    
    btnLogin.onclick = async (e) => {
      e.preventDefault();
      if (confirm('¿Cerrar sesión?')) {
        isLoggingOut = true;
        await logoutUser();
      }
    };
  } else {
    btnLogin.textContent = 'Iniciar sesión';
    btnLogin.classList.remove('logged-in');
    btnLogin.style.background = '#3b82f6';
    btnLogin.title = '';
    
    if (!isLoggingOut) {
      btnLogin.onclick = abrirModal;
    } else {
      setTimeout(() => {
        isLoggingOut = false;
        btnLogin.onclick = abrirModal;
      }, 100);
    }
    
    cerrarModal();
  }
});

// ========================================
// UTILIDADES
// ========================================

function limpiarFormularios() {
  loginForm?.reset();
  registroForm?.reset();
  limpiarMensajes();
}

function limpiarMensajes() {
  if (loginMessage) {
    loginMessage.textContent = '';
    loginMessage.className = 'auth-message';
  }
  if (registroMessage) {
    registroMessage.textContent = '';
    registroMessage.className = 'auth-message';
  }
}

function getErrorMessage(code) {
  const errores = {
    // Errores de login - mensaje genérico
    'auth/user-not-found': 'Usuario y/o contraseña incorrecta',
    'auth/wrong-password': 'Usuario y/o contraseña incorrecta',
    'auth/invalid-credential': 'Usuario y/o contraseña incorrecta',
    'auth/invalid-email': 'Usuario y/o contraseña incorrecta',
    
    // Errores de registro
    'auth/email-already-in-use': 'Este correo ya está registrado',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    
    // Errores generales
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde',
    'auth/network-request-failed': 'Error de conexión. Verifica tu internet',
    
    // Errores de Google
    'auth/popup-closed-by-user': 'Ventana cerrada. Intenta nuevamente',
    'auth/popup-blocked': 'Popup bloqueado. Permite popups para este sitio',
    'auth/cancelled-popup-request': 'Solicitud cancelada'
  };
  
  return errores[code] || 'Error de autenticación';
}