// js/consulta_prc.js

function nombrePoligono(props) {
  if (!props) return 'Polígono sin nombre';
  return props.name ||
         props.Nombre ||
         props.NOMBRE ||
         props.ZONA ||
         props.Zona ||
         props.CODIGO ||
         JSON.stringify(props);
}

// Carga un KML con omnivore y resuelve con sus features GeoJSON
function cargarKMLcomoGeoJSON(urlKml) {
  return new Promise(function(resolve, reject) {
    var loader = omnivore.kml(urlKml);

    loader.on('ready', function() {
      try {
        var geojson = this.toGeoJSON();
        resolve(geojson.features || []);
      } catch (e) {
        reject(e);
      }
    });

    loader.on('error', function(err) {
      reject(err);
    });
  });
}

// Consulta el punto sobre una sola capa KML, devolviendo coincidencias
function consultaSobreCapa(lat, lon, kmlPathRel) {
  var pt = turf.point([lon, lat]);

  return cargarKMLcomoGeoJSON(kmlPathRel).then(function(features) {
    var resultado = {
      capa: kmlPathRel,
      coincidencias: []   // { nombrePoligono, propiedades, feature }
    };

    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f.geometry) continue;

      var t = f.geometry.type;
      if (t !== 'Polygon' && t !== 'MultiPolygon') continue;

      var dentro = false;
      try {
        dentro = turf.booleanPointInPolygon(pt, f);
      } catch(e) {
        console.warn('Error en booleanPointInPolygon para feature de', kmlPathRel, e);
        continue;
      }

      if (dentro) {
        resultado.coincidencias.push({
          nombre: nombrePoligono(f.properties || {}),
          props: f.properties || {},
          feature: f
        });
      }
    }

    return resultado;
  });
}

// Construye HTML desde resultados
function construirHTMLDesdeResultados(resultados) {
  var html = '<section>';
  html += '<h3>Consulta PRC sobre capas KML</h3>';

  if (!resultados || resultados.length === 0) {
    html += '<p>No se pudieron evaluar capas KML.</p></section>';
    return html;
  }

  var totalCoincidencias = 0;
  resultados.forEach(function(r) {
    totalCoincidencias += r.coincidencias.length;
  });

  if (totalCoincidencias === 0) {
    html += '<p>El punto consultado <strong>no se encuentra dentro de ningún polígono</strong> ';
    html += 'de las capas KML listadas en <code>capas/manifest.json</code>.</p>';
    html += '</section>';
    return html;
  }

  html += '<p>Se encontraron coincidencias en las siguientes capas:</p>';

  resultados.forEach(function(r) {
    if (r.coincidencias.length === 0) {
      return;
    }

    html += '<h4 style="margin-top:10px;margin-bottom:4px;">Capa: ' +
            r.capa + '</h4>';

    r.coincidencias.forEach(function(c, idx) {
      html += '<p style="margin:4px 0;"><strong>Polígono ' + (idx + 1) +
              ':</strong> ' + c.nombre + '</p>';

      var props = c.props || {};
      var keys = Object.keys(props);
      if (keys.length > 0) {
        html += '<table>';
        html += '<tr><th>Atributo</th><th>Valor</th></tr>';
        keys.forEach(function(k) {
          html += '<tr><td>' + k + '</td><td>' + props[k] + '</td></tr>';
        });
        html += '</table>';
      }
    });
  });

  html += '</section>';
  return html;
}

// Función principal: lee manifest.json y ejecuta la consulta; también dibuja polígonos en el mapa
// Función principal: lee manifest.json (o listado.json) y ejecuta la consulta; también dibuja polígonos en el mapa
function consultaPRCEnTodasLasCapas(lat, lon, manifestPath, map) {
  return fetch(manifestPath)
    .then(function(resp) {
      if (!resp.ok) {
        throw new Error('No se pudo leer manifest/listado de KML');
      }
      return resp.json();
    })
    .then(function(data) {
      // Soporta tanto "kml_files" como "kml"
      var files = [];
      if (data) {
        if (Array.isArray(data.kml_files)) {
          files = data.kml_files;
        } else if (Array.isArray(data.kml)) {
          files = data.kml;
        }
      }

      if (files.length === 0) {
        return construirHTMLDesdeResultados([]);
      }

      // Carpeta base donde está el manifest/listado
      var lastSlash = manifestPath.lastIndexOf('/');
      var baseDir = lastSlash >= 0 ? manifestPath.substring(0, lastSlash + 1) : '';

      var promises = files.map(function(fname) {
        var kmlPathRel;

        if (fname.indexOf('/') !== -1) {
          // El JSON ya trae subcarpeta, se respeta tal cual respecto a baseDir
          kmlPathRel = baseDir + fname;
        } else {
          // Intentar inferir región desde el nombre: IPT_03_..., PRC_02_..., etc.
          var partes = fname.split('_');
          var region = (partes.length > 1) ? partes[1] : null;

          if (region && /^\d+$/.test(region)) {
            // Si manifest está en "capas/", los KML viven en "capas/capas_XX/"
            if (/\/capas\/?$/.test(baseDir)) {
              kmlPathRel = baseDir + 'capas_' + region + '/' + fname;
            } else {
              // Si el manifest ya está dentro de "capas_XX", usamos esa misma carpeta
              kmlPathRel = baseDir + fname;
            }
          } else {
            // Sin región detectable: usar la misma carpeta del manifest
            kmlPathRel = baseDir + fname;
          }
        }

        return consultaSobreCapa(lat, lon, kmlPathRel)
          .catch(function(err) {
            console.error('Error consultando capa', kmlPathRel, err);
            return { capa: kmlPathRel, coincidencias: [] };
          });
      });

      return Promise.all(promises).then(function(resultados) {
        // Dibujar polígonos en el mapa si se entregó un mapa Leaflet
        if (map) {
          resultados.forEach(function(r) {
            r.coincidencias.forEach(function(c) {
              try {
                L.geoJSON(c.feature, {
                  style: {
                    color: '#2563eb',
                    weight: 2,
                    fillOpacity: 0.2
                  }
                }).addTo(map);
              } catch (e) {
                console.warn('No se pudo dibujar polígono en el mapa', e);
              }
            });
          });
        }

        return construirHTMLDesdeResultados(resultados);
      });
    });
}


}
