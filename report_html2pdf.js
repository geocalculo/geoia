(function () {
  const payloadRaw = sessionStorage.getItem("geoipt_pdf_payload");
  const reportRoot = document.getElementById("report-root");
  const statusEl = document.getElementById("pdf-status");
  const downloadBtn = document.getElementById("btn-download-pdf");

  function showStatus(message, type = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `pdf-status is-visible is-${type}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function formatDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? "–" : date.toLocaleString("es-CL");
  }

  function safeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Sin_dato";
  }

  function buildFilename(payload) {
    const date = payload?.generado_en ? new Date(payload.generado_en) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `GeoIPT_${safeName(payload?.contexto?.comuna)}_${safeName(payload?.resultado?.zona)}_${yyyy}${mm}${dd}_${hh}${mi}.pdf`;
  }

  function kv(items) {
    return `<dl class="grid">${items.map(([k, v]) => `<div class="kv"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "–")}</dd></div>`).join("")}</dl>`;
  }

  function renderTable(rows) {
    if (!Array.isArray(rows) || !rows.length) return "<p>Sin filas disponibles.</p>";
    const headers = Object.keys(rows[0] || {});
    return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function renderObjectTable(obj) {
    const rows = Object.entries(obj || {}).map(([Campo, Valor]) => ({ Campo, Valor }));
    return renderTable(rows);
  }

  function renderReport(payload) {
    console.info("[GeoCard PDF v2] Generando PDF desde payload GeoCard.");
    reportRoot.innerHTML = `
      <header class="report-title">
        <h1>GeoCard IPT | Reporte del punto consultado</h1>
        <p><strong>Fecha/hora:</strong> ${escapeHtml(formatDate(payload.generado_en))}</p>
        <p><strong>Coordenadas:</strong> ${escapeHtml(payload?.punto?.lat ?? "–")}, ${escapeHtml(payload?.punto?.lon ?? "–")}</p>
      </header>
      <section class="pdf-section"><h2>Resumen ejecutivo</h2>${kv([
        ["Comuna", payload?.contexto?.comuna],
        ["Región", payload?.contexto?.region],
        ["Localidad", payload?.contexto?.localidad],
        ["Fuente PRC", payload?.contexto?.fuente_prc],
        ["Instrumento", payload?.contexto?.instrumento],
        ["Estado", payload?.contexto?.estado]
      ])}</section>
      <section class="pdf-section"><h2>Resultado normativo</h2>${kv([
        ["Zona", payload?.resultado?.zona],
        ["Nombre normativo", payload?.resultado?.nombre_normativo],
        ["Tipo de zona", payload?.resultado?.tipo_zona],
        ["Usos permitidos", payload?.resultado?.usos_permitidos],
        ["Restricciones", payload?.resultado?.restricciones],
        ["Interpretación", payload?.resultado?.interpretacion]
      ])}</section>
      <section class="pdf-section"><h2>Mapa de referencia</h2>${payload?.mapa?.png ? `<img class="map-img" src="${escapeHtml(payload.mapa.png)}" alt="Mapa de referencia GeoCard" />` : `<div class="map-fallback">Mapa no disponible en esta exportación.</div>`}</section>
      <section class="pdf-section"><h2>Estadígrafos geométricos</h2><h3>Polígono consultado</h3>${kv(Object.entries(payload?.estadigrafos?.poligono || {}))}<h3>Categoría normativa</h3>${kv(Object.entries(payload?.estadigrafos?.categoria || {}))}</section>
      <section class="pdf-section"><h2>Tabla Match</h2>${renderTable(payload.tabla_match)}</section>
      <section class="pdf-section"><h2>Metadata técnica</h2>${renderObjectTable(payload.metadata)}</section>
      <footer class="pdf-section footer">GeoFactory / GeoIPT · Reporte generado automáticamente desde GeoCard IPT.</footer>
    `;
  }

  async function downloadPdf(payload) {
    if (typeof html2pdf !== "function") {
      throw new Error("html2pdf.js no está disponible");
    }
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "Generando PDF...";
    }
    const opt = {
      margin: [8, 8, 8, 8],
      filename: buildFilename(payload),
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, windowWidth: 980 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    };
    await html2pdf().set(opt).from(reportRoot).save();
    // Mantener payload en sessionStorage durante etapa de depuración PDF v2.
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Descargar PDF";
    }
  }

  let payload;
  try {
    if (!payloadRaw) throw new Error("No se encontró payload PDF. Vuelva a GeoCard y genere nuevamente el reporte.");
    payload = JSON.parse(payloadRaw);
    renderReport(payload);
  } catch (error) {
    console.error("[GeoCard PDF v2] Error leyendo payload PDF", error);
    showStatus(error.message || "No se pudo leer el payload PDF.", "error");
    if (reportRoot) reportRoot.innerHTML = "";
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  downloadBtn?.addEventListener("click", async () => {
    try {
      await downloadPdf(payload);
    } catch (error) {
      console.error("[GeoCard PDF v2] Error generando PDF", error);
      showStatus("No se pudo generar el PDF. Revise la consola para más detalle.", "error");
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Descargar PDF";
      }
    }
  });

  if (new URLSearchParams(window.location.search).get("autodownload") === "1") {
    downloadBtn?.click();
  }
})();
