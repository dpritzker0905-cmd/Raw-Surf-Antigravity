// Several map-editing tools (AdminSpotEditor's Map Editor tab, AdminSpotsPanel's
// precision-pin map, LocationPicker, UnifiedSpotDrawer's refine-location map) expect
// a global `window.L` (Leaflet) — the pattern used when a page loads Leaflet via a CDN
// <script> tag. That tag was never actually added anywhere (no npm dependency, no
// index.html script, no dynamic script injection), so window.L was never set and all
// four consumers silently failed (or, for AdminSpotEditor, surfaced "Map library failed
// to load. Please refresh the page." after a 5s poll timeout).
//
// Importing this module as a side effect makes window.L available via the real
// `leaflet` npm package instead. Each consumer's existing "poll until window.L exists"
// logic is left untouched — it just finds it immediately now.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

if (typeof window !== 'undefined' && !window.L) {
  window.L = L;
}

export default L;
