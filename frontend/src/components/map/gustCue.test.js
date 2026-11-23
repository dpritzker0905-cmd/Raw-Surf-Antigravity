/**
 * GUST CUE A/B (windGustColour.gustCue, gustShaderSplice.js 'width', gustHatch.js 'hatch', GustCueKey.js): one build runs every
 * candidate; the default stays today's flicker until the owner picks; each cue's kill drops it to no cue; motion is never
 * touched; the legend says what the cue means.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { gustCue, gustFlicker, GUST_CUES, GUST_CUE_DEFAULT, bindGustColour } from './windGustColour';
import { GUST_SPLICE } from './gustShaderSplice';
import { hatchGeometry, GUST_HATCH } from './gustHatch';
import GustCueKey, { gustCueKeyText } from './GustCueKey';
import { DRAW_VS, DRAW_FS } from './WebGLWindShaders';

const NL = String.fromCharCode(10);
const store = (v) => ({ getItem: (k) => (k === 'rawGustCue' ? v : null) });

describe('gustCue lever', () => {
  test('default is today\'s flicker; the window lever wins over storage; junk is ignored', () => {
    expect(GUST_CUE_DEFAULT).toBe('flicker');
    expect(GUST_CUES).toEqual(['flicker', 'width', 'hatch', 'none']);
    expect(gustCue({})).toBe('flicker');
    expect(gustCue({ localStorage: store('hatch') })).toBe('hatch');
    expect(gustCue({ __RAW_GUST_CUE__: 'width', localStorage: store('hatch') })).toBe('width');
    expect(gustCue({ __RAW_GUST_CUE__: 'sparkle', localStorage: store('nope') })).toBe('flicker');
    expect(gustCue({ localStorage: { getItem: () => { throw new Error('blocked'); } } })).toBe('flicker');
  });

  test('each cue\'s own kill drops it to no cue, and only its own', () => {
    expect(gustCue({ __RAW_DISABLE_GUST_FLICKER__: true })).toBe('none');
    expect(gustCue({ __RAW_GUST_CUE__: 'width', __RAW_DISABLE_GUST_WIDTH__: true })).toBe('none');
    expect(gustCue({ __RAW_GUST_CUE__: 'hatch', __RAW_DISABLE_GUST_HATCH__: true })).toBe('none');
    expect(gustCue({ __RAW_GUST_CUE__: 'hatch', __RAW_DISABLE_GUST_WIDTH__: true })).toBe('hatch');
    expect(gustCue({ __RAW_GUST_CUE__: 'width', __RAW_DISABLE_GUST_HATCH__: true })).toBe('width');
  });

  test('the flicker runs only under the flicker cue (and never under reduced motion)', () => {
    expect(gustFlicker({}).on).toBe(true);
    expect(gustFlicker({ __RAW_GUST_CUE__: 'width' }).on).toBe(false);
    expect(gustFlicker({ __RAW_GUST_CUE__: 'hatch' }).on).toBe(false);
    expect(gustFlicker({ __RAW_GUST_CUE__: 'none' }).on).toBe(false);
    expect(gustFlicker({ matchMedia: () => ({ matches: true }) }).on).toBe(false);
  });
});

describe('width cue (shader splice)', () => {
  test('widens only ACROSS the flow, keyed on G/W 1.5 -> 2.0, and never touches motion or length', () => {
    expect(GUST_SPLICE.vsColour).toContain('v_bold = 1.0 + 0.8 * smoothstep(1.5, 2.0, v_cspeed / max(v_speed, 2.0))');
    expect(GUST_SPLICE.fsBold).toContain('localCoord.y /= v_bold;');
    // the across-wind axis is divided; the along-wind axis (length, which reads as speed) is untouched, and the dash's own
    // line stays byte for byte (windParticlesV2 / windParticleScale pin it)
    expect(DRAW_FS).toContain('localCoord = vec2(along.x, along.y * elong * max(v_stretch, 1.0));' + NL + '    localCoord.y /= v_bold;');
    expect(DRAW_FS).not.toMatch(/localCoord\.x\s*[/*]=\s*v_bold/);
    expect(DRAW_FS).toContain('varying float v_bold;');
    expect(DRAW_VS).toContain('uniform float u_gust_bold; varying float v_bold;');
    expect(GUST_SPLICE.vsColour).not.toMatch(/gl_PointSize|v_stretch|pos\s*=/);
  });

  test('u_gust_bold is 1 only under the width cue, and never for currents', () => {
    const calls = {};
    const gl = { getUniformLocation: (p, n) => n, uniform1f: (n, v) => { calls[n] = v; }, uniform4f: () => {}, uniform2f: () => {},
      uniform1i: () => {}, activeTexture: () => {}, bindTexture: () => {}, TEXTURE0: 0, TEXTURE_2D: 1 };
    const engine = { _gustMode: true, _gust: { tex: {}, bounds: { west: 0, south: 0, east: 1, north: 1 }, cols: 2, rows: 2, maxKn: 75, sea: false } };
    window.__RAW_GUST_CUE__ = 'width';
    try {
      bindGustColour(gl, 'p', engine); expect(calls.u_gust_bold).toBe(1);
      engine._gust.sea = true; bindGustColour(gl, 'p', engine); expect(calls.u_gust_bold).toBe(0);
      engine._gust.sea = false; window.__RAW_GUST_CUE__ = 'flicker'; bindGustColour(gl, 'p', engine); expect(calls.u_gust_bold).toBe(0);
    } finally { delete window.__RAW_GUST_CUE__; }
  });
});

describe('hatch cue (gustHatch.js)', () => {
  // a flat Mercator camera: world px = merc * worldPx - origin, clip = px / screen * 2 - 1 (column-major mat4)
  const cam = (worldPx, ox, oy, W, H) => [2 * worldPx / W, 0, 0, 0, 0, 2 * worldPx / H, 0, 0, 0, 0, 1, 0, -2 * ox / W - 1, -2 * oy / H - 1, 0, 1];

  test('spacing is constant in CSS px: 8 on desktop, 12 on a phone, scaled by DPR; lines 1.25 css px', () => {
    const d = hatchGeometry(cam(1 << 20, 0, 0, 1440, 900), 1440, 900, 1);
    expect(d.spacing).toBe(8); expect(d.width).toBe(1.25); expect(d.phone).toBe(false);
    const p = hatchGeometry(cam(1 << 20, 0, 0, 1125, 2436), 1125, 2436, 3);   // a 375 css px phone at DPR 3
    expect(p.phone).toBe(true); expect(p.spacing).toBe(36); expect(p.width).toBe(3.75);
  });

  test('ANCHORED TO THE MAP: panning by any amount leaves the hatch at the same place on the map', () => {
    const W = 1440, H = 900, wp = 512 * 2 ** 7;
    const a = hatchGeometry(cam(wp, 1000, 2000, W, H), W, H, 1);
    const b = hatchGeometry(cam(wp, 1000 + 37, 2000 - 5, W, H), W, H, 1);   // the map moved 37 px left, 5 px down
    // a screen point p shows map point p + origin; the line phase at a fixed MAP point must not change
    const phaseAt = (g, ox, oy, mx, my) => (((mx - ox) + (my - oy) + g.phaseSum) % g.spacing + g.spacing) % g.spacing;
    expect(phaseAt(a, 1000, 2000, 5000, 6000)).toBeCloseTo(phaseAt(b, 1037, 1995, 5000, 6000), 6);
  });

  test('thresholds: hatch from G/W 1.5, cross-hatch from 2.0; ink exists for every theme', () => {
    expect(GUST_HATCH.gusty).toBe(1.5); expect(GUST_HATCH.veryGusty).toBe(2.0);
    for (const t of ['dark', 'light', 'beach']) { expect(GUST_HATCH.ink[t]).toHaveLength(3); expect(GUST_HATCH.alpha[t]).toBeGreaterThan(0); }
  });
});

describe('GustCueKey: the legend says what the cue means (never colour alone)', () => {
  afterEach(() => { delete window.__RAW_GUST_CUE__; });
  test('one accessible sentence per cue; nothing to explain under no cue', () => {
    expect(gustCueKeyText('hatch').label).toMatch(/Hatched areas are gusty: gusts at least 1.5 times the mean wind/);
    expect(gustCueKeyText('width').label).toMatch(/Wider marks are in gusty air/);
    expect(gustCueKeyText('flicker').label).toMatch(/pulse/);
    expect(gustCueKeyText('flicker', true).label).toMatch(/reduced motion/);
    expect(gustCueKeyText('none')).toBeNull();
  });
  test('renders a role=note with the label, following the lever', () => {
    window.__RAW_GUST_CUE__ = 'hatch';
    render(<GustCueKey className="x" />);
    const note = screen.getByRole('note');
    expect(note.getAttribute('aria-label')).toMatch(/Cross-hatched areas are very gusty/);
    expect(note.getAttribute('data-gust-cue')).toBe('hatch');
  });
  test('the width cue\'s kill hides the key with the cue', () => {
    window.__RAW_GUST_CUE__ = 'width'; window.__RAW_DISABLE_GUST_WIDTH__ = true;
    try { const { container } = render(<GustCueKey />); expect(container.firstChild).toBeNull(); } finally { delete window.__RAW_DISABLE_GUST_WIDTH__; }
  });
});
