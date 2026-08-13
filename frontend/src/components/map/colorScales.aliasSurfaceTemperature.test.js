import { aliasSurfaceTemperature } from './colorScales';

// ⛔ THE REGRESSION THIS PINS: the water-temp heatmap rendered NOTHING on every model, for as long
// as the layer has requested `surface_temperature`. Confirmed on dev live 2026-08-13 — tiles
// arrived, decoded to 4,718,592 real values (-53.95 to +38.75 degC), and colourisation found no
// scale under that key among the 49 registered, so it emitted transparent tiles. Every upstream
// signal read healthy. Removing the alias restores a silent, total, model-independent blank.

describe('aliasSurfaceTemperature', () => {
  test('gives surface_temperature the sea_surface_temperature scale', () => {
    const sst = { type: 'breakpoint', unit: '°C', breakpoints: [-80, 0, 40] };
    const scales = aliasSurfaceTemperature({ sea_surface_temperature: sst });
    expect(scales.surface_temperature).toBe(sst);   // SAME object: aliased, never copied,
  });                                               // so the two can never drift apart

  test('does NOT overwrite a surface_temperature scale the library already ships', () => {
    // ★ The day upstream adds its own, theirs must win — an alias that clobbers a real scale
    // would be a silently WRONG palette rather than a missing one, which is harder to notice.
    const own = { type: 'breakpoint', unit: '°C', breakpoints: [0, 30] };
    const sst = { type: 'breakpoint', unit: '°C', breakpoints: [-80, 40] };
    const scales = aliasSurfaceTemperature({ surface_temperature: own, sea_surface_temperature: sst });
    expect(scales.surface_temperature).toBe(own);
  });

  test('is a no-op when the SST scale is absent — never invents a palette', () => {
    // If the library renames the SST scale, the layer should stay blank and be INVESTIGATED,
    // not silently painted with whatever happened to be nearby.
    const scales = aliasSurfaceTemperature({ temperature: { type: 'breakpoint' } });
    expect(scales.surface_temperature).toBeUndefined();
  });

  test('tolerates null/undefined without throwing — it runs during protocol registration', () => {
    expect(() => aliasSurfaceTemperature(null)).not.toThrow();
    expect(() => aliasSurfaceTemperature(undefined)).not.toThrow();
  });

  test('returns the same object it was given, so it can be used inline', () => {
    const scales = { sea_surface_temperature: { type: 'breakpoint' } };
    expect(aliasSurfaceTemperature(scales)).toBe(scales);
  });
});
