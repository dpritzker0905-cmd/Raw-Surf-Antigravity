import { defaultOmProtocolSettings } from '@openmeteo/weather-map-layer';
import { CUSTOM_COLOR_SCALES, aliasSurfaceTemperature } from './colorScales';
import { LAYER_REGISTRY } from './LayerRegistry';

/**
 * ⛔ THE CLASS THIS GUARDS, not just the instance.
 *
 * On 2026-08-13 the water-temp heatmap rendered blank on EVERY model because the layer requested
 * `variable=surface_temperature` while the registered colour scale was named
 * `sea_surface_temperature`. Tiles were fetched and decoded correctly (4,718,592 values,
 * -53.95 to +38.75 degC); colourisation looked up a key that did not exist and emitted transparent
 * tiles. Nothing logged a failure, because nothing HAD failed.
 *
 * ⭐ A LOOKUP MISS THAT RETURNS "NOTHING TO DRAW" IS INDISTINGUISHABLE FROM "NOTHING TO SHOW" — so
 * no runtime signal will ever catch this. It has to be caught statically, and it is cheap to:
 * every raster layer names its `omVariable`, and every colour scale is a key. This test diffs the
 * two sets. It would have found the bug in seconds; instead it took seven refuted hypotheses.
 *
 * ⚠️ The scales are assembled the SAME WAY the protocol assembles them (library defaults, then
 * CUSTOM_COLOR_SCALES, then the aliases) — not a re-derived list. A guard that builds its own
 * version of the thing it checks tests its own copy, which is this repo's most-recorded shape.
 */

const buildScales = () => {
  const scales = { ...(defaultOmProtocolSettings.colorScales || {}), ...CUSTOM_COLOR_SCALES };
  aliasSurfaceTemperature(scales);            // the production alias step
  return scales;
};

describe('every raster layer variable has a colour scale', () => {
  test('the fixture itself is real — registry and scales both loaded', () => {
    // ★ POSITIVE CONTROL. If either import silently yielded {}, the coverage test below would
    // pass vacuously (nothing to check) or fail wholesale. Neither is a result.
    const scales = buildScales();
    expect(Object.keys(LAYER_REGISTRY).length).toBeGreaterThan(5);
    expect(Object.keys(scales).length).toBeGreaterThan(20);
    expect(scales.sea_surface_temperature).toBeDefined();
  });

  // ⚠️ EXACT-KEY MATCHING IS NOT THE RULE, and asserting it produced a FALSE POSITIVE on the very
  // first run (`temperature -> temperature_2m`) for a layer that renders perfectly. The library
  // strips LEVEL SUFFIXES before lookup (it exports LEVEL_REGEX/LEVEL_PREFIX), so `temperature_2m`
  // resolves to `temperature`, while `surface_temperature` reduces to nothing and fails.
  // ★ THE RULE BELOW IS CALIBRATED AGAINST TWO OBSERVED OUTCOMES, not guessed: air temp
  // (`temperature_2m`) RENDERS on dev live, water temp (`surface_temperature`) did NOT until the
  // alias shipped. Any replacement rule must keep reproducing both.
  const LEVEL_SUFFIX = /_(\d+)(m|hPa|cm)$/;
  const resolves = (scales, v) =>
    Object.prototype.hasOwnProperty.call(scales, v) ||
    Object.prototype.hasOwnProperty.call(scales, v.replace(LEVEL_SUFFIX, ''));

  test('the resolution rule reproduces both observed outcomes', () => {
    // ★ THE CONTROL ON THE RULE ITSELF. Without this, a rule that resolves everything would make
    // the coverage test below pass vacuously -- a guard that cannot fail.
    const scales = { ...(defaultOmProtocolSettings.colorScales || {}), ...CUSTOM_COLOR_SCALES };
    expect(resolves(scales, 'temperature_2m')).toBe(true);      // renders in production
    expect(resolves(scales, 'surface_temperature')).toBe(false); // did NOT, before the alias
  });

  test('no raster layer requests a variable that resolves to no scale', () => {
    const scales = buildScales();
    const missing = Object.entries(LAYER_REGISTRY)
      .filter(([, e]) => e && e.omVariable && e.type === 'raster')
      .filter(([, e]) => !resolves(scales, e.omVariable))
      .map(([k, e]) => `${k} -> ${e.omVariable}`);
    expect(missing).toEqual([]);
  });

  test('MARINE layers too — they render as raster when WebGL fails', () => {
    // ⭐ THE FALLBACK PATH IS THE DANGEROUS ONE. MapWebGL renders a marine layer through the
    // raster/colour-scale path when `webglMarineFailed`, so an unscaled marine variable would
    // blank ONLY on devices where WebGL is unavailable — a blank that most people never see and
    // nobody can reproduce on request. All four resolve today (verified against the live merged
    // scales on dev live); this keeps it that way for whatever marine layer is added next.
    const scales = buildScales();
    const missing = Object.entries(LAYER_REGISTRY)
      .filter(([, e]) => e && e.omVariable && e.type === 'marine')
      .filter(([, e]) => !resolves(scales, e.omVariable))
      .map(([k, e]) => `${k} -> ${e.omVariable}`);
    expect(missing).toEqual([]);
  });

  test('water_temp specifically — the regression that motivated this file', () => {
    const scales = buildScales();
    expect(LAYER_REGISTRY.water_temp.omVariable).toBe('surface_temperature');
    expect(scales[LAYER_REGISTRY.water_temp.omVariable]).toBeDefined();
  });

  test('fog specifically — reported blank the same day, and its variable IS covered', () => {
    // Recorded so the next reader does not re-run this: fog's blankness is NOT the water-temp
    // mode. `visibility` has a scale; the fog cause was never found and is still open.
    const scales = buildScales();
    expect(LAYER_REGISTRY.fog.omVariable).toBe('visibility');
    expect(scales.visibility).toBeDefined();
  });
});
