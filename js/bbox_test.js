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
const map = L.map("map").setView(
  (!Number.isNaN(lat) && !Number.isNaN(lon)) ? [lat, lon] : [-27, -70],
  zoom
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
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
          carpeta: ipt.carpeta
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
  set("md-loc", mapValores.LOCALIDAD || mapValores.LOC || "–");
  set("md-zona", mapValores.ZONA || "–");
  set("md-nombre", mapValores.NOMBRE || mapValores.NOM || "–");
  set("md-uperm", mapValores.UPERM || "–");
  set("md-uproh", mapValores.UPROH || "–");
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

function volverAIndex() {
  const url = `index.html?lat=${lat}&lon=${lon}&zoom=${zoom}`;
  window.location.href = url;
}

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
          "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
      }

      if (preMeta) {
        preMeta.textContent =
          "(no se encontraron IPT intersectando el BBOX para este clic)";
      }

      prepararBotonReporte([]);
      trackResultadoVacio("sin_ipt_en_bbox");

      setTimeout(() => {
        hideLoadingOverlay();
      }, 250);

      if (NO_MATCH_DELAY_MS >= 0) {
        setTimeout(cerrarPestana, Math.max(NO_MATCH_DELAY_MS, 350));
      }
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
          "Sugerencia: regrese al mapa principal y haga clic sobre un área urbana.";
      }

      if (preMeta) {
        preMeta.textContent =
          "(ningún polígono de los IPT intersectados contiene el punto clic)";
      }

      prepararBotonReporte([]);
      trackResultadoVacio("sin_poligono_contiene_punto");

      setTimeout(() => {
        hideLoadingOverlay();
      }, 250);

      if (NO_MATCH_DELAY_MS >= 0) {
        setTimeout(cerrarPestana, Math.max(NO_MATCH_DELAY_MS, 350));
      }
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