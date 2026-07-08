/**
 * Consistency + resolution tests for the baked NATURAL animation defaults (2026-07-01).
 *
 * The §5#2 animation upgrades (trochoidal crest, orbital pitch, shoaling foam, crest jitter) shipped as
 * gated shader uniforms DEFAULT-OFF; the visual dial-in ("Natural") was never baked, so production always
 * rendered the legacy flat look and the tuner preset had to be re-applied by hand every session. Natural is
 * now the engine default (WebGLMarineEngine.NATURAL_ANIM_DEFAULTS + resolveAnimValue). The tuner mirrors the
 * values instead of importing the engine (engine-boundaries.md: the panel never imports the engine) — this
 * test is the sync enforcement between the two files.
 */
import { NATURAL_ANIM_DEFAULTS, resolveAnimValue } from './WebGLMarineEngine';
import fs from 'fs';
import path from 'path';

const KEYS = ['__RAW_TROCHOIDAL__', '__RAW_ORBITAL_PITCH__', '__RAW_SHOAL_FOAM__', '__RAW_CREST_DIR_JITTER__'];

afterEach(() => {
  for (const k of KEYS) delete window[k];
  delete window.__RAW_ANIM_LEGACY__;
});

describe('NATURAL_ANIM_DEFAULTS ↔ tuner sync', () => {
  // Parse the tuner source instead of importing it: the tuner module renders via react-dom portals and its
  // defaults live in data tables — a source-level assert keeps this test dependency-free and unambiguous.
  const tunerSrc = fs.readFileSync(path.join(__dirname, 'MarineAnimTuner.js'), 'utf8');

  it('tuner CONTROLS defs match the engine baked defaults', () => {
    for (const [key, val] of Object.entries(NATURAL_ANIM_DEFAULTS)) {
      const m = tunerSrc.match(new RegExp(`key:\\s*'${key}'[^\\n]*def:\\s*([0-9.]+)`));
      expect(m).not.toBeNull();
      expect(parseFloat(m[1])).toBe(val);
    }
  });

  it('tuner PRESET_NATURAL matches the engine baked defaults', () => {
    for (const [key, val] of Object.entries(NATURAL_ANIM_DEFAULTS)) {
      const m = tunerSrc.match(new RegExp(`PRESET_NATURAL = \\{[^}]*${key}:\\s*([0-9.]+)`));
      expect(m).not.toBeNull();
      expect(parseFloat(m[1])).toBe(val);
    }
  });

  it('tuner uses the V2 persistence key (stale pre-Natural saves must not mask the baked look)', () => {
    expect(tunerSrc).toContain("const LS_VALS = '__RAW_TUNER_VALUES_V2__'");
  });
});

describe('resolveAnimValue resolution order', () => {
  it('returns the Natural default when nothing overrides', () => {
    expect(resolveAnimValue('__RAW_TROCHOIDAL__')).toBe(0.7);
    expect(resolveAnimValue('__RAW_ORBITAL_PITCH__')).toBe(2.5);
    expect(resolveAnimValue('__RAW_SHOAL_FOAM__')).toBe(1.5);
    expect(resolveAnimValue('__RAW_CREST_DIR_JITTER__')).toBe(0.26);
  });

  it('explicit window global (tuner slider / console) wins over everything', () => {
    window.__RAW_TROCHOIDAL__ = 0.3;
    expect(resolveAnimValue('__RAW_TROCHOIDAL__')).toBe(0.3);
    window.__RAW_TROCHOIDAL__ = 0;                       // slider at 0 = flat, respected
    expect(resolveAnimValue('__RAW_TROCHOIDAL__')).toBe(0);
    window.__RAW_ANIM_LEGACY__ = true;                    // explicit value still wins over the kill
    window.__RAW_TROCHOIDAL__ = 0.9;
    expect(resolveAnimValue('__RAW_TROCHOIDAL__')).toBe(0.9);
  });

  it('__RAW_ANIM_LEGACY__ kill restores the flat pre-2026-07 look (0) for unset keys', () => {
    window.__RAW_ANIM_LEGACY__ = true;
    for (const k of KEYS) expect(resolveAnimValue(k)).toBe(0.0);
  });

  it('unknown keys resolve to 0 (never NaN/undefined into a uniform)', () => {
    expect(resolveAnimValue('__RAW_DOES_NOT_EXIST__')).toBe(0.0);
  });
});
