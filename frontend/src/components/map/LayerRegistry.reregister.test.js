/**
 * Re-registering an IDENTICAL layer plugin must be silent; a genuine id CONFLICT must still warn.
 *
 * WHY THIS EXISTS (measured live on the dev map, 2026-08-03). `bootstrapCoreLayers` is documented
 * "called once after engine init" but runs on EVERY init, and the engine re-inits on model switches
 * and pans. A short driving session produced engine_init 9 / engine_dispose 12 and **48 identical
 * `[LayerRegistry] Plugin already registered: …` warns inside 2 ms**. Each console.warn is captured
 * into `__WEATHER_TELEMETRY__` as a `model_warning`, and the ring reader's cardinality check FAILED
 * on the result: `model_warning` was **73.8% of the ring**. In a FIFO ring with no per-type quota,
 * past 50% every OTHER type is an undercount — so this warning was not merely noisy, it was
 * DESTROYING the telemetry it shared a ring with. Second instance of that class in this repo; the
 * first was a per-frame emit fixed in `52b27146`.
 *
 * ★ THE FIX IS NOT "MUTE THE WARNING". The guard's real purpose — catching two DIFFERENT plugins
 *   claiming one id — is preserved; only the expected, identical re-bootstrap goes quiet. A test
 *   that only asserted silence would pass against a deleted guard, so the CONFLICT case is here
 *   with equal weight.
 *
 * ⚠️ AND THE SILENT PATH IS COUNTED, NOT INVISIBLE. Verifying live, the map produced 0 warnings —
 *   but `reregisterCount` was also 0, i.e. the re-registration path had never RUN and the green was
 *   worthless. `__LAYER_REGISTRY_DIAG__.reregisterCount` is the known-present control that exposed
 *   that, and these tests assert it for the same reason.
 */
import {
  registerLayerPlugin, getLayerPlugin, getAllPlugins, destroyPlugins, bootstrapCoreLayers,
} from './LayerRegistry';

const PLUGIN = {
  id: 'waves', type: 'marine', dataSource: 'MARINE_WAVES', renderMode: 'canvas',
  updateFrequency: 1, enabled: false,
};

describe('LayerRegistry re-registration', () => {
  let warn;
  beforeEach(() => {
    destroyPlugins();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    destroyPlugins();
  });

  it('registers a new plugin without warning', () => {
    registerLayerPlugin({ ...PLUGIN });
    expect(getLayerPlugin('waves')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is SILENT when the same definition is registered again — and COUNTS it', () => {
    const before = window.__LAYER_REGISTRY_DIAG__.reregisterCount;
    registerLayerPlugin({ ...PLUGIN });
    registerLayerPlugin({ ...PLUGIN });
    registerLayerPlugin({ ...PLUGIN });
    expect(warn).not.toHaveBeenCalled();
    // THE KNOWN-PRESENT CONTROL: silence only means something if the path actually ran.
    expect(window.__LAYER_REGISTRY_DIAG__.reregisterCount).toBe(before + 2);
    expect(getAllPlugins().filter((p) => p.id === 'waves')).toHaveLength(1);
  });

  it('STILL WARNS on a genuine id conflict (different definition, same id)', () => {
    registerLayerPlugin({ ...PLUGIN });
    registerLayerPlugin({ ...PLUGIN, dataSource: 'SOMETHING_ELSE' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/CONFLICT/i);
  });

  it.each([
    ['type', { type: 'raster' }],
    ['dataSource', { dataSource: 'OTHER' }],
    ['renderMode', { renderMode: 'webgl' }],
  ])('treats a differing %s as a conflict', (_field, override) => {
    registerLayerPlugin({ ...PLUGIN });
    registerLayerPlugin({ ...PLUGIN, ...override });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the FIRST definition on conflict, so a late bad registration cannot hijack an id', () => {
    registerLayerPlugin({ ...PLUGIN });
    registerLayerPlugin({ ...PLUGIN, dataSource: 'HIJACK' });
    expect(getLayerPlugin('waves').dataSource).toBe('MARINE_WAVES');
  });

  it('bootstrapCoreLayers is idempotent and silent across repeated engine inits', () => {
    // THE ACTUAL LIVE SCENARIO: 9 engine inits produced 48 warnings before the fix.
    for (let i = 0; i < 9; i += 1) bootstrapCoreLayers();
    expect(warn).not.toHaveBeenCalled();
    const ids = getAllPlugins().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);           // no duplicates in the registry
    expect(window.__LAYER_REGISTRY_DIAG__.reregisterCount).toBeGreaterThan(0);  // the path RAN
  });

  it('still rejects a plugin with no id', () => {
    expect(() => registerLayerPlugin({ type: 'marine' })).toThrow(/missing id/i);
  });
});
