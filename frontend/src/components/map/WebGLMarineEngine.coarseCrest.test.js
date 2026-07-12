/**
 * Coarse-band crest controls (2026-07-02): the 2026-07-01 vortex fix suppressed ALL crests on a
 * magnified coarse-global grid (z3.5–7), leaving the whole band crest-less ("wave animations clear
 * z3.61–6.89, restore at 7.04"). The default is now NEAREST-CELL direction sampling: the vortex was
 * the bilinear BLEND of divergent ~10°-cell headings synthesizing a smooth rotation — uniform
 * per-cell headings cannot swirl, so crests animate in the band again. 'suppress' remains available.
 */
import { resolveCoarseCrestControls } from './WebGLMarineEngine';
import { ADVECT_FS, DRAW_VS } from './WebGLMarineParticleShaders';

describe('resolveCoarseCrestControls (vortex-band crest strategy)', () => {
  it('outside the band: everything off', () => {
    expect(resolveCoarseCrestControls(false, {})).toEqual({ dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'off' });
  });

  it('in the band, default: NEAREST mode with the seam floor ON at 0.7 (land-aware coherence)', () => {
    // 2026-07-03: the encoder's direction-only dilation (dilateDirectionField) fills a unit direction
    // into every zero-direction texel, so the bilinear-|waveVec| coherence measure no longer collapses
    // beside coastlines (the land-BLIND floor was the "missing patches all over" regression) — the seam
    // fade is safe to default on. 0.7 fades seams where neighbor headings differ by more than ~90°.
    expect(resolveCoarseCrestControls(true, {})).toEqual({ dirCoherenceMin: 0.7, coarseNearestDir: 1.0, mode: 'nearest' });
  });

  it('nearest mode honours the __RAW_DIR_COHERENCE_MIN__ override (0 = no seam cull)', () => {
    expect(resolveCoarseCrestControls(true, { __RAW_DIR_COHERENCE_MIN__: 0 }).dirCoherenceMin).toBe(0);
    expect(resolveCoarseCrestControls(true, { __RAW_DIR_COHERENCE_MIN__: 0.5 }).dirCoherenceMin).toBe(0.5);
  });

  it("mode 'suppress' restores the 2026-07-01 full-discard behavior", () => {
    const r = resolveCoarseCrestControls(true, { __RAW_COARSE_CREST_MODE__: 'suppress' });
    expect(r).toEqual({ dirCoherenceMin: 2.0, coarseNearestDir: 0.0, mode: 'suppress' });
  });

  it("mode 'suppress' honours the __RAW_DIR_COHERENCE_MIN__ partial-cull override", () => {
    const r = resolveCoarseCrestControls(true, { __RAW_COARSE_CREST_MODE__: 'suppress', __RAW_DIR_COHERENCE_MIN__: 0.5 });
    expect(r.dirCoherenceMin).toBe(0.5);
    expect(r.coarseNearestDir).toBe(0.0);
  });

  it('kill switch → legacy bilinear crests (vortex risk, forensics only)', () => {
    expect(resolveCoarseCrestControls(true, { __RAW_DISABLE_COARSE_CREST_SUPPRESS__: true }).mode).toBe('killed');
    expect(resolveCoarseCrestControls(true, { __RAW_COARSE_CREST_MODE__: 'off' }).mode).toBe('killed');
    const r = resolveCoarseCrestControls(true, { __RAW_DISABLE_COARSE_CREST_SUPPRESS__: true });
    expect(r.dirCoherenceMin).toBe(0.0);
    expect(r.coarseNearestDir).toBe(0.0);
  });
});

describe('nearest-direction shader plumbing', () => {
  it('ADVECT_FS declares and uses the nearest-cell uniforms', () => {
    expect(ADVECT_FS).toContain('uniform float u_coarseNearestDir;');
    expect(ADVECT_FS).toContain('uniform vec2 u_waveGridSize;');
    expect(ADVECT_FS).toContain('u_coarseNearestDir > 0.5');
    expect(ADVECT_FS).toContain('floor(tex_uv * u_waveGridSize)');
  });

  it('DRAW_VS declares and uses the nearest-cell uniforms (orientation matches motion)', () => {
    expect(DRAW_VS).toContain('uniform float u_coarseNearestDir;');
    expect(DRAW_VS).toContain('uniform vec2 u_waveGridSize;');
    expect(DRAW_VS).toContain('u_coarseNearestDir > 0.5');
    expect(DRAW_VS).toContain('floor(tex_uv * u_waveGridSize)');
  });

  it('the nearest override snaps BEFORE the mercator y-flip in both shaders (flip applies once)', () => {
    for (const src of [ADVECT_FS, DRAW_VS]) {
      const overrideIdx = src.indexOf('u_coarseNearestDir > 0.5');
      const flipIdx = src.indexOf('waveVec.y = -waveVec.y;');
      expect(overrideIdx).toBeGreaterThan(-1);
      expect(flipIdx).toBeGreaterThan(overrideIdx);
    }
  });

  it('seam coherence is measured on the BILINEAR sample BEFORE the nearest override (both shaders)', () => {
    for (const src of [ADVECT_FS, DRAW_VS]) {
      const cohIdx = src.indexOf('float dirCoherence = length(waveVec);');
      const overrideIdx = src.indexOf('u_coarseNearestDir > 0.5');
      expect(cohIdx).toBeGreaterThan(-1);
      expect(cohIdx).toBeLessThan(overrideIdx);
      // NO coherence-based drop/discard anywhere (2026-07-03): even the half-floor "core" cull made
      // divergence hotspots (Baja: neighbor rows 177° apart → coherence ~0 across a strip degrees
      // wide) a band-wide crest DEAD ZONE. Seam de-emphasis is a DIM, never a cull.
      expect(src).not.toContain('dirCoherence < u_dirCoherenceMin');
    }
    // DRAW dims alpha two-segment down to u_seamFadeFloor (only the anti-parallel core line nears 0);
    // ADVECT damps drift in the same zones — dim slow shimmer, never a hole or wrong-way streaming.
    expect(DRAW_VS).toContain('v_alpha *= mix(u_seamFadeFloor * coreT, 1.0, seamT);');
    expect(ADVECT_FS).toContain('offset *= mix(0.35, 1.0, smoothstep(0.0, u_dirCoherenceMin, dirCoherence));');
  });

  it('U2 stratified reseeding + U3 far-zoom size floor are plumbed', () => {
    expect(ADVECT_FS).toContain('uniform float u_stratifiedReseed;');
    expect(ADVECT_FS).toContain('uniform float u_particles_res;');
    expect(ADVECT_FS).toContain('fract(v_uv + (randVal - 0.5) / max(u_particles_res, 1.0))');
    expect(DRAW_VS).toContain('uniform float u_farzoomSizeFloor;');
    expect(DRAW_VS).toContain('(1.0 - u_farzoomSizeFloor) + u_farzoomSizeFloor');
  });
});

// === isMagnifiedCoarseField (2026-07-13, the Canaveral "low-pressure center" fix) ===
// The vortex gate re-keyed on CELL MAGNIFICATION: the legacy coarse-global-only z3.5–7 band
// missed 2°/cell MID grids magnified at z7–9.3 (live log: 5×4/7×7/9×9 mid residents at those
// zooms bilinear-swirling into radial "sources"). 80 px/cell preserves the legacy onset by
// construction: a 10° cell at z3.5 is ~80 screen px.
// eslint-disable-next-line import/first
import { isMagnifiedCoarseField } from './WebGLMarineEngine';

describe('isMagnifiedCoarseField — vortex gate by cell magnification', () => {
  it('matches the legacy onset by construction: 10deg cells engage at ~z3.5, not below', () => {
    expect(isMagnifiedCoarseField(10, 3.5, {})).toBe(true);    // ~80.4 px/cell
    expect(isMagnifiedCoarseField(10, 3.0, {})).toBe(false);   // ~56.9 px/cell
  });

  it("catches the user's live case: a 2deg mid cell at z8.6 (~550+ px) ENGAGES", () => {
    expect(isMagnifiedCoarseField(2, 8.63, {})).toBe(true);
    expect(isMagnifiedCoarseField(1.8, 9.3, {})).toBe(true);   // the accepted 5x4 mid clip
  });

  it('mid cells zoomed OUT stay ungated (many cells on screen, no swirl)', () => {
    expect(isMagnifiedCoarseField(2, 5.0, {})).toBe(false);    // ~45 px/cell
  });

  it('FINE grids never gate regardless of zoom (coherent neighbors; per-cell motion would regress)', () => {
    expect(isMagnifiedCoarseField(0.25, 10, {})).toBe(false);
    expect(isMagnifiedCoarseField(0.31, 12, {})).toBe(false);
    expect(isMagnifiedCoarseField(0.99, 14, {})).toBe(false);
  });

  it('kill switch returns null (caller falls back to the legacy band predicate verbatim)', () => {
    expect(isMagnifiedCoarseField(2, 8.6, { __RAW_VORTEX_MAG_GATE_DISABLED__: true })).toBe(null);
  });

  it('threshold is a live lever (__RAW_VORTEX_MIN_CELL_PX__)', () => {
    expect(isMagnifiedCoarseField(2, 5.0, { __RAW_VORTEX_MIN_CELL_PX__: 40 })).toBe(true);
    expect(isMagnifiedCoarseField(10, 3.5, { __RAW_VORTEX_MIN_CELL_PX__: 200 })).toBe(false);
  });

  it('unknown inputs fail SAFE (no gate)', () => {
    expect(isMagnifiedCoarseField(null, 8, {})).toBe(false);
    expect(isMagnifiedCoarseField(undefined, 8, {})).toBe(false);
    expect(isMagnifiedCoarseField(2, undefined, {})).toBe(false);
  });
});
