// js/ui-auth.js
import { register, login, logout, onAuthReady } from "./auth.js";

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function setStatus(msg, ok = true) {
  const s = $("authStatus");
  if (!s) return;
  s.textContent = msg;
  s.style.color = ok ? "#0a7a2f" : "#b00020";
}

function updateHeader(user) {
  const btn = $("btnAuth");
  const label = $("authLabel");
  if (!btn) return;

  if (user) {
    btn.textContent = "Cerrar sesión";
    btn.dataset.mode = "logout";
    if (label) label.textContent = user.email;
  } else {
    btn.textContent = "Iniciar sesión";
    btn.dataset.mode = "login";
    if (label) label.textContent = "";
  }
}

function openModal(mode = "login") {
  const m = $("authModal");
  if (!m) return;

  show(m);
  $("authTabLogin").classList.toggle("active", mode === "login");
  $("authTabRegister").classList.toggle("active", mode === "register");
  $("panelLogin").style.display = mode === "login" ? "block" : "none";
  $("panelRegister").style.display = mode === "register" ? "block" : "none";
  setStatus("");
}

function closeModal() {
  const m = $("authModal");
  if (!m) return;
  hide(m);
  setStatus("");
}

// Exponer para que otras páginas (bbox_test) puedan abrirlo si lo comparten
window.GeoIPT_openLogin = () => openModal("login");
window.GeoIPT_openRegister = () => openModal("register");

// Bind UI
window.addEventListener("DOMContentLoaded", () => {
  const btnAuth = $("btnAuth");
  const btnClose = $("authClose");
  const overlay = $("authOverlay");

  if (btnAuth) {
    btnAuth.addEventListener("click", async () => {
      const mode = btnAuth.dataset.mode;
      if (mode === "logout") {
        await logout();
        setStatus("Sesión cerrada.", true);
        return;
      }
      openModal("login");
    });
  }

  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (overlay) overlay.addEventListener("click", closeModal);

  $("authTabLogin")?.addEventListener("click", () => openModal("login"));
  $("authTabRegister")?.addEventListener("click", () => openModal("register"));

  $("doLogin")?.addEventListener("click", async () => {
    try {
      const email = $("loginEmail").value.trim();
      const pass = $("loginPass").value;
      await login(email, pass);
      setStatus("Sesión iniciada ✅", true);
      closeModal();
    } catch (e) {
      setStatus(e?.message || String(e), false);
    }
  });

  $("doRegister")?.addEventListener("click", async () => {
    try {
      const email = $("regEmail").value.trim();
      const pass = $("regPass").value;
      await register(email, pass);
      setStatus("Cuenta creada ✅", true);
      closeModal();
    } catch (e) {
      setStatus(e?.message || String(e), false);
    }
  });

  // Mantener header sincronizado
  onAuthReady((user) => updateHeader(user));
});
