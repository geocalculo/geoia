# Fase 1 — Consolidación de flujos PDF (GeoIPT)

## 1) Resumen ejecutivo

Esta fase **no corrige la generación PDF** (paginación/cortes/calidad), sino que consolida arquitectura y reduce conflicto entre implementaciones legacy. Se identificó que el estado operativo actual mantiene el botón PDF deshabilitado en `bbox_test.html`, pero aún conviven scripts/librerías y código inline heredado con potencial de reactivación accidental.

Resultado de Fase 1:
- Flujo productivo PDF queda explícitamente en estado de mantenimiento: **"📄 PDF próximamente"**.
- Se define un único flujo objetivo para PDF v2.
- Se marcan flujos legacy como deprecados (sin eliminarlos).

---

## 2) Inventario de archivos/elementos PDF relacionados

| Archivo | Función | Estado | ¿Se usa realmente? | Observaciones |
|---|---|---|---|---|
| `bbox_test.html` | Vista principal de resultado + botón PDF + script inline de export con `html2canvas + jsPDF` | Legacy conflictivo | Parcial (la página sí, export no) | Botón PDF deshabilitado por script; mantiene código completo de export inline listo para activarse si se engancha handler. |
| `js/bbox_test.js` | Flujo principal GIS (mapa, match PRC, KML, tracking) | Activo | Sí | No genera PDF, pero es el controlador de la pantalla donde vive el botón PDF. |
| `report_html2pdf.html` | Plantilla dedicada para prueba de export con `html2pdf.js` | Ensayo / candidato v2 | No en producción actual | Incluye estructura orientada a reporte limpio (fondo blanco y layout estable). |
| `js/report_html2pdf.js` | Lógica de generación en `report_html2pdf.html` | Ensayo / legacy intermedio | No en producción actual | Debe marcarse deprecado hasta formalizar PDF v2. |
| `report.html` | Plantilla de reporte alternativa con `html2canvas + jsPDF` | Legacy | No en producción actual | Compite con `report_html2pdf.html`; sin punto de entrada oficial actual. |
| CDNs en `bbox_test.html` | `html2canvas` y `jspdf` | Legacy conflictivo | Cargados pero no usados funcionalmente | Carga innecesaria mientras botón está deshabilitado. |
| iframe GTM (`bbox_test.html`) | iframe analytics noscript | Activo | Sí | No es flujo PDF; no tocar. |

---

## 3) Flujo real actual (as-is)

```text
bbox_test.html
  -> renderiza botón "📄 PDF próximamente" deshabilitado
  -> setupPdfButtonActions() fuerza disabled + sin onclick
  -> NO hay flujo PDF activo en producción

(legacy aún presente en código inline)
  handleExportPdf()
    -> exportGeoIptPdfDirectDownload()
      -> captura mapa clonado con html2canvas
      -> clona .report-card
      -> rasteriza card completa con html2canvas
      -> multipágina manual con jsPDF.addPage()
      -> doc.save()
```

Conclusión: el flujo ejecutable real hoy termina en **no-op controlado** (botón deshabilitado), pero existe código legacy listo para ejecución accidental.

---

## 4) Conflictos detectados

1. **Múltiples estrategias PDF coexistiendo**:
   - `html2canvas + jsPDF` (inline en `bbox_test.html`, y también patrón en `report.html`).
   - `html2pdf.js` (en `report_html2pdf.html`).

2. **Múltiples plantillas de reporte**:
   - `report.html` vs `report_html2pdf.html` sin contrato único.

3. **Código PDF incrustado en vista operativa**:
   - `bbox_test.html` mezcla UI GIS + export raster + estilos print.

4. **Dependencias cargadas sin uso efectivo** (estado actual):
   - `html2canvas/jspdf` en `bbox_test.html` con botón deshabilitado.

5. **Riesgo de doble render / reactivación accidental**:
   - funciones `handleExportPdf/exportGeoIptPdfDirectDownload` presentes aunque el botón esté desactivado.

---

## 5) Arquitectura oficial propuesta (target PDF v2)

```text
bbox_test.html
  -> botón PDF (único entrypoint)
  -> prepara payload JSON limpio de consulta
  -> abre report_html2pdf.html con payload serializado (query/sessionStorage)
  -> report_html2pdf.html renderiza layout PDF-only (fondo blanco)
  -> paginación por bloques semánticos (no screenshot del visor)
  -> descarga directa jsPDF/html2pdf controlada
```

### Componentes oficiales propuestos
- **Controlador principal**: `js/pdf_v2_controller.js` (nuevo, único orquestador).
- **Plantilla principal PDF**: `report_html2pdf.html` (consolidada y endurecida).
- **CSS principal PDF**: `css/report_pdf.css` (nuevo; separar estilos PDF de `bbox_test.html`).
- **Contrato de datos**: `GeoIPTPdfPayload` (objeto tipado estable para mapa + metadata + tabla + KPI).

---

## 6) Legacy a congelar (sin borrar en Fase 1)

- `report.html` → congelar como referencia legacy.
- Export inline en `bbox_test.html` (`handleExportPdf`, `exportGeoIptPdfDirectDownload`, `captureMapAsFrozenImage`) → congelar/deprecado.
- `js/report_html2pdf.js` actual → mantener solo para ensayo y marcar deprecado hasta migración a `pdf_v2_controller.js`.

---

## 7) Estado final estable esperado tras Fase 1

- Un único punto de entrada de producto: botón PDF en `bbox_test.html`.
- Botón en modo mantenimiento: **deshabilitado + mensaje "📄 PDF próximamente"**.
- Flujos legacy explícitamente deprecados por log.
- Sin impacto sobre KML, PRC, CARD, mapa, navegación ni tracking.

---

## 8) Recomendación técnica final

1. Cerrar Fase 1 con limpieza contractual (entrypoint único + deprecations).
2. Iniciar Fase 2 creando `pdf_v2_controller.js` y `report_pdf.css`.
3. Mover todo código PDF fuera de `bbox_test.html`.
4. Mantener render semántico en plantilla dedicada (evitar screenshot integral del visor interactivo).
