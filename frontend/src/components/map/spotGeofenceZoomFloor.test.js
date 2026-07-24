/**
 * SPOT GEOFENCE ZOOM FLOOR (2026-07-24) — the "marine heatmap is covering land" report.
 *
 * ROOT (measured, not inferred): `spot-geofences-layer` is a circle layer coloured #06b6d4 with a
 * radius ramp whose FIRST stop is zoom 10. It carried no `minzoom`, so below zoom 10 Mapbox clamped
 * the radius to its first-stop value (5 px) and every one of ~1900 surf-spot circles kept drawing at
 * world zoom, hugging every coastline. They overlap into a continuous cyan band that reads exactly
 * like the marine field bleeding inland.
 *
 * The measurements that identified it:
 *   - the pixels "over land" were rgb(6,182,212) === #06b6d4, the geofence colour, EXACTLY;
 *   - they were identical in the normal frame and in the marine heatmap's own debug frame
 *     (u_debug_mode='mask'), i.e. not painted by the marine engine at all;
 *   - they were identical in light AND dark theme (the basemap's palette is theme-aware; this is not);
 *   - queryRenderedFeatures reported `spot-geofences-layer` on every painted land pixel and NOT on
 *     the bare ones;
 *   - at z3.1 the band reached ~50 km inland, and 5 px at z3.1 is ~45 km.
 *
 * The invariant worth guarding is not "minzoom === 10" (a magic number someone will re-tune) but
 * that the zoom floor and the radius ramp's first stop stay the SAME NUMBER — the moment they drift
 * the clamp comes back.
 */
import { SPOT_GEOFENCE_RADIUS, SPOT_GEOFENCE_MIN_ZOOM } from './MapWebGL';

// Mirror of Mapbox's zoom-interpolate clamping: below the first stop and above the last, the value
// is CLAMPED to the nearest stop rather than extrapolated.
function radiusAtZoom(ramp, zoom) {
  const stops = [];
  for (let i = 3; i < ramp.length; i += 2) stops.push([ramp[i], ramp[i + 1]]);
  if (zoom <= stops[0][0]) return stops[0][1];
  if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (zoom <= stops[i][0]) {
      const [z0, r0] = stops[i - 1], [z1, r1] = stops[i];
      const base = 2;
      const t = (Math.pow(base, zoom - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
      return r0 + t * (r1 - r0);
    }
  }
  return stops[stops.length - 1][1];
}

describe('spot geofence zoom floor', () => {
  const firstStopZoom = SPOT_GEOFENCE_RADIUS[3];

  it('the layer zoom floor equals the radius ramp first stop (they must not drift apart)', () => {
    expect(SPOT_GEOFENCE_MIN_ZOOM).toBe(firstStopZoom);
  });

  it('the ramp CLAMPS below its first stop — which is why a floor is required at all', () => {
    const atFirst = radiusAtZoom(SPOT_GEOFENCE_RADIUS, firstStopZoom);
    // world zoom: without a floor the circles are still full first-stop size
    expect(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 3.1)).toBe(atFirst);
    expect(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 0)).toBe(atFirst);
    expect(atFirst).toBeGreaterThan(0);
  });

  it('a clamped circle at world zoom spans a geographically absurd distance', () => {
    // 5 px at z3.1: worldSize = 512 * 2^z px for 360 deg; convert the radius to km at lat 28.
    const z = 3.1;
    const degPerPx = 360 / (512 * Math.pow(2, z));
    const km = radiusAtZoom(SPOT_GEOFENCE_RADIUS, z) * degPerPx * 111.32 * Math.cos(28 * Math.PI / 180);
    expect(km).toBeGreaterThan(30);          // ~45 km — matches the measured ~50 km inland band
  });

  it('above the floor the ramp still grows with zoom (the feature itself is unchanged)', () => {
    expect(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 14)).toBeGreaterThan(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 10));
    expect(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 18)).toBeGreaterThan(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 14));
    expect(radiusAtZoom(SPOT_GEOFENCE_RADIUS, 18)).toBe(150);
  });
});
