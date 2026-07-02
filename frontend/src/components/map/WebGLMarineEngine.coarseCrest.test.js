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

  it('in the band, default: NEAREST mode with the SEAM floor (0.7 culls divergent-cell seam strips)', () => {
    // 2026-07-02 Baja live report: at boundaries between cells whose headings differ ≳90°, nearest-snapped
    // crests animated in OPPOSITE directions side by side. The shaders measure coherence on the bilinear
    // magnitude BEFORE the nearest override, so 0.7 culls only those seam strips.
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
      expect(src).toContain('dirCoherence < u_dirCoherenceMin');
    }
  });

  it('U2 stratified reseeding + U3 far-zoom size floor are plumbed', () => {
    expect(ADVECT_FS).toContain('uniform float u_stratifiedReseed;');
    expect(ADVECT_FS).toContain('uniform float u_particles_res;');
    expect(ADVECT_FS).toContain('fract(v_uv + (randVal - 0.5) / max(u_particles_res, 1.0))');
    expect(DRAW_VS).toContain('uniform float u_farzoomSizeFloor;');
    expect(DRAW_VS).toContain('(1.0 - u_farzoomSizeFloor) + u_farzoomSizeFloor');
  });
});
