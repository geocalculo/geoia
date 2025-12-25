// js/bbox-auth-guard.js
import { onAuthReady } from "./auth.js";

function setProEnabled(enabled) {
  // Cambia estos IDs según tus botones reales
  const btnKml = document.getElementById("btnDescargarKML");
  const msg = document.getElementById("proMsg");

  if (btnKml) btnKml.disabled = !enabled;

  if (msg) {
    msg.textContent = enabled
      ? "PRO habilitado ✅"
      : "🔒 Inicia sesión para descargar KML.";
  }
}

onAuthReady((user) => {
  setProEnabled(!!user);
});

// Si quieres que al click en botón bloqueado se abra login:
window.addEventListener("DOMContentLoaded", () => {
  const btnKml = document.getElementById("btnDescargarKML");
  if (!btnKml) return;

  btnKml.addEventListener("click", () => {
    if (btnKml.disabled) {
      // si existe el modal (misma página), lo abre:
      if (window.GeoIPT_openLogin) window.GeoIPT_openLogin();
      // si no, redirige:
      else window.location.href = "./login.html";
    }
  });
});
