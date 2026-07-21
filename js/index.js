let map;
let osmLayer;
let satLayer;
let currentBaseLayer;
let currentBasemap = "osm";
let initialCrossAccessState = null;
let selectedPoint = null;
let geoqueryToastTimeoutId = null;
let selectedFeatureContext = null;
const SITE_ID = "geoipt";
const SITE_CONFIG = { initialRegion: "Región Metropolitana de Santiago" };
const CROSS_ACCESS_PARAM_NAME = "from";
const CROSS_ACCESS_PARAM_VALUE = "crossaccess";

let viewportRestoreApplied = false;
let initialViewportCompleted = false;
let geoQueryRestoreState = null;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBasemap(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["sat", "satellite", "satelital"].includes(normalized)) return "sat";
  return "osm";
}

function validLat(value) { return Number.isFinite(value) && value >= -90 && value <= 90; }
function validLon(value) { return Number.isFinite(value) && value >= -180 && value <= 180; }
function validZoom(value) { return Number.isFinite(value) && value >= 0 && value <= 22; }

function getGeoQueryOriginStorageKey(site = SITE_ID) {
  return `geox:${site}:geoquery-origin`;
}

function normalizeGeoQueryOriginState(raw, site = SITE_ID) {
  if (!raw || raw.site !== site) return null;
  const centerLat = toFiniteNumber(raw.map?.centerLat);
  const centerLon = toFiniteNumber(raw.map?.centerLon);
  const zoom = toFiniteNumber(raw.map?.zoom);
  const queryLat = toFiniteNumber(raw.queryPoint?.lat);
  const queryLon = toFiniteNumber(raw.queryPoint?.lon);
  const west = toFiniteNumber(raw.map?.bounds?.west);
  const south = toFiniteNumber(raw.map?.bounds?.south);
  const east = toFiniteNumber(raw.map?.bounds?.east);
  const north = toFiniteNumber(raw.map?.bounds?.north);
  const savedAt = toFiniteNumber(raw.savedAt) || Date.now();
  const maxAgeMs = 12 * 60 * 60 * 1000;
  if (!validLat(centerLat) || !validLon(centerLon) || !validZoom(zoom)) return null;
  if (!validLat(queryLat) || !validLon(queryLon)) return null;
  if (!validLon(west) || !validLon(east) || !validLat(south) || !validLat(north) || !(west < east) || !(south < north)) return null;
  if (Date.now() - savedAt > maxAgeMs) return null;
  return {
    version: 1,
    site,
    source: "geoquery",
    savedAt,
    queryPoint: { lat: queryLat, lon: queryLon },
    map: { centerLat, centerLon, zoom, basemap: normalizeBasemap(raw.map?.basemap), bounds: { west, south, east, north } },
    navigation: { from: raw.navigation?.from || "index", crossAccess: raw.navigation?.crossAccess === true || raw.navigation?.from === "crossaccess" }
  };
}

function readOriginStateFromUrl(site = SITE_ID) {
  const params = new URLSearchParams(window.location.search);
  const finiteParam = (name) => toFiniteNumber(params.get(name));
  const centerLat = finiteParam("mapCenterLat") ?? finiteParam("viewLat");
  const centerLon = finiteParam("mapCenterLon") ?? finiteParam("viewLon");
  const zoom = finiteParam("mapZoom") ?? finiteParam("zoom");
  const queryLat = finiteParam("queryLat") ?? finiteParam("lat");
  const queryLon = finiteParam("queryLon") ?? finiteParam("lon");
  const west = finiteParam("viewWest");
  const south = finiteParam("viewSouth");
  const east = finiteParam("viewEast");
  const north = finiteParam("viewNorth");
  return normalizeGeoQueryOriginState({ version: 1, site, source: "geoquery", savedAt: Date.now(), queryPoint: { lat: queryLat, lon: queryLon }, map: { centerLat, centerLon, zoom, basemap: params.get("basemap"), bounds: { west, south, east, north } }, navigation: { from: params.get("from") || "index", crossAccess: params.get("from") === "crossaccess" || params.get("source") === "crossaccess" } }, site);
}

function readOriginStateFromHistory(site = SITE_ID) {
  return normalizeGeoQueryOriginState(history.state?.geoQueryOrigin, site);
}

function readOriginStateFromSessionStorage(site = SITE_ID) {
  try { return normalizeGeoQueryOriginState(JSON.parse(sessionStorage.getItem(getGeoQueryOriginStorageKey(site)) || "null"), site); }
  catch { return null; }
}

function resolveViewportRestoreState(site = SITE_ID) {
  return readOriginStateFromUrl(site) || readOriginStateFromHistory(site) || readOriginStateFromSessionStorage(site) || null;
}

function captureGeoQueryOriginState({ site = SITE_ID, map, queryLat, queryLon, basemap, from }) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return normalizeGeoQueryOriginState({ version: 1, site, source: "geoquery", savedAt: Date.now(), queryPoint: { lat: Number(queryLat), lon: Number(queryLon) }, map: { centerLat: center.lat, centerLon: center.lng, zoom: map.getZoom(), basemap, bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } }, navigation: { from: from || "index", crossAccess: from === "crossaccess" } }, site);
}

function persistOriginStateBeforeGeoQuery(originState) {
  if (!originState) return;
  try { sessionStorage.setItem(getGeoQueryOriginStorageKey(originState.site), JSON.stringify(originState)); } catch {}
  const currentUrl = new URL(window.location.href);
  const p = currentUrl.searchParams;
  p.set("mapCenterLat", originState.map.centerLat); p.set("mapCenterLon", originState.map.centerLon); p.set("mapZoom", originState.map.zoom);
  p.set("basemap", originState.map.basemap); p.set("queryLat", originState.queryPoint.lat); p.set("queryLon", originState.queryPoint.lon);
  p.set("viewWest", originState.map.bounds.west); p.set("viewSouth", originState.map.bounds.south); p.set("viewEast", originState.map.bounds.east); p.set("viewNorth", originState.map.bounds.north);
  p.set("restoreViewport", "1"); p.set("from", originState.navigation.crossAccess ? "crossaccess" : "geoquery");
  history.replaceState({ ...(history.state || {}), geoQueryOrigin: originState }, "", currentUrl);
}

function appendOriginStateToGeoQueryUrl(url, originState) {
  const target = new URL(url, window.location.href); const p = target.searchParams;
  p.set("viewLat", originState.map.centerLat); p.set("viewLon", originState.map.centerLon); p.set("mapCenterLat", originState.map.centerLat); p.set("mapCenterLon", originState.map.centerLon);
  p.set("zoom", originState.map.zoom); p.set("mapZoom", originState.map.zoom); p.set("basemap", originState.map.basemap); p.set("queryLat", originState.queryPoint.lat); p.set("queryLon", originState.queryPoint.lon);
  p.set("viewWest", originState.map.bounds.west); p.set("viewSouth", originState.map.bounds.south); p.set("viewEast", originState.map.bounds.east); p.set("viewNorth", originState.map.bounds.north);
  return target.pathname.split('/').pop() === 'geoquery.html' ? `./geoquery/geoquery.html?${p.toString()}` : target.toString();
}

function restoreMapViewport(mapInstance, restoreState) {
  const state = normalizeGeoQueryOriginState(restoreState, SITE_ID); if (!mapInstance || !state) return false;
  if (typeof switchBaseMap === "function") switchBaseMap(state.map.basemap);
  mapInstance.setView([state.map.centerLat, state.map.centerLon], state.map.zoom, { animate: false });
  if (typeof setSelectedPoint === "function") setSelectedPoint(state.queryPoint.lat, state.queryPoint.lon, "geoquery_restore");
  else { selectedPoint = { lat: state.queryPoint.lat, lon: state.queryPoint.lon, source: "geoquery_restore", site: SITE_ID, timestamp: new Date().toISOString() }; window.selectedPoint = selectedPoint; }
  viewportRestoreApplied = true; geoQueryRestoreState = state; return true;
}

function installGeoQueryViewportRestoreHandlers() {
  window.addEventListener("pageshow", (event) => { if (!event.persisted) return; const state = resolveViewportRestoreState(SITE_ID); if (state && map) { restoreMapViewport(map, state); setTimeout(() => map.invalidateSize(false), 0); } });
  window.addEventListener("popstate", (event) => { const state = normalizeGeoQueryOriginState(event.state?.geoQueryOrigin, SITE_ID) || resolveViewportRestoreState(SITE_ID); if (state && map) restoreMapViewport(map, state); });
}


const PARAMS_PATH = "parametros/parametros_index.json";
const REGIONES_PATH = "capas_selector/regiones.json";
const GEOIPT_DEBUG_SKIP_MODAL = false;
const GEOIPT_EMERGENCY_VIEWPORT = {
  center: { lat: -33.4489, lon: -70.6693 },
  scaleDenominator: 20000,
  fallbackZoom: 14.5,
  basemap: "osm"
};
const GEOIPT_FALLBACK_CONFIG = {
  sitio: "GeoIPT",
  titulo: "GeoIPT",
  subtitulo: "Normativa urbana y usos de suelo",
  pais_default: "CL",
  region_default: "13",
  centro_mapa: [-33.4489, -70.6693],
  zoom_inicial: 14.5,
  mapa_base: "osm",
  defaultViewport: { ...GEOIPT_EMERGENCY_VIEWPORT, center: { ...GEOIPT_EMERGENCY_VIEWPORT.center } },
  locationViewport: { scaleDenominator: 20000, fallbackZoom: 14.5, basemap: "osm" },
  zoomLimits: { min: 3, max: 19, snap: 0.25 },
  configFallbackActive: true
};
let regionesSelector = [];
let currentInitStep = "inicio";

function isCrossAccessNavigationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get(CROSS_ACCESS_PARAM_NAME) === CROSS_ACCESS_PARAM_VALUE ||
    params.get("source") === CROSS_ACCESS_PARAM_VALUE ||
    params.get("crossAccess") === "1"
  );
}

function getInitialCrossAccessStateFromUrl() {
  if (initialCrossAccessState) return initialCrossAccessState;

  const params = new URLSearchParams(window.location.search);

  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  const zoom = parseInt(params.get("zoom"), 10);
  const requestedBasemap = params.get("basemap") || "osm";
  const basemap = requestedBasemap === "sat" ? "sat" : "osm";

  console.log("[GeoX cross_access receive]", {
    lat,
    lon,
    zoom,
    basemap
  });

  initialCrossAccessState = {
    viewport: Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(zoom)
      ? { lat, lon, zoom }
      : null,
    basemap
  };

  return initialCrossAccessState;
}

function getInitialViewportFromUrl() {
  return getInitialCrossAccessStateFromUrl().viewport;
}

function getInitialBasemapFromUrl() {
  return getInitialCrossAccessStateFromUrl().basemap;
}


let userLocationMarker = null;

function isValidSelectedPoint(point) {
  return Boolean(
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lon))
  );
}

function setSelectedPoint(lat, lon, source) {
  const numericLat = Number(lat);
  const numericLon = Number(lon);

  if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return null;

  selectedPoint = {
    lat: numericLat,
    lon: numericLon,
    source,
    site: SITE_ID,
    timestamp: new Date().toISOString()
  };
  window.selectedPoint = selectedPoint;
  return selectedPoint;
}

function initSelectedPointFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return setSelectedPoint(lat, lon, "url_params");
}

function captureSelectedPoint(event, featureContext = null) {
  const latlng = event?.latlng || event;
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return null;

  const originalEvent = event?.originalEvent;
  if (featureContext && originalEvent) originalEvent.__geoxFeatureContext = featureContext;

  setSelectedPoint(latlng.lat, latlng.lng, "map_click");
  selectedFeatureContext = featureContext || originalEvent?.__geoxFeatureContext || null;
  window.selectedPoint = selectedPoint;
  window.selectedFeatureContext = selectedFeatureContext;
  return selectedPoint;
}

function getLocationByGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation no disponible"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  });
}

async function getLocationByIp() {
  try {
    const response = await fetch("https://ipapi.co/json/", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("No se pudo obtener ubicación por IP");
    }

    const data = await response.json();

    const lat = parseFloat(data.latitude);
    const lon = parseFloat(data.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("IP sin coordenadas válidas");
    }

    return { lat, lon };
  } catch (error) {
    console.warn("GeoX: ubicación por IP no disponible", error);
    return null;
  }
}

function updateUserLocationMarker(lat, lon) {
  if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return;

  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lon]);
  } else {
    userLocationMarker = L.marker([lat, lon]).addTo(map);
  }
}

function applyUserLocation(mapInstance, location, zoomLevel = 14) {
  if (!mapInstance || !location) return;

  const lat = parseFloat(location.lat);
  const lon = parseFloat(location.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  mapInstance.setView([lat, lon], zoomLevel);
  updateUserLocationMarker(lat, lon);
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Tu navegador no permite obtener ubicación.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      map.setView([lat, lon], 15);

      if (typeof updateUserLocationMarker === "function") {
        updateUserLocationMarker(lat, lon);
      }

      window.userLocation = {
        lat,
        lon,
        source: "geolocation",
        site: "geoipt",
        timestamp: new Date().toISOString()
      };
    },
    () => {
      showToast("No fue posible obtener tu ubicación.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

async function initGeoXInitialLocation(mapInstance) {
  const incomingViewport = getInitialViewportFromUrl();

  if (incomingViewport) {
    mapInstance.setView(
      [incomingViewport.lat, incomingViewport.lon],
      incomingViewport.zoom
    );
    return;
  }

  try {
    const gpsLocation = await getLocationByGps();

    if (gpsLocation) {
      applyUserLocation(mapInstance, gpsLocation, window.GeoXLocationZoom || 11);
      return;
    }
  } catch (error) {
    console.warn("GeoX: GPS no disponible o no autorizado", error);
  }

  const ipLocation = await getLocationByIp();

  if (ipLocation) {
    applyUserLocation(mapInstance, ipLocation, window.GeoXLocationZoom || 11);
    return;
  }

  console.warn("GeoX: se mantiene ubicación default del sitio");
}

function initGeoXMyLocationButton(mapInstance) {
  const button =
    document.getElementById("my-location-btn") ||
    document.getElementById("locate-btn") ||
    document.getElementById("btn-my-location") ||
    document.querySelector(".my-location-btn") ||
    document.querySelector(".locate-btn") ||
    document.querySelector("[data-action='my-location']");

  if (!button) {
    console.warn("GeoX: botón Mi ubicación no encontrado");
    return;
  }

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    locateUser();
  });
}

function getGeoXMapInstance() {
  if (window.geoxMap && typeof window.geoxMap.getCenter === "function") {
    return window.geoxMap;
  }

  if (window.map && typeof window.map.getCenter === "function") {
    return window.map;
  }

  return null;
}

function getCurrentMapState() {
  const mapInstance = getGeoXMapInstance();

  if (!mapInstance) {
    console.warn("GeoX: no se encontró instancia Leaflet para capturar estado del mapa.");
    return null;
  }

  const center = mapInstance.getCenter();

  return {
    lat: center.lat,
    lon: center.lng,
    zoom: mapInstance.getZoom(),
    basemap: currentBasemap || "osm"
  };
}

function buildCrossAccessUrl(sitePath) {
  const state = getCurrentMapState();
  const url = new URL(sitePath, window.location.href);
  url.searchParams.set(CROSS_ACCESS_PARAM_NAME, CROSS_ACCESS_PARAM_VALUE);

  if (!state) return url.toString();

  console.log("[GeoX cross_access send]", state);

  url.searchParams.set("lat", state.lat.toFixed(6));
  url.searchParams.set("lon", state.lon.toFixed(6));
  url.searchParams.set("zoom", String(state.zoom));
  url.searchParams.set("basemap", state.basemap);

  return url.toString();
}

function getCurrentViewportParams() {
  const state = getCurrentMapState();

  if (!state) return "";

  const params = new URLSearchParams();
  params.set("lat", state.lat.toFixed(6));
  params.set("lon", state.lon.toFixed(6));
  params.set("zoom", String(state.zoom));
  params.set("basemap", state.basemap);
  params.set(CROSS_ACCESS_PARAM_NAME, CROSS_ACCESS_PARAM_VALUE);

  return params.toString();
}

function isGeoXPortalLink(link) {
  if (!link) return false;

  const href = link.getAttribute("href") || "";
  const target = link.getAttribute("data-geox-target") || "";

  const value = `${href} ${target}`.toLowerCase();

  return (
    value.includes("geoipt") ||
    value.includes("geoeva") ||
    value.includes("geonemo") ||
    value.includes("geonoxa")
  );
}

function initGeoXCrossPortalNavigation() {
  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");

    if (!isGeoXPortalLink(link)) return;

    const rawTarget =
      link.getAttribute("data-geox-target") ||
      link.getAttribute("href");

    if (!rawTarget) return;

    event.preventDefault();

    window.location.href = buildCrossAccessUrl(rawTarget);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    currentInitStep = "carga_configuracion";
    const params = await loadGeoIptConfigSafely();

    currentInitStep = "validacion_configuracion";
    aplicarParametros(params);

    try {
      await cargarSummaryConfigYCapas();
    } catch (err) {
      console.warn("No se pudo cargar summary_config o capas summary:", err);
    }

    initSelectedPointFromUrl();

    currentInitStep = "creacion_mapa";
    await iniciarMapa(params);

    currentInitStep = "carga_capas";
    initGeoXCrossPortalNavigation();
    await cargarRegionesSelector(params);
    await GeoXViewport.initializeInitialViewport({ map, siteId: SITE_ID, siteConfig: window.geoxSiteConfig, regionSelector: document.getElementById("region-selector"), executeExistingRegionSearch: moverViewportPorRegion, applyBasemap: switchBaseMap });
    initialViewportCompleted = true;
    viewportRestoreApplied = GeoXViewport.readCrossAccessViewport(new URLSearchParams(window.location.search))?.isValid === true;

    currentInitStep = "eventos";
    conectarEventos();
    cargarListadoToSearch();
    await cargarLabelDensityConfig();
    await cargarListadoPanelTerritorial();
    iniciarPanelTerritorial();

    if (summaryConfig && map) {
      calcularYActualizarIndicadores();
      map.on("moveend zoomend", calcularYActualizarIndicadores);
    }

    currentInitStep = "modal";
    if (!GEOIPT_DEBUG_SKIP_MODAL && window.GeoFactoryIntroModal?.init) {
      window.GeoFactoryIntroModal.init();
    }

    console.log("GeoX iniciado correctamente:", params);
  } catch (error) {
    console.error("[GeoIPT INIT] Error completo:", error);
    console.error("[GeoIPT INIT] Mensaje:", error?.message);
    console.error("[GeoIPT INIT] Stack:", error?.stack);
    console.error("[GeoIPT INIT] Etapa:", currentInitStep);
    handleGeoIptInitError(error, currentInitStep);
  }
});

function handleGeoIptInitError(error, stage) {
  console.error("[GeoIPT INIT]", { stage, message: error?.message, stack: error?.stack, error });
  const criticalStages = new Set(["leaflet_missing", "map_container_missing", "map_creation_failed", "creacion_mapa"]);
  if (criticalStages.has(stage)) alert("No fue posible crear el mapa GeoIPT.");
}

function buildGeoIptConfigUrl() {
  return new URL(PARAMS_PATH, window.location.href).toString();
}

async function fetchGeoIptConfig() {
  const configUrl = buildGeoIptConfigUrl();
  console.info("[GeoIPT CONFIG] URL:", configUrl);
  const response = await fetch(configUrl, { cache: "no-store" });
  console.info("[GeoIPT CONFIG] Respuesta:", response.status, response.headers.get("content-type"));
  if (!response.ok) throw new Error(`No fue posible cargar configuración: ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch (error) {
    console.error("[GeoIPT CONFIG] JSON inválido:", error, text.slice(0, 500));
    throw error;
  }
}

async function cargarParametros() {
  return loadGeoIptConfigSafely();
}

async function loadGeoIptConfigSafely() {
  try {
    const rawConfig = await fetchGeoIptConfig();
    const normalizedConfig = normalizeGeoIptConfig(rawConfig);
    console.info("[GeoIPT CONFIG] Configuración cargada");
    return normalizedConfig;
  } catch (error) {
    console.error("[GeoIPT CONFIG] Falló configuración:", error);
    console.warn("[GeoIPT CONFIG] Usando fallback de emergencia");
    return { ...GEOIPT_FALLBACK_CONFIG, defaultViewport: { ...GEOIPT_EMERGENCY_VIEWPORT, center: { ...GEOIPT_EMERGENCY_VIEWPORT.center } } };
  }
}

function aplicarParametros(params) {
  document.title = `${params.sitio} - GeoFactory`;

  const siteTitle = document.getElementById("site-title");
  const siteSubtitle = document.getElementById("site-subtitle");
  const panelTitle = document.getElementById("panel-title");
  const searchBox = document.getElementById("search-box");

  siteTitle.textContent = params.titulo || "GeoX";
  siteSubtitle.textContent = params.subtitulo || "Molde territorial genérico";
  panelTitle.textContent = "Etiquetas";
  searchBox.placeholder = params.search_placeholder || "Buscar...";

  if (Array.isArray(params.summary_items)) {
    actualizarSummaryEnDom(params.summary_items);
  }
}

function crearSummaryItem(item) {
  const div = document.createElement("div");
  div.className = "summary-item";

  div.innerHTML = `
    <span class="summary-value">${item.value}</span>
    <span class="summary-label">${item.label}</span>
  `;

  return div;
}

function actualizarSummaryEnDom(items) {
  const summaryBar = document.getElementById("summary-bar");
  const mobileSummaryContent = document.getElementById("mobile-summary-content");

  [summaryBar, mobileSummaryContent].forEach((container) => {
    if (!container) return;

    container.innerHTML = "";
    items.forEach((item) => {
      container.appendChild(crearSummaryItem(item));
    });
  });
}


function calculateLeafletZoomForScale({ latitude, scaleDenominator, dpi = 96 }) {
  const lat = Number(latitude);
  const scale = Number(scaleDenominator);
  if (!Number.isFinite(lat) || !Number.isFinite(scale) || scale <= 0) return null;
  const metersPerPixel = scale * 0.0254 / dpi;
  const latitudeFactor = Math.cos(lat * Math.PI / 180);
  if (!Number.isFinite(latitudeFactor) || latitudeFactor <= 0) return null;
  const zoom = Math.log2(156543.03392804097 * latitudeFactor / metersPerPixel);
  return Number.isFinite(zoom) ? zoom : null;
}

function normalizeViewportConfig(viewport, fallback = GEOIPT_EMERGENCY_VIEWPORT) {
  const safe = viewport || {};
  const fallbackCenter = fallback.center || GEOIPT_EMERGENCY_VIEWPORT.center;
  const lat = Number(safe.center?.lat ?? safe.lat ?? fallbackCenter.lat);
  const lon = Number(safe.center?.lon ?? safe.center?.lng ?? safe.lon ?? safe.lng ?? fallbackCenter.lon);
  const scaleDenominator = Number(safe.scaleDenominator ?? fallback.scaleDenominator);
  const fallbackZoom = Number(safe.fallbackZoom ?? safe.zoom ?? fallback.fallbackZoom);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitud default inválida");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Longitud default inválida");
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) throw new Error("Escala default inválida");
  if (!Number.isFinite(fallbackZoom)) throw new Error("fallbackZoom inválido");
  return { center: { lat, lon }, scaleDenominator, fallbackZoom, basemap: normalizeBasemap(safe.basemap ?? fallback.basemap) };
}

function ensureDefaultViewport(config) {
  try {
    return { ...config, defaultViewport: normalizeViewportConfig(config?.defaultViewport, GEOIPT_EMERGENCY_VIEWPORT) };
  } catch (error) {
    console.warn("[GeoIPT VIEWPORT] Default inválido; usando fallback", error);
    return { ...config, defaultViewport: { ...GEOIPT_EMERGENCY_VIEWPORT, center: { ...GEOIPT_EMERGENCY_VIEWPORT.center } } };
  }
}

function normalizeGeoIptConfig(rawConfig) {
  const baseConfig = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const legacyViewport = baseConfig?.map?.initialView ?? baseConfig?.initialView ?? baseConfig?.viewport ?? (
    Array.isArray(baseConfig?.centro_mapa)
      ? { center: { lat: baseConfig.centro_mapa[0], lon: baseConfig.centro_mapa[1] }, fallbackZoom: baseConfig.zoom_inicial, basemap: baseConfig.mapa_base }
      : null
  );
  const viewport = baseConfig?.defaultViewport ?? legacyViewport;
  const merged = {
    ...GEOIPT_FALLBACK_CONFIG,
    ...baseConfig,
    region_default: String(baseConfig.region_default || GEOIPT_FALLBACK_CONFIG.region_default),
    defaultViewport: normalizeViewportConfig(viewport, GEOIPT_EMERGENCY_VIEWPORT),
    locationViewport: {
      scaleDenominator: Number(baseConfig?.locationViewport?.scaleDenominator ?? GEOIPT_EMERGENCY_VIEWPORT.scaleDenominator),
      fallbackZoom: Number(baseConfig?.locationViewport?.fallbackZoom ?? baseConfig?.locationViewport?.zoom ?? GEOIPT_EMERGENCY_VIEWPORT.fallbackZoom),
      basemap: normalizeBasemap(baseConfig?.locationViewport?.basemap ?? GEOIPT_EMERGENCY_VIEWPORT.basemap)
    },
    zoomLimits: { ...GEOIPT_FALLBACK_CONFIG.zoomLimits, ...(baseConfig.zoomLimits || {}) }
  };
  return ensureDefaultViewport(merged);
}

function isValidViewport(viewport) {
  const lat = Number(viewport?.center?.lat);
  const lon = Number(viewport?.center?.lon);
  const zoom = Number(viewport?.zoom);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180 && Number.isFinite(zoom);
}

function buildEmergencyGeoIptViewport() {
  const calculatedZoom = calculateLeafletZoomForScale({ latitude: GEOIPT_EMERGENCY_VIEWPORT.center.lat, scaleDenominator: GEOIPT_EMERGENCY_VIEWPORT.scaleDenominator });
  const zoom = Number.isFinite(calculatedZoom) ? calculatedZoom : GEOIPT_EMERGENCY_VIEWPORT.fallbackZoom;
  return { source: "geoipt-emergency", center: { ...GEOIPT_EMERGENCY_VIEWPORT.center }, zoom, basemap: "osm", consultedCoordinate: null, siteDestination: SITE_ID, scaleDenominator: GEOIPT_EMERGENCY_VIEWPORT.scaleDenominator };
}

async function resolveGeoIptInitialViewportSafely(options) {
  try {
    if (!window.GeoXViewport?.resolveInitialViewport) throw new Error("GeoXViewport no está disponible");
    const viewport = await GeoXViewport.resolveInitialViewport(options);
    if (!isValidViewport(viewport)) throw new Error("El resolvedor devolvió un viewport inválido");
    return { ...viewport, basemap: normalizeBasemap(viewport.basemap) };
  } catch (error) {
    console.error("[GeoIPT VIEWPORT] Error en resolución:", error);
    return buildEmergencyGeoIptViewport();
  }
}

function applyResolvedViewport(mapInstance, initialViewport) {
  const viewport = isValidViewport(initialViewport) ? initialViewport : buildEmergencyGeoIptViewport();
  const basemap = normalizeBasemap(viewport.basemap);
  if (typeof switchBaseMap === "function") switchBaseMap(basemap);
  mapInstance.setView([viewport.center.lat, viewport.center.lon], viewport.zoom, { animate: false });
  console.info("[GeoIPT VIEWPORT] Aplicado:", { ...viewport, basemap });
}

async function iniciarMapa(params = {}) {
  if (!window.L) {
    currentInitStep = "leaflet_missing";
    throw new Error("Leaflet no está disponible");
  }
  if (!document.getElementById("map")) {
    currentInitStep = "map_container_missing";
    throw new Error("Contenedor #map no disponible");
  }

  const siteConfig = { ...normalizeGeoIptConfig(params), ...SITE_CONFIG };
  window.GeoXLocationZoom = Number(siteConfig.locationViewport?.fallbackZoom ?? siteConfig.locationViewport?.zoom ?? siteConfig.defaultViewport?.fallbackZoom ?? siteConfig.defaultViewport?.zoom ?? 11);

  geoQueryRestoreState = null;
  const zoomSnap = Number(siteConfig?.zoomLimits?.snap);
  const minZoom = Number(siteConfig?.zoomLimits?.min);
  const maxZoom = Number(siteConfig?.zoomLimits?.max);
  try {
    map = L.map("map", {
      zoomControl: true,
      zoomSnap: Number.isFinite(zoomSnap) ? zoomSnap : 0.25,
      zoomDelta: Number.isFinite(zoomSnap) ? zoomSnap : 0.25,
      minZoom: Number.isFinite(minZoom) ? minZoom : 3,
      maxZoom: Number.isFinite(maxZoom) ? maxZoom : 19
    });
  } catch (error) {
    currentInitStep = "map_creation_failed";
    throw error;
  }
  window.geoxMap = map;

  osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }
  );

  satLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }
  );

  currentInitStep = "resolucion_viewport";
  currentInitStep = "aplicacion_viewport";
  window.geoxSiteConfig = siteConfig;

  // GEOFACTORY ESCALA GRÁFICA
  L.control.scale({
    position: "bottomleft",
    metric: true,
    imperial: false,
    maxWidth: 120
  }).addTo(map);

  ensureTerritorialLabelsLayer();

  map.invalidateSize();
  map.on("click", handleMapClick);
  map.on("moveend zoomend", scheduleTerritorialLabelUpdate);
  installGeoQueryViewportRestoreHandlers();
}


function showGeoQueryNotice(message) {
  const toast = document.getElementById("geoquery-toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("is-visible");

  if (geoqueryToastTimeoutId) window.clearTimeout(geoqueryToastTimeoutId);
  geoqueryToastTimeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2600);
}

function getCurrentBasemap() {
  return currentBasemap || "osm";
}

function buildGeoQueryUrl(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !map) return null;

  return `./geoquery/geoquery.html?site=geoipt` +
    `&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&zoom=${encodeURIComponent(map.getZoom())}` +
    `&basemap=${encodeURIComponent(getCurrentBasemap())}` +
    `&from=index`;
}

function openGeoQueryFromLatLng(lat, lon) {
  const queryUrl = buildGeoQueryUrl({ lat, lon });
  if (!queryUrl) return;
  const originState = captureGeoQueryOriginState({ site: SITE_ID, map, queryLat: lat, queryLon: lon, basemap: getCurrentBasemap(), from: isCrossAccessNavigationFromUrl() ? "crossaccess" : "index" });
  persistOriginStateBeforeGeoQuery(originState);
  window.location.href = appendOriginStateToGeoQueryUrl(queryUrl, originState);
}

function showToast(message) {
  if (typeof showGeoQueryNotice === "function") {
    showGeoQueryNotice(message);
    return;
  }
  console.info(message);
}

function disableClickPropagationForElement(element) {
  if (!element || !window.L || !L.DomEvent) return;
  L.DomEvent.disableClickPropagation(element);
  L.DomEvent.disableScrollPropagation(element);
}

function disableUiClickPropagation() {
  [
    "btn-my-location",
    "my-location-btn",
    "locate-btn",
    "btn-osm",
    "btn-sat",
    "territorial-panel",
    "search-box-wrapper",
    "region-selector",
    "country-selector",
    "main-footer",
    "btn-clear",
    "btn-search",
    "mobile-map-controls",
    "mobile-summary-drawer",
    "mobile-layer-toggle"
  ].forEach((id) => disableClickPropagationForElement(document.getElementById(id)));

  document.querySelectorAll(
    ".leaflet-control, .map-toggle, .search-result-item, footer a"
  ).forEach(disableClickPropagationForElement);
}

function conectarEventos() {
  disableUiClickPropagation();

  const regionSelector = document.getElementById("region-selector");

  if (regionSelector) {
    regionSelector.addEventListener("change", () => moverViewportPorRegion(regionSelector.value));
  }

  const btnOsm = document.getElementById("btn-osm");
  const btnSat = document.getElementById("btn-sat");

  if (btnOsm) {
    btnOsm.addEventListener("click", () => {
      switchBaseMap("osm");
      setMapToggleActive("osm");
    });
  }

  if (btnSat) {
    btnSat.addEventListener("click", () => {
      switchBaseMap("sat");
      setMapToggleActive("sat");
    });
  }

  document.getElementById("btn-clear").addEventListener("click", () => {
    document.getElementById("search-box").value = "";
    cerrarResultadosToSearch();
  });

  document.getElementById("btn-search").addEventListener("click", () => {
    seleccionarPrimerResultadoToSearch();
  });

  initGeoXMyLocationButton(map);
  conectarMobileSummaryDrawer();
  conectarSearchBoxToSearch();
}

function conectarMobileSummaryDrawer() {
  const mobileSummaryToggle = document.getElementById("mobile-summary-toggle");
  const mobileSummaryDrawer = document.getElementById("mobile-summary-drawer");

  if (!mobileSummaryToggle || !mobileSummaryDrawer) return;

  mobileSummaryToggle.textContent = "Summary ▼";
  mobileSummaryToggle.setAttribute("aria-expanded", "false");

  mobileSummaryToggle.addEventListener("click", () => {
    const isOpen = mobileSummaryDrawer.classList.toggle("is-open");
    mobileSummaryToggle.setAttribute("aria-expanded", String(isOpen));
    mobileSummaryToggle.textContent = isOpen ? "Summary ▲" : "Summary ▼";
  });
}

// GEOFACTORY SELECTOR REGIÓN
// CARGA regiones.json
async function cargarRegionesSelector(params = {}) {
  const selector = document.getElementById("region-selector");
  if (!selector) return;

  try {
    const response = await fetch(REGIONES_PATH);
    if (!response.ok) throw new Error(`No se pudo cargar ${REGIONES_PATH}`);

    const data = await response.json();
    regionesSelector = Array.isArray(data)
      ? data.filter((region) => region && region.activo === true)
      : [];

    if (!regionesSelector.length) {
      throw new Error(`${REGIONES_PATH} no contiene regiones activas`);
    }

    selector.innerHTML = "";
    regionesSelector.forEach((region) => {
      const option = document.createElement("option");
      option.value = String(region.codigo_ine || "");
      option.textContent = region.nombre || "Región sin nombre";
      selector.appendChild(option);
    });

    setRegionSelection(params.region_default || "13", { triggerSearch: false, changeViewport: false });
  } catch (error) {
    regionesSelector = [];
    console.warn("GEOFACTORY SELECTOR REGIÓN: regiones.json no disponible. Se mantiene el selector actual como respaldo.", error);
  }
}

function setRegionSelection(regionCode, { triggerSearch = false, changeViewport = false } = {}) {
  const selector = document.getElementById("region-selector");
  if (!selector || !regionCode) return false;
  const normalizedCode = String(regionCode).padStart(2, "0");
  const exists = Array.from(selector.options).some((option) => option.value === normalizedCode);
  if (!exists) return false;
  selector.value = normalizedCode;
  if (changeViewport) moverViewportPorRegion(normalizedCode);
  if (triggerSearch) seleccionarPrimerResultadoToSearch();
  return true;
}

// MOVER VIEWPORT POR REGIÓN
function moverViewportPorRegion(codigoIne) {
  if (!map || !codigoIne || !regionesSelector.length) return;

  const region = regionesSelector.find((item) => String(item.codigo_ine) === String(codigoIne));
  if (!region) return;

  if (Array.isArray(region.bbox) && region.bbox.length === 2) {
    map.fitBounds(region.bbox);
    return;
  }

  if (Array.isArray(region.centro) && region.centro.length === 2) {
    const zoom = Number.isFinite(Number(region.zoom)) ? Number(region.zoom) : map.getZoom();
    map.setView(region.centro, zoom);
  }
}

function setMapToggleActive(type) {
  const btnOsm = document.getElementById("btn-osm");
  const btnSat = document.getElementById("btn-sat");

  if (!btnOsm || !btnSat) return;

  btnOsm.classList.toggle("active", type === "osm");
  btnSat.classList.toggle("active", type === "sat");
}

function switchBaseMap(type) {
  if (!map) return;

  if (type === "osm") {
    if (satLayer && map.hasLayer(satLayer)) map.removeLayer(satLayer);
    if (osmLayer && !map.hasLayer(osmLayer)) osmLayer.addTo(map);
    currentBaseLayer = osmLayer;
    currentBasemap = "osm";
  }

  if (type === "sat") {
    if (osmLayer && map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
    if (satLayer && !map.hasLayer(satLayer)) satLayer.addTo(map);
    currentBaseLayer = satLayer;
    currentBasemap = "sat";
  }

  setMapToggleActive(type);
  actualizarEstiloPerimetrosIptVisibles();
  scheduleTerritorialLabelUpdate();
}

// GEOFACTORY TOSEARCH
const TOSEARCH_DIR = "capas_tosearch";
const TOSEARCH_FILE_PREFIX = "perimetros_capas_";
const TOSEARCH_FILE_COUNT = 16;
const toSearchIndice = [];
let toSearchIndicePromise = null;
let toSearchResultadosActuales = [];
let toSearchHighlightLayer = null;
let selectedPRCHighlightLayer = null;
let mapHintTimeoutId = null;
let resultadosBusquedaActual = [];
let searchActiveIndex = -1;
let puntoConsultaMarker = null;
let bloquearCierreBusquedaPorClickMapa = false;

function normalizarTextoToSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// CARGA índice nacional desde capas_tosearch/perimetros_capas_XX.geojson
async function cargarListadoToSearch() {
  if (toSearchIndice.length) return toSearchIndice;
  if (toSearchIndicePromise) return toSearchIndicePromise;

  console.log("[GeoIPT Search] cargando índice nacional capas_tosearch/");

  toSearchIndicePromise = (async () => {
    const archivos = Array.from({ length: TOSEARCH_FILE_COUNT }, (_, index) => {
      const numero = String(index + 1).padStart(2, "0");
      return `${TOSEARCH_DIR}/${TOSEARCH_FILE_PREFIX}${numero}.geojson`;
    });

    await Promise.all(archivos.map((archivo) => cargarCapaToSearch({ archivo })));

    console.log(`[GeoIPT Search] índice nacional listo | total features: ${toSearchIndice.length}`);
    return toSearchIndice;
  })();

  return toSearchIndicePromise;
}

async function cargarCapaToSearch(layerConfig) {
  const archivo = layerConfig?.archivo;
  if (!archivo) return;

  try {
    const response = await fetch(archivo);
    if (response.status === 404) {
      console.warn(`[GeoIPT Search] archivo no encontrado: ${archivo.split("/").pop()}`);
      return;
    }
    if (!response.ok) throw new Error(`No se pudo cargar ${archivo}`);

    const geojson = await response.json();
    const features = Array.isArray(geojson.features) ? geojson.features : [];

    features.forEach((feature) => agregarFeatureAlIndiceToSearch(feature, layerConfig));
    console.log(`[GeoIPT Search] archivo cargado: ${archivo.split("/").pop()} | features: ${features.length}`);
  } catch (error) {
    console.warn(`[GeoIPT Search] archivo no encontrado: ${archivo.split("/").pop()}`, error);
  }
}

// INDICE DE BUSQUEDA POR LOCALIDAD
// GEOFACTORY SEARCH CONTEXTO TERRITORIAL
function obtenerPropTexto(props, nombresCampos) {
  for (const nombre of nombresCampos) {
    const valor = props?.[nombre];
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim();
    }
  }
  return "";
}


function obtenerNombrePrc(feature) {
  const props = feature?.properties || {};
  return obtenerPropTexto(props, ["nombre_prc", "localidad", "LOC", "LOCALIDAD", "nombre", "NOMBRE"]) || "PRC sin nombre";
}

function normalizarLatLng(clickedLatLng) {
  if (!clickedLatLng) return null;
  if (Number.isFinite(clickedLatLng.lat) && Number.isFinite(clickedLatLng.lng)) return clickedLatLng;
  if (Number.isFinite(clickedLatLng.lat) && Number.isFinite(clickedLatLng.lon)) return L.latLng(clickedLatLng.lat, clickedLatLng.lon);
  if (Array.isArray(clickedLatLng) && clickedLatLng.length >= 2) return L.latLng(Number(clickedLatLng[0]), Number(clickedLatLng[1]));
  return null;
}

function obtenerLatLngRepresentativoFeature(feature, bounds) {
  if (bounds?.isValid?.()) return bounds.getCenter();
  try {
    const featureBounds = L.geoJSON(feature).getBounds();
    if (featureBounds.isValid()) return featureBounds.getCenter();
  } catch (error) {
    console.warn("No se pudo obtener punto representativo para PRC.", error);
  }
  return null;
}

function handlePRCSelection(feature, clickedLatLng, options = {}) {
  const punto = normalizarLatLng(clickedLatLng);
  if (!punto) return;

  captureSelectedPoint(punto, {
    site: SITE_ID,
    layer_id: options.layer_id || "prc",
    feature_id: feature?.properties?.id || feature?.properties?.fid || feature?.id || null,
    feature_name: obtenerNombrePrc(feature),
    source_layer: options.source || "direct"
  });
}

function puntoEnAnillo(lonLat, ring) {
  const [x, y] = lonLat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersecta = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersecta) inside = !inside;
  }
  return inside;
}

function puntoEnPoligono(lonLat, polygon) {
  if (!Array.isArray(polygon?.[0])) return false;
  if (!puntoEnAnillo(lonLat, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => puntoEnAnillo(lonLat, hole));
}

function puntoEnFeature(latLng, feature) {
  const geometry = feature?.geometry;
  if (!latLng || !geometry) return false;
  const lonLat = [latLng.lng, latLng.lat];
  if (geometry.type === "Polygon") return puntoEnPoligono(lonLat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => puntoEnPoligono(lonLat, polygon));
  return false;
}

function colocarMarcadorPunto(clickedLatLng) {
  if (!map || !clickedLatLng) return;

  if (puntoConsultaMarker && map.hasLayer(puntoConsultaMarker)) {
    map.removeLayer(puntoConsultaMarker);
  }

  puntoConsultaMarker = L.circleMarker(clickedLatLng, {
    radius: 6,
    color: "#0f172a",
    weight: 2,
    opacity: 1,
    fillColor: "#38bdf8",
    fillOpacity: 0.9
  }).addTo(map);
}

function findContainingPRCFromPerimetros(latlng) {
  const features = getPerimetrosIPTFeatures();
  if (!Array.isArray(features) || !features.length || !latlng) return null;

  if (window.turf?.point && window.turf?.booleanPointInPolygon) {
    const point = window.turf.point([latlng.lng, latlng.lat]);

    for (const feature of features) {
      try {
        if (window.turf.booleanPointInPolygon(point, feature)) {
          return feature;
        }
      } catch (err) {
        console.warn("No se pudo evaluar punto en polígono", err, feature);
      }
    }

    return null;
  }

  for (const feature of features) {
    try {
      if (puntoEnFeature(latlng, feature)) return feature;
    } catch (err) {
      console.warn("No se pudo evaluar punto en polígono", err, feature);
    }
  }

  return null;
}

function normalizarRegionGeoCard(region) {
  const digits = String(region || "").trim().replace(/\D/g, "");
  return digits ? digits.padStart(2, "0") : "";
}

function getRegionActualParaGeoCard() {
  const possibleIds = [
    "region-selector",
    "region-select",
    "regionSelector",
    "select-region",
    "region"
  ];

  for (const id of possibleIds) {
    const el = document.getElementById(id);
    const region = normalizarRegionGeoCard(el?.value);
    if (region) return region;
  }

  return normalizarRegionGeoCard(window.regionActual);
}


function getPRCArchivoFromFeature(feature) {
  const p = feature?.properties || {};
  return (
    p.archivo
    || p.file
    || p.kml
    || p.capa_kml
    || p.prc_archivo
    || p.PRC_ARCHIVO
    || ""
  );
}

function getRegionFromFeatureOrSelector(feature) {
  const props = feature?.properties || {};
  const candidates = [
    props.REG,
    props.region,
    props.REGION,
    props.cod_region,
    props.region_id,
    props.id_region
  ];

  for (const value of candidates) {
    const region = normalizarRegionGeoCard(value);
    if (region) return region;
  }

  return getRegionActualParaGeoCard();
}

function buscarItemPrcContenedor(latLng) {
  return toSearchIndice.find((item) => item?.bounds?.contains?.(latLng) && puntoEnFeature(latLng, item.feature)) || null;
}

function handleMapClick(event) {
  if (!event?.latlng) return;

  const clickedLatLng = event.latlng;
  const containingPRC = findContainingPRCFromPerimetros(clickedLatLng);

  captureSelectedPoint(clickedLatLng, containingPRC ? {
    site: SITE_ID,
    layer_id: "prc",
    feature_id: containingPRC?.properties?.id || containingPRC?.properties?.fid || containingPRC?.id || null,
    feature_name: obtenerNombrePrc(containingPRC),
    source_layer: "perimetros_ipt"
  } : null);

  openGeoQueryFromLatLng(clickedLatLng.lat, clickedLatLng.lng);
}

function getSearchInputElement() {
  return document.getElementById("search-input")
    || document.getElementById("prc-search")
    || document.getElementById("search-box");
}

function getSearchResultsElement() {
  return document.getElementById("search-results")
    || document.getElementById("prc-search-results");
}

function abrirResultadosBusqueda(contenedor = getSearchResultsElement()) {
  if (!contenedor) {
    console.warn("No existe contenedor de resultados del buscador");
    return null;
  }

  contenedor.hidden = false;
  contenedor.removeAttribute("hidden");
  contenedor.classList.add("is-visible", "is-open");
  contenedor.style.display = "block";

  return contenedor;
}

function renderFallbackResultadosCercanos(items) {
  resultadosBusquedaActual = items || [];
  searchActiveIndex = -1;

  const searchInput = getSearchInputElement();
  const searchResults = getSearchResultsElement();

  if (!searchResults) {
    console.warn("No existe contenedor de resultados del buscador.");
    return;
  }

  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }

  if (!items || !items.length) {
    searchResults.innerHTML = `
      <div class="map-search-empty search-empty search-results-message">
        No encontramos un PRC exacto en ese punto, y no hay sugerencias disponibles.
      </div>
    `;
    abrirResultadosBusqueda(searchResults);
    return;
  }

  searchResults.innerHTML = `
    <div class="map-search-empty search-empty search-results-message nearest-header" style="padding-bottom: 8px;">
      No encontramos un PRC exacto en ese punto.<br>
      Estos son los 3 PRC más cercanos:
    </div>
    ${items.map((item, idx) => {
      const meta = [item.comuna, item.region_nombre].filter(Boolean).join(" · ");
      const distancia = Number(item.distancia_km);
      const distanciaTexto = Number.isFinite(distancia)
        ? distancia.toFixed(1) + " km"
        : "distancia no disponible";
      const metaTexto = [meta, distanciaTexto].filter(Boolean).join(" · ");

      return `
        <button
          type="button"
          class="map-search-item search-result-item nearest-prc-item"
          data-index="${idx}"
        >
          <span class="map-search-title search-result-title">
            ${escapeHtml(item.nombre || "PRC sin nombre")}
          </span>
          <span class="map-search-meta search-result-meta">
            ${escapeHtml(metaTexto)}
          </span>
        </button>
      `;
    }).join("")}
  `;

  abrirResultadosBusqueda(searchResults);

  searchResults.querySelectorAll(".map-search-item, .search-result-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const item = resultadosBusquedaActual[idx];
      if (item) await seleccionarResultadoBusqueda(item, { source: "nearest" });
    });
  });
}

function bboxEsValido(bbox) {
  return (
    Array.isArray(bbox)
    && bbox.length === 2
    && Array.isArray(bbox[0])
    && Array.isArray(bbox[1])
    && bbox[0].length === 2
    && bbox[1].length === 2
    && bbox.every((par) => Array.isArray(par) && par.every((num) => Number.isFinite(Number(num))))
  );
}

function fitBoundsDesdeBbox(bbox) {
  if (!bboxEsValido(bbox) || !map) return false;

  const sw = L.latLng(Number(bbox[0][0]), Number(bbox[0][1]));
  const ne = L.latLng(Number(bbox[1][0]), Number(bbox[1][1]));
  const bounds = L.latLngBounds(sw, ne);

  if (!bounds.isValid()) return false;

  map.fitBounds(bounds, {
    padding: [30, 30],
    maxZoom: 16
  });

  return true;
}

function getBboxFromFeature(feature) {
  try {
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();

    if (!bounds || !bounds.isValid()) return null;

    return [
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()]
    ];
  } catch (err) {
    console.warn("No se pudo calcular bbox del feature", err);
    return null;
  }
}

function zoomToGeoJsonFeature(feature) {
  if (!feature || !map) return false;

  const bbox = getBboxFromFeature(feature);
  return fitBoundsDesdeBbox(bbox);
}

function centroDesdeBbox(bbox) {
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

  const dLat = Number(a.lat) - Number(b.lat);
  const dLon = Number(a.lon) - Number(b.lon);

  return Math.sqrt(dLat * dLat + dLon * dLon) * 111;
}

function obtenerPrcCercanosDesdePerimetros(lat, lon, limite = 3) {
  const origen = { lat: Number(lat), lon: Number(lon) };

  if (!Number.isFinite(origen.lat) || !Number.isFinite(origen.lon)) {
    return [];
  }

  const features = getPerimetrosIPTFeatures();

  if (!Array.isArray(features) || !features.length) {
    console.warn("No hay features de Perímetros IPT disponibles para calcular cercanos.");
    return [];
  }

  return features
    .map((feature) => {
      const props = feature.properties || {};
      const bbox = normalizarBboxPerimetro(props.bbox || feature.bbox || getBboxFromFeature(feature));
      const centro = centroDesdeBbox(bbox);

      return {
        nombre: getPRCDisplayName(feature),
        comuna: props.comuna || props.COMUNA || props.Comuna || "",
        region_nombre: props.region_nombre || props.region || props.REGION || props.Región || "",
        region_codigo: props.region_codigo || props.codigo_region || props.cod_region || "",
        archivo: props.archivo || props.file || props.kml || props.capa_kml || "",
        carpeta: props.carpeta || "",
        bbox,
        feature,
        distancia_km: centro ? distanciaAproximadaKm(origen, centro) : Infinity
      };
    })
    .filter((item) => item.nombre && bboxEsValido(item.bbox) && Number.isFinite(item.distancia_km))
    .sort((a, b) => a.distancia_km - b.distancia_km)
    .slice(0, limite);
}

function normalizarBboxPerimetro(bbox) {
  if (bboxEsValido(bbox)) return bbox;
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
    if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      return [[minLat, minLon], [maxLat, maxLon]];
    }
  }
  return null;
}

function getPerimetrosIPTFeatures() {
  if (window.perimetrosIPTData?.features) return window.perimetrosIPTData.features;
  if (window.perimetrosData?.features) return window.perimetrosData.features;
  if (Array.isArray(window.perimetrosIPTFeatures)) return window.perimetrosIPTFeatures;

  const features = [];
  panelGeojsonCargados.forEach((geojson) => {
    if (Array.isArray(geojson?.features)) features.push(...geojson.features);
  });

  return features;
}

function getPRCDisplayName(feature) {
  const p = feature?.properties || {};

  return (
    p.nombre
    || p.NOMBRE
    || p.nombre_prc
    || p.prc
    || p.PRC
    || p.instrumento
    || p.INSTRUMENTO
    || p.localidad
    || p.comuna
    || p.COMUNA
    || "PRC sin nombre"
  );
}

function limpiarNombrePrcParaResultado(nombrePrc) {
  if (!nombrePrc) return "";

  const texto = String(nombrePrc).trim();
  const matchPrc = texto.match(/(?:^|_)PRC[_\s-]+(.+)$/i);
  const base = (matchPrc ? matchPrc[1] : texto.replace(/^PRC[_\s-]+/i, "")).replace(/[_-]+/g, " ").trim();

  return base.replace(/\s+/g, " ").replace(/\b\p{L}/gu, (letra) => letra.toLocaleUpperCase("es-CL"));
}

function construirLineaResultadoToSearch({ localidad, comuna, nombrePrc, region }) {
  const localidadDisplay = localidad || comuna || limpiarNombrePrcParaResultado(nombrePrc);
  const comunaDisplay = comuna || limpiarNombrePrcParaResultado(nombrePrc);
  const partes = [];

  if (localidadDisplay) partes.push(localidadDisplay);
  if (comunaDisplay && normalizarTextoToSearch(comunaDisplay) !== normalizarTextoToSearch(localidadDisplay)) {
    partes.push(comunaDisplay);
  }
  if (region) partes.push(region);

  return partes.join(" · ") || localidadDisplay || comunaDisplay || "PRC sin nombre";
}

// RESULTADO LOCALIDAD COMUNA REGION
function construirTextoResultadoToSearch(props) {
  const nombreBusq = obtenerPropTexto(props, ["nombre_busq", "NOMBRE_BUSQ"]);
  const localidad = obtenerPropTexto(props, ["localidad", "LOC", "LOCALIDAD"]);
  const comuna = obtenerPropTexto(props, ["comuna", "COM", "COMUNA"]);
  const nombrePrc = obtenerPropTexto(props, ["nombre_prc", "PRC", "prc", "nombre", "NOMBRE"]);
  const region = obtenerPropTexto(props, ["region", "REG", "REGION", "region_nombre"]);
  const zona = obtenerPropTexto(props, ["zona", "ZONA"]);
  const textoResultado = construirLineaResultadoToSearch({ localidad, comuna, nombrePrc, region });
  const textoBusqueda = normalizarTextoToSearch(
    [nombreBusq, localidad, comuna, nombrePrc, region, zona].filter(Boolean).join(" ")
  );

  return {
    id: obtenerPropTexto(props, ["id", "ID", "fid_origen"]),
    text: nombreBusq || textoResultado,
    texto_localidad: localidad,
    texto_comuna: comuna,
    texto_nombre_prc: nombrePrc,
    texto_region: region,
    texto_zona: zona,
    texto_resultado: textoResultado,
    texto_busqueda: textoBusqueda
  };
}

function agregarFeatureAlIndiceToSearch(feature, layerConfig) {
  if (!feature) return;

  const props = feature.properties || {};
  const textosTerritoriales = construirTextoResultadoToSearch(props);
  if (!textosTerritoriales.texto_busqueda) return;

  const bounds = obtenerBoundsFeatureToSearch(feature);
  if (!bounds || !bounds.isValid()) {
    console.warn("[GeoIPT Search] geometría inválida para feature de búsqueda", props);
    return;
  }

  toSearchIndice.push({
    ...textosTerritoriales,
    nombre: textosTerritoriales.texto_localidad || textosTerritoriales.texto_nombre_prc || textosTerritoriales.texto_resultado,
    texto_display: textosTerritoriales.texto_resultado,
    feature,
    geometry: feature.geometry || null,
    source_file: layerConfig?.archivo || "",
    layer_config: layerConfig,
    bounds
  });
}

function obtenerBoundsFeatureToSearch(feature) {
  try {
    if (feature?.geometry) {
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds?.isValid?.()) return bounds;
    }

    const bbox = normalizarBboxPerimetro(feature?.bbox);
    if (bbox) return L.latLngBounds(bbox);
  } catch (error) {
    console.warn("[GeoIPT Search] geometría inválida; se intentará bbox si existe.", error);
  }

  const bbox = normalizarBboxPerimetro(feature?.bbox);
  return bbox ? L.latLngBounds(bbox) : null;
}

function getFeatureBounds(feature) {
  return obtenerBoundsFeatureToSearch(feature);
}

function conectarSearchBoxToSearch() {
  const searchBox = document.getElementById("search-box");
  if (!searchBox) return;

  searchBox.addEventListener("input", () => mostrarResultadosToSearch(searchBox.value));
  searchBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      seleccionarPrimerResultadoToSearch();
    } else if (event.key === "Escape") {
      cerrarResultadosToSearch();
    }
  });

  document.addEventListener("click", (event) => {
    if (bloquearCierreBusquedaPorClickMapa) {
      bloquearCierreBusquedaPorClickMapa = false;
      return;
    }

    const wrapper = document.getElementById("map-search-wrap")
      || document.getElementById("floating-search")
      || document.getElementById("search-box-wrapper")
      || document.querySelector(".map-search-wrap");

    if (!wrapper) return;

    if (!wrapper.contains(event.target)) cerrarResultadosToSearch();
  });
}

// RESULTADOS SEARCH BOX
function buscarResultadosToSearch(texto) {
  const query = normalizarTextoToSearch(texto);
  if (!query) return [];

  const resultados = toSearchIndice
    .filter((item) => item.texto_busqueda.includes(query))
    .sort((a, b) => a.texto_resultado.localeCompare(b.texto_resultado, "es"))
    .slice(0, 20);

  console.log(`[GeoIPT Search] búsqueda: ${texto} | resultados: ${resultados.length}`);
  return resultados;
}

function mostrarResultadosToSearch(texto) {
  const contenedor = document.getElementById("search-results");
  if (!contenedor) return;

  toSearchResultadosActuales = buscarResultadosToSearch(texto);
  contenedor.innerHTML = "";

  if (!toSearchResultadosActuales.length) {
    contenedor.hidden = true;
    contenedor.classList.remove("is-visible", "is-open");
    contenedor.style.display = "none";
    return;
  }

  toSearchResultadosActuales.forEach((item) => {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "search-result-item";
    boton.textContent = item.texto_resultado;
    boton.title = item.texto_resultado;

    boton.addEventListener("click", () => seleccionarResultadoToSearch(item));
    contenedor.appendChild(boton);
  });

  abrirResultadosBusqueda(contenedor);
}

function ocultarResultadosBusqueda() {
  resultadosBusquedaActual = [];
  toSearchResultadosActuales = [];
  searchActiveIndex = -1;

  const searchResults = getSearchResultsElement();
  if (searchResults) {
    searchResults.innerHTML = "";
    searchResults.hidden = true;
    searchResults.classList.remove("is-visible", "is-open");
    searchResults.style.display = "none";
  }
}

function cerrarResultadosToSearch() {
  ocultarResultadosBusqueda();
}

function zoomToPRCFeature(feature, options = {}) {
  if (!map || !feature) return;

  const bounds = options.bounds?.isValid?.() ? options.bounds : getFeatureBounds(feature);

  if (!bounds || !bounds.isValid || !bounds.isValid()) {
    console.warn("No se pudo obtener bounds para el PRC seleccionado", feature);
    return;
  }

  const layerConfig = options.layerConfig || {};
  const padding = Array.isArray(layerConfig.padding) ? layerConfig.padding : [36, 36];
  const maxZoom = Number.isFinite(Number(layerConfig.max_zoom)) ? Number(layerConfig.max_zoom) : 15;

  map.fitBounds(bounds, {
    padding,
    maxZoom
  });

  highlightSelectedPRC(feature);
  cerrarResultadosToSearch();
  showMapHint("PRC localizado. Haga click dentro del área para consultar.");
}

function seleccionarPrimerResultadoToSearch() {
  const searchBox = document.getElementById("search-box");
  if (!toSearchResultadosActuales.length && searchBox) {
    toSearchResultadosActuales = buscarResultadosToSearch(searchBox.value);
  }

  if (toSearchResultadosActuales.length) {
    seleccionarResultadoToSearch(toSearchResultadosActuales[0]);
  }
}

// ZOOM TO FEATURE
async function seleccionarResultadoBusqueda(item, options = {}) {
  if (!item) return;

  const searchInput = getSearchInputElement();
  if (searchInput) {
    searchInput.value = item.nombre || item.texto_localidad || item.texto_resultado || "";
  }

  console.log(`[GeoIPT Search] zoom extent a: ${[item.texto_nombre_prc, item.texto_comuna, item.texto_region].filter(Boolean).join(" / ")}`);

  ocultarResultadosBusqueda();

  let hizoFit = false;
  if (item.bbox) hizoFit = fitBoundsDesdeBbox(item.bbox);
  if (!hizoFit && item.bounds?.isValid?.()) {
    map.fitBounds(item.bounds, { padding: [40, 40], maxZoom: 15 });
    hizoFit = true;
  }
  if (!hizoFit && item.feature) hizoFit = zoomToGeoJsonFeature(item.feature);

  if (item.feature) resaltarTemporalmenteFeatureToSearch(item.feature);

  if (hizoFit && typeof setMapMarkerAtCenter === "function") {
    setMapMarkerAtCenter();
  }

  showMapHint("PRC localizado. Haga click dentro del área para consultar.");
}

function seleccionarResultadoToSearch(item, options = {}) {
  return seleccionarResultadoBusqueda(item, options);
}

// HIGHLIGHT TEMPORAL
function resaltarTemporalmenteFeatureToSearch(feature) {
  if (!map || !feature) return;

  if (toSearchHighlightLayer && map.hasLayer(toSearchHighlightLayer)) {
    map.removeLayer(toSearchHighlightLayer);
  }

  toSearchHighlightLayer = L.geoJSON(feature, {
    interactive: false,
    style: {
      color: "#f97316",
      weight: 3,
      opacity: 1,
      fillColor: "#f97316",
      fillOpacity: 0.18
    }
  }).addTo(map);

  window.setTimeout(() => {
    if (toSearchHighlightLayer && map && map.hasLayer(toSearchHighlightLayer)) {
      map.removeLayer(toSearchHighlightLayer);
    }
    toSearchHighlightLayer = null;
  }, 2000);
}

function highlightSelectedPRC(feature) {
  if (!map || !feature) return;

  if (selectedPRCHighlightLayer && map.hasLayer(selectedPRCHighlightLayer)) {
    map.removeLayer(selectedPRCHighlightLayer);
  }

  selectedPRCHighlightLayer = L.geoJSON(feature, {
    interactive: false,
    style: {
      color: "#00aeef",
      weight: 4,
      opacity: 1,
      fillColor: "#00aeef",
      fillOpacity: 0.08
    }
  }).addTo(map);

  window.setTimeout(() => {
    if (selectedPRCHighlightLayer && map && map.hasLayer(selectedPRCHighlightLayer)) {
      map.removeLayer(selectedPRCHighlightLayer);
    }
    selectedPRCHighlightLayer = null;
  }, 3500);
}

function showMapHint(message) {
  const mapElement = document.getElementById("map");
  if (!mapElement) {
    console.info(message);
    return;
  }

  let hint = document.getElementById("map-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "map-hint";
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    mapElement.appendChild(hint);
  }

  hint.textContent = message;
  hint.classList.add("is-visible");

  if (mapHintTimeoutId) window.clearTimeout(mapHintTimeoutId);
  mapHintTimeoutId = window.setTimeout(() => {
    hint.classList.remove("is-visible");
  }, 3500);
}

// --- Summary: carga y cálculo de indicadores ---
let summaryConfig = null;
let summaryFeatures = {}; // { layerId: [feature, ...] }

async function cargarSummaryConfigYCapas() {
  const PATH = "capas_summary/summary_config.json";
  try {
    const resp = await fetch(PATH);
    if (!resp.ok) throw new Error("no existe summary_config.json");
    summaryConfig = await resp.json();

    if (!summaryConfig.activo || !Array.isArray(summaryConfig.capas)) return;

    // Cargar cada archivo GeoJSON definido
    const promises = summaryConfig.capas.map(async (capa) => {
      try {
        const r = await fetch(capa.archivo);
        if (!r.ok) throw new Error(`No se pudo cargar ${capa.archivo}`);
        const gj = await r.json();
        summaryFeatures[capa.id] = Array.isArray(gj.features) ? gj.features : [];
      } catch (e) {
        console.warn("Error cargando capa summary:", capa.archivo, e);
        summaryFeatures[capa.id] = [];
      }
    });

    await Promise.all(promises);
  } catch (e) {
    summaryConfig = null;
    summaryFeatures = {};
    // no propagar el error: mantenemos el sitio funcional sin summary
    console.info("Summary no disponible:", e.message);
  }
}

function calcularYActualizarIndicadores() {
  if (!summaryConfig || !Array.isArray(summaryConfig.indicadores)) return;
  if (!map) return;

  const bounds = map.getBounds();
  const indicadores = summaryConfig.indicadores;

  const resultados = indicadores.map((ind) => {
    let value = 0;
    const capas = Array.isArray(ind.capas) ? ind.capas : [];

    if (ind.operacion === "count") {
      let contador = 0;
      capas.forEach((layerId) => {
        const feats = summaryFeatures[layerId] || [];
        feats.forEach((f) => {
          if (f && f.geometry && f.geometry.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            if (bounds.contains(L.latLng(lat, lng))) contador++;
          }
        });
      });
      value = contador;
    } else if (ind.operacion === "sum") {
      let suma = 0;
      const campo = ind.campo;
      capas.forEach((layerId) => {
        const feats = summaryFeatures[layerId] || [];
        feats.forEach((f) => {
          if (f && f.geometry && f.geometry.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            if (bounds.contains(L.latLng(lat, lng))) {
              const raw = f.properties ? f.properties[campo] : undefined;
              const num = Number(raw);
              if (!isNaN(num)) suma += num;
            }
          }
        });
      });
      value = suma;
    } else if (ind.operacion === "unique_count") {
      const campo = ind.campo;
      const set = new Set();
      capas.forEach((layerId) => {
        const feats = summaryFeatures[layerId] || [];
        feats.forEach((f) => {
          if (f && f.geometry && f.geometry.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            if (bounds.contains(L.latLng(lat, lng))) {
              const raw = f.properties ? f.properties[campo] : undefined;
              if (raw !== null && raw !== undefined && String(raw).trim() !== "") set.add(String(raw));
            }
          }
        });
      });
      value = set.size;
    }

    // formateo
    let mostrar = 0;
    if (ind.operacion === "sum" && typeof value === "number") {
      if (typeof ind.decimales === "number") {
        mostrar = value.toLocaleString(undefined, { minimumFractionDigits: ind.decimales, maximumFractionDigits: ind.decimales });
      } else {
        mostrar = Number(value).toLocaleString();
      }
    } else {
      mostrar = value;
    }

    if (ind.sufijo) mostrar = `${mostrar} ${ind.sufijo}`;

    return { id: ind.id, label: ind.label, value: mostrar };
  });

  // Actualizar #summary-bar y el drawer mobile desde la misma fuente de datos.
  actualizarSummaryEnDom(resultados);
}
// GEOFACTORY PANEL TERRITORIAL
const PANEL_CAPAS_PATH = "capas_panel/listado_capas.json";
let panelCapasListado = [];
let panelPerimetrosActivo = false;
const panelCapasCargadas = new Map();
// ETIQUETAS DINÁMICAS PANEL TERRITORIAL
const panelGeojsonCargados = new Map();
let territorialLabelsLayer = null;
let territorialLabelsUpdateTimer = null;
const DEFAULT_LABEL_DENSITY_CONFIG = {
  maxLabels: Number.POSITIVE_INFINITY,
  minZoom: 0,
  debounceMs: 200
};
const TERRITORIAL_LABELS_PANE = "territorial-labels-pane";
const TERRITORIAL_LABEL_FIELDS = ["LOC", "LOCALIDAD", "SECTOR", "COMUNA"];
const panelCapasEnCarga = new Set();

// ESTILO DINÁMICO SEGÚN BASEMAP
function obtenerEstiloPerimetrosSegunBase(itemStyle = {}) {
  const estiloBase = { ...itemStyle };

  if (currentBaseLayer === satLayer) {
    return {
      ...estiloBase,
      color: "#ffe600",
      weight: 3,
      opacity: 1,
      fillColor: "#ffe600",
      fillOpacity: 0.08
    };
  }

  return {
    ...estiloBase,
    color: "#ff6600",
    fillColor: "#ff6600"
  };
}

function actualizarEstiloPerimetrosIptVisibles() {
  if (!map) return;

  panelCapasCargadas.forEach((layer, id) => {
    if (!map.hasLayer(layer) || typeof layer.setStyle !== "function") return;

    const item = panelCapasListado.find((capa) => capa.id === id);
    const itemStyle = item && item.style ? item.style : {};
    layer.setStyle(obtenerEstiloPerimetrosSegunBase(itemStyle));
  });
}

// CARGA listado_capas.json
async function cargarListadoPanelTerritorial() {
  try {
    const response = await fetch(PANEL_CAPAS_PATH);
    if (!response.ok) throw new Error(`No se pudo cargar ${PANEL_CAPAS_PATH}`);
    const data = await response.json();
    panelCapasListado = Array.isArray(data) ? data : [];
  } catch (error) {
    panelCapasListado = [];
    console.warn("GEOFACTORY PANEL TERRITORIAL: listado_capas.json no disponible.", error);
  }
}

function iniciarPanelTerritorial() {
  const toggle = document.getElementById("toggle-perimetros-ipt");
  const mobileToggle = document.getElementById("mobile-layer-toggle");
  if (!map) return;

  if (toggle) {
    toggle.addEventListener("change", () => {
      alternarPerimetrosIpt(toggle.checked);
    });
  }

  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => {
      alternarPerimetrosIpt(!panelPerimetrosActivo);
    });
  }

  panelPerimetrosActivo = toggle ? Boolean(toggle.checked) : false;
  sincronizarControlesPerimetrosIpt();
  actualizarPerimetrosIptVisibles();

  map.on("moveend zoomend", () => {
    actualizarPerimetrosIptVisibles();
  });

  window.addEventListener("resize", scheduleTerritorialLabelUpdate);
}


function alternarPerimetrosIpt(activo) {
  panelPerimetrosActivo = Boolean(activo);
  sincronizarControlesPerimetrosIpt();

  // ON/OFF del panel territorial: solo etiquetas. La geometría IPT permanece visible.
  actualizarPerimetrosIptVisibles();
  scheduleTerritorialLabelUpdate();
}


function getMobileLabelEyeIcon(isVisible) {
  if (isVisible) {
    return `<svg class="mobile-layer-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>`;
  }
  return `<svg class="mobile-layer-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2.5 12s3.5-6 9.5-6c2.1 0 3.9.72 5.36 1.7M21.5 12s-3.5 6-9.5 6c-2.1 0-3.9-.72-5.36-1.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 9.8A3 3 0 0 1 14.2 14.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
}

function sincronizarControlesPerimetrosIpt() {
  const toggle = document.getElementById("toggle-perimetros-ipt");
  const mobileToggle = document.getElementById("mobile-layer-toggle");

  if (toggle) {
    toggle.checked = panelPerimetrosActivo;
  }

  if (!mobileToggle) return;

  mobileToggle.classList.toggle("is-active", panelPerimetrosActivo);
  mobileToggle.classList.toggle("is-inactive", !panelPerimetrosActivo);
  mobileToggle.setAttribute("aria-pressed", String(panelPerimetrosActivo));

  const accion = panelPerimetrosActivo ? "Ocultar" : "Mostrar";
  const etiqueta = `${accion} etiquetas IPT`;
  mobileToggle.setAttribute("aria-label", etiqueta);
  mobileToggle.setAttribute("title", etiqueta);

  const icono = mobileToggle.querySelector(".mobile-layer-toggle-icon");
  if (icono) icono.innerHTML = getMobileLabelEyeIcon(panelPerimetrosActivo);
}

// FILTRO BBOX VIEWPORT
function bboxIntersectaViewport(bbox, bounds) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return true;
  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return true;

  return maxLon >= bounds.getWest()
    && minLon <= bounds.getEast()
    && maxLat >= bounds.getSouth()
    && minLat <= bounds.getNorth();
}

function obtenerCapasPanelCandidatas() {
  if (!map) return [];
  const bounds = map.getBounds();
  return panelCapasListado.filter((item) => bboxIntersectaViewport(item.bbox, bounds));
}

async function actualizarPerimetrosIptVisibles() {
  if (!map) {
    scheduleTerritorialLabelUpdate();
    return;
  }

  const candidatas = obtenerCapasPanelCandidatas();

  // Las geometrías IPT ya cargadas permanecen en el mapa; la interacción solo afecta etiquetas.

  await Promise.all(candidatas.map((item) => cargarCapaPanelSiCorresponde(item)));
  scheduleTerritorialLabelUpdate();
}

// CARGA DINÁMICA GEOJSON
async function cargarCapaPanelSiCorresponde(item) {
  if (!item || !item.id || !item.archivo || !map) return;

  const capaExistente = panelCapasCargadas.get(item.id);
  if (capaExistente) {
    capaExistente.setStyle(obtenerEstiloPerimetrosSegunBase(item.style || {}));
    if (!map.hasLayer(capaExistente)) capaExistente.addTo(map);
    return;
  }

  if (panelCapasEnCarga.has(item.id)) return;
  panelCapasEnCarga.add(item.id);

  try {
    const response = await fetch(item.archivo);
    if (!response.ok) throw new Error(`No se pudo cargar ${item.archivo}`);
    const geojson = await response.json();
    const layer = L.geoJSON(geojson, {
      style: obtenerEstiloPerimetrosSegunBase(item.style || {}),
      interactive: false
    });
    panelCapasCargadas.set(item.id, layer);
    panelGeojsonCargados.set(item.id, geojson);
    if (bboxIntersectaViewport(item.bbox, map.getBounds())) {
      layer.addTo(map);
    }
  } catch (error) {
    console.warn("GEOFACTORY PANEL TERRITORIAL: error cargando GeoJSON regional.", item.archivo, error);
  } finally {
    panelCapasEnCarga.delete(item.id);
  }
}

function removerTodosPerimetrosIpt() {
  // La geometría del panel territorial no se remueve desde los toggles.
  scheduleTerritorialLabelUpdate();
}



function normalizeTerritorialFieldName(fieldName) {
  return String(fieldName || "").trim().toUpperCase();
}

function ensureTerritorialLabelsLayer() {
  if (!map) return null;

  if (!map.getPane(TERRITORIAL_LABELS_PANE)) {
    const pane = map.createPane(TERRITORIAL_LABELS_PANE);
    pane.style.zIndex = 650;
    pane.style.pointerEvents = "none";
  }

  if (!territorialLabelsLayer) territorialLabelsLayer = L.layerGroup().addTo(map);
  return territorialLabelsLayer;
}

function getFeatureLabelText(feature) {
  const props = feature?.properties || {};
  const normalizedFields = new Map();

  Object.keys(props).forEach((field) => {
    normalizedFields.set(normalizeTerritorialFieldName(field), field);
  });

  for (const field of TERRITORIAL_LABEL_FIELDS) {
    const originalField = normalizedFields.get(normalizeTerritorialFieldName(field));
    if (!originalField) continue;

    const value = props[originalField];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return null;
}

function layerIntersectsViewport(layer, mapBounds) {
  if (!layer || !mapBounds) return false;

  if (typeof layer.getLatLng === "function") {
    const latlng = layer.getLatLng();
    return latlng ? mapBounds.contains(latlng) : false;
  }

  if (typeof layer.getBounds === "function") {
    const bounds = layer.getBounds();
    return bounds?.isValid?.() ? bounds.intersects(mapBounds) : false;
  }

  return false;
}

function getVisibleLabelLatLng(layer, leafletMap) {
  if (!layer || !leafletMap) return null;

  const mapBounds = leafletMap.getBounds();

  if (typeof layer.getLatLng === "function") {
    const latlng = layer.getLatLng();
    return latlng && mapBounds.contains(latlng) ? latlng : null;
  }

  if (typeof layer.getBounds !== "function") return null;

  const layerBounds = layer.getBounds();
  if (!layerBounds?.isValid?.() || !layerBounds.intersects(mapBounds)) return null;

  const center = layerBounds.getCenter();
  if (mapBounds.contains(center)) return center;

  const south = Math.max(layerBounds.getSouth(), mapBounds.getSouth());
  const north = Math.min(layerBounds.getNorth(), mapBounds.getNorth());
  const west = Math.max(layerBounds.getWest(), mapBounds.getWest());
  const east = Math.min(layerBounds.getEast(), mapBounds.getEast());

  if (south > north || west > east) return null;
  return L.latLng((south + north) / 2, (west + east) / 2);
}

function createTerritorialLabelMarker(labelText, latlng) {
  if (!labelText || !latlng) return null;

  return L.marker(latlng, {
    pane: TERRITORIAL_LABELS_PANE,
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: "territorial-label",
      html: escapeHtml(labelText),
      iconSize: null
    })
  });
}

async function cargarLabelDensityConfig() {
  if (window.GeoXLabelGrid && typeof GeoXLabelGrid.loadCapacityConfig === "function") {
    const labelConfig = await GeoXLabelGrid.loadCapacityConfig("capas_panel/label_capacity_config.json");
    console.log("[GeoIPT Labels] config", labelConfig);
  }
}

function getLabelDensityMaxLabels() {
  return DEFAULT_LABEL_DENSITY_CONFIG.maxLabels;
}

function buildGeoIptLabelBox(candidate) {
  const point = candidate?.point;
  if (!point) return null;
  const textLength = String(candidate.text || "").length;
  const width = Math.max(46, Math.min(280, textLength * 7.5 + 20));
  const height = 24;
  return {
    left: point.x - width / 2,
    right: point.x + width / 2,
    top: point.y - height / 2,
    bottom: point.y + height / 2
  };
}

function getLabelDensityMinZoom() {
  return DEFAULT_LABEL_DENSITY_CONFIG.minZoom;
}

function getLabelDensityDebounceMs() {
  return DEFAULT_LABEL_DENSITY_CONFIG.debounceMs;
}

function updateTerritorialLabels() {
  if (!map) return;

  ensureTerritorialLabelsLayer();
  territorialLabelsLayer.clearLayers();

  if (!panelPerimetrosActivo) return;
  if (map.getZoom() < getLabelDensityMinZoom()) return;

  const maxLabels = getLabelDensityMaxLabels();
  const mapBounds = map.getBounds();
  const labelCandidates = [];

  for (const item of panelCapasListado) {
    const panelLayer = panelCapasCargadas.get(item.id);
    if (!panelLayer || !map.hasLayer(panelLayer)) continue;

    panelLayer.eachLayer((featureLayer) => {
      if (!layerIntersectsViewport(featureLayer, mapBounds)) return;

      const labelText = getFeatureLabelText(featureLayer.feature);
      if (!labelText) return;

      const latlng = getVisibleLabelLatLng(featureLayer, map);
      if (!latlng || !mapBounds.contains(latlng)) return;

      const props = featureLayer.feature?.properties || {};
      labelCandidates.push({
        latlng,
        text: labelText,
        id: props.id ?? props.fid ?? props.fid_origen ?? `${item.id}-${labelCandidates.length}`,
        originalIndex: labelCandidates.length
      });
    });
  }

  const labelsToRender = window.GeoXLabelGrid && typeof GeoXLabelGrid.selectLabels === "function"
    ? GeoXLabelGrid.selectLabels(map, labelCandidates, { estimateLabelBox: buildGeoIptLabelBox })
    : labelCandidates.slice(0, maxLabels);

  labelsToRender.slice(0, maxLabels).forEach((label) => {
    const marker = createTerritorialLabelMarker(label.text, label.latlng);
    if (marker) marker.addTo(territorialLabelsLayer);
  });

  logGeoIptLabelCapacity(labelCandidates, labelsToRender);
}

function logGeoIptLabelCapacity(candidates, drawn) {
  if (!map || !(window.GeoXLabelGrid && typeof GeoXLabelGrid.pxAreaToCm2 === "function")) return;

  const size = map.getSize();
  const cellWidth = size.x / 3;
  const cellHeight = size.y / 3;
  const cells = Array.from({ length: 9 }, () => ({ candidates: 0, drawn: 0 }));

  const addToCell = (label, key) => {
    const point = map.latLngToContainerPoint(label.latlng);
    if (!point || point.x < 0 || point.y < 0 || point.x > size.x || point.y > size.y) return;
    const col = Math.min(2, Math.max(0, Math.floor(point.x / cellWidth)));
    const row = Math.min(2, Math.max(0, Math.floor(point.y / cellHeight)));
    cells[row * 3 + col][key] += 1;
  };

  candidates.forEach((label) => addToCell(label, "candidates"));
  drawn.forEach((label) => addToCell(label, "drawn"));

  const maxLabels = Math.floor(GeoXLabelGrid.pxAreaToCm2(cellWidth, cellHeight) * GeoXLabelGrid.getLabelsPerCm2());
  cells.forEach((cell, index) => {
    const effectiveMax = cell.candidates > 0 ? Math.max(1, maxLabels) : maxLabels;
    console.log(`[GeoIPT Labels] celda ${index + 1} | candidatos: ${cell.candidates} | maxLabels: ${effectiveMax} | dibujadas: ${cell.drawn}`);
  });
  console.log(`[GeoIPT Labels] total candidatas: ${candidates.length}`);
  console.log(`[GeoIPT Labels] total dibujadas: ${drawn.length}`);
}

function scheduleTerritorialLabelUpdate() {
  if (territorialLabelsUpdateTimer) window.clearTimeout(territorialLabelsUpdateTimer);

  territorialLabelsUpdateTimer = window.setTimeout(() => {
    territorialLabelsUpdateTimer = null;
    updateTerritorialLabels();
  }, getLabelDensityDebounceMs());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

(function initGeoFactoryIntroModal() {
  const MODAL_CONFIG_PATH = "./parametros/log-modal.json";
  const MODAL_CONFIG_FALLBACK_PATH = "./assets/log-modal.json";

  async function loadModalConfig() {
    const response = await fetch(MODAL_CONFIG_PATH);
    if (response.ok) return response.json();

    const fallbackResponse = await fetch(MODAL_CONFIG_FALLBACK_PATH);
    if (!fallbackResponse.ok) throw new Error(`No se pudo cargar ${MODAL_CONFIG_PATH}`);
    return fallbackResponse.json();
  }

  function ensureModalStyles() {
    if (document.getElementById("geofactory-intro-modal-styles")) return;

    const style = document.createElement("style");
    style.id = "geofactory-intro-modal-styles";
    style.textContent = `
      .geofactory-intro-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(3,7,18,.68)}
      .geofactory-intro-modal{width:min(92vw,560px);max-height:90vh;overflow-y:auto;border-radius:18px;background:#fff;color:#071225;padding:24px;box-shadow:0 28px 80px rgba(0,0,0,.38);text-align:center;font-family:inherit}
      .geofactory-intro-image{display:block;width:100%;max-width:480px;height:auto;margin:0 auto 20px;border-radius:12px}
      .geofactory-intro-actions{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
      .geofactory-intro-button{border:0;border-radius:12px;padding:14px 26px;background:#071225;color:#fff;font-weight:800;font-size:.95rem;cursor:pointer;box-shadow:0 12px 28px rgba(7,18,37,.22)}
      .geofactory-intro-button:hover{transform:translateY(-1px)}
      .geofactory-intro-button:focus-visible,.geofactory-intro-check input:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:3px}
      .geofactory-intro-check{display:inline-flex;align-items:center;gap:8px;color:#4b5563;font-size:.95rem;cursor:pointer}
      .geofactory-intro-check input{width:16px;height:16px}
      @media(max-width:640px){.geofactory-intro-overlay{padding:12px}.geofactory-intro-modal{width:min(94vw,420px);padding:20px;border-radius:16px}.geofactory-intro-actions{flex-direction:column;gap:12px}.geofactory-intro-button{width:100%}.geofactory-intro-image{max-width:100%;margin-bottom:18px}}
    `;
    document.head.appendChild(style);
  }

  function localStorageHas(storageKey) {
    return Boolean(storageKey && window.localStorage.getItem(storageKey));
  }

  function buildModal(modalIntro) {
    const imageConfig = modalIntro.imagen || {};
    const imageSrc = `${imageConfig.ruta || ""}${imageConfig.archivo || ""}`;
    if (!imageSrc) return null;

    const existingHardcodedOverlay = document.getElementById("geoipt-intro-overlay");
    if (existingHardcodedOverlay) existingHardcodedOverlay.remove();

    const overlay = document.createElement("div");
    overlay.className = "geofactory-intro-overlay";

    const modal = document.createElement("div");
    modal.className = "geofactory-intro-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Modal introductorio");

    const image = document.createElement("img");
    image.className = "geofactory-intro-image";
    image.src = imageSrc;
    image.alt = imageConfig.alt || "Instrucciones de uso";

    const actions = document.createElement("div");
    actions.className = "geofactory-intro-actions";

    const button = document.createElement("button");
    button.className = "geofactory-intro-button";
    button.type = "button";
    button.textContent = modalIntro.botonTexto || "Comenzar";

    const label = document.createElement("label");
    label.className = "geofactory-intro-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";

    label.append(checkbox, document.createTextNode("No volver a mostrar"));
    actions.append(button, label);
    modal.append(image, actions);
    overlay.appendChild(modal);

    button.addEventListener("click", () => {
      if (checkbox.checked && modalIntro.storageKey) {
        window.localStorage.setItem(modalIntro.storageKey, "true");
      }
      overlay.remove();
    });

    return overlay;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (isCrossAccessNavigationFromUrl()) {
        const existingHardcodedOverlay = document.getElementById("geoipt-intro-overlay");
        if (existingHardcodedOverlay) existingHardcodedOverlay.remove();
        return;
      }

      const config = await loadModalConfig();
      const modalIntro = config && config.modalIntro;
      if (!modalIntro || modalIntro.activo !== true || localStorageHas(modalIntro.storageKey)) return;

      ensureModalStyles();
      const modal = buildModal(modalIntro);
      if (modal) document.body.appendChild(modal);
    } catch (error) {
      console.warn("GeoFactory modal inicial no disponible.", error);
    }
  });
})();
