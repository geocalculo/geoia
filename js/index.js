const regionSelect = document.getElementById("region-select");
const instrumentoSelect = document.getElementById("instrumento-select");

const prcSearchInput = document.getElementById("prc-search");
const prcSearchResults = document.getElementById("prc-search-results");

let regionesData = [];
let map;
let marcadorPunto = null;
let indiceBuscador = [];
let resultadosBusquedaActual = [];
let searchActiveIndex = -1;
let shouldPreserveIncomingViewport = false;
let hasUserInteractedWithMap = false;
let initialViewportResolutionPromise = null;
let hasShownMapHintFade = false;
let mapHintFadeIsHidden = false;
let mapHintFadeShowTimeoutId = null;
let mapHintFadeHideTimeoutId = null;
let mapHintFadeReadyFallbackTimeoutId = null;

const HOME_VIEW = {
  center: [-27.5, -70.25],
  zoom: 15
};
const VIEWPORT_STORAGE_KEY = "ms:lastViewport:geoipt";
const VIEWPORT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VIEWPORT_SAVE_DEBOUNCE_MS = 500;

// Carga por fases
let uiDataLoaded = false;
let uiDataPromise = null;
let spatialDataLoaded = false;
let spatialDataPromise = null;

// Overview
let overviewMap = null;
let overviewRect = null;

window.dataLayer = window.dataLayer || [];

/* -------------------------
   TRACKING
------------------------- */
function cleanTrackingValue(value) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function getSelectedRegionData() {
  const code = cleanTrackingValue(regionSelect?.value || "");
  const reg = code ? obtenerRegionPorCodigo(code) : null;

  return {
    region_code: code,
    region_name: cleanTrackingValue(reg?.nombre || "")
  };
}

function getSelectedInstrumentData() {
  const selectedOption =
    instrumentoSelect && instrumentoSelect.selectedIndex >= 0
      ? instrumentoSelect.options[instrumentoSelect.selectedIndex]
      : null;

  return {
    instrumento_selected: cleanTrackingValue(selectedOption?.textContent || ""),
    instrumento_file: cleanTrackingValue(instrumentoSelect?.value || "")
  };
}

function trackGeoiptMapClick(payload = {}) {
  window.dataLayer = window.dataLayer || [];

  const eventPayload = {
    event: "geoipt_click_mapa",
    site: "geoipt",
    page: "index",
    trigger: "map_click",
    ...getSelectedRegionData(),
    ...getSelectedInstrumentData(),
    ...payload
  };

  Object.keys(eventPayload).forEach((key) => {
    if (eventPayload[key] === undefined) {
      delete eventPayload[key];
    }
  });

  window.dataLayer.push(eventPayload);
}

/* -------------------------
   UTILIDADES
------------------------- */
function parseBboxFromQuery(value) {
  if (!value) return null;

  const parts = String(value)
    .split(",")
    .map((v) => Number(v.trim()));

  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }

  const [north, east, south, west] = parts;

  const latOk = Math.abs(north) <= 90 && Math.abs(south) <= 90;
  const lonOk = Math.abs(east) <= 180 && Math.abs(west) <= 180;
  const orderOk = north >= south && east >= west;

  if (!latOk || !lonOk || !orderOk) {
    return null;
  }

  return [
    [south, west],
    [north, east]
  ];
}

function getIncomingViewportFromUrl() {
  // URLSearchParams permite leer "bbox" sin importar el orden de los parámetros
  // (por ejemplo: ?utm_source=...&utm_medium=...&bbox=...)
  const params = new URLSearchParams(window.location.search);
  const bbox = parseBboxFromQuery(params.get("bbox"));
  const parseQueryNumber = (name) => {
    const rawValue = params.get(name);
    if (rawValue === null) return null;

    const trimmedValue = String(rawValue).trim();
    if (!trimmedValue) return null;

    const parsedValue = Number(trimmedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  };

  const lat = parseQueryNumber("lat");
  const lon = parseQueryNumber("lon");
  const zoom = parseQueryNumber("zoom");

  return {
    bbox,
    lat,
    lon,
    zoom
  };
}

function hasValidLatLonZoomViewport(incoming) {
  if (!incoming) return false;

  const { lat, lon, zoom } = incoming;
  if (lat === null || lon === null || zoom === null) return false;

  return (
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    Number.isFinite(zoom) &&
    zoom >= 0 &&
    zoom <= 22
  );
}

function applyIncomingViewport() {
  if (!map) return false;

  const incoming = getIncomingViewportFromUrl();
  if (incoming.bbox && fitBoundsDesdeBbox(incoming.bbox)) {
    setMapMarkerAtCenter();
    shouldPreserveIncomingViewport = true;
    return true;
  }

  if (hasValidLatLonZoomViewport(incoming)) {
    map.setView([incoming.lat, incoming.lon], incoming.zoom ?? 16);
    marcadorPunto = L.circleMarker([incoming.lat, incoming.lon], {
      radius: 6,
      color: "#f97316",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.9
    }).addTo(map);
    shouldPreserveIncomingViewport = true;
    return true;
  }

  shouldPreserveIncomingViewport = false;
  return false;
}

function saveViewportToLocalStorage() {
  const viewport = getCurrentViewportParams();
  if (!viewport) return;

  const payload = {
    lat: Number(viewport.lat),
    lon: Number(viewport.lon),
    zoom: Number(viewport.zoom),
    bbox: viewport.bbox,
    updatedAt: Date.now()
  };

  localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(payload));
}

function readViewportFromLocalStorage() {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed?.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    if (Date.now() - updatedAt > VIEWPORT_MAX_AGE_MS) return null;

    const lat = Number(parsed?.lat);
    const lon = Number(parsed?.lon);
    const zoom = Number(parsed?.zoom);
    const bbox = typeof parsed?.bbox === "string" ? parsed.bbox : "";

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(zoom) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      zoom < 0 ||
      zoom > 22
    ) {
      return null;
    }

    return { lat, lon, zoom, bbox };
  } catch (_) {
    return null;
  }
}

function getCurrentPositionPromise(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function tryResolveGpsWithoutPrompt() {
  if (!navigator.geolocation || !navigator.permissions?.query) return null;

  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    if (permission.state !== "granted") return null;

    const pos = await getCurrentPositionPromise({
      enableHighAccuracy: true,
      timeout: 10000
    });

    const lat = Number(pos?.coords?.latitude);
    const lon = Number(pos?.coords?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return { lat, lon, zoom: 16 };
  } catch (_) {
    return null;
  }
}

async function tryResolveLocationFromIp() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);

  try {
    const resp = await fetch("https://ipapi.co/json/", {
      signal: controller.signal
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const lat = Number(data?.latitude);
    const lon = Number(data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return { lat, lon, zoom: 12 };
  } catch (_) {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function debounce(fn, delayMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => fn(...args), delayMs);
  };
}

async function resolveInitialViewport() {
  if (!map) return;

  const appliedIncoming = applyIncomingViewport();
  if (appliedIncoming) {
    shouldPreserveIncomingViewport = true;
    saveViewportToLocalStorage(); // excepción: viewport heredado por URL
    return;
  }

  const lastViewport = readViewportFromLocalStorage();
  if (lastViewport) {
    const lastBbox = parseBboxFromQuery(lastViewport.bbox);
    if (!lastBbox || !fitBoundsDesdeBbox(lastBbox)) {
      map.setView([lastViewport.lat, lastViewport.lon], lastViewport.zoom);
    }
    shouldPreserveIncomingViewport = true;
    return;
  }

  const gpsViewport = await tryResolveGpsWithoutPrompt();
  if (gpsViewport) {
    map.setView([gpsViewport.lat, gpsViewport.lon], gpsViewport.zoom);
    shouldPreserveIncomingViewport = true;
    return;
  }

  const ipViewport = await tryResolveLocationFromIp();
  if (ipViewport) {
    map.setView([ipViewport.lat, ipViewport.lon], ipViewport.zoom);
    shouldPreserveIncomingViewport = true;
    return;
  }

  map.setView(HOME_VIEW.center, HOME_VIEW.zoom);
  shouldPreserveIncomingViewport = true;
}

function getCurrentViewportParams() {
  if (!map) return null;
  const center = map.getCenter();
  const bounds = map.getBounds();

  return {
    lat: center.lat.toFixed(6),
    lon: center.lng.toFixed(6),
    zoom: String(map.getZoom()),
    bbox: [
      bounds.getNorth().toFixed(8),
      bounds.getEast().toFixed(8),
      bounds.getSouth().toFixed(8),
      bounds.getWest().toFixed(8)
    ].join(",")
  };
}

function isEcosystemHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "geoeva.cl" ||
    host === "www.geoeva.cl" ||
    host === "geonemo.cl" ||
    host === "www.geonemo.cl" ||
    host === "geoipt.cl" ||
    host === "www.geoipt.cl"
  );
}

function buildCrossSiteUrl(rawHref) {
  if (!rawHref) return null;
  const url = new URL(rawHref, window.location.href);
  if (!isEcosystemHost(url.hostname)) return null;

  const viewport = getCurrentViewportParams();
  if (!viewport) return url.toString();

  url.searchParams.set("from", "geoipt");
  url.searchParams.set("lat", viewport.lat);
  url.searchParams.set("lon", viewport.lon);
  url.searchParams.set("zoom", viewport.zoom);
  url.searchParams.set("bbox", viewport.bbox);
  return url.toString();
}

function openWithViewport(rawHref, target = "_self") {
  const nextUrl = buildCrossSiteUrl(rawHref);
  if (!nextUrl) return false;

  if (target === "_blank") {
    window.open(nextUrl, "_blank", "noopener");
  } else {
    window.location.href = nextUrl;
  }
  return true;
}

function initCrossSitePortal() {
  document.addEventListener(
    "click",
    (e) => {
      const anchor = e.target.closest?.("a[href]");
      if (!anchor) return;

      const handled = openWithViewport(anchor.href, anchor.target || "_self");
      if (handled) {
        e.preventDefault();
      }
    },
    true
  );

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "ecosystem:navigate") return;
    openWithViewport(data.href, data.target || "_blank");
  });
}

function normalizarTexto(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFallbackParams() {
  const params = new URLSearchParams(window.location.search);

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  return {
    fallback: params.get("fallback") || "",
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null
  };
}

function obtenerPrcCercanosDesdeSession() {
  try {
    const data = JSON.parse(
      sessionStorage.getItem("geoipt_prc_cercanos") || "{}"
    );
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    return [];
  }
}

function ocultarPanelPrcCercanos() {
  const panel = document.getElementById("prc-nearby-panel");
  if (!panel) return;
  panel.innerHTML = "";
  panel.hidden = true;
}

async function irAPrcSugerido(item) {
  if (!item) return;

  ocultarPanelPrcCercanos();

  if (item.region_codigo) {
    regionSelect.value = item.region_codigo;
    centrarEnRegion(item.region_codigo);
    await cargarInstrumentos(item.region_codigo);
  }

  const option = Array.from(instrumentoSelect.options).find(
    (opt) => opt.value === item.archivo
  );

  if (option) {
    instrumentoSelect.value = option.value;
  }

  const hizoFitBbox = fitBoundsDesdeBbox(item.bbox);

  if (!hizoFitBbox) {
    await zoomAlInstrumento(item.region_codigo, item.archivo);
  } else {
    setMapMarkerAtCenter();
  }
}

function renderPanelPrcCercanos(items) {
  const panel = document.getElementById("prc-nearby-panel");
  if (!panel || !items.length) return;

  panel.innerHTML = `
    <div class="prc-nearby-card">
      <div class="prc-nearby-title">No encontramos un PRC exacto en ese punto</div>
      <div class="prc-nearby-subtitle">Estos son los 3 PRC más cercanos:</div>
      <div class="prc-nearby-list">
        ${items.map((item, idx) => `
          <button type="button" class="prc-nearby-item" data-index="${idx}">
            <span class="prc-nearby-name">${escapeHtml(item.nombre || "PRC sin nombre")}</span>
            <span class="prc-nearby-distance">${Number(item.distancia_km).toFixed(1)} km</span>
            <span class="prc-nearby-meta">${escapeHtml(
              [item.comuna, item.region_nombre].filter(Boolean).join(" / ")
            )}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  panel.hidden = false;

  panel.querySelectorAll(".prc-nearby-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const item = items[idx];
      await irAPrcSugerido(item);
    });
  });
}



function aplicarFallbackNoMatchEnIndex() {
  const params = getFallbackParams();
  if (params.fallback !== "no_match") return;

  const items = obtenerPrcCercanosDesdeSession();

  if (Number.isFinite(params.lat) && Number.isFinite(params.lon)) {
    if (marcadorPunto) {
      marcadorPunto.setLatLng([params.lat, params.lon]);
    } else {
      marcadorPunto = L.circleMarker([params.lat, params.lon], {
        radius: 6,
        color: "#f97316",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 0.9
      }).addTo(map);
    }
  }

  map.setView([params.lat, params.lon], 13);

  if (prcSearchInput) {
    prcSearchInput.value = "";
    prcSearchInput.focus();
  }

  renderFallbackResultadosCercanos(items);
}

function bboxEsValido(bbox) {
  return (
    Array.isArray(bbox) &&
    bbox.length === 2 &&
    Array.isArray(bbox[0]) &&
    Array.isArray(bbox[1]) &&
    bbox[0].length === 2 &&
    bbox[1].length === 2 &&
    bbox.every((par) =>
      Array.isArray(par) &&
      par.every((num) => Number.isFinite(Number(num)))
    )
  );
}

function fitBoundsDesdeBbox(bbox) {
  if (!bboxEsValido(bbox) || !map) return false;

  const sw = L.latLng(Number(bbox[0][0]), Number(bbox[0][1]));
  const ne = L.latLng(Number(bbox[1][0]), Number(bbox[1][1]));
  const bounds = L.latLngBounds(sw, ne);

  if (!bounds.isValid()) return false;

  map.fitBounds(bounds, { padding: [30, 30] });
  return true;
}

function centroDesdeBboxBuscador(bbox) {
  if (!bboxEsValido(bbox)) return null;

  const south = Number(bbox[0][0]);
  const west = Number(bbox[0][1]);
  const north = Number(bbox[1][0]);
  const east = Number(bbox[1][1]);

  return {
    lat: (south + north) / 2,
    lon: (west + east) / 2
  };
}

function distanciaAproximadaKm(a, b) {
  if (!a || !b) return Infinity;

  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;

  // aproximación suficiente para ranking
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111;
}

function obtenerPrcCercanosParaClick(lat, lon, limite = 3) {
  const origen = { lat, lon };

  if (!Array.isArray(indiceBuscador) || !indiceBuscador.length) return [];

  return indiceBuscador
    .map((item) => {
      const centro = centroDesdeBboxBuscador(item.bbox);

      return {
        nombre: item.nombre || "",
        comuna: item.comuna || "",
        region_nombre: item.region_nombre || "",
        region_codigo: item.region_codigo || "",
        carpeta: item.carpeta || "",
        archivo: item.archivo || "",
        bbox: item.bbox || [],
        distancia_km: centro ? distanciaAproximadaKm(origen, centro) : Infinity
      };
    })
    .filter(
      (item) =>
        item.nombre &&
        item.archivo &&
        bboxEsValido(item.bbox) &&
        Number.isFinite(item.distancia_km)
    )
    .sort((a, b) => a.distancia_km - b.distancia_km)
    .slice(0, limite);
}

function guardarPrcCercanosEnSession(lat, lon) {
  const items = obtenerPrcCercanosParaClick(lat, lon, 3);

  sessionStorage.setItem(
    "geoipt_prc_cercanos",
    JSON.stringify({
      origen: {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6))
      },
      items
    })
  );
}

function setMapMarkerAtCenter() {
  if (!map) return;
  const center = map.getCenter();

  if (marcadorPunto) {
    marcadorPunto.setLatLng(center);
  } else {
    marcadorPunto = L.circleMarker(center, {
      radius: 6,
      color: "#f97316",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.9
    }).addTo(map);
  }
}

function obtenerTextoRegionCorto(regionNombre) {
  return String(regionNombre || "").replace(/^Región( de)? /i, "").trim();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error(`No se pudo cargar el script: ${src}`)),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () =>
      reject(new Error(`No se pudo cargar el script: ${src}`));

    document.head.appendChild(script);
  });
}

/* -------------------------
   CARGA POR FASES
------------------------- */
async function loadUiData() {
  if (uiDataLoaded) return;
  if (uiDataPromise) return uiDataPromise;

  uiDataPromise = (async () => {
    // Capa liviana inicial:
    // - regiones
    // - instrumentos del panel superior
    // - índice del buscador
    await cargarRegiones();
    await cargarIndiceBuscador();
    uiDataLoaded = true;
  })();

  try {
    await uiDataPromise;
  } finally {
    if (!uiDataLoaded) {
      uiDataPromise = null;
    }
  }
}

async function loadSpatialData() {
  if (spatialDataLoaded) return;
  if (spatialDataPromise) return spatialDataPromise;

  spatialDataPromise = (async () => {
    // Capa pesada / futura lógica espacial.
    // Se deja preparada solo bajo demanda.
    if (!window.turf) {
      await loadScript("https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js");
    }

    spatialDataLoaded = true;
  })();

  try {
    await spatialDataPromise;
  } finally {
    if (!spatialDataLoaded) {
      spatialDataPromise = null;
    }
  }
}

/* -------------------------
   MAPA BASE
------------------------- */
function initMapa() {
  const mapaCalle = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  );

  map = L.map("map", {
    center: HOME_VIEW.center,
    zoom: HOME_VIEW.zoom,
    minZoom: 4,
    maxZoom: 19,
    layers: [mapaCalle]
  });

  initMapHintFade(mapaCalle);

  const overviewDiv = document.getElementById("overview-map");
  if (overviewDiv) {
    overviewMap = L.map("overview-map", {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18
    }).addTo(overviewMap);

    const chileBounds = L.latLngBounds([-56.0, -76.0], [-17.0, -66.0]);
    overviewMap.fitBounds(chileBounds);

    overviewRect = L.rectangle(map.getBounds(), {
      color: "#ff2d2d",
      weight: 2,
      fillOpacity: 0,
      interactive: false
    }).addTo(overviewMap);

    map.on("moveend", () => {
      if (overviewRect) {
        overviewRect.setBounds(map.getBounds());
      }
    });
  }

  initialViewportResolutionPromise = resolveInitialViewport();

  const markUserInteraction = () => {
    hasUserInteractedWithMap = true;
  };
  map.getContainer().addEventListener("pointerdown", markUserInteraction, {
    passive: true
  });
  map.getContainer().addEventListener("wheel", markUserInteraction, {
    passive: true
  });
  map.getContainer().addEventListener("touchstart", markUserInteraction, {
    passive: true
  });

  const saveViewportDebounced = debounce(() => {
    if (!hasUserInteractedWithMap) return;
    saveViewportToLocalStorage();
  }, VIEWPORT_SAVE_DEBOUNCE_MS);

  map.on("moveend zoomend", saveViewportDebounced);

  map.on("click", async (e) => {
    try {
      await loadSpatialData();
    } catch (err) {
      console.error("No se pudo inicializar la capa espacial:", err);
      return;
    }

    handleMapClick(e);
  });

  const mira = document.getElementById("mira-rifle");
  if (mira) {
    mira.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 16);
          setMapMarkerAtCenter();
          saveViewportToLocalStorage(); // excepción: geolocalización manual
        },
        (err) => {
          console.error(err);
          alert("No se pudo obtener tu ubicación.");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
}

function showMapHintFade() {
  if (hasShownMapHintFade) return;

  const hint = document.getElementById("map-hint-fade");
  if (!hint) return;

  hasShownMapHintFade = true;
  mapHintFadeIsHidden = false;

  const showDelayMs = 220;

  mapHintFadeShowTimeoutId = setTimeout(() => {
    hint.classList.add("is-visible");
  }, showDelayMs);
}

function hideMapHintFade() {
  if (mapHintFadeIsHidden) return;

  const hint = document.getElementById("map-hint-fade");
  if (!hint) return;

  if (mapHintFadeShowTimeoutId) {
    clearTimeout(mapHintFadeShowTimeoutId);
    mapHintFadeShowTimeoutId = null;
  }
  if (mapHintFadeReadyFallbackTimeoutId) {
    clearTimeout(mapHintFadeReadyFallbackTimeoutId);
    mapHintFadeReadyFallbackTimeoutId = null;
  }
  if (mapHintFadeHideTimeoutId) {
    clearTimeout(mapHintFadeHideTimeoutId);
    mapHintFadeHideTimeoutId = null;
  }

  mapHintFadeIsHidden = true;
  hint.classList.remove("is-visible");
  document.dispatchEvent(new CustomEvent("geoipt:map-hint-fade-hidden"));
}

function initMapHintFade(baseLayer) {
  if (!map) return;

  const hideDelayAfterMapReadyMs = 4000;
  const mapReadyFallbackMs = 5000;

  map.whenReady(showMapHintFade);

  const scheduleHide = () => {
    if (mapHintFadeReadyFallbackTimeoutId) {
      clearTimeout(mapHintFadeReadyFallbackTimeoutId);
      mapHintFadeReadyFallbackTimeoutId = null;
    }
    if (mapHintFadeHideTimeoutId) return;
    mapHintFadeHideTimeoutId = setTimeout(hideMapHintFade, hideDelayAfterMapReadyMs);
  };

  if (baseLayer && typeof baseLayer.once === "function") {
    baseLayer.once("load", scheduleHide);
  }

  mapHintFadeReadyFallbackTimeoutId = setTimeout(scheduleHide, mapReadyFallbackMs);

  const dismissOnInteraction = () => {
    if (mapHintFadeHideTimeoutId) {
      clearTimeout(mapHintFadeHideTimeoutId);
      mapHintFadeHideTimeoutId = null;
    }
    hideMapHintFade();
  };

  const mapContainer = map.getContainer();
  if (mapContainer) {
    ["pointerdown", "wheel", "touchstart"].forEach((eventName) => {
      mapContainer.addEventListener(eventName, dismissOnInteraction, {
        passive: true,
        once: true
      });
    });
  }
}

function handleMapClick(e) {
  ocultarResultadosBusqueda();
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  if (marcadorPunto) {
    marcadorPunto.setLatLng(e.latlng);
  } else {
    marcadorPunto = L.circleMarker(e.latlng, {
      radius: 6,
      color: "#f97316",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.9
    }).addTo(map);
  }

  const bounds = map.getBounds();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const west = bounds.getWest();

  const bboxStr = [
    north.toFixed(8),
    east.toFixed(8),
    south.toFixed(8),
    west.toFixed(8)
  ].join(",");

  const url = new URL("bbox_test.html", window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));
  url.searchParams.set("bbox", bboxStr);

  trackGeoiptMapClick({
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    bbox: bboxStr
  });

  guardarPrcCercanosEnSession(lat, lon);

  window.location.href = url.toString();
}

/* -------------------------
   REGIONES
------------------------- */
async function cargarRegiones() {
  try {
    if (initialViewportResolutionPromise) {
      await initialViewportResolutionPromise;
    }

    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) throw new Error("No se pudo leer capas/regiones.json");

    const data = await resp.json();
    regionesData = Array.isArray(data)
      ? data
      : data.regiones_ipt || data.regiones || [];

    regionSelect.innerHTML = "";

    regionesData
      .filter((r) => r.activo !== false)
      .forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.codigo_ine;
        const nombreCorto = (r.nombre || "").replace(/^Región( de)? /i, "");
        opt.textContent = `${r.codigo_ine} - ${nombreCorto}`;
        regionSelect.appendChild(opt);
      });

    let defaultCode = "03";
    if (!regionesData.some((r) => r.codigo_ine === defaultCode)) {
      defaultCode = regionesData[0]?.codigo_ine;
    }

    if (defaultCode) {
      regionSelect.value = defaultCode;
      if (!shouldPreserveIncomingViewport) {
        centrarEnRegion(defaultCode);
      }
      await cargarInstrumentos(defaultCode);
    }
  } catch (err) {
    console.error("Error cargando regiones:", err);
  }
}

function obtenerRegionPorCodigo(cod) {
  return regionesData.find((r) => r.codigo_ine === cod) || null;
}

function centrarEnRegion(cod) {
  const reg = obtenerRegionPorCodigo(cod);
  if (!reg || !Array.isArray(reg.centro)) return;
  const [lat, lon] = reg.centro;
  const zoom = reg.zoom || 7;
  map.setView([lat, lon], zoom);
}

/* -------------------------
   INSTRUMENTOS
------------------------- */
async function cargarInstrumentos(regionCode) {
  instrumentoSelect.innerHTML = "";
  instrumentoSelect.disabled = true;

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Selecciona un instrumento para hacer zoom";
  instrumentoSelect.appendChild(def);

  const reg = obtenerRegionPorCodigo(regionCode);
  if (!reg) {
    console.warn("No se encontró la región", regionCode);
    return [];
  }

  if (!reg.carpeta) {
    console.warn("La región no tiene campo 'carpeta' en regiones.json:", reg);
    return [];
  }

  const carpetaRegion = reg.carpeta;
  const url = `capas/${carpetaRegion}/listado.json`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo leer", url, resp.status);
      return [];
    }

    const data = await resp.json();
    const lista = data.instrumentos || data.kml || [];

    const instrumentosNormalizados = [];

    lista.forEach((entry, idx) => {
      let archivo = "";
      let nombre = "";
      let tipo = "";
      let comuna = "";
      let bbox = [];

      if (typeof entry === "string") {
        archivo = entry;
        nombre = entry.replace(/\.kml$/i, "");
      } else if (entry && typeof entry === "object") {
        archivo = entry.archivo || entry.kml || "";
        nombre = (entry.nombre || archivo || "").replace(/\.kml$/i, "");
        tipo = entry.tipo || "";
        comuna = entry.comuna || "";
        bbox = entry.bbox || [];
      }

      if (!archivo) {
        console.warn("Instrumento sin archivo en índice", idx, entry);
        return;
      }

      instrumentosNormalizados.push({
        archivo,
        nombre,
        tipo,
        comuna,
        bbox,
        carpeta: carpetaRegion
      });

      const opt = document.createElement("option");
      opt.value = archivo;
      opt.textContent = nombre;
      opt.dataset.carpeta = carpetaRegion;
      opt.dataset.tipo = tipo;
      opt.dataset.comuna = comuna;
      opt.dataset.bbox = JSON.stringify(bbox || []);
      instrumentoSelect.appendChild(opt);
    });

    instrumentoSelect.disabled = instrumentoSelect.options.length <= 1;
    return instrumentosNormalizados;
  } catch (e) {
    console.error("Error leyendo instrumentos:", e);
    return [];
  }
}

async function zoomAlInstrumento(regionCode, archivo) {
  if (!archivo) return;

  const reg = obtenerRegionPorCodigo(regionCode);
  if (!reg) return;

  const carpetaRegion = reg.carpeta;
  const url = `capas/${carpetaRegion}/${archivo}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo abrir el KML:", url);
      return;
    }

    const txt = await resp.text();
    const xml = new DOMParser().parseFromString(txt, "application/xml");
    const coords = xml.querySelectorAll("coordinates");

    const puntos = [];
    coords.forEach((c) => {
      c.textContent
        .trim()
        .split(/\s+/)
        .forEach((par) => {
          const [lon, lat] = par.split(",").map(Number);
          if (!isNaN(lat) && !isNaN(lon)) puntos.push([lat, lon]);
        });
    });

    if (puntos.length) {
      map.fitBounds(L.latLngBounds(puntos), { padding: [30, 30] });
      setMapMarkerAtCenter();
    }
  } catch (e) {
    console.warn("No se pudo procesar el KML:", e);
  }
}

/* -------------------------
   BUSCADOR NACIONAL
------------------------- */
async function cargarIndiceBuscador() {
  try {
    const resp = await fetch("capas/buscador_prc.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    if (!Array.isArray(data)) {
      throw new Error("buscador_prc.json no es un array");
    }

    indiceBuscador = data
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        region_nombre: item.region_nombre || "",
        region_codigo: item.region_codigo || "",
        carpeta: item.carpeta || "",
        archivo: item.archivo || "",
        nombre: item.nombre || "",
        tipo: item.tipo || "",
        comuna: item.comuna || "",
        bbox: item.bbox || [],
        searchText: normalizarTexto(
          [
            item.nombre,
            item.comuna,
            item.tipo,
            item.region_nombre,
            item.archivo
          ].join(" ")
        )
      }))
      .filter((item) => item.archivo && item.nombre);
  } catch (err) {
    console.error("No se pudo cargar el índice nacional del buscador:", err);
    indiceBuscador = [];
  }
}

function buscarInstrumentos(query) {
  const q = normalizarTexto(query);
  if (!q || q.length < 2) return [];

  const tokens = q.split(/\s+/).filter(Boolean);

  const resultados = indiceBuscador
    .filter((item) => tokens.every((t) => item.searchText.includes(t)))
    .sort((a, b) => {
      const aStarts = normalizarTexto(a.nombre).startsWith(q) ? 1 : 0;
      const bStarts = normalizarTexto(b.nombre).startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;

      const aComuna = normalizarTexto(a.comuna).startsWith(q) ? 1 : 0;
      const bComuna = normalizarTexto(b.comuna).startsWith(q) ? 1 : 0;
      if (aComuna !== bComuna) return bComuna - aComuna;

      return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
    });

  return resultados.slice(0, 10);
}

function ocultarResultadosBusqueda() {
  resultadosBusquedaActual = [];
  searchActiveIndex = -1;
  prcSearchResults.innerHTML = "";
  prcSearchResults.hidden = true;
}

function renderResultadosBusqueda(resultados) {
  resultadosBusquedaActual = resultados;
  searchActiveIndex = -1;

  if (!resultados.length) {
    prcSearchResults.innerHTML = `
      <div class="map-search-empty">Sin coincidencias.</div>
    `;
    prcSearchResults.hidden = false;
    return;
  }

  prcSearchResults.innerHTML = resultados
    .map((item, idx) => {
      const regionCorta = obtenerTextoRegionCorto(item.region_nombre);
      const meta = [item.tipo, item.comuna, regionCorta]
        .filter(Boolean)
        .join(" · ");

      return `
        <button
          type="button"
          class="map-search-item"
          data-index="${idx}"
        >
          <span class="map-search-title">${escapeHtml(item.nombre)}</span>
          <span class="map-search-meta">${escapeHtml(meta)}</span>
        </button>
      `;
    })
    .join("");

  prcSearchResults.hidden = false;

  prcSearchResults.querySelectorAll(".map-search-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const item = resultadosBusquedaActual[idx];
      if (item) {
        seleccionarResultadoBusqueda(item);
      }
    });
  });
}

function renderFallbackResultadosCercanos(items) {
  resultadosBusquedaActual = items;
  searchActiveIndex = -1;

  if (!prcSearchResults) return;

  if (!items || !items.length) {
    prcSearchResults.innerHTML = `
      <div class="map-search-empty">
        No encontramos un PRC exacto en ese punto, y no hay sugerencias disponibles.
      </div>
    `;
    prcSearchResults.hidden = false;
    return;
  }

  prcSearchResults.innerHTML = `
    <div class="map-search-empty" style="padding-bottom: 8px;">
      No encontramos un PRC exacto en ese punto.<br>
      Estos son los 3 PRC más cercanos:
    </div>
    ${items
      .map((item, idx) => {
        const meta = [item.comuna, item.region_nombre]
          .filter(Boolean)
          .join(" · ");

        return `
          <button
            type="button"
            class="map-search-item"
            data-index="${idx}"
          >
            <span class="map-search-title">
              ${escapeHtml(item.nombre || "PRC sin nombre")}
            </span>
            <span class="map-search-meta">
              ${escapeHtml(meta)} · ${Number(item.distancia_km).toFixed(1)} km
            </span>
          </button>
        `;
      })
      .join("")}
  `;

  prcSearchResults.hidden = false;

  prcSearchResults.querySelectorAll(".map-search-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const item = resultadosBusquedaActual[idx];
      if (item) {
        await seleccionarResultadoBusqueda(item);
      }
    });
  });
}

function actualizarItemActivoBusqueda() {
  const items = prcSearchResults.querySelectorAll(".map-search-item");
  items.forEach((el, idx) => {
    el.classList.toggle("is-active", idx === searchActiveIndex);
  });

  if (searchActiveIndex >= 0 && items[searchActiveIndex]) {
    items[searchActiveIndex].scrollIntoView({ block: "nearest" });
  }
}

async function seleccionarResultadoBusqueda(item) {
  if (!item) return;

  prcSearchInput.value = item.nombre;
  ocultarResultadosBusqueda();

  if (item.region_codigo) {
    regionSelect.value = item.region_codigo;
    centrarEnRegion(item.region_codigo);
    await cargarInstrumentos(item.region_codigo);
  }

  const option = Array.from(instrumentoSelect.options).find(
    (opt) => opt.value === item.archivo
  );

  if (option) {
    instrumentoSelect.value = option.value;
  }

  const hizoFitBbox = fitBoundsDesdeBbox(item.bbox);

  if (!hizoFitBbox) {
    await zoomAlInstrumento(item.region_codigo, item.archivo);
  } else {
    setMapMarkerAtCenter();
  }
}

function initBuscadorNacional() {
  if (!prcSearchInput || !prcSearchResults) return;

  prcSearchInput.addEventListener("input", () => {
    const value = prcSearchInput.value.trim();

    if (value.length < 2) {
      ocultarResultadosBusqueda();
      return;
    }

    const resultados = buscarInstrumentos(value);
    renderResultadosBusqueda(resultados);
  });

  prcSearchInput.addEventListener("keydown", async (e) => {
    if (prcSearchResults.hidden || !resultadosBusquedaActual.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      searchActiveIndex = (searchActiveIndex + 1) % resultadosBusquedaActual.length;
      actualizarItemActivoBusqueda();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      searchActiveIndex =
        searchActiveIndex <= 0
          ? resultadosBusquedaActual.length - 1
          : searchActiveIndex - 1;
      actualizarItemActivoBusqueda();
    } else if (e.key === "Enter") {
      if (searchActiveIndex >= 0 && resultadosBusquedaActual[searchActiveIndex]) {
        e.preventDefault();
        await seleccionarResultadoBusqueda(
          resultadosBusquedaActual[searchActiveIndex]
        );
      }
    } else if (e.key === "Escape") {
      ocultarResultadosBusqueda();
    }
  });

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("map-search-wrap");
    if (!wrap) return;
    if (!wrap.contains(e.target)) {
      ocultarResultadosBusqueda();
    }
  });
}

/* -------------------------
   INICIO
------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  initMapa();
  initCrossSitePortal();
  initBuscadorNacional();
  await loadUiData();

  aplicarFallbackNoMatchEnIndex();

   
    const prcSummary = window.createPRCSummary({
      map,
      getItems: () => indiceBuscador
    });
    prcSummary.init();
 

  regionSelect.addEventListener("change", async () => {
    ocultarResultadosBusqueda();
    const code = regionSelect.value;
    centrarEnRegion(code);
    await cargarInstrumentos(code);
  });

  instrumentoSelect.addEventListener("change", async () => {
    ocultarResultadosBusqueda();
    const selectedOption =
      instrumentoSelect.options[instrumentoSelect.selectedIndex];

    if (!selectedOption || !selectedOption.value) return;

    let bbox = [];
    try {
      bbox = JSON.parse(selectedOption.dataset.bbox || "[]");
    } catch (_) {
      bbox = [];
    }

    const hizoFitBbox = fitBoundsDesdeBbox(bbox);
    if (!hizoFitBbox) {
      await zoomAlInstrumento(regionSelect.value, instrumentoSelect.value);
    } else {
      setMapMarkerAtCenter();
    }
  });
});

/* -------------------------
   HINT DESKTOP
------------------------- */
(function initMapHintHover() {
  if (window.innerWidth < 768) return;

  const mapEl = document.getElementById("map");
  const hint = document.getElementById("map-hint");
  if (!mapEl || !hint) return;

  mapEl.addEventListener("mouseenter", () => {
    hint.classList.add("is-visible");
  });

  mapEl.addEventListener("mouseleave", () => {
    hint.classList.remove("is-visible");
  });
})();

/* -------------------------
   HINT MOBILE
------------------------- */
function initMobileMapHint() {
  const hint = document.getElementById("mobile-map-hint");
  if (!hint) return;

  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  if (!isMobile) {
    hint.remove();
    return;
  }

  const showDelay = 700;
  const visibleTime = 2800;

  window.setTimeout(() => {
    hint.classList.add("is-visible");

    window.setTimeout(() => {
      hint.classList.remove("is-visible");

      window.setTimeout(() => {
        hint.remove();
      }, 400);
    }, visibleTime);
  }, showDelay);
}

window.addEventListener("load", initMobileMapHint);
