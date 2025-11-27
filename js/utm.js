// Conversión WGS84 -> UTM 19S (EPSG:32719) sin librerías externas
function actualizarUTM(latDeg, lonDeg) {
  try {
    // Constantes WGS84
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);

    // Zona UTM 19S
    const zoneNumber = 19;
    const lon0Deg = zoneNumber * 6 - 183;
    const lon0 = (lon0Deg * Math.PI) / 180;

    // Radianes
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const tanLat = Math.tan(lat);

    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const T = tanLat * tanLat;
    const C = ep2 * cosLat * cosLat;
    const A = cosLat * (lon - lon0);

    // Meridional arc M
    const e4 = e2 * e2;
    const e6 = e4 * e2;

    const M =
      a *
      ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat -
        (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat) +
        (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat) -
        (35 * e6 / 3072) * Math.sin(6 * lat));

    let x =
      k0 *
        N *
        (A +
          ((1 - T + C) * A ** 3) / 6 +
          (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) +
      500000;

    let y =
      k0 *
      (M +
        N *
          tanLat *
          (A * A / 2 +
            (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 +
            (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));

    // Hemisferio Sur
    if (latDeg < 0) {
      y += 10000000;
    }

    // Redondeados sin decimales, con separadores de miles
    const este = Math.round(x)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const norte = Math.round(y)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    document.getElementById("utm-e-display").textContent = este;
    document.getElementById("utm-n-display").textContent = norte;
  } catch (e) {
    console.error("Error UTM:", e);
  }
}
