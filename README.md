# GeoX

GeoX es una plantilla territorial genérica del ecosistema GeoCálculo.

## Objetivo
Convertir una base derivada de GeoNOXA en una plantilla madre reutilizable para futuros sitios GeoXXXX, manteniendo la arquitectura funcional (Leaflet, flujo INDEX → CARD, parámetros por URL y exportaciones KML/PDF) y neutralizando etiquetas específicas de dominio.

## Estructura actual
- `index.html`: interfaz principal con mapa Leaflet, buscador y panel territorial.
- `mapago.html`: CARD PRO con análisis del POI.
- `js/index.js`: carga de capas, resumen y navegación hacia CARD.
- `js/mapago.js`: cálculo de KPI, render de paneles, KML/PDF.
- `css/index.css`, `css/mapago.css`: estilos dark del INDEX y CARD.

## Configuración
Se incorpora `config.json` como base de parametrización para evolucionar GeoX hacia template configurable.
