// ==========================================================
// GeoIPT - info.js
// Versión "camino simple":
//  - Lee lat, lon, zoom, ipts desde la URL.
//  - Carga SOLO esos archivos (KML/GeoJSON).
//  - Detecta qué polígonos contienen el clic.
//  - Muestra encabezado, mapa, detalle de zona, etc.
// ==========================================================

const mensaje = document.getElementById("mensaje");
const contenido = document.getElementById("contenido");

// ------------------------------
// 1. Leer parámetros de la URL
// ------------------------------
const params = new URLSearchParams(window.location.search);
const lat = parseFloat(params.get("lat"));
const lon = parseFloat(params.get("lon"));
const zoom = parseInt(params.get("zoom"), 10) || 17;
const iptsParam = params.get("ipts"); // rutas separadas por "|"

if (!iptsParam || !lat || !lon) {
  mensaje.innerHTML = `
    <div class="msg-error">
      No se recibieron parámetros válidos para el reporte.<br/>
      Vuelva al mapa principal e intente nuevamente.
    </div>
  `;
} else {
  contenido.style.display = "block";
  iniciarReporte(lat, lon, zoom, iptsParam.split("|").filter(Boolean));
}

// ==========================================================
// Funciones principales
// ==========================================================

async function iniciarReporte(lat, lon, zoom, iptRutas) {
  // 2. Encabezado WGS84 / UTM
  rellenarCoordenadas(lat, lon);

  // 3. Crear mapa base
  const map = crearMapa(lat, lon, zoom);

  // 4. Cargar IPT y encontrar polígonos que contienen el punto
  const resultado = await cargarIptsYBuscarPoligonos(lat, lon, iptRutas);

  if (!resultado.matches.length) {
    mensaje.innerHTML = `
      <div class="msg-error">
        No se encontró ningún polígono PRC/SCC que contenga exactamente el punto consultado.<br/>
        Intente nuevamente sobre un área urbana.
      </div>
    `;
    return;
  }

  // 5. Construir encabezado (región, instrumentos, etc.)
  construirEncabezado(resultado);

  // 6. Dibujar polígono(s) en el mapa y habilitar listado de vértices
  dibujarPoligonosEnMapa(map, lat, lon, resultado.matches);

  // 7. Texto de resultado + lista de coincidencias
  mostrarResultadoCoincidencias(resultado.matches);

  // 8. Detalle de atributos de la zona (usamos el primer polígono como "principal")
  const zonaPrincipal = resultado.matches[0];
  mostrarDetalleZona(zonaPrincipal);

  // 9. Tabla de instrumentos en pantalla (uno por archivo IPT)
  poblarTablaInstrumentos(resultado);

  // 10. Enlaces de descarga
  configurarDescargas(zonaPrincipal);
}

// ----------------------------------------------------------
// Encabezado: coordenadas WGS84 + UTM
// ----------------------------------------------------------
function rellenarCoordenadas(lat, lon) {
  document.getElementById("wgs-lat").textContent = lat.toFixed(6);
  document.getElementById("wgs-lon").textContent = lon.toFixed(6);

  // UTM automática
  let utmZone = Math.floor((lon + 180) / 6) + 1;
  if (utmZone < 1) utmZone = 1;
  if (utmZone > 60) utmZone = 60;

  const epsg = 32700 + utmZone; // hemisferio sur
  const utmDef = `+proj=utm +zone=${utmZone} +south +datum=WGS84 +units=m +no_defs`;

  let este = "";
  let norte = "";
  try {
    const res = proj4("EPSG:4326", utmDef, [lon, lat]);
    este = res[0].toFixed(3);
    norte = res[1].toFixed(3);
  } catch (e) {
    console.error("Error en transformación UTM", e);
  }

  document.getElementById("utm-e").textContent = este;
  document.getElementById("utm-n").textContent = norte;
  document.getElementById("utm-epsg").textContent = `EPSG:${epsg}`;
}

// ----------------------------------------------------------
// Crear mapa Leaflet + click para nueva consulta
// ----------------------------------------------------------
function crearMapa(lat, lon, zoom) {
  const map = L.map("map").setView([lat, lon], zoom || 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20
  }).addTo(map);

  // Punto consultado
  L.circleMarker([lat, lon], {
    radius: 7,
    weight: 3,
    color: "#0f172a",
    fillColor: "#ffffff",
    fillOpacity: 0.9
  }).addTo(map);

  // Click en mapa → nuevo index.html
  map.on("click", function (e) {
    const newLat = e.latlng.lat.toFixed(6);
    const newLon = e.latlng.lng.toFixed(6);
    const url = `index.html?lat=${newLat}&lon=${newLon}`;
    window.open(url, "_blank");
  });

  return map;
}

// ----------------------------------------------------------
// Cargar KML/GeoJSON de cada IPT y buscar polígonos que
// contienen el punto (lon, lat)
// ----------------------------------------------------------
async function cargarIptsYBuscarPoligonos(lat, lon, iptRutas) {
  const pt = turf.point([lon, lat]);
  const matches = [];       // lista de {ruta, archivo, properties, geometry}
  const instrumentosTabla = []; // uno por archivo IPT

  for (const ruta of iptRutas) {
    const archivo = ruta.split("/").pop();

    try {
      const resp = await fetch(ruta);
      if (!resp.ok) {
        console.warn("No se pudo leer IPT:", ruta);
        continue;
      }

      let geojson = null;
      const lower = archivo.toLowerCase();

      if (lower.endsWith(".json") || lower.endsWith(".geojson")) {
        geojson = await resp.json();
      } else if (lower.endsWith(".kml")) {
        const txt = await resp.text();
        const dom = new DOMParser().parseFromString(txt, "text/xml");
        geojson = toGeoJSON.kml(dom);
      } else {
        console.warn("Formato no manejado en info.js:", archivo);
        continue;
      }

      if (!geojson || !geojson.features) continue;

      let algunaCoincidenciaEnEsteArchivo = false;
      for (const f of geojson.features) {
        if (
          !f.geometry ||
          !["Polygon", "MultiPolygon"].includes(f.geometry.type)
        ) {
          continue;
        }

        if (turf.booleanPointInPolygon(pt, f)) {
          algunaCoincidenciaEnEsteArchivo = true;
          matches.push({
            ruta,
            archivo,
            properties: f.properties || {},
            geometry: f.geometry
          });
        }
      }

      // Para la tabla, registramos una fila por archivo IPT
      instrumentosTabla.push({
        archivo,
        ruta,
        propertiesEjemplo: geojson.features[0]
          ? (geojson.features[0].properties || {})
          : {},
        contienePunto: !!algunaCoincidenciaEnEsteArchivo
      });
    } catch (e) {
      console.error("Error procesando IPT en info.js:", ruta, e);
    }
  }

  return { matches, instrumentosTabla };
}

// ----------------------------------------------------------
// Construir encabezado (subtítulo, región, instrumentos)
// ----------------------------------------------------------
function construirEncabezado({ matches, instrumentosTabla }) {
  // Subtítulo: lista de archivos IPT
  const nombres = [...new Set(matches.map(m => m.archivo))];
  document.getElementById("subtitulo-instrumento").textContent =
    nombres.join(", ");

  // Región: tomamos REG del primer match que la tenga
  let region = "Región no especificada";
  for (const m of matches) {
    if (m.properties && m.properties.REG) {
      region = m.properties.REG;
      break;
    }
  }
  document.getElementById("region-texto").textContent = region;

  // Instrumentos texto
  document.getElementById("instrumentos-texto").textContent =
    nombres.join(", ");
}

// ----------------------------------------------------------
// Dibujar polígono(s) en el mapa y mostrar vértices
// ----------------------------------------------------------
function dibujarPoligonosEnMapa(map, lat, lon, matches) {
  const contVertices = document.getElementById("vertices-poligono");

  const capa = L.geoJSON(matches.map(m => ({
    type: "Feature",
    geometry: m.geometry,
    properties: m.properties
  })), {
    style: {
      color: "#2563eb",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 0.30
    }
  }).addTo(map);

  const bounds = capa.getBounds().extend([lat, lon]);
  map.fitBounds(bounds.pad(0.15));

  capa.on("click", function (e) {
    L.DomEvent.stop(e);

    let geom = e.layer.feature.geometry;
    let coords = [];

    if (geom.type === "Polygon") {
      coords = geom.coordinates[0];
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0 &&
      Array.isArray(geom.coordinates[0]) &&
      geom.coordinates[0].length > 0
    ) {
      coords = geom.coordinates[0][0];
    }

    if (!coords || !coords.length) return;

    const items = coords.map((par, idx) => {
      const lonV = Number(par[0]) || 0;
      const latV = Number(par[1]) || 0;
      return `<li>${idx + 1}. Lon: ${lonV.toFixed(6)} – Lat: ${latV.toFixed(6)}</li>`;
    }).join("");

    contVertices.innerHTML = `
      <h3 style="margin:10px 0 4px; font-size:0.95rem;">Vértices del polígono seleccionado</h3>
      <ol style="margin-left:18px;">
        ${items}
      </ol>
    `;
  });
}

// ----------------------------------------------------------
// Texto de resultado + lista de coincidencias
// ----------------------------------------------------------
function mostrarResultadoCoincidencias(matches) {
  const textoResultado = document.getElementById("texto-resultado");
  textoResultado.textContent =
    "Resultado: el punto consultado se encuentra dentro de al menos un polígono PRC/SCC.";

  const listaCoincidencias = document.getElementById("lista-coincidencias");
  const items = matches.map(m => {
    const zona = m.properties.ZONA || m.properties.NOM || "";
    return `<li>Coincidencia en archivo: <strong>${m.archivo}</strong> ${zona ? `– ${zona}` : ""}</li>`;
  }).join("");

  listaCoincidencias.innerHTML = items;
}

// ----------------------------------------------------------
// Detalle de atributos de la zona (primer polígono)
// ----------------------------------------------------------
function mostrarDetalleZona(zonaMatch) {
  const { archivo, properties, geometry } = zonaMatch;

  document.getElementById("titulo-detalle-poligono").textContent =
    `Detalle de atributos del/los polígono(s) – ${archivo}`;

  // Guardamos en global para descargas
  window.__geoipt_zonaActual = {
    archivo,
    properties,
    geometry
  };

  const tablaZona = document.getElementById("tabla-zona");
  const filas = Object.entries(properties || {})
    .map(([k, v]) => `
      <tr>
        <th style="width: 180px;">${k}</th>
        <td>${v}</td>
      </tr>
    `).join("");

  tablaZona.innerHTML = `<tbody>${filas}</tbody>`;
}

// ----------------------------------------------------------
// Tabla de instrumentos
// ----------------------------------------------------------
function poblarTablaInstrumentos({ instrumentosTabla }) {
  const cuerpo = document.querySelector("#tabla-lista tbody");
  const filas = instrumentosTabla.map(it => {
    const props = it.propertiesEjemplo || {};
    const nombre = it.archivo;
    const tipo =
      nombre.includes("_PRC") ? "PRC" :
      nombre.includes("_SCC") ? "SCC" : (props.tipo || "");
    const comuna = props.COM || props.COMUNA || "";

    return `
      <tr>
        <td>${nombre}</td>
        <td>${tipo}</td>
        <td>${comuna}</td>
        <td>${it.contienePunto ? "✔" : ""}</td>
      </tr>
    `;
  }).join("");

  cuerpo.innerHTML = filas;
}

// ----------------------------------------------------------
// Descargas: KML y JSON de la zona principal
// ----------------------------------------------------------
function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function construirKmlZona(zona) {
  if (!zona || !zona.geometry) return null;
  const geom = zona.geometry;
  let ring = [];

  if (geom.type === "Polygon" && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    ring = geom.coordinates[0];
  } else if (
    geom.type === "MultiPolygon" &&
    Array.isArray(geom.coordinates) &&
    geom.coordinates.length > 0 &&
    geom.coordinates[0].length > 0
  ) {
    ring = geom.coordinates[0][0];
  }

  if (!ring || ring.length < 3) return null;

  const coordsStr = ring.map(par => `${par[0]},${par[1]},0`).join(" ");

  const props = zona.properties || {};
  const nombreInstrumento = zona.archivo || "Zona GeoIPT";
  const nombreZona = props.NOM || props.ZONA || props.NOMBRE_PM || "Zona consultada";

  const attrsXml = Object.entries(props)
    .map(([k, v]) =>
      `        <Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(nombreInstrumento)}</name>
    <Style id="geoipt_poly">
      <LineStyle>
        <color>ffeb6325</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>66f6823b</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(nombreZona)}</name>
      <styleUrl>#geoipt_poly</styleUrl>
      <ExtendedData>
${attrsXml}
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${coordsStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
}

function configurarDescargas(zonaMatch) {
  const linkKml = document.getElementById("link-kml");
  const linkJsonZona = document.getElementById("link-json-zona");

  linkKml.addEventListener("click", function (ev) {
    ev.preventDefault();
    const zona = window.__geoipt_zonaActual;
    const kmlStr = construirKmlZona({
      archivo: zona.archivo,
      properties: zona.properties,
      geometry: zona.geometry
    });

    if (!kmlStr) {
      alert("No se pudo construir el KML de la zona consultada.");
      return;
    }

    const blob = new Blob([kmlStr], {
      type: "application/vnd.google-earth.kml+xml"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = (zona.archivo || "zona").replace(/\.kml$/i, "");
    a.download = `geoipt_zona_${baseName}.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  linkJsonZona.addEventListener("click", function (ev) {
    ev.preventDefault();
    const zona = window.__geoipt_zonaActual;
    const data = {
      archivo: zona.archivo,
      properties: zona.properties,
      geometry: zona.geometry
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = (zona.archivo || "zona").replace(/\.kml$/i, "");
    a.download = `geoipt_zona_${baseName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
