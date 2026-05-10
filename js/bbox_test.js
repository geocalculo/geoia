/************************************************************
 * GeoIPT - bbox_test.js
 *
 * PASO 1: Regiones cuyo BBOX toca la pantalla
 * PASO 2: IPT cuyo BBOX toca la pantalla
 * PASO 3: IPT cuya GEOMETRÍA contiene el clic
 * PASO 4: Si hay IPT → habilitar KML / metadata
 *         Si no hay  → mensaje + cerrar pestaña automáticamente
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
const zoomParam = parseInt(urlParams.get("zoom"), 10);
const zoom = Number.isFinite(zoomParam) ? zoomParam : 14;

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
    page: "bbox_test"
  };

  if (reg) meta.region = reg;
  if (com) meta.comuna = com;
  if (capa) meta.prc = capa;
  if (!Number.isNaN(lat)) meta.lat = Number(lat.toFixed(6));
  if (!Number.isNaN(lon)) meta.lon = Number(lon.toFixed(6));
  if (bboxParam) meta.bbox = bboxParam;

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

let bboxPantalla = null;
if (bboxParam) {
  const s = bboxParam.split(",");
  bboxPantalla = [
    parseFloat(s[0]), // N
    parseFloat(s[1]), // E
    parseFloat(s[2]), // S
    parseFloat(s[3])  // W
  ];
}

/* ---------------------------------------------
   2) MAPA LEAFLET
--------------------------------------------- */
const map = L.map("map", {
  preferCanvas: true
}).setView(
  (!Number.isNaN(lat) && !Number.isNaN(lon)) ? [lat, lon] : [-27, -70],
  zoom
);

window.geoIptMap = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  crossOrigin: true
}).addTo(map);

initKmlButton();

if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
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
    `&zoom=${zoomClick}&bbox=${bboxStr}`;

  window.open(nuevaUrl, "_blank");
});

/* ---------------------------------------------
   UTILIDADES DE BBOX
--------------------------------------------- */
function normalizarBBoxSWNE(b) {
  if (!b || b.length !== 2) return null;
  const sw = b[0];
  const ne = b[1];
  return [ne[0], ne[1], sw[0], sw[1]];
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
  const resp = await fetch("capas/regiones.json");
  const regiones = await resp.json();

  return regiones.filter((reg) => {
    const bboxReg = normalizarBBoxSWNE(reg.bbox);
    return intersectaBbox(bboxReg, bboxPantalla);
  });
}

/* ---------------------------------------------
   PASO 2: IPT cuyo BBOX intersecta el BBOX
--------------------------------------------- */
async function obtenerIptEnPantalla(regiones) {
  const lista = [];

  for (const reg of regiones) {
    const carpeta = reg.carpeta;
    const urlListado = `capas/${carpeta}/listado.json`;

    try {
      const resp = await fetch(urlListado);
      const datos = await resp.json();
      const instrumentos = datos.instrumentos || [];

      for (const ipt of instrumentos) {
        const bboxNorm = normalizarBBoxSWNE(ipt.bbox);
        if (intersectaBbox(bboxNorm, bboxPantalla)) {
          lista.push({
            carpeta,
            archivo: ipt.archivo,
            bboxNorm
          });
        }
      }
    } catch (e) {
      console.warn("No se pudo leer listado:", urlListado, e);
    }
  }

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
    actualizarEstadigrafosGeoIPT(null, "");

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

function featureToKmlPlacemark(feature, props, nombreFallback) {
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

  const propsSafe = props || {};
  const nombre =
    propsSafe.NOM ||
    propsSafe.NOMBRE ||
    propsSafe.ZONA ||
    nombreFallback ||
    "Zona consultada";

  let extendedData = "";
  const entries = Object.entries(propsSafe);
  if (entries.length) {
    extendedData = "<ExtendedData>";
    entries.forEach(([k, v]) => {
      extendedData += `<Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`;
    });
    extendedData += "</ExtendedData>";
  }

  return `
    <Placemark>
      <name>${escapeXml(nombre)}</name>
      <styleUrl>#geoipt_poly</styleUrl>
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

  const zonaFull = `${zona} · ${nombre}`;
  set("kpi-zona", zonaFull);
  set("rp-zona", zonaFull);
  set("rp-punto", `${comuna}, ${region}`);
  set("rp-coords", `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`);
  const interpretacion = `El terreno se encuentra en una zona ${nombre.toLowerCase()},\nlo que permite: ${uperm.toLowerCase()}.\n\nNo está permitido: ${uroh.toLowerCase()}.`;
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
      featureToKmlPlacemark(item.feature, item.metadata, `Zona ${idx + 1}`)
    )
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>${escapeXml(nombreKml)}</name>
      <Style id="geoipt_poly">
        <LineStyle>
          <color>ffeb6325</color>
          <width>2</width>
        </LineStyle>
        <PolyStyle>
          <color>66f6823b</color>
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

  URL.revokeObjectURL(url);
}

/* ---------------------------------------------
   PASO 4: Navegación / cierre pestaña
--------------------------------------------- */
function cerrarPestana() {
  if (window.opener && !window.opener.closed) {
    window.close();
  } else {
    window.open(location.href, "_self");
    window.close();
  }
}

function volverAIndexConFallback() {
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("fallback", "no_match");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  if (Number.isFinite(zoom)) {
    url.searchParams.set("zoom", zoom);
  }
  appendAttributionParams(url);
  window.location.href = url.toString();
}

function volverAIndex() {
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  if (Number.isFinite(zoom)) {
    url.searchParams.set("zoom", zoom);
  }
  appendAttributionParams(url);
  window.location.href = url.toString();
}


function buildGeoIptPdfPayload() {
  const first = (featuresSeleccionadas && featuresSeleccionadas[0]) || {};
  const props = first.metadata || {};
  const zona = props.ZONA || "–";
  const nombreNormativo = props.NOMBRE || props.NOM || "–";
  const tipoZona = nombreNormativo;
  const usosPermitidos = document.getElementById("md-uperm")?.textContent?.trim() || props.UPERM || "–";
  const restricciones = document.getElementById("md-uproh")?.textContent?.trim() || props.UPROH || "–";
  const interpretacion = document.getElementById("md-interpretacion")?.textContent?.trim() || "Sin resumen disponible.";
  const stats = {
    poligono: {
      area: document.getElementById("stat-poly-area")?.textContent?.trim() || "–",
      perimetro: document.getElementById("stat-poly-perimeter")?.textContent?.trim() || "–",
      diametroEquivalente: document.getElementById("stat-poly-diameter")?.textContent?.trim() || "–",
      porcentajePrc: document.getElementById("stat-poly-pct")?.textContent?.trim() || "–"
    },
    categoria: {
      zona: document.getElementById("stat-cat-zone")?.textContent?.trim() || zona,
      areaTotal: document.getElementById("stat-cat-area")?.textContent?.trim() || "–",
      numeroPoligonos: document.getElementById("stat-cat-count")?.textContent?.trim() || "–",
      diametroEquivalente: document.getElementById("stat-cat-diameter")?.textContent?.trim() || "–",
      porcentajePrc: document.getElementById("stat-cat-pct")?.textContent?.trim() || "–"
    },
    presenciaEnPrcTexto: document.getElementById("zone-share-text")?.textContent?.trim() || `La zona ${zona} representa el – de la superficie total del PRC.`
  };

  const metadataTecnica = {
    REG: props.REG || "–",
    COM: props.COM || "–",
    LOCALIDAD: props.LOCALIDAD || props.LOC || "–",
    ZONA: zona,
    NOMBRE: nombreNormativo,
    UPERM: props.UPERM || "–",
    UPROH: props.UPROH || "–",
    Capa: document.getElementById("md-capa")?.textContent?.trim() || "–",
    CUT: props.CUT || "–",
    Shape_STAr_ha: Number.isFinite(Number(props.Shape_STAr)) ? `${(Number(props.Shape_STAr) / 10000).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha` : "–",
    Shape_STLe_km: Number.isFinite(Number(props.Shape_STLe)) ? `${(Number(props.Shape_STLe) / 1000).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km` : "–"
  };

  const payload = {
    site: "GeoIPT",
    generatedAt: new Date().toISOString(),
    poi: {
      lat: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
      lon: Number.isFinite(lon) ? Number(lon.toFixed(6)) : null,
      utmEste: props.UTM_E || props.UTM_ESTE || null,
      utmNorte: props.UTM_N || props.UTM_NORTE || null
    },
    prc: {
      comuna: props.COM || "–",
      region: props.REG || "–",
      instrumento: obtenerNombrePRC(first.archivo),
      zona,
      estado: props.ESTADO || "Vigente",
      nombre: nombreNormativo,
      tipoZona,
      fuente: document.getElementById("rp-fuente")?.textContent?.trim() || document.getElementById("md-capa")?.textContent?.trim() || "–"
    },
    summary: interpretacion,
    usosPermitidos,
    restricciones,
    stats,
    metadataTecnica,
    mapImage: null
  };

  return payload;
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

function openGeoIptPdfReportV2() {
  const payload = buildGeoIptPdfPayload();
  sessionStorage.setItem("geoipt_pdf_payload", JSON.stringify(payload));
  window.open("report_html2pdf.html", "_blank");
}

window.buildGeoIptPdfPayload = buildGeoIptPdfPayload;
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
   FLUJO PRINCIPAL
--------------------------------------------- */
async function ejecutarFlujo() {
  const pre1 = document.getElementById("txt-instrumentos");
  const pre2 = document.getElementById("txt-instrumentos-punto");
  const preMeta = document.getElementById("txt-metadata-poligono");
  const btn = document.getElementById("btn-reporte");

  try {
    trackConsultaIniciada();

    if (btn) {
      btn.disabled = true;
      btn.style.opacity = 0.5;
      btn.onclick = null;
    }

    if (pre1) pre1.textContent = "(Cargando regiones que intersectan el BBOX...)";
    if (pre2) pre2.textContent = "";
    if (preMeta) preMeta.textContent = "(sin datos aún)";

    setLoadingProgress(15, "Buscando regiones...");

    const regiones = await obtenerRegionesIntersectadas();

    setLoadingProgress(38, "Cargando instrumentos...");

    if (pre1) pre1.textContent = "(Cargando IPT de las regiones intersectadas...)";
    const iptEnPantalla = await obtenerIptEnPantalla(regiones);

    if (pre1) pre1.textContent = JSON.stringify(iptEnPantalla, null, 2);

    if (!iptEnPantalla.length) {
      setLoadingProgress(100, "Sin resultados");

      if (pre2) {
        pre2.textContent =
          "⚠ No hay IPT cuyo BBOX intersecte la pantalla en este clic.\n" +
          "Volviendo al mapa principal con sugerencias cercanas...";
      }

      if (preMeta) {
        preMeta.textContent =
          "(no se encontraron IPT intersectando el BBOX para este clic)";
      }

      prepararBotonReporte([]);
      trackResultadoVacio("sin_ipt_en_bbox");

      setTimeout(() => {
        hideLoadingOverlay();
        volverAIndexConFallback();
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
          "Volviendo al mapa principal con sugerencias cercanas...";
      }

      if (preMeta) {
        preMeta.textContent =
          "(ningún polígono de los IPT intersectados contiene el punto clic)";
      }

      prepararBotonReporte([]);
      trackResultadoVacio("sin_poligono_contiene_punto");

      setTimeout(() => {
        hideLoadingOverlay();
        volverAIndexConFallback();
      }, 250);

      return;
    }

    if (pre2) {
      pre2.textContent = JSON.stringify(iptConPunto, null, 2);
    }

    setLoadingProgress(92, "Generando reporte...");

    prepararBotonReporte(iptConPunto);

    setLoadingProgress(100, "Listo");

    setTimeout(() => {
      hideLoadingOverlay();
    }, 320);

  } catch (err) {
    console.error("Error en ejecutarFlujo():", err);
    trackResultadoVacio("error_ejecucion");
    setLoadingProgress(100, "Error");
    setTimeout(() => {
      hideLoadingOverlay();
    }, 250);
  }
}

ejecutarFlujo();
