(function () {
  "use strict";

  function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
  }

  function isValidBBox(bbox) {
    return (
      Array.isArray(bbox) &&
      bbox.length === 2 &&
      Array.isArray(bbox[0]) &&
      Array.isArray(bbox[1]) &&
      bbox[0].length === 2 &&
      bbox[1].length === 2 &&
      isFiniteNumber(bbox[0][0]) &&
      isFiniteNumber(bbox[0][1]) &&
      isFiniteNumber(bbox[1][0]) &&
      isFiniteNumber(bbox[1][1])
    );
  }

  function normalizeBBox(bbox) {
    if (!isValidBBox(bbox)) return null;

    const south = Number(bbox[0][0]);
    const west = Number(bbox[0][1]);
    const north = Number(bbox[1][0]);
    const east = Number(bbox[1][1]);

    if (south > north || west > east) return null;
    return { south, west, north, east };
  }

  function buildLeafletBounds(bbox) {
    const normalized = normalizeBBox(bbox);
    if (!normalized || !window.L) return null;

    return window.L.latLngBounds(
      [normalized.south, normalized.west],
      [normalized.north, normalized.east]
    );
  }

  function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMiles(value) {
    return Math.round(value).toLocaleString("es-CL");
  }

  function createPRCSummary(options) {
    const config = {
      map: options?.map || null,
      getItems: typeof options?.getItems === "function" ? options.getItems : () => [],
      catalogUrl: options?.catalogUrl || "/capas/catalogo_prc.json",
      summarySelector: options?.summarySelector || "#prc-summary",
      emptyBehavior: options?.emptyBehavior || "hide",
      debug: Boolean(options?.debug)
    };

    let map = config.map;
    let rafId = null;
    let isInitialized = false;
    let itemsCache = [];
    let hasLoadedCatalog = false;

    function log(...args) {
      if (config.debug) console.log("[prcSummary]", ...args);
    }

    function getSummaryEl() { return document.querySelector(config.summarySelector); }
    function getPRCCountEl() { return document.querySelector("#prc-count"); }
    function getHectareasEl() { return document.querySelector("#hectareas-count"); }
    function getZonasEl() { return document.querySelector("#zonas-count"); }

    async function loadCatalog() {
      if (hasLoadedCatalog) return;
      hasLoadedCatalog = true;

      try {
        const response = await fetch(config.catalogUrl, { cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        itemsCache = list.filter((item) => item && typeof item === "object" && isValidBBox(item.bbox));
        log("Catálogo cargado:", itemsCache.length, "desde", config.catalogUrl);
      } catch (error) {
        const fallback = config.getItems();
        itemsCache = Array.isArray(fallback)
          ? fallback.filter((item) => item && typeof item === "object" && isValidBBox(item.bbox))
          : [];
        log("No se pudo cargar catálogo, usando fallback getItems():", error);
      }
    }

    function intersectsCurrentView(itemBBox) {
      if (!map || !window.L) return false;
      const viewBounds = map.getBounds();
      const itemBounds = buildLeafletBounds(itemBBox);

      if (!viewBounds || !itemBounds || !viewBounds.isValid() || !itemBounds.isValid()) return false;
      return viewBounds.intersects(itemBounds);
    }

    function getVisibleItems() {
      const byKey = new Map();
      for (const item of itemsCache) {
        if (!intersectsCurrentView(item.bbox)) continue;
        const key = item.archivo || item.id || `${item.nombre || ""}__${JSON.stringify(item.bbox)}`;
        if (!byKey.has(key)) byKey.set(key, item);
      }
      return Array.from(byKey.values());
    }

    function buildMetrics(visibles) {
      let totalHas = 0;
      let totalZonas = 0;

      for (const item of visibles) {
        totalHas += asNumber(item.superficie_ha);
        totalZonas += asNumber(item.zonas_unicas);
      }

      return {
        totalPRC: visibles.length,
        totalHas,
        totalZonas: Math.round(totalZonas)
      };
    }

    function render(metrics) {
      const summaryEl = getSummaryEl();
      const prcEl = getPRCCountEl();
      const hasEl = getHectareasEl();
      const zonasEl = getZonasEl();

      if (!summaryEl) return;

      if (metrics.totalPRC <= 0 && config.emptyBehavior === "hide") {
        summaryEl.hidden = true;
        summaryEl.style.display = "none";
        if (prcEl) prcEl.textContent = "0";
        if (hasEl) hasEl.textContent = "0";
        if (zonasEl) zonasEl.textContent = "0";
        return;
      }

      if (prcEl) prcEl.textContent = formatMiles(metrics.totalPRC);
      if (hasEl) hasEl.textContent = formatMiles(metrics.totalHas);
      if (zonasEl) zonasEl.textContent = formatMiles(metrics.totalZonas);

      summaryEl.hidden = false;
      summaryEl.style.display = "";
    }

    function update() {
      if (!map) return null;
      const visibles = getVisibleItems();
      const metrics = buildMetrics(visibles);
      render(metrics);
      return { ...metrics, items: visibles };
    }

    function scheduleUpdate() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    }

    function bindMapEvents() {
      if (!map) return;
      map.on("moveend", scheduleUpdate);
      map.on("zoomend", scheduleUpdate);
      map.on("resize", scheduleUpdate);
    }

    function unbindMapEvents() {
      if (!map) return;
      map.off("moveend", scheduleUpdate);
      map.off("zoomend", scheduleUpdate);
      map.off("resize", scheduleUpdate);
    }

    function init() {
      if (isInitialized) {
        scheduleUpdate();
        return;
      }
      if (!map) throw new Error("PRCSummary: falta map en la configuración.");
      if (!window.L) throw new Error("PRCSummary: Leaflet no está disponible en window.L.");

      loadCatalog()
        .finally(() => {
          bindMapEvents();
          isInitialized = true;
          scheduleUpdate();
        });
    }

    function destroy() {
      unbindMapEvents();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      isInitialized = false;
    }

    function setMap(nextMap) {
      if (map === nextMap) return;
      unbindMapEvents();
      map = nextMap;
      if (isInitialized) {
        bindMapEvents();
        scheduleUpdate();
      }
    }

    return { init, update, destroy, setMap, getVisibleItems };
  }

  window.createPRCSummary = createPRCSummary;
})();
