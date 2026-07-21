import { shouldKeepResidentOnNullEncode } from './WebGLMarineEngine';

// NULL-ENCODE RESIDENT GUARD (SDF handoff §9): encodeMarineTexture returns null for a degenerate grid
// (no vectors / cols<2 / rows<2). setWaveData's unconditional `this._waveData = newWaveData` then blanks
// a valid resident with no re-drive (renderHeatmapAndParticles returns early on !this._waveData). The
// guard drops the degenerate commit and keeps a renderable resident. It is DEFENSIVE HARDENING: the
// null-encode path is a latent gap (setWaveData's top empty-vector guard makes it unreachable from known
// callers today) — the win here is closing a real structural hole + a live falsifiability probe.
// `resident` is the ENCODED data object setWaveData holds in this._waveData — a { waveGrid, ... } wrapper.
const resident = (over = {}) => {
  const { waveGrid: wgOver, ...rest } = over;
  return {
    u_waveTexture: {}, bounds: { west: -82, east: -79, south: 27, north: 29 },
    ...rest,
    waveGrid: {
      cols: 13, rows: 13, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0,
      vectors: new Array(169), __renderable: true, coverage_scope: 'regional', ...(wgOver || {}),
    },
  };
};
// The (degenerate) INCOMING grid whose encode returned null — carries metadata even when malformed.
const incoming = (over = {}) => ({
  cols: 1, rows: 13, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0,
  vectors: new Array(13), ...over,
});

describe('shouldKeepResidentOnNullEncode — blank-heatmap-on-degenerate-commit guard', () => {
  afterEach(() => { delete window.__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__; });

  it('KEEPS a valid renderable resident on a same-layer/same-model degenerate commit (drop it, do not blank)', () => {
    expect(shouldKeepResidentOnNullEncode(resident(), incoming())).toBe(true);
  });

  it('KEEPS with no incoming supplied (renderability floor only — backward-compatible 2-arg call)', () => {
    expect(shouldKeepResidentOnNullEncode(resident())).toBe(true);
  });

  it('does NOT keep on a COLD start — no resident means nothing worth preserving, legacy path runs', () => {
    expect(shouldKeepResidentOnNullEncode(null, incoming())).toBe(false);
    expect(shouldKeepResidentOnNullEncode(undefined, incoming())).toBe(false);
  });

  it('does NOT keep a resident that carries no waveGrid (cannot be trusted to paint)', () => {
    expect(shouldKeepResidentOnNullEncode({ u_waveTexture: {} }, incoming())).toBe(false);
  });

  it('does NOT keep a NON-renderable resident — it is no better than blank, so let the legacy path run', () => {
    // A <2-col / <2-row / empty-vector resident would itself encode to null; holding it protects nothing.
    expect(shouldKeepResidentOnNullEncode(resident({ waveGrid: { cols: 1, rows: 13, vectors: new Array(13) } }), incoming())).toBe(false);
    expect(shouldKeepResidentOnNullEncode(resident({ waveGrid: { cols: 13, rows: 1, vectors: new Array(13) } }), incoming())).toBe(false);
    expect(shouldKeepResidentOnNullEncode(resident({ waveGrid: { cols: 13, rows: 13, vectors: [] } }), incoming())).toBe(false);
    expect(shouldKeepResidentOnNullEncode(resident({ waveGrid: { cols: 13, rows: 13, vectors: null } }), incoming())).toBe(false);
  });

  describe('TRUTH GUARD — never silently hold the old selection mislabeled under a new one', () => {
    it('does NOT keep across a LAYER switch (blank is safer than showing waves under a swell selection)', () => {
      expect(shouldKeepResidentOnNullEncode(resident(), incoming({ __componentLayer: 'swell_1' }))).toBe(false);
    });

    it('does NOT keep across a MODEL switch (never label GFS data as the selected EURO)', () => {
      expect(shouldKeepResidentOnNullEncode(resident(), incoming({ __sourceModel: 'EURO' }))).toBe(false);
    });

    it('KEEPS across a different HOUR (a scrub that came back degenerate holds the last-good frame — transient, not a lie)', () => {
      expect(shouldKeepResidentOnNullEncode(resident({ waveGrid: { hourOffset: 0 } }), incoming({ hourOffset: 24 }))).toBe(true);
    });

    it('KEEPS when the incoming carries no model (only a DEFINITE model mismatch releases — fail toward holding)', () => {
      expect(shouldKeepResidentOnNullEncode(resident(), incoming({ __sourceModel: undefined }))).toBe(true);
    });

    it('layer defaults to "waves" on both sides (an unlabeled resident + unlabeled incoming are same-layer)', () => {
      const r = resident({ waveGrid: { __componentLayer: undefined } });
      expect(shouldKeepResidentOnNullEncode(r, incoming({ __componentLayer: undefined }))).toBe(true);
    });
  });

  it('is fully disabled by the kill switch (restores legacy blank-on-null-encode behaviour)', () => {
    window.__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__ = true;
    expect(shouldKeepResidentOnNullEncode(resident(), incoming())).toBe(false);
  });

  it('honours an injected win object over the global (3rd arg; kill switch respected via the param)', () => {
    expect(shouldKeepResidentOnNullEncode(resident(), incoming(), { __RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__: true })).toBe(false);
    expect(shouldKeepResidentOnNullEncode(resident(), incoming(), {})).toBe(true);
  });

  it('a coarse-global resident is still worth keeping (any renderable frame beats a blank)', () => {
    const coarse = resident({ waveGrid: { cols: 37, rows: 17, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0, vectors: new Array(629), coverage_scope: 'global_coarse' } });
    expect(shouldKeepResidentOnNullEncode(coarse, incoming())).toBe(true);
  });
});
