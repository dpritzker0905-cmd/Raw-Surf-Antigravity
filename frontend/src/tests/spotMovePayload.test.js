/**
 * The admin spot-move payload contract (2026-08-09 regression).
 *
 * Owner: "the map editor is failing to move spots in the admin."
 *
 * Cause: two independent call sites built the same request body, and one of them spread Leaflet's
 * `{lat, lng}` straight into a request whose model requires `{latitude, longitude}`:
 *
 *     dragend        { latitude: newPos.lat, longitude: newPos.lng, ... }   OK
 *     land-override  { ...landWarning.coords, ... }   ->   HTTP 422, never written
 *
 * Proven by execution against a verbatim copy of `SpotMoveRequest`
 * (backend/routes/surf_spots/spot_admin.py:45-48) -> loc=('latitude',) type=missing, and
 * independently by the DEPLOYED /openapi.json -> required:["latitude","longitude"].
 *
 * The failure was PERMANENT for any spot the land check flags: the land branch reverts the marker
 * first, so the user drags, the pin snaps back, they confirm, and the confirm 422s forever.
 */
import { spotMovePayload, adminErrorMessage } from '../components/admin/spotMovePayload';

// The backend contract, restated here so a change on either side collides with this test.
const REQUIRED = ['latitude', 'longitude'];

describe('spotMovePayload — the request the API actually accepts', () => {
  it('converts Leaflet {lat,lng} to the API {latitude,longitude}', () => {
    expect(spotMovePayload({ lat: 21.665, lng: -158.0533 })).toEqual({
      latitude: 21.665, longitude: -158.0533, override_land_warning: false,
    });
  });

  it('passes through an already-correct API shape unchanged', () => {
    expect(spotMovePayload({ latitude: 1.5, longitude: 2.5 }, true)).toEqual({
      latitude: 1.5, longitude: 2.5, override_land_warning: true,
    });
  });

  it('⛔ REGRESSION PIN: the land-override body carries both required fields', () => {
    // This is the exact object the override handler holds — Leaflet-shaped — and the exact call
    // it makes. Before the fix this produced {lat, lng, override_land_warning} and 422'd.
    const landWarningCoords = { lat: 41.035, lng: -71.916 };  // Montauk, the measured land-flagged case
    const body = spotMovePayload(landWarningCoords, true);
    for (const key of REQUIRED) {
      expect(body[key]).toBeDefined();
      expect(Number.isFinite(body[key])).toBe(true);
    }
    expect(body).not.toHaveProperty('lat');
    expect(body).not.toHaveProperty('lng');
    expect(body.override_land_warning).toBe(true);
  });

  it('★ an equatorial 0.0 coordinate survives — `??` not `||`', () => {
    // Gabon, Sao Tome and Kiribati all have surf near 0. With `||` a 0.0 latitude would fall
    // through to undefined and 422 exactly like the bug this file exists to prevent.
    const body = spotMovePayload({ lat: 0, lng: 0 });
    expect(body.latitude).toBe(0);
    expect(body.longitude).toBe(0);
  });

  it('override defaults to false when not asked for', () => {
    expect(spotMovePayload({ lat: 1, lng: 2 }).override_land_warning).toBe(false);
  });
});

describe('adminErrorMessage — a 401 must not read as "no data"', () => {
  it('names authorisation for 401/403 instead of blaming the data', () => {
    for (const status of [401, 403]) {
      const msg = adminErrorMessage({ response: { status } }, 'Failed to load spots');
      expect(msg).toMatch(/authoris|admin/i);
      expect(msg).not.toBe('Failed to load spots');
    }
  });

  it('surfaces the server detail when there is one', () => {
    const msg = adminErrorMessage(
      { response: { status: 422, data: { detail: 'field required: latitude' } } }, 'Failed to move spot');
    expect(msg).toBe('field required: latitude');
  });

  it('falls back cleanly on a network error with no response', () => {
    expect(adminErrorMessage(new Error('Network Error'), 'Failed to move spot'))
      .toBe('Failed to move spot');
  });
});
