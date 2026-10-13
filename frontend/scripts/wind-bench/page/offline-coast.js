/**
 * Wind bench: the OFFLINE basemap's coast (map mode `--offline`), shared by the page (the synthetic style, map-entry.js) and the
 * runner (the land file the engine's land mask reads, ../serve.js writeLandFile).
 *
 * The app's wind marks pick a streak row by the land under them (src/components/map/windLandMask.js: the app's Natural Earth land,
 * fetched from the page's origin). The offline basemap is not the Earth: its sea is these two rough rings. The engine must be handed
 * the SAME coast, or a mark over the synthetic land would draw its sea row wherever the real Gulf happens to be.
 */
const GULF = [[-98, 18], [-98, 26], [-97.2, 27.8], [-96.5, 28.4], [-95, 29.1], [-94, 29.6], [-93, 29.75], [-92, 29.6], [-91, 29.3], [-90.2, 29.1],
  [-89.4, 29], [-89.2, 29.3], [-89.6, 29.6], [-89.5, 30.1], [-89, 30.35], [-88.4, 30.38], [-88.1, 30.25], [-88.05, 30.5], [-88, 30.68], [-87.9, 30.6],
  [-87.9, 30.25], [-87.5, 30.27], [-86.5, 30.4], [-85.7, 30.15], [-85.3, 29.7], [-84.4, 29.9], [-83.5, 29.6], [-82.8, 28.9], [-82.7, 27.9],
  [-82.2, 26.8], [-81.5, 25.9], [-81, 25.2], [-80.4, 25.2], [-80, 23], [-75, 18], [-98, 18]];
const ATLANTIC = [[-80.4, 25.2], [-80, 26.5], [-80.6, 28.5], [-81.4, 30.5], [-81.2, 31.5], [-80, 32.5], [-78, 33.8], [-76, 35], [-75.5, 36], [-70, 40],
  [-55, 40], [-55, 15], [-75, 18], [-80, 23], [-80.4, 25.2]];

/** The offline basemap's LAND as GeoJSON: the whole map with the two seas cut out (the mask fills by the even-odd rule). */
function offlineLand() {
  const world = [[-180, -85.05], [180, -85.05], [180, 85.05], [-180, 85.05], [-180, -85.05]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { featurecla: 'Land (wind bench, offline)' }, geometry: { type: 'Polygon', coordinates: [world, GULF, ATLANTIC] } }] };
}

module.exports = { GULF, ATLANTIC, offlineLand };
