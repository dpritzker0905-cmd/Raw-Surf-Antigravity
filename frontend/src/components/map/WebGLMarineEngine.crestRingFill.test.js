import { resolveCrestRingFill } from './WebGLMarineEngine';
import { ADVECT_FS, DRAW_VS } from './WebGLMarineParticleShaders';

// CREST RING-FILL (2026-07-16 queue #1) regression guards. Live + 66-frame split-speckle proof:
// when the viewport extends past the resident grid edge, the ring shows the coarse wash but ZERO
// crests — both particle shaders culled outside u_dataBounds. The fix is a per-pixel fallback to
// the held coarse-global base (its wave texture + its OWN world mask). Two failure classes guarded:
//  1. the DECISION (resolveCrestRingFill) — enabling without a complete base set would read
//     unbound/foreign samplers; enabling without the wash would paint crests over bare basemap.
//  2. the SHADER PARITY — advect and draw must gate identically (§4.2 motion-unlock lesson:
//     mismatched land/field semantics kill particles where crests would render and vice versa).

const COMPLETE_BASE = {
  u_waveTexture: {},
  u_oceanMaskTexture: {},
  bounds: { west: -180, south: -80, east: 180, north: 85 },
};

describe('resolveCrestRingFill — enable decision', () => {
  it('enables with a complete base + engaged wash + adequate vertex texture units', () => {
    expect(resolveCrestRingFill({
      killed: false, blendEngaged: true, base: COMPLETE_BASE, maxVertexTextures: 16,
    })).toEqual({ enabled: true, reason: 'ok' });
  });

  it('KILL SWITCH wins over everything', () => {
    expect(resolveCrestRingFill({
      killed: true, blendEngaged: true, base: COMPLETE_BASE, maxVertexTextures: 16,
    })).toEqual({ enabled: false, reason: 'killed' });
  });

  it('stays off while the wash composite is idle (ring crests must ride the SAME field the wash paints)', () => {
    expect(resolveCrestRingFill({
      killed: false, blendEngaged: false, base: COMPLETE_BASE, maxVertexTextures: 16,
    })).toEqual({ enabled: false, reason: 'wash_idle' });
  });

  it('requires the COMPLETE base set — wave texture, its own mask, and bounds', () => {
    expect(resolveCrestRingFill({ blendEngaged: true, base: null }).reason).toBe('no_base');
    expect(resolveCrestRingFill({
      blendEngaged: true, base: { ...COMPLETE_BASE, u_waveTexture: null },
    }).reason).toBe('no_base');
    expect(resolveCrestRingFill({
      blendEngaged: true, base: { ...COMPLETE_BASE, u_oceanMaskTexture: null },
    }).reason).toBe('no_base');
    expect(resolveCrestRingFill({
      blendEngaged: true, base: { ...COMPLETE_BASE, bounds: null },
    }).reason).toBe('no_base');
  });

  it('declines below 7 vertex texture units (DRAW_VS statically samples 7) but fails OPEN on unknown', () => {
    expect(resolveCrestRingFill({
      blendEngaged: true, base: COMPLETE_BASE, maxVertexTextures: 6,
    })).toEqual({ enabled: false, reason: 'vertex_tex_units' });
    // unknown (getParameter threw before it could report) → fail open: every WebGL-era GPU ≥16
    expect(resolveCrestRingFill({
      blendEngaged: true, base: COMPLETE_BASE, maxVertexTextures: undefined,
    }).enabled).toBe(true);
  });
});

describe('ring-fill shader wiring — advect/draw parity', () => {
  const RING_UNIFORMS = [
    'uniform float u_ringFillEnabled;',
    'uniform sampler2D u_coarseWaveTexture;',
    'uniform sampler2D u_coarseMaskTexture;',
    'uniform vec2 u_coarseBounds_min;',
    'uniform vec2 u_coarseBounds_max;',
  ];

  it.each([['ADVECT_FS', ADVECT_FS], ['DRAW_VS', DRAW_VS]])(
    '%s declares the full ring-fill uniform set', (_name, src) => {
      for (const u of RING_UNIFORMS) expect(src).toContain(u);
    });

  it.each([['ADVECT_FS', ADVECT_FS], ['DRAW_VS', DRAW_VS]])(
    '%s gates the fallback on the SAME predicate (enabled + out-of-resident + inside coarse bounds)', (_name, src) => {
      expect(src).toContain('bool useCoarse = (u_ringFillEnabled > 0.5) && !inResident');
      expect(src).toContain('&& c_u >= 0.0 && c_u <= 1.0 && c_v >= 0.0 && c_v <= 1.0;');
    });

  it.each([['ADVECT_FS', ADVECT_FS], ['DRAW_VS', DRAW_VS]])(
    '%s samples the coarse pair for field AND land when falling back', (_name, src) => {
      expect(src).toContain('useCoarse ? texture2D(u_coarseWaveTexture, vec2(c_u, c_v))');
      expect(src).toContain('? texture2D(u_coarseMaskTexture,');
    });

  it.each([['ADVECT_FS', ADVECT_FS], ['DRAW_VS', DRAW_VS]])(
    '%s keeps the nearest-cell direction snap RESIDENT-only (u_waveGridSize is resident texel dims)', (_name, src) => {
      expect(src).toContain('if (u_coarseNearestDir > 0.5 && !useCoarse) {');
    });

  it('ADVECT_FS only drops OOB particles the fallback cannot take (current AND next position)', () => {
    expect(ADVECT_FS).toContain('bool isOob = (!inResident && !useCoarse) || (!nextInResident && !nextUseCoarse);');
    expect(ADVECT_FS).toContain('bool nextUseCoarse = (u_ringFillEnabled > 0.5) && !nextInResident');
  });

  it('DRAW_VS only culls OOB particles the fallback cannot take', () => {
    expect(DRAW_VS).toContain('bool isOob = !inResident && !useCoarse;');
  });

  it('DRAW_VS exempts ring particles from the resident edge feather (negative tex_u/v would zero them)', () => {
    expect(DRAW_VS).toContain('if (u_edgeFeatherEnabled > 0.5 && !useCoarse) {');
  });

  it('DRAW_VS checks ring ribbon ENDS against the coarse mask and skips resident-aligned shoal foam', () => {
    expect(DRAW_VS).toContain('endMaskSample = texture2D(u_coarseMaskTexture, vec2(cend_u, cend_v));');
    expect(DRAW_VS).toContain('if (u_shoalFoam > 0.0001 && !useCoarse) {');
  });
});
