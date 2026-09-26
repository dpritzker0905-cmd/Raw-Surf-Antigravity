/**
 * Tokenless basemap fallback (audit 15.0 A15-17, 2026-09-26).
 *
 * THE DEFECT. The basemap is a Mapbox style fetched with REACT_APP_MAPBOX_TOKEN. With the token
 * missing, revoked or rotated, the style request fails AFTER the map is created, so
 * `isMapStartupFailure` (correctly) treats it as a runtime error and raises no panel: the user got
 * a black rectangle, and because the weather layers insert relative to the style, no weather either.
 * Observed on the local rig 2026-09-25 (no token) — and the production token was rotated that day.
 *
 * THE FALLBACK IS LOCAL ON PURPOSE. Land comes from the Natural Earth 50 m GeoJSON the app already
 * ships in /public (OceanMask and getSharedLandGeoJSON read the same file), so the fallback adds no
 * third-party service, no key, no new host and no new download for the user.
 *
 * LAYER IDS ARE A CONTRACT. `findMarineInsertionLayer` (mapUtils) places the marine rasters after
 * the layer named `water` and before the next one, so the style is `water` → `land` → `coastline`:
 * weather draws over the ocean and under the land, exactly as it does on the Mapbox styles.
 */

// Theme palettes. Three themes, all devices (CLAUDE.md): each keeps the land/ocean contrast of
// the Mapbox style it stands in for (navigation-night, navigation-day, outdoors).
export const FALLBACK_PALETTES = {
  dark: { ocean: '#0b1d2e', land: '#1c2530', coast: '#3b4a5a' },
  light: { ocean: '#cfe3f2', land: '#f1efe9', coast: '#9fb3c4' },
  beach: { ocean: '#9fd8e6', land: '#f3e3c3', coast: '#6fa3b0' },
};

export const hasMapboxToken = () => Boolean(process.env.REACT_APP_MAPBOX_TOKEN);

const landUrl = () => {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  // Absolute: a style's GeoJSON URL is fetched inside the map worker, which resolves relative
  // paths against the worker script rather than the page.
  return `${origin}${process.env.PUBLIC_URL || ''}/ne_50m_land.json`;
};

export const getFallbackMapStyle = (theme) => {
  const p = FALLBACK_PALETTES[theme] || FALLBACK_PALETTES.dark;
  return {
    version: 8,
    name: `raw-surf-fallback-${FALLBACK_PALETTES[theme] ? theme : 'dark'}`,
    sources: {
      'fallback-land': { type: 'geojson', data: landUrl(), attribution: 'Natural Earth' },
    },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': p.ocean } },
      { id: 'land', type: 'fill', source: 'fallback-land', paint: { 'fill-color': p.land } },
      { id: 'coastline', type: 'line', source: 'fallback-land', paint: { 'line-color': p.coast, 'line-width': 0.8 } },
    ],
  };
};

// The style JSON itself: /styles/v1/<owner>/<style>, with no further path. Sprites, tiles and
// fonts have more segments or other roots and are NOT basemap loss on their own.
const STYLE_JSON_URL = /^https:\/\/api\.mapbox\.com\/styles\/v1\/[^/?]+\/[^/?]+(\?|$)/;

/**
 * The reason code when a map `error` event is the basemap style failing to load, else null.
 * Only the status is kept: the request URL carries the access token.
 */
export const basemapStyleFailure = (event) => {
  const err = event && (event.error || event);
  const url = err && typeof err.url === 'string' ? err.url : '';
  if (!STYLE_JSON_URL.test(url)) return null;
  return `style_http_${Number(err.status) || 0}`;
};

/** window.__BASEMAP_DIAG__ — what the basemap is and why, for E2E and support. */
export const publishBasemapDiag = (fallbackReason) => {
  if (typeof window === 'undefined') return;
  window.__BASEMAP_DIAG__ = {
    mode: fallbackReason ? 'fallback' : 'mapbox',
    reason: fallbackReason || null,
    at: new Date().toISOString(),
  };
};
