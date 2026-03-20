/************************************************************
 * GeoIPT - bbox_test.js  (Versión ajustada con polígonos AZULES)
 *
 * PASO 1: Regiones cuyo BBOX toca la pantalla
 * PASO 2: IPT cuyo BBOX toca la pantalla
 * PASO 3: IPT cuya GEOMETRÍA contiene el clic
 * PASO 4: Si hay IPT → habilitar botón y abrir info.html
 *         Si no hay  → mensaje + cerrar pestaña automáticamente
 *
 * Cambios:
 *  - Se elimina el rectángulo verde del BBOX
 *  - Se dibujan en AZUL los polígonos que contienen el punto
 *  - Se muestra metadata de TODOS los polígonos match
 *  - Desde el mapa se puede hacer clic para abrir NUEVO bbox_test en otra pestaña
 *  - Si no hay match, se cierra la pestaña tras NO_MATCH_DELAY_MS
 ************************************************************/

// Tiempo de espera cuando NO hay match (en milisegundos)
//  5000 = 5 segundos
//  0    = cierre inmediato
//  -1   = NO cerrar automáticamente
const NO_MATCH_DELAY_MS = 0;

/* ---------------------------------------------
   1) PARÁMETROS DE LA URL
---------------------------------------------*/
const urlParams = new URLSearchParams(window.location.search);
const lat = parseFloat(urlParams.get("lat"));
const lon = parseFloat(urlParams.get("lon"));
const bboxParam = urlParams.get("bbox");
const zoomParam = parseInt(urlParams.get("zoom"), 10);
const zoom = Number.isFinite(zoomParam) ? zoomParam : 14;

let btnKml = null;

function initKmlButton() {
  btnKml = document.getElementById("btn-kml");
  if (!btnKml) return;

  btnKml.disabled = true;
  btnKml.classList.remove("is-ready");

  btnKml.addEventListener("click", () => {
    if (!featuresSeleccionadas || !featuresSeleccionadas.length) return;
    descargarKmlZona();
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

// Mostrar en texto
if (!isNaN(lat) && !isNaN(lon)) {
  const pTxt = document.getElementById("txt-punto");
  if (pTxt) {
    pTxt.textContent = `Lat: ${lat.toFixed(6)}, Lon: ${lon.toFixed(6)}`;
  }
}
if (bboxPantalla) {
  const bboxTxt = document.getElementById("txt-bbox");
  if (bboxTxt) {
    bboxTxt.textContent =
      `${bboxPantalla[0].toFixed(6)}, ${bboxPantalla[1].toFixed(6)}, ` +
      `${bboxPantalla[2].toFixed(6)}, ${bboxPantalla[3].toFixed(6)}`;
  }
}

/* ---------------------------------------------
   2) MAPA LEAFLET
---------------------------------------------*/
const map = L.map("map").setView(
  (!isNaN(lat) && !isNaN(lon)) ? [lat, lon] : [-27, -70],
  zoom
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

// ✅ Inicializa el botón KML (debe existir en el HTML)
initKmlButton();



// Punto del clic original: marcador con popup
if (!isNaN(lat) && !isNaN(lon)) {
  const marker = L.marker([lat, lon]).addTo(map);

  marker.bindPopup(
    `<strong>Punto consultado</strong><br>` +
    `Lat: ${lat.toFixed(6)}<br>` +
    `Lon: ${lon.toFixed(6)}`
  ).openPopup();
}




/* 🔥 NUEVA LÓGICA:
   Desde este mapa, cualquier clic abre OTRO bbox_test.html
   en una pestaña nueva, usando el BBOX actual de la vista. */
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

  // Construimos la URL del mismo bbox_test.html
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const nuevaUrl =
    `${baseUrl}?lat=${latClick}&lon=${lonClick}` +
    `&zoom=${zoomClick}&bbox=${bboxStr}`;

  // Abrir en nueva pestaña
  window.open(nuevaUrl, "_blank");
});

/* ***********************************************
   ❌ NO DIBUJAMOS EL RECTÁNGULO VERDE DEL BBOX
*********************************************** */
// if (bboxPantalla) {
//   L.rectangle(...).addTo(map);
// }

/* ---------------------------------------------
   UTILIDADES DE BBOX
---------------------------------------------*/
function normalizarBBoxSWNE(b) {
  if (!b || b.length !== 2) return null;
  const sw = b[0]; // [lat_s, lon_w]
  const ne = b[1]; // [lat_n, lon_e]
  return [ne[0], ne[1], sw[0], sw[1]]; // [N, E, S, W]
}

function intersectaBbox(a, b) {
  if (!a || !b) return false;
  const [N1, E1, S1, W1] = a;
  const [N2, E2, S2, W2] = b;
  return !(S1 > N2 || N1 < S2 || W1 > E2 || E1 < W2);
}

/* ---------------------------------------------
   PASO 1: Regiones que intersectan el BBOX
---------------------------------------------*/
async function obtenerRegionesIntersectadas() {
  const resp = await fetch("capas/regiones.json");
  const regiones = await resp.json();

  return regiones.filter(reg => {
    const bboxReg = normalizarBBoxSWNE(reg.bbox);
    return intersectaBbox(bboxReg, bboxPantalla);
  });
}

/* ---------------------------------------------
   PASO 2: IPT cuyo BBOX intersecta el BBOX
---------------------------------------------*/
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
---------------------------------------------*/

// Capa global para los polígonos match AZULES
let matchLayer = null;

let featuresSeleccionadas = [];


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
      if (
        !f.geometry ||
        !["Polygon", "MultiPolygon"].includes(f.geometry.type)
      ) {
        continue;
      }

      if (turf.booleanPointInPolygon(pt, f)) {
        // Guardamos feature + metadata + archivo/carpeta
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

  // Si hay matches, dibujamos y mostramos metadata
  if (featuresParaDibujar.length > 0) {
    // dibujar polígono(s) azul(es)
  if (featuresParaDibujar.length > 0) {
    dibujarPoligonosMatch(featuresParaDibujar.map(f => f.feature));

  const metaBox = document.getElementById("txt-metadata-poligono");
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

  // ✅ usar SOLO el primer polígono para rellenar la tabla
  const primerItem = featuresParaDibujar[0];
  actualizarTablaDesdeTexto(
    Object.entries(primerItem.metadata || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    primerItem.carpeta,
    primerItem.archivo
  );
}


    // 👉 Guardamos selección para exportar
    featuresSeleccionadas = featuresParaDibujar;

    // ✅ Habilitar botón KML
    if (btnKml) {
      btnKml.disabled = false;
      btnKml.classList.add("is-ready");
    }



    // 👉 Activar enlace de descarga KML

    // 👉 Activar enlace de descarga KML (LIBRE)
    if (linkKml) {
      linkKml.style.display = "inline";     // ✅ clave: sacar el display:none del HTML
      linkKml.style.opacity = "1";
      linkKml.style.pointerEvents = "auto";
      linkKml.href = "#";                   // por si quedó algo anterior

      linkKml.onclick = function (e) {
        e.preventDefault();
        descargarKmlZona();                 // esto dispara la descarga con Blob + click()
      };
    }


  } else {
    // Sin matches
    if (metaBox) {
      metaBox.textContent =
        "(ningún polígono contiene el punto clic en los IPT analizados)";
    }

    // limpiar selección y desactivar botón
    featuresSeleccionadas = [];

    // ❌ Bloquear botón KML
    if (btnKml) {
      btnKml.disabled = true;
      btnKml.classList.remove("is-ready");
    }

  }

  return resultado;
}


/* ---------------------------------------------
   Dibujar polígonos match en AZUL
---------------------------------------------*/
function dibujarPoligonosMatch(features) {
  // Borrar resaltado anterior
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
      color: "#2563eb",      // borde azul
      weight: 2,
      fillColor: "#3b82f6",  // relleno azul
      fillOpacity: 0.35
    }
  }).addTo(map);

  try {
    const bounds = matchLayer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch (e) {
    // por si acaso
  }
}

function polygonToKml(polyCoords) {
  const outer = polyCoords[0] || [];
  const coordStr = outer.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
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
  return multiCoords.map(p => polygonToKml(p)).join("");
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
      extendedData += `<Data name="${escapeXml(k)}"><value>${escapeXml(
        v
      )}</value></Data>`;
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
  // Convierte líneas del tipo "REG: Atacama" en un diccionario { REG: "Atacama", ... }
  const map = {};
  const lineas = (texto || "").split(/\r?\n/);

  lineas.forEach((line) => {
    const m = line.match(/^([A-Z_]+)\s*:\s*(.+)$/i);
    if (!m) return;
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    map[key] = value;
  });

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "–";
  };

  const setHtml = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html ?? "–";
  };

  // Función local: desde IPT_03_PRC_Copiapo.kml -> PRC_copiapo
  const slugInstrumentoDesdeArchivo = (archivoKml) => {
    if (!archivoKml) return "";
    const sinExt = archivoKml.replace(/\.kml$/i, "");
    const partes = sinExt.split("_");
    const idxPRC = partes.indexOf("PRC");
    if (idxPRC < 0) return "";

    const resto = partes.slice(idxPRC + 1).join("_").toLowerCase();
    return resto ? `PRC_${resto}` : "";
  };

  // Campos principales
  set("md-reg", map.REG || "–");
  set("md-com", map.COM || "–");
  set("md-loc", map.LOCALIDAD || map.LOC || "–");
  set("md-zona", map.ZONA || "–");
  set("md-nombre", map.NOMBRE || map.NOM || "–");
  set("md-uperm", map.UPERM || "–");
  set("md-uproh", map.UPROH || "–");
  set("md-cut", map.CUT || "–");

  // Campo CAPA -> mostrar link al HTML del PRC
  if (archivo && carpeta) {
    const slug = slugInstrumentoDesdeArchivo(archivo);

    if (slug) {
      // carpeta = "capas_03" -> html_03
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
  const pad = n => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

// Extrae "PRC Antuco" desde "IPT_08_PRC_Antuco.kml", por ejemplo
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


function descargarKmlZona() {
  if (!featuresSeleccionadas || !featuresSeleccionadas.length) {
    alert("No hay polígonos seleccionados para exportar.");
    return;
  }

  // Usamos el primer feature para armar el nombre
  const first = featuresSeleccionadas[0];
  const props = first.metadata || {};
  const zona = props.ZONA || props.zona || "ZONA";
  const prcNombre = obtenerNombrePRC(first.archivo); // viene desde iptContienePunto
  const stamp = timestampYYYYMMDDHHMM();

  const nombreKml = `${prcNombre} ${zona} ${stamp}`;

  const placemarks = featuresSeleccionadas
    .map((item, idx) =>
      featureToKmlPlacemark(
        item.feature,
        item.metadata,
        `Zona ${idx + 1}`
      )
    )
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>${escapeXml(nombreKml)}</name>
      <Style id="geoipt_poly">
        <LineStyle>
          <!-- ff0000ff = opaco, azul (ABGR) -->
          <color>ffeb6325</color>
          <width>2</width>
        </LineStyle>
        <PolyStyle>
          <!-- 660000ff = azul semitransparente -->
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
  // nombre de archivo: mismo nombre, espacios a "_"
  a.download = nombreKml.replace(/\s+/g, "_") + ".kml";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}





/* ---------------------------------------------
   PASO 4: Navegación (info.html / cierre pestaña)
---------------------------------------------*/

function cerrarPestana() {
  // Si fue abierta por window.open, se cierra sin aviso
  if (window.opener && !window.opener.closed) {
    window.close();
  } else {
    // Fallback por si el navegador bloquea window.close
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
    .map(ipt => `capas/${ipt.carpeta}/${ipt.archivo}`)
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
   FLUJO PRINCIPAL
---------------------------------------------*/
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

    // PASO 1
    const regiones = await obtenerRegionesIntersectadas();

    setLoadingProgress(38, "Cargando instrumentos...");

    // PASO 2
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

      setTimeout(() => {
        hideLoadingOverlay();
      }, 250);

      if (NO_MATCH_DELAY_MS >= 0) {
        setTimeout(cerrarPestana, Math.max(NO_MATCH_DELAY_MS, 350));
      }
      return;
    }

    setLoadingProgress(72, "Analizando geometría...");

    // PASO 3
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

    // PASO 4
    prepararBotonReporte(iptConPunto);

    setLoadingProgress(100, "Listo");

    setTimeout(() => {
      hideLoadingOverlay();
    }, 320);

  } catch (err) {
    console.error("Error en ejecutarFlujo():", err);
    setLoadingProgress(100, "Error");
    setTimeout(() => {
      hideLoadingOverlay();
    }, 250);
  }
}
ejecutarFlujo();
