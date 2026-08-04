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
 * thought to pin.
 *
 * ⚠️ CORRECTED 2026-08-04. The line above used to continue "This test compares the three field
 * SETS, so the next omission fails on the day it is written" — and it did not. Every assertion here
 * was a per-field pin against a hand-written list of four, i.e. exactly the thing the sentence above
 * calls insufficient. `directional_conflict` was added to all three mappers that day and this file
 * would have passed had it been added to only one.
 *
 * WHY FULL SET-EQUALITY IS NOT THE FIX (measured 2026-08-04, and it is why the pins exist):
 *     union 44 fields · 31 of them (70%) are NOT in all three
 * The three mappers legitimately differ — `forecastSamplers` carries requestedLat/snappedLat/
 * activeLayer that no wire mapper has, `backendCopernicusServiceClient` carries stale/staleReason.
 * Asserting set-equality would fail on 31 fields on day one and be switched off by the second
 * reader, which is the failure this file exists to prevent.
 *
 * ⭐ WHAT DISCRIMINATES: the defect's signature is a field in EXACTLY TWO of the three — somebody
 * added it and missed one. A field in exactly ONE is usually genuinely path-specific. So the ratchet
 * below pins the twelve 2-of-3 fields that exist TODAY as a measured baseline and fails on the
 * THIRTEENTH. It does not adjudicate the existing twelve — several may be real drops, and each needs
 * its own measurement (see the handoff); it guarantees the next one cannot be added silently.
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

  test('directional_conflict reaches every mapper', () => {
    // The size and the quality disagree about the SAME swell by up to 3.54x past 75.73 deg
    // off-normal (backend wave_physics.directional_conflict). Measured 2026-08-04 on n=1005 served
    // spots: >=15.4% bind, and the infobox computes its rating badge from THESE fields — so a
    // mapper that drops this prints a height and a score that contradict each other, silently, on
    // whichever client path the user happens to be on.
    const gaps = Object.entries(MAPPERS)
      .filter(([, file]) => !mapsField(file, 'directional_conflict'))
      .map(([name]) => name);
    expect(gaps).toEqual([]);
  });

  // ── ⭐ THE RATCHET: the next 2-of-3 field fails on the day it is written ──────────────────────

  /** Every field a mapper assigns straight off the response, read from source. */
  function mappedFields(file) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:.*(?:json|cachedResponse)\.([A-Za-z_][A-Za-z0-9_]*)\b/gm;
    const out = new Set();
    let m;
    while ((m = re.exec(src)) !== null) if (m[1] === m[2]) out.add(m[1]);
    return out;
  }

  // MEASURED 2026-08-04, not chosen. Each is mapped by exactly two of the three mappers. Pinned as
  // a baseline so the list can only SHRINK; a new entry means somebody added a field and missed a
  // mapper. ⛔ Do not add to this list to make a build pass — that is the whole defect.
  const KNOWN_TWO_OF_THREE = [
    'cache_key', 'coordinate_count', 'coverage_scope', 'is_dynamic_viewport_product',
    'is_forecast_authoritative', 'is_test_fixture', 'requested_bbox', 'resolution',
    'served_bbox', 'source', 'surf_nearshore', 'valid_time',
  ].sort();

  test('no NEW field is mapped by exactly two of the three mappers', () => {
    const sets = Object.fromEntries(
      Object.entries(MAPPERS).map(([name, file]) => [name, mappedFields(file)]));

    // SETUP ASSERTION: a regex that matched nothing would make this pass vacuously — the failure
    // mode this file already names. Pin that each mapper yields a plausible number of fields.
    for (const [name, s] of Object.entries(sets))
      expect(`${name}:${s.size >= 15}`).toBe(`${name}:true`);

    const names = Object.keys(sets);
    const union = new Set(names.flatMap((n) => [...sets[n]]));
    const twoOfThree = [...union]
      .filter((f) => names.filter((n) => sets[n].has(f)).length === 2).sort();

    const added = twoOfThree.filter((f) => !KNOWN_TWO_OF_THREE.includes(f));
    expect(added).toEqual([]);   // a NEW field added to two mappers and not the third
  });

  test('the ratchet would notice a 2-of-3 field__THE_CONTROL', () => {
    // Without this, the assertion above could pass because `twoOfThree` is always empty.
    expect(KNOWN_TWO_OF_THREE.length).toBeGreaterThan(0);
    // and the baseline must describe reality, or it is a list of names nobody measured
    const sets = Object.fromEntries(
      Object.entries(MAPPERS).map(([name, file]) => [name, mappedFields(file)]));
    const names = Object.keys(sets);
    const stillTwo = KNOWN_TWO_OF_THREE
      .filter((f) => names.filter((n) => sets[n].has(f)).length === 2);
    // Shrinking is good (someone fixed one) — but it must not be EMPTY, which would mean the
    // detector stopped seeing anything and the test above is now vacuous.
    expect(stillTwo.length).toBeGreaterThan(0);
  });
});
