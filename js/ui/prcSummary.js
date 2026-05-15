// js/prcSummary.js
// Card resumen de PRC visibles en la vista actual del mapa.
// Requiere:
// - Leaflet cargado globalmente (window.L)
// - Un elemento #prc-summary con un hijo #prc-count en el HTML
//
// Uso desde index.js:
//   const prcSummary = window.createPRCSummary({
//     map,
//     getItems: () => indiceBuscador
//   });
//   prcSummary.init();

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

  function defaultCardText(total) {
    return total === 1
      ? "En esta vista hay 1 plano regulador"
      : `En esta vista hay ${total} planos reguladores`;
  }

  function createPRCSummary(options) {
    const config = {
      map: options?.map || null,
      getItems:
        typeof options?.getItems === "function"
          ? options.getItems
          : () => [],
      summarySelector: options?.summarySelector || "#prc-summary",
      countSelector: options?.countSelector || "#prc-count",
      emptyBehavior: options?.emptyBehavior || "hide", // "hide" | "show-zero"
      debug: Boolean(options?.debug),
      formatter:
        typeof options?.formatter === "function"
          ? options.formatter
          : defaultCardText
    };

    let map = config.map;
    let rafId = null;
    let isInitialized = false;

    function log(...args) {
      if (config.debug) {
        console.log("[prcSummary]", ...args);
      }
    }

    function getSummaryEl() {
      return document.querySelector(config.summarySelector);
    }

    function getCountEl() {
      return document.querySelector(config.countSelector);
    }

    function getComunasCountEl() {
      return document.querySelector("#comunas-count");
    }

    function getItems() {
      const items = config.getItems();
      return Array.isArray(items) ? items : [];
    }

    function intersectsCurrentView(itemBBox) {
      if (!map || !window.L) return false;
      const viewBounds = map.getBounds();
      const itemBounds = buildLeafletBounds(itemBBox);

      if (!viewBounds || !itemBounds || !viewBounds.isValid() || !itemBounds.isValid()) {
        return false;
      }

      return viewBounds.intersects(itemBounds);
    }

    function getVisibleItems() {
      const items = getItems();

      return items.filter((item) => {
        if (!item || typeof item !== "object") return false;
        if (!item.bbox) return false;
        return intersectsCurrentView(item.bbox);
      });
    }

    function getUniqueVisibleItems() {
      const visibles = getVisibleItems();
      const byKey = new Map();

      visibles.forEach((item) => {
        // Preferimos archivo como clave única; si no existe, usamos nombre+bbox
        const key =
          item.archivo ||
          `${item.nombre || ""}__${JSON.stringify(item.bbox || [])}`;

        if (!byKey.has(key)) {
          byKey.set(key, item);
        }
      });

      return Array.from(byKey.values());
    }

    function getUniqueVisibleComunas(visibles) {
      const comunas = new Set();

      visibles.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const rawComuna = item.comuna;
        if (rawComuna === null || rawComuna === undefined) return;

        const comuna = String(rawComuna).trim();
        if (!comuna) return;

        comunas.add(comuna.toLowerCase());
      });

      return comunas.size;
    }

    function render(total, totalComunas) {
      const summaryEl = getSummaryEl();
      const countEl = getCountEl();
      const comunasCountEl = getComunasCountEl();

      if (!summaryEl) {
        log("No se encontró el elemento del card", config.summarySelector);
        return;
      }

      if (total <= 0 && config.emptyBehavior === "hide") {
        summaryEl.hidden = true;
        summaryEl.style.display = "none";
        if (countEl) countEl.textContent = "0";
        if (comunasCountEl) comunasCountEl.textContent = "0";
        return;
      }

      if (countEl) {
        countEl.textContent = String(total);
        if (comunasCountEl) comunasCountEl.textContent = String(totalComunas);
      } else {
        summaryEl.textContent = config.formatter(total);
      }

      summaryEl.hidden = false;
      summaryEl.style.display = "";
    }

    function update() {
      if (!map) return;

      const visibles = getUniqueVisibleItems();
      const total = visibles.length;
      const totalComunas = getUniqueVisibleComunas(visibles);

      log("Visibles:", total, visibles, "Comunas:", totalComunas);
      render(total, totalComunas);

      return {
        total,
        comunas: totalComunas,
        items: visibles
      };
    }

    function scheduleUpdate() {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

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

      if (!map) {
        throw new Error("PRCSummary: falta map en la configuración.");
      }

      if (!window.L) {
        throw new Error("PRCSummary: Leaflet no está disponible en window.L.");
      }

      bindMapEvents();
      isInitialized = true;
      scheduleUpdate();
    }

    function destroy() {
      unbindMapEvents();

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

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

    return {
      init,
      update,
      destroy,
      setMap,
      getVisibleItems: getUniqueVisibleItems
    };
  }

  window.createPRCSummary = createPRCSummary;
})();
