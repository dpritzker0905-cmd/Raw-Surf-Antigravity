/**
 * F-15 (audit 14.0) — "LOADING" must mean "still might arrive".
 *
 * THE DEFECT THIS PINS. `getLayerTruth` answered a raster layer that was not visible with
 * "LOADING", unconditionally. When the Open-Meteo protocol fails to register, `MapWebGL` never
 * mounts a single raster slot, so nothing can ever become visible — and the diagnostics HUD, whose
 * entire job is to state the truth about what is rendering, reported an unfinished load FOREVER.
 * That is "absence encoded as silence" inside the instrument built to catch it, which is why it
 * gets its own test rather than riding along with the reporter's.
 *
 * ⭐ EVERY ASSERTION HERE IS PAIRED WITH ITS OPPOSITE. A test that only checked
 * `protocolFailed: true → UNAVAILABLE` would pass against an implementation that returned
 * UNAVAILABLE unconditionally, which would be a worse bug than the one being fixed.
 */
import { getLayerTruth } from './TruthOverlay';

const RASTER_LAYERS = ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog'];
const WIND = { vectors: [{ lat: 0, lng: 0, speed: 5, direction: 90 }] };
const MARINE = { grid: { vectors: [{ lat: 0, lng: 0 }] } };

describe('F-15 getLayerTruth discloses a dead protocol', () => {
  describe('raster layers', () => {
    it.each(RASTER_LAYERS)('%s reads UNAVAILABLE when registration has failed', (id) => {
      expect(getLayerTruth(id, false, null, null, true)).toBe('UNAVAILABLE');
      // ...and stays UNAVAILABLE even if something claims visibility: a slot that cannot exist
      // cannot be visible, so a stale `true` here must not out-vote the known-dead protocol.
      expect(getLayerTruth(id, true, null, null, true)).toBe('UNAVAILABLE');
    });

    it.each(RASTER_LAYERS)('%s keeps its ORIGINAL behaviour when the protocol is healthy', (id) => {
      // THE CONTROL. Without these two lines an implementation hard-wired to UNAVAILABLE would
      // pass the block above.
      expect(getLayerTruth(id, true, null, null, false)).toBe('LOADED');
      expect(getLayerTruth(id, false, null, null, false)).toBe('LOADING');
    });

    it('defaults to the healthy reading when the flag is omitted — byte-identical to pre-F-15', () => {
      // Every existing caller that has not been updated must behave exactly as before.
      expect(getLayerTruth('rain', true, null, null)).toBe('LOADED');
      expect(getLayerTruth('rain', false, null, null)).toBe('LOADING');
    });
  });

  describe('non-raster layers are NOT affected', () => {
    // The protocol failure kills the raster slot factory. Wind renders through WebGLWindEngine and
    // marine through WebGLMarineEngine, neither of which touches the om:// protocol on the normal
    // path — so claiming they are unavailable would be over-reporting, the mirror-image defect.
    it('wind still reports from its own vector data', () => {
      expect(getLayerTruth('wind', false, WIND, null, true)).toBe('LOADED');
      expect(getLayerTruth('wind', false, null, null, true)).toBe('LOADING');
    });

    it('marine still reports from its own grid', () => {
      expect(getLayerTruth('waves', false, null, MARINE, true)).toBe('LOADED');
      expect(getLayerTruth('waves', false, null, null, true)).toBe('LOADING');
    });
  });

  it('an unknown layer is OFF in both worlds', () => {
    expect(getLayerTruth('not-a-layer', true, null, null, true)).toBe('OFF');
    expect(getLayerTruth('not-a-layer', true, null, null, false)).toBe('OFF');
  });

  it('the six disclosed layers ARE exactly the raster layers — the copy cannot drift', () => {
    // The user-facing toast and the HUD banner both name OM_PROTOCOL_DEPENDENT_LAYERS. If someone
    // adds a seventh raster layer and forgets the list, the disclosure would under-report and this
    // goes red. Checked against the registry, not against a second hand-written list.
    const { LAYER_REGISTRY } = require('./LayerRegistry');
    const { OM_PROTOCOL_DEPENDENT_LAYERS } = require('./openMeteoProtocolFailure');
    const rasterWithOm = Object.keys(LAYER_REGISTRY)
      .filter((k) => LAYER_REGISTRY[k].type === 'raster' && LAYER_REGISTRY[k].omVariable)
      .sort();
    expect([...OM_PROTOCOL_DEPENDENT_LAYERS].sort()).toEqual(rasterWithOm);
  });
});
