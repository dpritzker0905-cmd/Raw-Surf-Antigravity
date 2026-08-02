/**
 * THE THREE POINT WHITELISTS MUST AGREE.
 *
 * A point field reaches the infobox through exactly one of three mappers, chosen by which client
 * path served the request:
 *
 *   backendWeatherServiceClientPoint.js   /api/weather/point
 *   backendCopernicusServiceClient.js     the Copernicus/CMEMS point path
 *   forecastSamplers.js                   selectExactPointHour, off the cached response
 *
 * Each is a WHITELIST: a field absent from one is silently dropped on that path. Every one of those
 * files already carries a comment saying so, and the history is a straight line —
 * `shore_normal_deg` (2026-07-26, the infobox was permanently geometry-blind), then `partitions`,
 * then `reference_size_m`, then `coverage_status`, whose own comment reads "FOURTH FIELD IN A ROW
 * to be missing from this whitelist".
 *
 * ⛔ AND THE FOURTH WAS ITSELF ADDED TO ONLY TWO OF THE THREE. Measured 2026-08-02:
 * `coverage_status` is mapped by backendWeatherServiceClientPoint and backendCopernicusServiceClient
 * and is ABSENT from forecastSamplers — the file whose own comment names all three whitelists and
 * warns that "a field added to one and not the others is dropped on whichever client path the user
 * happens to be on".
 *
 * ⇒ A per-field regression pin cannot catch this class; it only ever catches the field someone
 * thought to pin. This test compares the three field SETS, so the next omission fails on the day it
 * is written rather than on the day someone notices the infobox disagreeing with the glyph.
 */
import fs from 'fs';
import path from 'path';

const DIR = __dirname;
const MAPPERS = {
  backendWeatherServiceClientPoint: 'backendWeatherServiceClientPoint.js',
  backendCopernicusServiceClient: 'backendCopernicusServiceClient.js',
  forecastSamplers: 'forecastSamplers.js',
};

/**
 * The point fields a mapper assigns, read from source.
 *
 * Derived rather than listed: a hand-maintained expectation here would be a fourth copy of the
 * very fact whose duplication is the defect.
 */
function mapsField(file, field) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  // `foo:` as an object key, with `json.foo` / `cachedResponse.foo` on the same logical line.
  // ⚠️ The first version required the source expression to follow the key IMMEDIATELY, which made
  // it blind to the ternary form `surf_height_m: status === 'x' ? null : (cachedResponse.surf_height_m ?? null)`
  // and report a field that IS mapped as missing. A guard that cries wolf is worse than none —
  // it teaches the reader to skip it, which is the failure this whole file exists to prevent.
  const re = new RegExp(`^\\s*${field}\\s*:.*(?:json|cachedResponse)\\.${field}\\b`, 'm');
  return re.test(src);
}

// The geometry-provenance envelope the backend serves on every point response (schemas.py).
// `shore_normal_deg` is the bearing itself; the rest say what that bearing is STANDING ON.
const PROVENANCE_FIELDS = [
  'shore_normal_deg',
  'shore_normal_source',
  'break_depth_m',
  'geometry_readiness',
];

describe('point field whitelist parity', () => {
  test('the detector sees a field that IS mapped, in every mapper (positive control)', () => {
    // Without this, a regex matching nothing would make every assertion below pass vacuously —
    // the failure mode this repo has recorded seven times. `shore_normal_deg` is the right probe:
    // it is mapped in all three, and it is the field whose absence started this whole history.
    for (const file of Object.values(MAPPERS)) {
      expect(mapsField(file, 'shore_normal_deg')).toBe(true);
    }
  });

  test('the detector sees the TERNARY form too (negative control on the detector itself)', () => {
    // forecastSamplers maps surf_height_m through a conditional. An earlier version of this
    // detector reported it as missing — a false positive on a field that is present.
    expect(mapsField(MAPPERS.forecastSamplers, 'surf_height_m')).toBe(true);
  });

  test('every mapper carries the geometry-provenance envelope', () => {
    // The envelope exists so a surf number can say what it is STANDING ON. A mapper that drops it
    // renders a degraded spot identically to a fully-measured one — the exact defect
    // spot_geometry_readiness was built to end, reappearing at the render boundary.
    const gaps = [];
    for (const [name, file] of Object.entries(MAPPERS)) {
      for (const f of PROVENANCE_FIELDS) {
        if (!mapsField(file, f)) gaps.push(`${name} drops ${f}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  test('coverage_status reaches every mapper, not just the one that added it', () => {
    // Its own comment in backendWeatherServiceClientPoint reads "FOURTH FIELD IN A ROW to be
    // missing from this whitelist" — and it was then added to ONE of the three. Measured
    // 2026-08-02: the other two reference it only as a fallback for `status`, which is a different
    // field with a different meaning, so the tier a layer was served at never reaches the card on
    // those paths.
    const gaps = Object.entries(MAPPERS)
      .filter(([, file]) => !mapsField(file, 'coverage_status'))
      .map(([name]) => name);
    expect(gaps).toEqual([]);
  });
});
