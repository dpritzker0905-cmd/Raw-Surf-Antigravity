/**
 * Current particles (currentParticles.js): Currents runs the WIND particle engine on the current's own u / v. Pins: the gate,
 * its kill and reduced motion; the hand-off; the grid (direction toward, the one gain, south-first rows, land = still water,
 * no direction = no grid); the colour / sea bytes; the wiring (never published as wind, ocean-only shader, one engine).
 */
import fs from 'fs';
import path from 'path';
import {
  currentParticlesOn, currentFlowMode, setShownCurrentField, getShownCurrentField, subscribeCurrentField, setOfPath,
  buildCurrentGrid, encodeCurrentColour, gridForShown, CURRENT_SPEED_GAIN, CURRENT_RAMP_MAX, DIR_STEP_DEG,
} from './currentParticles';
import { setGustMode, setGustField, gustColourActive, gustModeBlank, rampMaxFor, bindGustColour } from './windGustColour';
import { DRAW_VS } from './WebGLWindShaders';
import { OWN_RASTER_SETS } from './ownRasterFrames';

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const MISSING = -1e30;
const code = (deg) => Math.round(deg / DIR_STEP_DEG) % 256;

afterEach(() => {
  delete window.__RAW_DISABLE_CURRENT_PARTICLES__;
  delete window.matchMedia;
  setShownCurrentField(null);
});

describe('layer gating', () => {
  test('ships ON: Currents flows the wind engine on the current; the kill returns the raster alone', () => {
    expect(currentParticlesOn()).toBe(true);
    expect(currentFlowMode(['currents'])).toBe(true);
    window.__RAW_DISABLE_CURRENT_PARTICLES__ = true;
    expect(currentParticlesOn()).toBe(false);
    expect(currentFlowMode(['currents'])).toBe(false);
  });

  test('prefers-reduced-motion: no particles (the raster still shows the speed)', () => {
    window.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    expect(currentFlowMode(['currents'])).toBe(false);
  });

  test('Wind or Gusts own the particles when picked with Currents; other layers run none', () => {
    expect(currentFlowMode(['currents', 'wind'])).toBe(false);
    expect(currentFlowMode(['gusts', 'currents'])).toBe(false);
    for (const l of [[], ['pressure'], ['waves'], null]) expect(currentFlowMode(l)).toBe(false);
  });

  test('MapWebGL hands the wind layer the current grid, with no wind delivery queue, only in current mode', () => {
    const m = src('MapWebGL.js');
    expect(m).toContain('const currentFlow = currentFlowMode(activeLayers);');
    expect(m).toContain('data={currentFlow ? currentGrid : windData}');
    expect(m).toContain('deliveryQueue={currentFlow ? null : windDeliveryQueue}');
    expect(m).toContain('currentFlow={currentFlow}');
  });
});

describe('the hand-off', () => {
  const field = { cols: 2, rows: 2, values: Float32Array.from([1, 1, 1, 1]), bounds: { west: 0, south: 0, east: 1, north: 1 }, validMs: 5 };

  test('subscribers get the shown field and its set; null when it leaves', () => {
    const seen = [];
    const off = subscribeCurrentField((r) => seen.push(r));
    setShownCurrentField(field, 'cmems/marine/currents/global_0p25');
    setShownCurrentField(field, 'cmems/marine/currents/global_0p25');   // same: no second notice
    setShownCurrentField(null);
    off();
    expect(seen).toEqual([{ field, source: 'cmems/marine/currents/global_0p25' }, null]);
    expect(getShownCurrentField()).toBeNull();
  });

  test('a frame path names its set, so any currents set on screen drives the particles (not a hard-coded source)', () => {
    expect(setOfPath('v1/cmems/marine/currents/global_0p25/20261122T00Z/20261122T06Z-abc.bin')).toBe('cmems/marine/currents/global_0p25');
    expect(setOfPath('v1/rtofs/marine/currents/global_0p25/r/f.bin')).toBe('rtofs/marine/currents/global_0p25');
    const r = src('useOwnRasterFrames.js');
    expect(r).toContain("if (layer === 'currents') setShownCurrentField(field || null, setOfPath(path));");
    expect(r).toMatch(/noteMiss\('no_frame'\);\s*if \(layer === 'gusts'\) setShownGustField\(null\);[^\n]*\n\s*if \(layer === 'currents'\) setShownCurrentField\(null\);/);   // no frame: no particles
  });

  test('the currents set decodes its flow direction beside the speed (one byte, else the old field 1)', () => {
    expect(OWN_RASTER_SETS.currents.dirField).toEqual([14, 1]);
    expect(OWN_RASTER_SETS.gusts.dirField).toBeUndefined();
  });
});

describe('the grid the engine advects on', () => {
  // 4 x 4 lattice, south row first, the publisher's anchors at even rows / columns (frame_binary.flow_dir_anchors):
  // block (0,0) flows east at 1 kn, block (0,1) north at 2 kn, the upper blocks are land; non-anchor cells carry 0.
  const f = () => {
    const values = Float32Array.from([1, 1, 2, 2, 1, 1, 2, 2, MISSING, MISSING, MISSING, MISSING, MISSING, MISSING, MISSING, MISSING]);
    const dirCodes = new Uint8Array(16);
    dirCodes[0] = code(90); dirCodes[2] = code(0);
    return { cols: 4, rows: 4, bounds: { west: -180, south: -1, east: -179.25, north: -0.25 }, validMs: Date.UTC(2026, 10, 22, 6), values, dirCodes };
  };

  test('direction TOWARD from the anchors, every speed x the one gain, rows kept south-first, land still', () => {
    const g = buildCurrentGrid(f(), 'cmems/x', 2);
    expect(g.cols).toBe(2); expect(g.rows).toBe(2);
    expect(g.vectors[0].u).toBeCloseTo(CURRENT_SPEED_GAIN, 6);       // east 1 kn -> 12 engine kn
    expect(g.vectors[0].v).toBeCloseTo(0, 6);
    expect(g.vectors[1].v).toBeCloseTo(2 * CURRENT_SPEED_GAIN, 6);   // north 2 kn
    expect(g.vectors[2]).toEqual({ u: 0, v: 0, speed: 0 });         // land
    expect(g.isCurrentFlow).toBe(true);
    expect(g.source).toBe('currents:cmems/x');
    expect(g.truthTag.layer).toBe('currents');
    expect(g.valid_time).toBe('2026-11-22T06:00:00.000Z');
    expect(g.bounds).toEqual({ west: -180, south: -1, east: -179.5, north: -0.5 });
  });

  test('a wider stride (phones) takes the vector mean of the anchors with water in its block', () => {
    const g = buildCurrentGrid(f(), 's', 4);
    expect(g.cols).toBe(1); expect(g.rows).toBe(1);
    expect(g.vectors[0].u).toBeCloseTo(CURRENT_SPEED_GAIN / 2, 6);   // (east 1 + north 2) / 2 anchors with water
    expect(g.vectors[0].v).toBeCloseTo(CURRENT_SPEED_GAIN, 6);
  });

  test('a global 0.25-deg frame gives the 0.5-deg grid to the east and north edges', () => {
    const cols = 1440; const rows = 721;
    const fld = { cols, rows, bounds: { west: -180, south: -90, east: 179.75, north: 90 }, validMs: 0,
      values: new Float32Array(cols * rows).fill(0.5), dirCodes: new Uint8Array(cols * rows) };
    const g = buildCurrentGrid(fld, 's', 2);
    expect([g.cols, g.rows]).toEqual([720, 361]);
    expect(g.bounds).toEqual({ west: -180, south: -90, east: 179.5, north: 90 });
  });

  test('no direction (a frame before the direction byte) or no water: no grid, nothing drawn', () => {
    const a = f(); delete a.dirCodes;
    expect(buildCurrentGrid(a, 's')).toBeNull();
    const b = f(); b.values.fill(MISSING);
    expect(buildCurrentGrid(b, 's')).toBeNull();
    expect(gridForShown({ field: a, source: 's' })).toBeNull();
    expect(window.__RAW_CURRENT_PARTICLES__.state).toBe('no_direction');
  });

  test('the colour / sea bytes: land 0 (hidden), water scaled to the ramp top of 4 kn', () => {
    const e = encodeCurrentColour(f());
    expect(e.maxKn).toBe(CURRENT_RAMP_MAX);
    expect(e.bytes[0]).toBe(1 + Math.round((1 * CURRENT_SPEED_GAIN) / CURRENT_RAMP_MAX * 254));
    expect(e.bytes[8]).toBe(0);
  });
});

describe('one engine: the gust colour path in current mode', () => {
  const glStub = () => {
    const set = {};
    return { set, TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_ALIGNMENT: 3, LUMINANCE: 4, UNSIGNED_BYTE: 5, TEXTURE0: 100,
      getParameter: () => null, createTexture: () => ({}), deleteTexture: () => {}, bindTexture: () => {}, pixelStorei: () => {},
      texParameteri: () => {}, texImage2D: () => {}, texSubImage2D: () => {}, activeTexture: () => {},
      getUniformLocation: (p, n) => n, uniform1f: (n, v) => { set[n] = v; }, uniform1i: () => {}, uniform2f: () => {},
      uniform4f: (n, a) => { set[n] = a; } };
  };
  const fld = { cols: 2, rows: 2, values: Float32Array.from([1, MISSING, 2, 3]), bounds: { west: 0, south: 0, east: 1, north: 1 }, validMs: 1 };

  test('Currents picked with no frame: the engine is blank (never wind under the Currents label)', () => {
    const engine = { _maxWindSpeed: 30 };
    setGustMode(engine, 'current');
    expect(gustModeBlank(engine)).toBe(true);
    const gl = glStub();
    setGustField(engine, gl, fld, { encoded: encodeCurrentColour(fld), sea: true });
    expect(gustColourActive(engine)).toBe(true);
    expect(rampMaxFor(engine)).toBe(CURRENT_RAMP_MAX);
    bindGustColour(gl, {}, engine);
    expect(gl.set.u_gust_sea).toBe(1);          // ocean only
    expect(gl.set.u_gust_flick).toBe(0);        // uniform4f stub keeps the first component: no gust flicker on a current
  });

  test('the draw shader hides marks over no-data cells only with the sea flag', () => {
    expect(DRAW_VS).toContain('uniform float u_gust_sea;');
    expect(DRAW_VS).toContain('if (u_gust_on > 0.5 && u_gust_sea > 0.5 && gb < 1.0) v_flick = 0.0;');
  });

  test('a current grid is never published as wind (its knots are scaled), and the layer follows the current field', () => {
    const l = src('WebGLWindLayer.js');
    expect(l).toContain('if (!data.isCurrentFlow) publishWindDrawn(data);');
    expect(l).toContain('engine.setGustField(gl, field || null, field ? { encoded: currentColourOf(field), sea: true } : undefined);');
    expect(l).toContain('subscribeCurrentField((rec) => { apply(rec ? rec.field : null); })');
  });
});
