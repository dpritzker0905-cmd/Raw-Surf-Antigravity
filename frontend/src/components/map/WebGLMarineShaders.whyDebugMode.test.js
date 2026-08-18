import { HEATMAP_FS } from './WebGLMarineShaders';

/**
 * The 'why' discard-reason debug mode (2026-08-17, the 255 deg teardown).
 *
 * WHY THIS FILE EXISTS. The teardown proved the mask was innocent at the residual but could not name
 * the culprit, because A BLANK PIXEL CANNOT SAY WHICH DISCARD RAN. Mode 5 paints the reason instead:
 * RED mask discard, BLUE rating discard, GREEN the pass paints.
 *
 * THE ONE FAILURE THAT WOULD MATTER IS SILENT: if the real discards are ever edited and the debug
 * branch is not, the view keeps rendering confident colours that no longer describe the code — and an
 * instrument that lies is worse than no instrument. These tests pin the two condition sets TOGETHER,
 * so drift fails here rather than in a future forensics session.
 *
 * (The suite already had 32 green tests over this shader and NOT ONE covered these lines. A green
 * suite is not coverage of a change.)
 */
describe('HEATMAP_FS — the why/discard-reason debug mode', () => {
  // Comments are STRIPPED before assertion: the branch's own rationale mentions `u_opacity` in
  // prose, and an assertion that matches a comment is testing the documentation, not the code.
  const whyBranch = () => {
    const start = HEATMAP_FS.indexOf('u_debug_mode < 5.5');
    expect(start).toBeGreaterThan(-1);
    const end = HEATMAP_FS.indexOf('// Ocean mask: discard land pixels');
    expect(end).toBeGreaterThan(start);
    return HEATMAP_FS.slice(start, end).replace(/\/\/[^\r\n]*/g, '');
  };

  it('is wired as mode 5, after mercator (4) and before the real discards', () => {
    expect(HEATMAP_FS).toContain('u_debug_mode < 4.5');
    expect(HEATMAP_FS).toContain('u_debug_mode < 5.5');
    expect(HEATMAP_FS.indexOf('u_debug_mode < 4.5')).toBeLessThan(HEATMAP_FS.indexOf('u_debug_mode < 5.5'));
    // it must run BEFORE the discards it classifies, or it could never report them
    expect(HEATMAP_FS.indexOf('u_debug_mode < 5.5'))
      .toBeLessThan(HEATMAP_FS.indexOf('// Ocean mask: discard land pixels'));
  });

  it('classifies with three unambiguous full-alpha colours', () => {
    const b = whyBranch();
    expect(b).toContain('vec4(1.0, 0.0, 0.0, 1.0)');   // RED   mask discard
    expect(b).toContain('vec4(0.0, 0.0, 1.0, 1.0)');   // BLUE  rating discard
    expect(b).toContain('vec4(0.0, 1.0, 0.0, 1.0)');   // GREEN paints
    // alpha must NOT be u_opacity: a classification read through a blend is not a classification
    expect(b).not.toContain('u_opacity');
  });

  it('MATCHES THE REAL DISCARDS — the drift guard', () => {
    const b = whyBranch();
    // the mask discard, on both sides
    expect(HEATMAP_FS).toContain('if (oceanAlpha < 0.5) {');
    expect(b).toContain('oceanAlpha < 0.5');
    // the rating discard: surf mode + the 0.05 score floor, and the score is waveHeight * 10
    expect(HEATMAP_FS).toContain('float ratingScore = waveHeight * 10.0;');
    expect(HEATMAP_FS).toContain('if (ratingScore <= 0.05) discard;');
    expect(b).toContain('u_surfMode > 0.5');
    expect(b).toContain('waveHeight * 10.0 <= 0.05');
  });

  it('still has exactly the two discards the mode claims to enumerate', () => {
    const discards = HEATMAP_FS.match(/discard\s*;/g) || [];
    // If this count changes, a THIRD way to produce nothing exists and mode 5 is now incomplete —
    // it would paint GREEN over a pixel that in fact renders nothing. Extend the mode, not this number.
    expect(discards).toHaveLength(2);
  });

  it('leaves every non-debug render untouched (the branch is gated, not inlined)', () => {
    // the whole debug block only runs under u_debug_mode > 0.5; production paths pass 0.0
    expect(HEATMAP_FS).toContain('if (u_debug_mode > 0.5) {');
    expect(HEATMAP_FS.indexOf('if (u_debug_mode > 0.5) {'))
      .toBeLessThan(HEATMAP_FS.indexOf('u_debug_mode < 5.5'));
  });
});
