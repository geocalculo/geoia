/************************************************************
 * GeoFactory / GeoX - geo-card.js (GeoQuery)
 *
 * PASO 1: Regiones cuyo BBOX toca la pantalla
 * PASO 2: IPT cuyo BBOX toca la pantalla
 * PASO 3: IPT cuya GEOMETRÍA contiene el clic
 * PASO 4: Si hay IPT → habilitar KML / metadata
 *         Si no hay  → mensaje de diagnóstico en GeoCard
 *
 * Tracking:
 *  - geoipt_consulta_iniciada
 *  - geoipt_resultado_ok
 *  - geoipt_resultado_vacio
 *  - download_kml
 *  - click_minvu_expediente
 ************************************************************/

const NO_MATCH_DELAY_MS = 0;

/* ---------------------------------------------
   1) PARÁMETROS DE LA URL
--------------------------------------------- */
const urlParams = new URLSearchParams(window.location.search);
const lat = parseFloat(urlParams.get("lat"));
const lon = parseFloat(urlParams.get("lon"));
const bboxParam = urlParams.get("bbox");
const regionParam = normalizarRegionId(urlParams.get("region"));
const sitioParam = (urlParams.get("sitio") || "GeoIPT").trim();
const zoomParam = parseInt(urlParams.get("zoom"), 10);
const zoom = Number.isFinite(zoomParam) ? zoomParam : 14;
const dominioPrc = urlParams.get("dominio_prc") === "1";
const prcNombreParam = urlParams.get("prc_nombre") || "";
const prcArchivoParam = urlParams.get("prc_archivo") || urlParams.get("capa_kml") || "";

let btnKml = null;
let matchLayer = null;
let featuresSeleccionadas = [];

window.dataLayer = window.dataLayer || [];

function cleanTrackingValue(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  return v && v !== "–" ? v : "";
}

function getTrackingMetadata() {
  const reg = cleanTrackingValue(document.getElementById("md-reg")?.textContent || "");
  const com = cleanTrackingValue(document.getElementById("md-com")?.textContent || "");
  const capa = cleanTrackingValue(document.getElementById("md-capa")?.textContent || "");

  const meta = {
    site: "geoipt",
    page: "geo-card"
  };

  if (reg) meta.region = reg;
  if (com) meta.comuna = com;
  if (capa) meta.prc = capa;
  if (!Number.isNaN(lat)) meta.lat = Number(lat.toFixed(6));
  if (!Number.isNaN(lon)) meta.lon = Number(lon.toFixed(6));
  if (bboxParam) meta.bbox = bboxParam;
  if (regionParam) meta.region_param = regionParam;
  if (sitioParam) meta.sitio = sitioParam;

  return meta;
}

function pushDataLayer(eventName, extra = {}) {
  window.dataLayer = window.dataLayer || [];

  const payload = {
    event: eventName,
    ...getTrackingMetadata(),
    ...extra
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
      delete payload[key];
    }
  });

  window.dataLayer.push(payload);
}

function trackResultadoOk(extra = {}) {
  pushDataLayer("geoipt_resultado_ok", extra);
}

function trackResultadoVacio(reason) {
  pushDataLayer("geoipt_resultado_vacio", {
    reason: reason || "sin_resultados"
  });
}

function trackDownloadKml(triggerType, extra = {}) {
  pushDataLayer("download_kml", {
    trigger: triggerType === "link" ? "link" : "button",
    download_method: "blob_anchor",
    ...extra
  });
}

function trackMinvuExpediente(extra = {}) {
  pushDataLayer("click_minvu_expediente", extra);
}

function trackConsultaIniciada() {
  pushDataLayer("geoipt_consulta_iniciada", {
    zoom: Number.isFinite(zoom) ? zoom : undefined
  });
}

function appendAttributionParams(targetUrl) {
  const incoming = new URLSearchParams(window.location.search);
  [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gclid",
    "fbclid"
  ].forEach((paramName) => {
    const value = incoming.get(paramName);
    if (value) {
      targetUrl.searchParams.set(paramName, value);
    }
  });
}


function initVolverMapaButton() {
  const btn = document.getElementById("btn-volver-mapa");
  if (!btn) return;

  const target = new URL("index.html", window.location.href);
  if (Number.isFinite(lat)) target.searchParams.set("lat", lat.toFixed(6));
  if (Number.isFinite(lon)) target.searchParams.set("lon", lon.toFixed(6));
  if (Number.isFinite(zoom)) target.searchParams.set("zoom", String(zoom));
  appendAttributionParams(target);
  btn.href = `${target.pathname.split("/").pop()}${target.search}`;
}

function initKmlButton() {
  btnKml = document.getElementById("btn-kml");
  if (!btnKml) return;

  btnKml.disabled = true;
  btnKml.classList.remove("is-ready");

  btnKml.addEventListener("click", () => {
    if (!featuresSeleccionadas || !featuresSeleccionadas.length) return;
    descargarKmlZona("button");
  });
}

function setPdfButtonEnabled(enabled) {
  const btn = document.getElementById("btn-export-pdf");
  if (!btn) return;

  btn.disabled = !enabled;
  btn.classList.toggle("pdf-btn-disabled", !enabled);

  if (enabled) {
    btn.textContent = "📄 Descargar PDF";
    btn.title = "Descargar reporte PDF";
  } else {
    btn.textContent = "📄 PDF no disponible";
    btn.title = "PDF no disponible para esta consulta";
  }
}

function setupPdfButtonActions() {
  const btn = document.getElementById("btn-export-pdf");
  if (!btn || btn.dataset.pdfHandlerReady === "1") return;

  btn.dataset.pdfHandlerReady = "1";
  btn.addEventListener("click", exportarPdfGeoCard);
  setPdfButtonEnabled(false);
}

let bboxPantalla = null;
if (bboxParam) {
  bboxPantalla = normalizarBBoxA_NESW(bboxParam);
}


if (!bboxPantalla && Number.isFinite(lat) && Number.isFinite(lon)) {
  const delta = 0.05;
  bboxPantalla = [
    lat + delta,
    lon + delta,
    lat - delta,
    lon - delta
  ];
  console.warn("[GeoCard] bbox no informado. Usando bbox fallback alrededor del POI:", bboxPantalla);
}

function escapeGeoCardStatusText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setEstadoGeoCard(texto, tipo = "ok") {
  const el = document.getElementById("rp-estado");
  if (!el) return;

  el.textContent = texto;
  el.classList.remove("status-ok", "status-warn", "status-error");

  if (tipo === "warn") el.classList.add("status-warn");
  else if (tipo === "error") el.classList.add("status-error");
  else el.classList.add("status-ok");
}

function normalizarTextoZona(zona, nombre) {
  const nombreTexto = String(nombre || "").trim();
  const zonaTexto = String(zona || "").trim();

  if (!nombreTexto && !zonaTexto) return "zona normativa";
  if (!nombreTexto || nombreTexto === "–") return zonaTexto || "zona normativa";
  if (/^zona\b/i.test(nombreTexto)) return nombreTexto;

  return `${zonaTexto} ${nombreTexto}`.trim();
}

function limpiarFraseGeoCard(texto) {
  return String(texto || "")
    .replace(/\bzona\s+zona\b/gi, "zona")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/([.!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function setMensajeKml(texto) {
  const msg = document.getElementById("msg-kml");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.style.display = texto ? "block" : "none";
}

function mostrarEstadoGeoCard(titulo, mensaje) {
  console.warn("[GeoCard]", titulo, mensaje);

  const statusBox =
    document.getElementById("geo-card-status") ||
    document.getElementById("msg-kml") ||
    null;

  if (statusBox) {
    statusBox.style.display = "block";
    statusBox.innerHTML = `
      <strong>${escapeGeoCardStatusText(titulo)}</strong><br>
      ${escapeGeoCardStatusText(mensaje)}
    `;
  } else {
    alert(`${titulo}\n\n${mensaje}`);
  }
}

function bboxDesdeMapaActual() {
  const bounds = map.getBounds();
  return [bounds.getNorth(), bounds.getEast(), bounds.getSouth(), bounds.getWest()];
}

function textoFuenteDominioPrc(candidatos = []) {
  const primero = candidatos.find((ipt) => ipt?.archivo || ipt?.nombre || ipt?.carpeta) || {};
  const fuenteCandidato = [primero.carpeta, primero.archivo].filter(Boolean).join("/") || primero.nombre || "";
  return prcNombreParam || prcArchivoParam || fuenteCandidato || "PRC candidato";
}

function poblarEncabezadoDominioPrc(candidatos = []) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "–";
  };

  set("rp-punto", "Punto dentro de PRC");
  set("rp-coords", `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`);
  set("rp-zona", "Sin zona normativa exacta");
  set("rp-fuente", textoFuenteDominioPrc(candidatos));
  setEstadoGeoCard("Dentro de dominio PRC", "warn");
}

/* ---------------------------------------------
   2) MAPA LEAFLET
--------------------------------------------- */
const GEOQUERY_PATHS = {
  legacyCapas: "capas",
  analysisCapas: "capas_card",
  parametros: "parametros",
  fichas: "fichas_html"
};

const geoQueryState = {
  sitio: sitioParam || "GeoIPT",
  region: regionParam || "",
  analysisRadiusM: 1000,
  reglasTopologicas: null,
  lastIptCandidates: [],
  lastMatches: []
};

const hasValidPoi = Number.isFinite(lat) && Number.isFinite(lon);

const map = L.map("map", {
  preferCanvas: true
}).setView(
  hasValidPoi ? [lat, lon] : [-27, -70],
  zoom
);

window.geoIptMap = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  crossOrigin: true
}).addTo(map);

initVolverMapaButton();
initKmlButton();

if (hasValidPoi) {
  const marker = L.marker([lat, lon]).addTo(map);

  marker.bindPopup(
    `<strong>Punto consultado</strong><br>` +
    `Lat: ${lat.toFixed(6)}<br>` +
    `Lon: ${lon.toFixed(6)}`
  ).openPopup();
}

map.on("click", function (e) {
  const latClick = e.latlng.lat;
  const lonClick = e.latlng.lng;
  const bounds = map.getBounds();
  const N = bounds.getNorth();
  const E = bounds.getEast();
  const S = bounds.getSouth();
  const W = bounds.getWest();
  const zoomClick = map.getZoom();

  const bboxStr = `${N},${E},${S},${W}`;

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const nuevaUrl =
    `${baseUrl}?lat=${latClick}&lon=${lonClick}` +
    `&zoom=${zoomClick}&bbox=${bboxStr}` +
    `&sitio=${encodeURIComponent(geoQueryState.sitio)}` +
    (geoQueryState.region ? `&region=${encodeURIComponent(geoQueryState.region)}` : "");

  window.open(nuevaUrl, "_blank");
});

/* ---------------------------------------------
   UTILIDADES DE BBOX
--------------------------------------------- */
function normalizarRegionId(region) {
  if (!region) return "";
  const clean = String(region).trim().replace(/\D/g, "");
  if (!clean) return "";
  return clean.padStart(2, "0");
}

function getRegionUrlParam() {
  return normalizarRegionId(urlParams.get("region"));
}

function normalizarBBoxA_NESW(bbox) {
  if (!bbox) return null;

  if (typeof bbox === "string") {
    bbox = bbox.split(",").map(Number);
  }

  if (
    Array.isArray(bbox) &&
    bbox.length === 2 &&
    Array.isArray(bbox[0]) &&
    Array.isArray(bbox[1])
  ) {
    const sw = bbox[0];
    const ne = bbox[1];
    const south = Number(sw[0]);
    const west = Number(sw[1]);
    const north = Number(ne[0]);
    const east = Number(ne[1]);

    if ([north, east, south, west].every(Number.isFinite)) {
      return [north, east, south, west];
    }
  }

  if (Array.isArray(bbox) && bbox.length === 4) {
    const a = bbox.map(Number);
    if (!a.every(Number.isFinite)) return null;

    const [v0, v1, v2, v3] = a;

    if (v0 > v2 && v1 > v3) {
      return [v0, v1, v2, v3];
    }

    if (v2 > v0 && v3 > v1) {
      const west = v0;
      const south = v1;
      const east = v2;
      const north = v3;
      return [north, east, south, west];
    }
  }

  console.warn("[GeoCard] BBOX no reconocido:", bbox);
  return null;
}

function intersectaBbox(a, b) {
  if (!a || !b) return false;
  const [N1, E1, S1, W1] = a;
  const [N2, E2, S2, W2] = b;
  return !(S1 > N2 || N1 < S2 || W1 > E2 || E1 < W2);
}

function formatArea(m2) {
  const value = Number(m2);
  if (!Number.isFinite(value) || value < 0) return "–";
  if (value >= 10000) {
    return `${(value / 10000).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ha`;
  }
  return `${Math.round(value).toLocaleString("es-CL")} m²`;
}

function formatKm(km) {
  const value = Number(km);
  if (!Number.isFinite(value) || value < 0) return "–";
  if (value >= 1) {
    return `${value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }
  return `${Math.round(value * 1000).toLocaleString("es-CL")} m`;
}

function formatPct(p) {
  const value = Number(p);
  if (!Number.isFinite(value) || value < 0) return "–";
  return `${value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function diametroEquivalente(m2) {
  const area = Number(m2);
  if (!Number.isFinite(area) || area <= 0) return 0;
  return 2 * Math.sqrt(area / Math.PI);
}

function calcularEstadigrafosGeoIPT(featureSeleccionada, geojsonCompleto, zonaSeleccionada) {
  if (typeof turf === "undefined" || !turf) return null;
  if (!featureSeleccionada || !featureSeleccionada.geometry) return null;
  if (!geojsonCompleto || !Array.isArray(geojsonCompleto.features)) return null;
  const normZona = (z) => String(z || "").trim().toUpperCase();
  const zonaNorm = normZona(zonaSeleccionada || featureSeleccionada.properties?.ZONA);
  const polygonFeatures = geojsonCompleto.features.filter((feature) =>
    feature?.geometry && ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
  );
  if (!polygonFeatures.length) return null;

  const areaPoligono = turf.area(featureSeleccionada);
  const areaTotalPRC = polygonFeatures.reduce((acc, feature) => acc + turf.area(feature), 0);
  const perimetroPoligono = turf.length(turf.polygonToLine(featureSeleccionada), { units: "kilometers" });

  let areaCategoria = 0;
  let cantidadPoligonosCategoria = 0;
  polygonFeatures.forEach((feature) => {
    if (normZona(feature.properties?.ZONA) === zonaNorm) {
      cantidadPoligonosCategoria += 1;
      areaCategoria += turf.area(feature);
    }
  });

  const porcentajeCategoriaPRC = areaTotalPRC > 0 ? (areaCategoria / areaTotalPRC) * 100 : 0;
  const porcentajePoligonoPRC = areaTotalPRC > 0 ? (areaPoligono / areaTotalPRC) * 100 : 0;

  return {
    areaPoligono,
    perimetroPoligono,
    diametroEquivalentePoligono: diametroEquivalente(areaPoligono),
    areaTotalPRC,
    areaCategoria,
    cantidadPoligonosCategoria,
    diametroEquivalenteCategoria: diametroEquivalente(areaCategoria),
    porcentajeCategoriaPRC,
    porcentajePoligonoPRC
  };
}

function actualizarEstadigrafosGeoIPT(stats, zona) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const pie = document.getElementById("zone-pie");
  const zonaTexto = String(zona || "–").trim() || "–";

  if (!stats || !Number.isFinite(stats.areaTotalPRC) || stats.areaTotalPRC <= 0) {
    if (pie) pie.style.setProperty("--p", 0);
    set("zone-share-pct", "–");
    set("zone-share-title", "Presencia en PRC");
    set("zone-share-text", "Sin datos suficientes para calcular superficies.");
    set("stat-poly-area", "–");
    set("stat-poly-perimeter", "–");
    set("stat-poly-diameter", "–");
    set("stat-poly-pct", "–");
    set("stat-cat-zone", zonaTexto);
    set("stat-cat-area", "–");
    set("stat-cat-count", "–");
    set("stat-cat-diameter", "–");
    set("stat-cat-pct", "–");
    return;
  }

  const pctCategoria = Math.max(0, Math.min(100, stats.porcentajeCategoriaPRC));
  if (pie) pie.style.setProperty("--p", pctCategoria.toFixed(1));
  set("zone-share-pct", formatPct(pctCategoria));
  set("zone-share-title", "Presencia en PRC");
  set("zone-share-text", `La zona ${zonaTexto} representa el ${formatPct(stats.porcentajeCategoriaPRC)} de la superficie total del PRC.`);
  set("stat-poly-area", formatArea(stats.areaPoligono));
  set("stat-poly-perimeter", formatKm(stats.perimetroPoligono));
  set("stat-poly-diameter", formatKm(stats.diametroEquivalentePoligono / 1000));
  set("stat-poly-pct", formatPct(stats.porcentajePoligonoPRC));
  set("stat-cat-zone", zonaTexto);
  set("stat-cat-area", formatArea(stats.areaCategoria));
  set("stat-cat-count", Number(stats.cantidadPoligonosCategoria || 0).toLocaleString("es-CL"));
  set("stat-cat-diameter", formatKm(stats.diametroEquivalenteCategoria / 1000));
  set("stat-cat-pct", formatPct(stats.porcentajeCategoriaPRC));
}

/* ---------------------------------------------
   PASO 1: Regiones que intersectan el BBOX
--------------------------------------------- */
async function obtenerRegionesIntersectadas() {
  const regionUrlParam = getRegionUrlParam();

  if (regionUrlParam) {
    console.log("[GeoCard] Usando región desde URL:", regionUrlParam);
    return [{
      id: regionUrlParam,
      codigo: regionUrlParam,
      carpeta: `capas_${regionUrlParam}`,
      fuente: "url_param"
    }];
  }

  const resp = await fetch("capas/regiones.json");
  const regiones = await resp.json();

  const regionesIntersectadas = regiones.filter((reg) => {
    const bboxReg = normalizarBBoxA_NESW(reg.bbox);
    return intersectaBbox(bboxReg, bboxPantalla);
  });

  console.log("[GeoCard] Regiones intersectadas:", regionesIntersectadas);
  return regionesIntersectadas;
}

/* ---------------------------------------------
   PASO 2: IPT cuyo BBOX intersecta el BBOX
--------------------------------------------- */
function getCarpetaRegion(reg) {
  const regionId = normalizarRegionId(reg?.id || reg?.codigo || reg?.region || reg?.reg);
  return reg?.carpeta || (regionId ? `capas_${regionId}` : "");
}

async function obtenerIptEnPantalla(regiones) {
  const lista = [];
  const listadosRegional = [];

  for (const reg of regiones) {
    const carpeta = getCarpetaRegion(reg);
    if (!carpeta) continue;
    const urlListado = `capas/${carpeta}/listado.json`;
    console.log("[GeoCard] Leyendo listado:", urlListado);

    try {
      const resp = await fetch(urlListado);
      const datos = await resp.json();
      const instrumentos = datos.instrumentos || [];
      console.log("[GeoCard] Instrumentos en listado:", instrumentos.length);
      listadosRegional.push({ carpeta, instrumentos });

      for (const ipt of instrumentos) {
        const bboxNorm = normalizarBBoxA_NESW(ipt.bbox);
        if (intersectaBbox(bboxNorm, bboxPantalla)) {
          lista.push({
            carpeta,
            archivo: ipt.archivo,
            bboxNorm
          });
        }
      }
    } catch (e) {
      console.warn("[GeoCard] No se pudo leer listado:", urlListado, e);
    }
  }

  if (!lista.length && regiones.length) {
    console.warn("[GeoCard] No hubo IPT por BBOX. Aplicando fallback regional.");

    for (const { carpeta, instrumentos } of listadosRegional) {
      instrumentos.forEach((ipt) => {
        lista.push({
          carpeta,
          archivo: ipt.archivo,
          bboxNorm: normalizarBBoxA_NESW(ipt.bbox),
          fallbackRegional: true
        });
      });
    }
  }

  console.log("[GeoCard] IPT candidatos en pantalla:", lista);
  return lista;
}

/* ---------------------------------------------
   PASO 3: IPT cuya GEOMETRÍA contiene el clic
--------------------------------------------- */
async function iptContienePunto(ipt, acumuladorFeatures) {
  const url = `capas/${ipt.carpeta}/${ipt.archivo}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("No se pudo leer IPT:", url);
      return false;
    }

    const txt = await resp.text();
    const dom = new DOMParser().parseFromString(txt, "text/xml");
    const gj = toGeoJSON.kml(dom);
    const pt = turf.point([lon, lat]);

    for (const f of gj.features) {
      if (!f.geometry || !["Polygon", "MultiPolygon"].includes(f.geometry.type)) {
        continue;
      }

      if (turf.booleanPointInPolygon(pt, f)) {
        acumuladorFeatures.push({
          feature: f,
          metadata: f.properties || {},
          archivo: ipt.archivo,
          carpeta: ipt.carpeta,
          geojson: gj
        });

        return true;
      }
    }
  } catch (e) {
    console.error("Error leyendo IPT:", ipt.archivo, e);
  }

  return false;
}

async function obtenerIptQueContienenElPunto(listaIpt) {
  const resultado = [];
  const featuresParaDibujar = [];

  for (let i = 0; i < listaIpt.length; i++) {
    const ipt = listaIpt[i];
    const tramo = 72 + ((i + 1) / listaIpt.length) * 18;
    setLoadingProgress(tramo, "Analizando geometría...");

    if (await iptContienePunto(ipt, featuresParaDibujar)) {
      resultado.push(ipt);
    }
  }

  const metaBox = document.getElementById("txt-metadata-poligono");
  const linkKml = document.getElementById("link-kml");

  if (featuresParaDibujar.length > 0) {
    dibujarPoligonosMatch(featuresParaDibujar.map((f) => f.feature));

    let texto = "";
    featuresParaDibujar.forEach((item, idx) => {
      const meta = item.metadata || {};
      const archivo = item.archivo || "(desconocido)";
      const carpeta = item.carpeta || "";

      texto += `#${idx + 1} ${carpeta}/${archivo}\n`;
      texto += Object.entries(meta)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      texto += "\n\n";
    });

    if (metaBox) {
      metaBox.textContent = texto.trim() || "(sin metadata disponible)";
    }

    const primerItem = featuresParaDibujar[0];
    actualizarTablaDesdeTexto(
      Object.entries(primerItem.metadata || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
      primerItem.carpeta,
      primerItem.archivo
    );
    const zonaSeleccionada = primerItem.metadata?.ZONA || primerItem.feature?.properties?.ZONA || "";
    const statsGeo = calcularEstadigrafosGeoIPT(primerItem.feature, primerItem.geojson, zonaSeleccionada);
    actualizarEstadigrafosGeoIPT(statsGeo, zonaSeleccionada);

    featuresSeleccionadas = featuresParaDibujar;
    geoQueryState.lastMatches = featuresParaDibujar;
    renderTablaMatch(featuresParaDibujar);
    setPdfButtonEnabled(true);

    if (btnKml) {
      btnKml.disabled = false;
      btnKml.classList.add("is-ready");
    }

    if (linkKml) {
      linkKml.style.display = "inline";
      linkKml.style.opacity = "1";
      linkKml.style.pointerEvents = "auto";
      linkKml.href = "#";

      linkKml.onclick = function (e) {
        e.preventDefault();
        descargarKmlZona("link");
      };
    }

    trackResultadoOk({
      matches_count: featuresParaDibujar.length
    });
  } else {
    if (metaBox) {
      metaBox.textContent =
        "(ningún polígono contiene el punto clic en los IPT analizados)";
    }

    featuresSeleccionadas = [];
    geoQueryState.lastMatches = [];
    renderTablaMatch([]);
    actualizarEstadigrafosGeoIPT(null, "");
    setPdfButtonEnabled(false);

    if (btnKml) {
      btnKml.disabled = true;
      btnKml.classList.remove("is-ready");
    }

    if (linkKml) {
      linkKml.style.display = "none";
      linkKml.style.pointerEvents = "none";
      linkKml.href = "#";
      linkKml.onclick = null;
    }
  }

  return resultado;
}

/* ---------------------------------------------
   Dibujar polígonos match en AZUL
--------------------------------------------- */
function dibujarPoligonosMatch(features) {
  if (matchLayer) {
    map.removeLayer(matchLayer);
    matchLayer = null;
  }

  if (!features || !features.length) return;

  const fc = {
    type: "FeatureCollection",
    features
  };

  matchLayer = L.geoJSON(fc, {
    style: {
      color: "#2563eb",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 0.35
    }
  }).addTo(map);

  try {
    const bounds = matchLayer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch (e) {
    // fallback silencioso
  }
}

function polygonToKml(polyCoords) {
  const outer = polyCoords[0] || [];
  const coordStr = outer.map(([lonCoord, latCoord]) => `${lonCoord},${latCoord},0`).join(" ");
  return `
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>${coordStr}</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>`;
}

function multiPolygonToKml(multiCoords) {
  return multiCoords.map((p) => polygonToKml(p)).join("");
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const GEOIPT_KML_THEME = { cssColor: "#FFFFFF", lineColor: "ffffffff", fillColor: "40ffffff", strongerFillColor: "59ffffff", textColor: "ff000000", haloColor: "ffffffff" };
function cleanKmlValue(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  return !text || /^(undefined|null)$/i.test(text) ? "" : text;
}
function pickProp(props, aliases) {
  for (const key of aliases) {
    const value = cleanKmlValue(props?.[key]);
    if (value) return value;
  }
  return "";
}
function geoIptNormativeMetadata(props, item = {}) {
  const merged = { ...(item.feature?.properties || {}), ...(props || {}), ...(item.metadata || {}) };
  const rows = {
    "Región": pickProp(merged, ["REG", "region", "REGION", "Región"]),
    "Comuna": pickProp(merged, ["COM", "comuna", "COMUNA"]),
    "Localidad": pickProp(merged, ["LOC", "LOCALIDAD", "localidad"]),
    "Código de zona": pickProp(merged, ["ZONA", "zona", "COD_ZONA"]),
    "Nombre de zona": pickProp(merged, ["NOM", "NOMBRE", "nombre", "Name"]),
    "Usos permitidos": pickProp(merged, ["UPERM", "USOS_PERMITIDOS", "uso_permitido"]),
    "Usos prohibidos": pickProp(merged, ["UPROH", "USOS_PROHIBIDOS", "uso_prohibido"]),
    "Tipo de documento": pickProp(merged, ["T_DO", "TIPO_DOC", "tipo_documento"]),
    "Número de documento": pickProp(merged, ["N_DOC", "NUM_DOC", "numero_documento"]),
    "Fecha del documento": pickProp(merged, ["P_DO", "FECHA_DOC", "fecha_documento"]),
    "Observaciones": pickProp(merged, ["OBS", "OBSERVACIONES", "observaciones"]),
    "Tipo de relación": cleanKmlValue(item.relacion || item.relation || item.tipoRelacion),
    "Distancia mínima": cleanKmlValue(item.distancia || item.distance || item.distanceKm),
    "Fuente": cleanKmlValue(item.fuente || item.source || "KML normativo PRC"),
    "Archivo regional de origen": cleanKmlValue(item.archivo)
  };
  Object.keys(rows).forEach((key) => { if (!cleanKmlValue(rows[key])) delete rows[key]; });
  return rows;
}
function geoIptPlacemarkName(metadata) {
  const code = metadata["Código de zona"];
  const name = metadata["Nombre de zona"];
  if (code && name) return `${code} · ${name}`;
  if (code) return `Zona PRC ${code}`;
  return "Zona PRC relacionada";
}
function geoIptDescription(metadata) {
  const row = (label) => metadata[label] ? `<tr><th>${escapeXml(label)}</th><td>${escapeXml(metadata[label])}</td></tr>` : "";
  const documentText = [metadata["Tipo de documento"], metadata["Número de documento"], metadata["Fecha del documento"]].filter(Boolean).join(" · ");
  return `<h2>Zona PRC relacionada</h2><table>${["Región","Comuna","Localidad","Código de zona","Nombre de zona","Tipo de relación","Distancia mínima","Fuente","Archivo regional de origen"].map(row).join("")}</table>${metadata["Usos permitidos"] ? `<h3>Usos permitidos</h3><p>${escapeXml(metadata["Usos permitidos"])}</p>` : ""}${metadata["Usos prohibidos"] ? `<h3>Usos prohibidos</h3><p>${escapeXml(metadata["Usos prohibidos"])}</p>` : ""}${documentText ? `<h3>Documento normativo</h3><p>${escapeXml(documentText)}</p>` : ""}${metadata["Observaciones"] ? `<h3>Observaciones</h3><p>${escapeXml(metadata["Observaciones"])}</p>` : ""}`;
}
function featureToKmlPlacemark(feature, props, nombreFallback, item = {}) {
  const geom = feature.geometry;
  if (!geom) return "";

  let geomKml = "";
  if (geom.type === "Polygon") {
    geomKml = polygonToKml(geom.coordinates);
  } else if (geom.type === "MultiPolygon") {
    geomKml = multiPolygonToKml(geom.coordinates);
  } else {
    return "";
  }

  const metadata = geoIptNormativeMetadata(props, item);
  const nombre = geoIptPlacemarkName(metadata) || nombreFallback || "Zona PRC relacionada";
  const extendedData = Object.entries(metadata).length ? `<ExtendedData>${Object.entries(metadata).map(([k, v]) => `<Data name="${escapeXml(k)}"><displayName>${escapeXml(k)}</displayName><value>${escapeXml(v)}</value></Data>`).join("")}</ExtendedData>` : "";
  return `
    <Placemark>
      <name>${escapeXml(nombre)}</name>
      <styleUrl>#geoipt_poly</styleUrl>
      <description><![CDATA[${geoIptDescription(metadata)}]]></description>
      ${extendedData}
      ${geomKml}
    </Placemark>`;
}

function actualizarTablaDesdeTexto(texto, carpeta, archivo) {
  const mapValores = {};
  const lineas = (texto || "").split(/\r?\n/);

  lineas.forEach((line) => {
    const m = line.match(/^([A-Z_]+)\s*:\s*(.+)$/i);
    if (!m) return;
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    mapValores[key] = value;
  });

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "–";
  };

  const setHtml = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html ?? "–";
  };

  const slugInstrumentoDesdeArchivo = (archivoKml) => {
    if (!archivoKml) return "";
    const sinExt = archivoKml.replace(/\.kml$/i, "");
    const partes = sinExt.split("_");
    const idxPRC = partes.indexOf("PRC");
    if (idxPRC < 0) return "";

    const resto = partes.slice(idxPRC + 1).join("_").toLowerCase();
    return resto ? `PRC_${resto}` : "";
  };

  set("md-reg", mapValores.REG || "–");
  set("md-com", mapValores.COM || "–");
  set("md-com-meta", mapValores.COM || "–");
  set("md-loc", mapValores.LOCALIDAD || mapValores.LOC || "–");
  set("md-loc-meta", mapValores.LOCALIDAD || mapValores.LOC || "–");
  set("md-zona", mapValores.ZONA || "–");
  set("md-nombre", mapValores.NOMBRE || mapValores.NOM || "–");
  set("md-nombre-meta", mapValores.NOMBRE || mapValores.NOM || "–");
  set("md-uperm", mapValores.UPERM || "–");
  set("md-uperm-meta", mapValores.UPERM || "–");
  set("md-uproh", mapValores.UPROH || "–");
  set("md-uproh-meta", mapValores.UPROH || "–");
  set("md-cut", mapValores.CUT || "–");

  if (archivo && carpeta) {
    const slug = slugInstrumentoDesdeArchivo(archivo);

    if (slug) {
      const sufijo = carpeta.replace("capas_", "");
      const carpetaHtml = `html_${sufijo}`;
      const href = `capas/${carpeta}/${carpetaHtml}/${slug}.html`;

      setHtml(
        "md-capa",
        `<a href="${href}" target="_blank" rel="noopener" style="color:#4fc3f7;font-weight:600;text-decoration:underline;">${slug}</a>`
      );
    } else {
      set("md-capa", `${carpeta}/${archivo}`);
    }
  } else {
    set("md-capa", "–");
  }

  const zona = mapValores.ZONA || "–";
  const nombre = mapValores.NOMBRE || mapValores.NOM || "–";
  const uperm = mapValores.UPERM || "–";
  const uroh = mapValores.UPROH || "–";
  const comuna = mapValores.COM || "–";
  const region = mapValores.REG || "–";

  const zonaFull = [zona, nombre].filter((value) => value && value !== "–").join(" · ") || "–";
  const textoZona = normalizarTextoZona(zona, nombre);
  set("kpi-zona", zonaFull);
  set("rp-zona", zonaFull);
  setEstadoGeoCard("Dentro de zona normativa", "ok");
  set("rp-punto", `${comuna}, ${region}`);
  set("rp-coords", `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`);
  const interpretacion = limpiarFraseGeoCard(
    `El terreno se encuentra en ${textoZona},
lo que permite: ${uperm}.

No está permitido: ${uroh}.`
  );
  set("md-interpretacion", interpretacion);

  const capaEl = document.getElementById("md-capa");
  const fuenteEl = document.getElementById("rp-fuente");
  const linkPrcEl = document.getElementById("link-prc");
  if (capaEl && fuenteEl) {
    fuenteEl.innerHTML = capaEl.innerHTML;
  }
  if (capaEl && linkPrcEl) {
    const sourceLink = capaEl.querySelector("a");
    if (sourceLink) {
      linkPrcEl.href = sourceLink.href;
    }
  }
}

function timestampYYYYMMDDHHMM() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

function obtenerNombrePRC(desdeArchivo) {
  if (!desdeArchivo) return "PRC";
  const sinExt = desdeArchivo.replace(/\.kml$/i, "");
  const partes = sinExt.split("_");
  const idxPRC = partes.indexOf("PRC");
  if (idxPRC >= 0) {
    const resto = partes.slice(idxPRC + 1).join(" ");
    return "PRC " + resto;
  }
  return sinExt;
}

function descargarKmlZona(triggerType = "button") {
  if (!featuresSeleccionadas || !featuresSeleccionadas.length) {
    alert("No hay polígonos seleccionados para exportar.");
    return;
  }

  const first = featuresSeleccionadas[0];
  const props = first.metadata || {};
  const zona = props.ZONA || props.zona || "ZONA";
  const prcNombre = obtenerNombrePRC(first.archivo);
  const stamp = timestampYYYYMMDDHHMM();

  const nombreKml = `${prcNombre} ${zona} ${stamp}`;
  const fileName = nombreKml.replace(/\s+/g, "_") + ".kml";

  const placemarks = featuresSeleccionadas
    .map((item, idx) =>
      featureToKmlPlacemark(item.feature, item.metadata || item.feature?.properties, `Zona ${idx + 1}`, item)
    )
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>${escapeXml(nombreKml)}</name>
      <Style id="geoipt_poly">
        <LineStyle>
          <color>ffffffff</color>
          <width>3</width>
        </LineStyle>
        <PolyStyle>
          <color>40ffffff</color>
          <fill>1</fill>
          <outline>1</outline>
        </PolyStyle>
      </Style>
      ${placemarks}
    </Document>
  </kml>`;

  const blob = new Blob([kml], {
    type: "application/vnd.google-earth.kml+xml"
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;

  trackDownloadKml(triggerType, {
    file_name: fileName,
    matches_count: featuresSeleccionadas.length
  });

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 🔥 tracking invisible por URL
setTimeout(() => {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";

  const okUrl = new URL("ok-kml.html", window.location.href);
  okUrl.searchParams.set("src", "geoipt");
  okUrl.searchParams.set("file", fileName);

  iframe.src = okUrl.toString();

  document.body.appendChild(iframe);

  // limpieza después de unos segundos
  setTimeout(() => {
    document.body.removeChild(iframe);
  }, 3000);

}, 300);

  setMensajeKml("✅ KML generado correctamente.");

  URL.revokeObjectURL(url);
}

/* ---------------------------------------------
   PASO 4: Navegación / cierre pestaña
--------------------------------------------- */
function cerrarPestana() {
  mostrarEstadoGeoCard(
    "GeoCard permanece abierto",
    "El cierre automático de la pestaña está desactivado durante la etapa de estabilización."
  );
}

function volverAIndexConFallback() {
  mostrarEstadoGeoCard(
    "GeoCard permanece abierto",
    "El retorno automático a GeoIndex está desactivado durante la etapa de estabilización."
  );
}

function volverAIndex() {
  mostrarEstadoGeoCard(
    "GeoCard permanece abierto",
    "La redirección automática a GeoIndex está desactivada durante la etapa de estabilización."
  );
}


function textFromSelector(selector, fallback = "–") {
  const value = document.querySelector(selector)?.textContent?.trim();
  return value || fallback;
}

function extractTableRows(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return [];

  const headers = Array.from(table.querySelectorAll("thead th"))
    .map((th) => th.textContent.trim());

  return Array.from(table.querySelectorAll("tbody tr"))
    .filter((tr) => !tr.querySelector("td[colspan]"))
    .map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cells[i]?.textContent.trim() || "";
      });
      return row;
    });
}

function extractKeyValueTable(selector) {
  const table = document.querySelector(selector);
  if (!table) return {};

  const data = {};
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = tr.querySelectorAll("td");
    if (cells.length >= 2) {
      const key = cells[0].textContent.trim();
      const value = cells[1].textContent.trim();
      if (key) data[key] = value;
    }
  });

  return data;
}

async function buildGeoIptPdfPayloadV2() {
  const first = (featuresSeleccionadas && featuresSeleccionadas[0]) || {};
  const props = first.metadata || {};
  const zona = textFromSelector("#md-zona", props.ZONA || "–");
  const nombreNormativo = textFromSelector("#md-nombre", props.NOMBRE || props.NOM || "–");
  const metadata = {
    ...extractKeyValueTable("#tabla-metadata"),
    Shape_STAr_ha: Number.isFinite(Number(props.Shape_STAr)) ? `${(Number(props.Shape_STAr) / 10000).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha` : undefined,
    Shape_STLe_km: Number.isFinite(Number(props.Shape_STLe)) ? `${(Number(props.Shape_STLe) / 1000).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km` : undefined
  };
  Object.keys(metadata).forEach((key) => {
    if (!metadata[key]) delete metadata[key];
  });

  let mapPng = null;
  try {
    mapPng = await captureGeoIptMapPng();
  } catch (error) {
    console.warn("[GeoCard PDF] Captura de mapa omitida; el PDF se generará sin mapa.", error);
  }

  return {
    version: "GeoCard IPT PDF v2",
    generado_en: new Date().toISOString(),
    punto: {
      lat: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
      lon: Number.isFinite(lon) ? Number(lon.toFixed(6)) : null,
      texto: textFromSelector("#rp-punto", "–")
    },
    contexto: {
      comuna: textFromSelector("#md-com", props.COM || "–"),
      region: props.REG || textFromSelector("#md-reg", "–"),
      localidad: textFromSelector("#md-loc", props.LOCALIDAD || props.LOC || "–"),
      fuente_prc: textFromSelector("#rp-fuente", textFromSelector("#md-capa", "–")),
      instrumento: obtenerNombrePRC(first.archivo),
      estado: textFromSelector("#rp-estado", props.ESTADO || "–")
    },
    resultado: {
      zona,
      nombre_normativo: nombreNormativo,
      tipo_zona: nombreNormativo,
      usos_permitidos: textFromSelector("#md-uperm", props.UPERM || "–"),
      restricciones: textFromSelector("#md-uproh", props.UPROH || "–"),
      interpretacion: textFromSelector("#md-interpretacion", "Sin resumen disponible.")
    },
    estadigrafos: {
      poligono: {
        area_ha: textFromSelector("#stat-poly-area"),
        perimetro_km: textFromSelector("#stat-poly-perimeter"),
        diametro_equivalente_m: textFromSelector("#stat-poly-diameter"),
        porcentaje_prc: textFromSelector("#stat-poly-pct")
      },
      categoria: {
        zona: textFromSelector("#stat-cat-zone", zona),
        area_total_ha: textFromSelector("#stat-cat-area"),
        numero_poligonos: textFromSelector("#stat-cat-count"),
        diametro_equivalente_km: textFromSelector("#stat-cat-diameter"),
        porcentaje_prc: textFromSelector("#stat-cat-pct")
      }
    },
    tabla_match: extractTableRows("#tabla-match"),
    metadata,
    mapa: {
      png: mapPng,
      nota: mapPng ? "Mapa capturado desde GeoCard" : "Mapa no disponible en esta exportación."
    }
  };
}

function buildGeoIptPdfPayload() {
  return buildGeoIptPdfPayloadV2();
}

async function exportarPdfGeoCard() {
  const btn = document.getElementById("btn-export-pdf");

  try {
    if (!featuresSeleccionadas || !featuresSeleccionadas.length) {
      throw new Error("No existe resultado normativo para exportar.");
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generando PDF...";
    }

    const payload = await buildGeoIptPdfPayloadV2();

    // Mantener payload en sessionStorage durante etapa de depuración PDF v2.
    sessionStorage.setItem("geoipt_pdf_payload", JSON.stringify(payload));

    window.open("report_html2pdf.html?autodownload=1", "_blank", "noopener");

    setPdfButtonEnabled(true);
  } catch (err) {
    console.error("[GeoCard PDF] Error generando payload PDF:", err);
    setPdfButtonEnabled(Boolean(featuresSeleccionadas && featuresSeleccionadas.length));
    alert("No se pudo preparar el PDF. Revise la consola para más detalle.");
  }
}


async function captureGeoIptMapPng() {
  const mapElement = document.getElementById("map");

  if (!mapElement || typeof html2canvas !== "function") {
    console.warn("[GeoIPT PDF V2] No se pudo capturar mapa: html2canvas o #map no disponible");
    return null;
  }

  const hidden = [];

  try {
    mapElement.querySelectorAll(
      ".leaflet-control-container, .leaflet-control, .leaflet-popup, .legend-floating"
    ).forEach((el) => {
      hidden.push([el, el.style.display]);
      el.style.display = "none";
    });

    if (window.geoIptMap && typeof window.geoIptMap.invalidateSize === "function") {
      window.geoIptMap.invalidateSize(true);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const canvas = await html2canvas(mapElement, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      ignoreElements: (element) => {
        return (
          element.classList?.contains("leaflet-control-container") ||
          element.classList?.contains("leaflet-control") ||
          element.classList?.contains("leaflet-popup") ||
          element.classList?.contains("legend-floating")
        );
      }
    });

    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("[GeoIPT PDF V2] Error capturando mapa estático", error);
    return null;
  } finally {
    hidden.forEach(([el, display]) => {
      el.style.display = display;
    });
  }
}

async function openGeoIptPdfReportV2() {
  await exportarPdfGeoCard();
}

window.buildGeoIptPdfPayload = buildGeoIptPdfPayload;
window.buildGeoIptPdfPayloadV2 = buildGeoIptPdfPayloadV2;
window.exportarPdfGeoCard = exportarPdfGeoCard;
window.openGeoIptPdfReportV2 = openGeoIptPdfReportV2;
window.captureGeoIptMapPng = captureGeoIptMapPng;
function prepararBotonReporte(iptsConPunto) {
  const btn = document.getElementById("btn-reporte");
  if (!btn) return;

  if (!iptsConPunto || !iptsConPunto.length) {
    btn.disabled = true;
    btn.style.opacity = 0.5;
    btn.onclick = null;
    return;
  }

  btn.disabled = false;
  btn.style.opacity = 1;
  btn.style.cursor = "pointer";

  const rutas = iptsConPunto
    .map((ipt) => `capas/${ipt.carpeta}/${ipt.archivo}`)
    .join("|");

  const bboxStr = bboxPantalla ? bboxPantalla.join(",") : "";

  const urlInfo =
    `info.html?lat=${lat}&lon=${lon}` +
    `&zoom=${zoom}` +
    (bboxStr ? `&bbox=${bboxStr}` : "") +
    `&ipts=${encodeURIComponent(rutas)}`;

  btn.onclick = () => {
    window.location.href = urlInfo;
  };
}

/* ---------------------------------------------
   TRACKING DE CLICK EN LINK PRC / MINVU
--------------------------------------------- */
document.addEventListener("click", function (event) {
  const linkExpediente = event.target.closest("#md-capa a");
  if (!linkExpediente) return;

  const href = linkExpediente.getAttribute("href") || "";
  const expediente = (linkExpediente.textContent || "").trim();

  trackMinvuExpediente({
    expediente_nombre: expediente,
    expediente_url: href
  });

  console.log("Expediente histórico:", expediente);
});


/* ---------------------------------------------
   GEOQUERY: reglas, slider y tabla Match
--------------------------------------------- */
async function cargarReglasTopologicas() {
  const url = `${GEOQUERY_PATHS.parametros}/reglas_topologicas.json`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const reglas = await resp.json();
    geoQueryState.reglasTopologicas = reglas?.[geoQueryState.sitio] || reglas;
    return geoQueryState.reglasTopologicas;
  } catch (error) {
    console.info("Reglas topológicas no disponibles aún:", url);
    return null;
  }
}

function getProp(props, keys, fallback = "–") {
  for (const key of keys) {
    const value = props?.[key] ?? props?.[key.toLowerCase()] ?? props?.[key.toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function resolveFichaUrl(urlFicha) {
  const value = String(urlFicha || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("fichas_html/") ? value : `${GEOQUERY_PATHS.fichas}/${value}`;
}

function calcularDistanciaPoiFeature(feature) {
  if (!hasValidPoi || !feature?.geometry || typeof turf === "undefined") return "–";
  try {
    const pt = turf.point([lon, lat]);
    if (["Polygon", "MultiPolygon"].includes(feature.geometry.type) && turf.booleanPointInPolygon(pt, feature)) return "0 m";
    const centroid = turf.centroid(feature);
    return formatKm(turf.distance(pt, centroid, { units: "kilometers" }));
  } catch (error) {
    return "–";
  }
}

function getVisibleMatchColumns(rows, preferredColumns) {
  return preferredColumns.filter((col) =>
    rows.some((row) => {
      const value = row[col.key];
      return value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "–";
    })
  );
}

function calcularSuperficieMatch(item, props) {
  const shapeArea = Number(getProp(props, ["Shape_STAr", "SHAPE_STAR"], NaN));
  if (Number.isFinite(shapeArea) && shapeArea > 0) return formatArea(shapeArea);

  if (item?.feature?.geometry && typeof turf !== "undefined") {
    try {
      const turfArea = turf.area(item.feature);
      if (Number.isFinite(turfArea) && turfArea > 0) return formatArea(turfArea);
    } catch (error) {
      // Mantener tabla estable si Turf no puede calcular esta geometría.
    }
  }

  const statsArea = Number(item?.stats?.areaPoligono || item?.estadigrafos?.areaPoligono);
  return Number.isFinite(statsArea) && statsArea > 0 ? formatArea(statsArea) : "–";
}

function buildMatchRows(matches) {
  return (matches || []).map((item) => {
    const props = item.metadata || item.feature?.properties || {};
    const ficha = resolveFichaUrl(getProp(props, ["url_ficha", "URL_FICHA"], ""));
    return {
      nombre: getProp(props, ["nombre", "NOMBRE", "NOM", "Name"], item.archivo || "–"),
      tipo: getProp(props, ["tipo", "TIPO"], "Zona normativa"),
      categoria: getProp(props, ["categoria", "CATEGORIA", "ZONA"], "–"),
      region: getProp(props, ["region", "REG"], geoQueryState.region || "–"),
      comuna: getProp(props, ["comuna", "COM"], "–"),
      distancia: calcularDistanciaPoiFeature(item.feature),
      localidad: getProp(props, ["localidad", "LOCALIDAD", "LOC"], "–"),
      superficie: calcularSuperficieMatch(item, props),
      estado: getProp(props, ["estado", "ESTADO"], "–"),
      titular: getProp(props, ["titular", "TITULAR"], "–"),
      recurso: getProp(props, ["recurso", "RECURSO"], "–"),
      normativa: getProp(props, ["normativa", "NORMATIVA", "UPERM"], "–"),
      url: getProp(props, ["url", "URL", "url_externa", "URL_EXTERNA"], ""),
      ficha
    };
  });
}

function renderTablaMatch(matches) {
  const table = document.getElementById("tabla-match");
  const tbody = document.getElementById("tabla-match-body");
  if (!table || !tbody) return;

  const preferredColumns = [
    { key: "nombre", label: "Nombre" },
    { key: "tipo", label: "Tipo" },
    { key: "categoria", label: "Categoría / Zona" },
    { key: "region", label: "Región" },
    { key: "comuna", label: "Comuna" },
    { key: "localidad", label: "Localidad" },
    { key: "distancia", label: "Distancia" },
    { key: "superficie", label: "Superficie" },
    { key: "estado", label: "Estado" },
    { key: "normativa", label: "Normativa" },
    { key: "url", label: "URL externa" },
    { key: "ficha", label: "url_ficha" }
  ];

  const rows = buildMatchRows(matches);
  const visibleColumns = getVisibleMatchColumns(rows, preferredColumns);
  const thead = table.querySelector("thead");
  if (thead) {
    thead.innerHTML = `<tr>${visibleColumns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("")}</tr>`;
  }

  if (!rows.length || !visibleColumns.length) {
    tbody.innerHTML = '<tr><td colspan="1">Sin objetos relacionados para el POI consultado.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>${visibleColumns.map((col) => {
      if (col.key === "url") {
        return `<td>${row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Abrir</a>` : "–"}</td>`;
      }
      if (col.key === "ficha") {
        return `<td>${row.ficha ? `<a class="btn-ficha" href="${escapeHtml(row.ficha)}" target="_blank" rel="noopener">Ver ficha</a>` : "–"}</td>`;
      }
      return `<td>${escapeHtml(row[col.key])}</td>`;
    }).join("")}</tr>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function initGeoQueryControls() {
  const slider = document.getElementById("geoquery-radius");
  const value = document.getElementById("geoquery-radius-value");
  const btn = document.getElementById("btn-actualizar-consulta");
  if (!slider) return;
  const sync = () => {
    geoQueryState.analysisRadiusM = Number(slider.value) || 1000;
    if (value) value.textContent = `${geoQueryState.analysisRadiusM.toLocaleString("es-CL")} m`;
  };
  const controls = slider.closest(".geoquery-controls");
  if (controls) controls.classList.add("is-placeholder");
  if (btn) btn.disabled = true;
  slider.disabled = true;
  slider.addEventListener("input", sync);
  sync();
}

/* ---------------------------------------------
   FLUJO PRINCIPAL
--------------------------------------------- */
async function ejecutarFlujo() {
  const pre1 = document.getElementById("txt-instrumentos");
  const pre2 = document.getElementById("txt-instrumentos-punto");
  const preMeta = document.getElementById("txt-metadata-poligono");
  const btn = document.getElementById("btn-reporte");

  try {
    setPdfButtonEnabled(false);
    console.log("[GeoCard] Parámetros recibidos:", {
      lat,
      lon,
      zoom,
      bboxParam,
      bboxPantalla,
      region: urlParams.get("region"),
      sitio: urlParams.get("sitio")
    });

    mostrarEstadoGeoCard(
      "Consultando",
      "GeoCard está consultando instrumentos y geometrías para el punto recibido."
    );

    trackConsultaIniciada();

    if (btn) {
      btn.disabled = true;
      btn.style.opacity = 0.5;
      btn.onclick = null;
    }

    if (!hasValidPoi) {
      if (preMeta) preMeta.textContent = "GeoQuery espera lat/lon desde GeoIndex. Carga segura sin POI.";
      mostrarEstadoGeoCard(
        "Parámetros incompletos",
        "GeoCard necesita parámetros lat y lon válidos desde GeoIndex. La página permanecerá abierta para revisión."
      );
      renderTablaMatch([]);
      setPdfButtonEnabled(false);
      setLoadingProgress(100, "Sin POI");
      setTimeout(() => hideLoadingOverlay(), 250);
      return;
    }

    bboxPantalla = bboxPantalla || bboxDesdeMapaActual();
    await cargarReglasTopologicas();

    if (pre1) pre1.textContent = "(Cargando regiones que intersectan el BBOX...)";
    if (pre2) pre2.textContent = "";
    if (preMeta) preMeta.textContent = "(sin datos aún)";

    setLoadingProgress(15, "Buscando regiones...");

    const regiones = await obtenerRegionesIntersectadas();

    setLoadingProgress(38, "Cargando instrumentos...");

    if (pre1) pre1.textContent = "(Cargando IPT de las regiones intersectadas...)";
    const iptEnPantalla = await obtenerIptEnPantalla(regiones);
    geoQueryState.lastIptCandidates = iptEnPantalla;

    if (pre1) pre1.textContent = JSON.stringify(iptEnPantalla, null, 2);

    if (!iptEnPantalla.length) {
      setLoadingProgress(100, "Sin resultados");

      if (pre2) {
        pre2.textContent =
          "⚠ No hay IPT cuyo BBOX intersecte la pantalla en este clic.\n" +
          "La página permanecerá abierta para revisión.";
      }

      if (preMeta) {
        preMeta.textContent =
          "(no se encontraron IPT intersectando el BBOX para este clic)";
      }

      prepararBotonReporte([]);
      setPdfButtonEnabled(false);
      setEstadoGeoCard("Sin zona normativa", "warn");
      trackResultadoVacio("sin_ipt_en_bbox");

      setTimeout(() => {
        hideLoadingOverlay();
        mostrarEstadoGeoCard(
          "Sin IPT en el BBOX",
          "No se encontraron instrumentos territoriales intersectando el viewport recibido desde GeoIndex."
        );
      }, 250);

      return;
}

    setLoadingProgress(72, "Analizando geometría...");

    if (pre2) pre2.textContent = "(Analizando geometría de los IPT en pantalla...)";
    const iptConPunto = await obtenerIptQueContienenElPunto(iptEnPantalla);

    if (!iptConPunto.length) {
      setLoadingProgress(100, "Sin resultados");

      if (pre2) {
        pre2.textContent =
          "⚠ Ningún IPT tiene polígonos que contengan exactamente el punto clic.\n" +
          "La página permanecerá abierta para revisión.";
      }

      if (preMeta) {
        preMeta.textContent =
          "(ningún polígono de los IPT intersectados contiene el punto clic)";
      }

      prepararBotonReporte([]);
      setPdfButtonEnabled(false);
      trackResultadoVacio("sin_poligono_contiene_punto");

      setTimeout(() => {
        hideLoadingOverlay();

        // GeoFactory:
        // El perímetro IPT confirma dominio territorial.
        // El KML normativo confirma zona normativa.
        // Un punto puede estar dentro del dominio PRC y no caer en una zona normativa interna exacta.
        if (dominioPrc) {
          poblarEncabezadoDominioPrc(iptEnPantalla);
          mostrarEstadoGeoCard(
            "Punto dentro del dominio PRC",
            "El punto consultado se encuentra dentro del perímetro del instrumento territorial, pero no se identificó una zona normativa interna exacta en el KML analizado. Esto puede ocurrir por vacíos de zonificación, bordes, diferencias geométricas o tolerancia espacial."
          );
        } else {
          setEstadoGeoCard("Sin zona normativa", "warn");
          mostrarEstadoGeoCard(
            "Punto fuera de geometría normativa",
            "Se encontraron instrumentos candidatos, pero ningún polígono contiene exactamente el punto consultado."
          );
        }
      }, 250);

      return;
    }

    if (pre2) {
      pre2.textContent = JSON.stringify(iptConPunto, null, 2);
    }

    setLoadingProgress(92, "Generando reporte...");

    prepararBotonReporte(iptConPunto);
    mostrarEstadoGeoCard(
      "Resultado encontrado",
      "Se encontraron instrumentos y geometrías normativas para el punto consultado."
    );

    setLoadingProgress(100, "Listo");

    setTimeout(() => {
      hideLoadingOverlay();
    }, 320);

  } catch (err) {
    console.error("Error en ejecutarFlujo():", err);
    trackResultadoVacio("error_ejecucion");
    setLoadingProgress(100, "Error");
    setEstadoGeoCard("Error de consulta", "error");
    mostrarEstadoGeoCard(
      "Error de consulta",
      "Ocurrió un error durante la consulta. Revisar consola para más detalles."
    );
    setTimeout(() => {
      hideLoadingOverlay();
    }, 250);
  }
}

initGeoQueryControls();
setupPdfButtonActions();
ejecutarFlujo();
