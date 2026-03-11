(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const lat = parseFloat(urlParams.get("lat"));
  const lon = parseFloat(urlParams.get("lon"));
  const bboxParam = urlParams.get("bbox");
  const zoomParam = parseInt(urlParams.get("zoom"), 10);
  const zoom = Number.isFinite(zoomParam) ? zoomParam : 14;
  const auto = urlParams.get("auto") !== "0";
  const autoclose = urlParams.get("autoclose") === "1";

  let bboxPantalla = null;
  let featuresSeleccionadas = [];
  let map = null;
  let matchLayer = null;
  let lastPdfBlobUrl = null;

  const btnGenerate = document.getElementById("btn-generate");
  const btnDownload = document.getElementById("btn-download");
  const statusEl = document.getElementById("status");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "-";
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html ?? "-";
  }

  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return {
      ui: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      file: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
    };
  }

  if (bboxParam) {
    const s = bboxParam.split(",");
    if (s.length === 4) {
      bboxPantalla = [parseFloat(s[0]), parseFloat(s[1]), parseFloat(s[2]), parseFloat(s[3])];
    }
  }

  const stamp = nowStamp();
  setText("fecha-reporte", stamp.ui);
  setText(
    "txt-punto",
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      : "-"
  );
  setText(
    "txt-bbox",
    bboxPantalla ? bboxPantalla.map((v) => Number(v).toFixed(6)).join(", ") : "-"
  );

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

  async function obtenerRegionesIntersectadas() {
    const resp = await fetch("capas/regiones.json");
    if (!resp.ok) throw new Error("No se pudo cargar capas/regiones.json");
    const regiones = await resp.json();
    return regiones.filter((reg) =>
      intersectaBbox(normalizarBBoxSWNE(reg.bbox), bboxPantalla)
    );
  }

  async function obtenerIptEnPantalla(regiones) {
    const lista = [];

    for (const reg of regiones) {
      const carpeta = reg.carpeta;
      const urlListado = `capas/${carpeta}/listado.json`;

      try {
        const resp = await fetch(urlListado);
        if (!resp.ok) continue;

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

  async function iptContienePunto(ipt, acumuladorFeatures) {
    const url = `capas/${ipt.carpeta}/${ipt.archivo}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) return false;

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

    for (const ipt of listaIpt) {
      if (await iptContienePunto(ipt, featuresParaDibujar)) {
        resultado.push(ipt);
      }
    }

    featuresSeleccionadas = featuresParaDibujar;
    return resultado;
  }

  function dibujarPoligonosMatch(features) {
    if (!map) return;

    if (matchLayer) {
      map.removeLayer(matchLayer);
      matchLayer = null;
    }

    if (!features || !features.length) return;

    matchLayer = L.geoJSON(
      { type: "FeatureCollection", features },
      {
        style: {
          color: "#2563eb",
          weight: 2,
          fillColor: "#3b82f6",
          fillOpacity: 0.35
        }
      }
    ).addTo(map);

    const bounds = matchLayer.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }

  function slugInstrumentoDesdeArchivo(archivoKml) {
    if (!archivoKml) return "";
    const sinExt = archivoKml.replace(/\.kml$/i, "");
    const partes = sinExt.split("_");
    const idxPRC = partes.indexOf("PRC");
    if (idxPRC < 0) return "";
    const resto = partes.slice(idxPRC + 1).join("_").toLowerCase();
    return resto ? `PRC_${resto}` : "";
  }

  function actualizarTablaDesdeMetadata(meta, carpeta, archivo) {
    const mapData = {};

    Object.entries(meta || {}).forEach(([k, v]) => {
      mapData[String(k).toUpperCase()] = v;
    });

    setText("md-reg", mapData.REG || "-");
    setText("md-com", mapData.COM || "-");
    setText("md-loc", mapData.LOCALIDAD || mapData.LOC || "-");
    setText("md-zona", mapData.ZONA || "-");
    setText("md-nombre", mapData.NOMBRE || mapData.NOM || "-");
    setText("md-uperm", mapData.UPERM || "-");
    setText("md-uproh", mapData.UPROH || "-");
    setText("md-cut", mapData.CUT || "-");

    setText("sum-reg", mapData.REG || "-");
    setText("sum-com", mapData.COM || "-");
    setText("sum-loc", mapData.LOCALIDAD || mapData.LOC || "-");
    setText("sum-zona", mapData.ZONA || "-");
    setText("sum-nombre", mapData.NOMBRE || mapData.NOM || "-");
    setText("sum-cut", mapData.CUT || "-");

    if (archivo && carpeta) {
      const slug = slugInstrumentoDesdeArchivo(archivo);

      if (slug) {
        const sufijo = carpeta.replace("capas_", "");
        const carpetaHtml = `html_${sufijo}`;
        const baseGeoipt = "https://geoipt.cl";
        const href = `${baseGeoipt}/capas/${carpeta}/${carpetaHtml}/${slug}.html`;

        setHtml(
          "md-capa",
          `<a href="${href}" target="_blank" rel="noopener">${slug} ↗</a>`
        );
      } else {
        setText("md-capa", `${carpeta}/${archivo}`);
      }
    } else {
      setText("md-capa", "-");
    }
  }

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true
    }).setView(
      Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : [-27, -70],
      zoom
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(map);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      L.circleMarker([lat, lon], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1
      }).addTo(map);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // FIX 8: Espera activa a que todos los tiles del mapa estén cargados,
  // con timeout de seguridad. Evita capturar el mapa con tiles en gris.
  function waitForMapTiles(timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!map) return resolve();

      const deadline = Date.now() + timeoutMs;

      function check() {
        // Leaflet expone _tilesToLoad en el tileLayer activo
        let pending = 0;
        map.eachLayer((layer) => {
          if (layer._tilesToLoad !== undefined) {
            pending += layer._tilesToLoad;
          }
        });

        if (pending === 0 || Date.now() > deadline) {
          resolve();
        } else {
          setTimeout(check, 150);
        }
      }

      check();
    });
  }

  function safeFileName() {
    const zona = document.getElementById("md-zona")?.textContent || "ZONA";
    const com = document.getElementById("md-com")?.textContent || "COMUNA";
    return `GeoIPT_${String(com).replace(/\s+/g, "_")}_${String(zona).replace(/\s+/g, "_")}_${stamp.file}.pdf`;
  }

  async function buildPdfBlob() {
    const root = document.getElementById("report-root");
    if (!root) throw new Error("No existe #report-root");

    // FIX 9: Secuencia de espera más robusta para el mapa:
    // 1) invalidateSize fuerza recálculo del viewport
    // 2) waitForMapTiles espera activamente que los tiles terminen
    // 3) Un último wait corto deja que el browser pinte el canvas final
    if (map) map.invalidateSize();
    await waitForMapTiles(8000);
    await wait(600);

    // FIX 10: windowWidth fijo (980px = max-width del .page) para que
    // html2canvas siempre renderice con el mismo ancho y no dependa del
    // viewport actual del usuario.
    const RENDER_WIDTH = 980;

    const opt = {
      margin: [8, 8, 8, 8],
      filename: safeFileName(),
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: RENDER_WIDTH,
        // FIX 11: scrollX/scrollY explícitos para evitar offsets por scroll
        scrollX: 0,
        scrollY: -window.scrollY
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait"
      },
      pagebreak: {
        mode: ["css", "legacy"]
      }
    };

    const worker = html2pdf().set(opt).from(root).toPdf();
    const pdf = await worker.get("pdf");
    return pdf.output("blob");
  }

  async function trackPdfDownload(fileName) {
    try {
      if (typeof gtag === "function") {
        gtag("event", "download_pdf", {
          event_category: "GeoIPT",
          event_label: fileName,
          file_name: fileName,
          lat: Number.isFinite(lat) ? lat : undefined,
          lon: Number.isFinite(lon) ? lon : undefined
        });
      }
    } catch (_) {}
  }

  async function downloadPdf() {
    if (btnGenerate) btnGenerate.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    setStatus("Renderizando PDF con html2pdf.js...");

    try {
      const blob = await buildPdfBlob();

      if (lastPdfBlobUrl) URL.revokeObjectURL(lastPdfBlobUrl);
      lastPdfBlobUrl = URL.createObjectURL(blob);

      const fileName = safeFileName();
      const a = document.createElement("a");
      a.href = lastPdfBlobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (btnGenerate) {
        btnGenerate.textContent = "PDF generado";
        btnGenerate.disabled = false;
      }
      if (btnDownload) btnDownload.disabled = false;

      setStatus(`PDF listo: ${fileName}`);
      trackPdfDownload(fileName);

      if (autoclose) {
        setTimeout(() => window.close(), 900);
      }
    } catch (err) {
      console.error(err);
      setStatus("No se pudo generar el PDF.");
      if (btnGenerate) btnGenerate.disabled = false;
    }
  }

  async function run() {
    try {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !bboxPantalla) {
        setStatus("Faltan parámetros lat, lon o bbox.");
        if (btnGenerate) {
          btnGenerate.textContent = "Sin parámetros";
          btnGenerate.disabled = true;
        }
        return;
      }

      initMap();

      setStatus("Buscando regiones e IPT coincidentes...");
      const regiones = await obtenerRegionesIntersectadas();
      const iptEnPantalla = await obtenerIptEnPantalla(regiones);
      const iptConPunto = await obtenerIptQueContienenElPunto(iptEnPantalla);

      if (!iptConPunto.length || !featuresSeleccionadas.length) {
        setStatus("No se encontraron polígonos coincidentes para este punto.");
        if (btnGenerate) {
          btnGenerate.textContent = "Sin coincidencias";
          btnGenerate.disabled = true;
        }
        return;
      }

      const primerItem = featuresSeleccionadas[0];
      actualizarTablaDesdeMetadata(
        primerItem.metadata || {},
        primerItem.carpeta,
        primerItem.archivo
      );

      dibujarPoligonosMatch(featuresSeleccionadas.map((x) => x.feature));

      // FIX 12: invalidateSize + espera de tiles antes de habilitar el botón,
      // para que si el usuario genera el PDF manualmente el mapa ya esté listo.
      if (map) map.invalidateSize();
      await waitForMapTiles(8000);
      await wait(400);

      if (btnGenerate) {
        btnGenerate.disabled = false;
        btnGenerate.textContent = "Descargar PDF";
      }
      if (btnDownload) btnDownload.disabled = !lastPdfBlobUrl;

      setStatus("Reporte listo para exportar (ensayo html2pdf.js).");

      if (auto) {
        await downloadPdf();
      }
    } catch (err) {
      console.error(err);
      setStatus("Error preparando el reporte PDF.");
      if (btnGenerate) {
        btnGenerate.textContent = "Reintentar";
        btnGenerate.disabled = false;
      }
    }
  }

  btnGenerate?.addEventListener("click", downloadPdf);

  btnDownload?.addEventListener("click", () => {
    if (!lastPdfBlobUrl) {
      downloadPdf();
      return;
    }

    const a = document.createElement("a");
    const fileName = safeFileName();
    a.href = lastPdfBlobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    trackPdfDownload(fileName);
  });

  run();
})();