(() => {
  const { jsPDF } = window.jspdf;

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

  function trackPdfDownload(fileName) {
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
    return [ne[0], ne[1], sw[0], sw[1]]; // [N, E, S, W]
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

        // URL absoluta para que el PDF no apunte al disco local
        const BASE_GEOIPT = "https://geoipt.cl";
        const href = `${BASE_GEOIPT}/capas/${carpeta}/${carpetaHtml}/${slug}.html`;

        setHtml(
          "md-capa",
          `<a class="pdf-link" href="${href}" target="_blank" rel="noopener" style="color:#0b63a3;font-weight:600;text-decoration:underline;">${slug} ↗</a>`
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

  function safeFileName() {
    const zona = document.getElementById("md-zona")?.textContent || "ZONA";
    const com = document.getElementById("md-com")?.textContent || "COMUNA";
    return `GeoIPT_${String(com).replace(/\s+/g, "_")}_${String(zona).replace(/\s+/g, "_")}_${stamp.file}.pdf`;
  }

  async function buildPdfBlob() {
    const root = document.getElementById("report-root");
    if (!root) throw new Error("No existe #report-root");

    await wait(1100);
    if (map) map.invalidateSize();
    await wait(900);

    const canvas = await html2canvas(root, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: root.scrollWidth,
      windowHeight: root.scrollHeight
    });

    const pdf = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
      compress: true
    });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;

    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;

    let remainingH = imgH;
    let sourceYpx = 0;
    let currentPageIndex = 0;
    const pagesInfo = [];

    while (remainingH > 0) {
      if (currentPageIndex > 0) pdf.addPage();

      const currentHmm = Math.min(usableH, remainingH);
      const currentHpx = Math.round((currentHmm * canvas.width) / imgW);

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = currentHpx;

      const ctx = pageCanvas.getContext("2d");
      ctx.drawImage(
        canvas,
        0,
        sourceYpx,
        canvas.width,
        currentHpx,
        0,
        0,
        canvas.width,
        currentHpx
      );

      const pageImg = pageCanvas.toDataURL("image/png", 1.0);
      pdf.addImage(pageImg, "PNG", margin, margin, imgW, currentHmm, undefined, "FAST");

      pagesInfo.push({
        pageNumber: currentPageIndex + 1,
        startMm: currentPageIndex * usableH,
        endMm: currentPageIndex * usableH + currentHmm
      });

      sourceYpx += currentHpx;
      remainingH -= currentHmm;
      currentPageIndex += 1;
    }

    // Insertar links vivos
    const rootRect = root.getBoundingClientRect();
    const links = root.querySelectorAll("a.pdf-link[href]");

    const scaleX = imgW / rootRect.width;
    const scaleY = imgH / rootRect.height;

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const rects = link.getClientRects();
      if (!rects || rects.length === 0) return;

      for (const rect of rects) {
        const xMm = margin + (rect.left - rootRect.left) * scaleX;
        const yGlobalMm = (rect.top - rootRect.top) * scaleY;
        const wMm = rect.width * scaleX;
        const hMm = rect.height * scaleY;

        if (wMm <= 0 || hMm <= 0) continue;

        const targetPage = pagesInfo.find(
          (p) => yGlobalMm >= p.startMm && yGlobalMm < p.endMm
        );

        if (!targetPage) continue;

        const yMm = margin + (yGlobalMm - targetPage.startMm);

        try {
          pdf.setPage(targetPage.pageNumber);
          pdf.link(xMm, yMm, wMm, hMm, { url: href });
        } catch (e) {
          console.warn("No se pudo insertar link PDF:", href, e);
        }
      }
    });

    return pdf.output("blob");
  }

  async function downloadPdf() {
    if (btnGenerate) btnGenerate.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    setStatus("Renderizando PDF...");

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

      await wait(1200);
      if (map) map.invalidateSize();

      if (btnGenerate) {
        btnGenerate.disabled = false;
        btnGenerate.textContent = "Descargar PDF";
      }
      if (btnDownload) btnDownload.disabled = !lastPdfBlobUrl;

      setStatus("Reporte listo para exportar.");

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