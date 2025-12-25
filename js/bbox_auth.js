// js/bbox_auth.js
// Protege el enlace de descarga KML en bbox_test.html

import { auth, onUserChanged } from './auth.js';

let currentUser = null;

// Escuchar cambios de autenticación
onUserChanged((user) => {
  currentUser = user;
  protegerEnlaceDescarga();
});

function protegerEnlaceDescarga() {
  // Buscar el enlace de descarga KML
  const linkDescarga = document.querySelector('a[href*="kml"], a[download*="kml"]');
  
  // También buscar por texto
  const todosLinks = document.querySelectorAll('a');
  let linkKml = null;
  
  todosLinks.forEach(link => {
    const texto = link.textContent.toLowerCase();
    if (texto.includes('descargar') && texto.includes('kml')) {
      linkKml = link;
    }
  });

  if (!linkKml) return;

  if (!currentUser) {
    // Usuario NO autenticado - ocultar/deshabilitar enlace
    linkKml.style.display = 'none';
    
    // Crear mensaje de reemplazo
    const parentLi = linkKml.closest('li');
    if (parentLi && !parentLi.querySelector('.auth-required-msg')) {
      const mensaje = document.createElement('span');
      mensaje.className = 'auth-required-msg';
      mensaje.style.cssText = `
        color: #9ca3af;
        font-size: 0.85rem;
        font-style: italic;
      `;
      mensaje.innerHTML = '🔒 Descargar KML <em>(requiere login)</em>';
      
      // Insertar después del enlace oculto
      linkKml.insertAdjacentElement('afterend', mensaje);
    }
    
  } else {
    // Usuario autenticado - mostrar enlace
    linkKml.style.display = '';
    
    // Remover mensaje de reemplazo
    const parentLi = linkKml.closest('li');
    if (parentLi) {
      const mensaje = parentLi.querySelector('.auth-required-msg');
      if (mensaje) {
        mensaje.remove();
      }
    }
  }
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', protegerEnlaceDescarga);
} else {
  protegerEnlaceDescarga();
}