import { resolveTruthVerdict } from './truthVerdict';

// Audit 11.2, mission T-1 last mile. T-1 (`516a7200`) made the parity gate three-valued and taught
// the HUD to show "NOT VERIFIED" on UNSAMPLED. It did NOT teach the row about the other two ways a
// comparison fails to be a pass:
//
//   1. status MISMATCH — the gate found a REAL disagreement. `truthIssues` comes from a DIFFERENT
//      validator (useLayerTruthDiff), so it is empty in this case, and the row fell through to
//      "✓ No Causal Layer Violations Detected". A confirmed disagreement rendered as a pass.
//
//   2. parity absent entirely — `window.__MARINE_SOURCE_PARITY__` undefined (never assembled, or
//      the diagnostics pass has not run). `undefined?.status === 'UNSAMPLED'` is false, so this
//      also fell through to green. This is instance #1 from the six-instruments table wearing a
//      new hat: undefined ⇒ falsy ⇒ the confident branch.
//
// ★ "I detected no violations", "I found a disagreement" and "I could not look" are three states.
//   A row with two branches cannot render three states without lying about one of them.

const MATCH = { status: 'MATCH', match: true, mismatchReasons: null, unsampledReasons: null };
const MISMATCH = {
  status: 'MISMATCH',
  match: false,
  mismatchReasons: ['model: heatmap=GFS infobox=EURO'],
  unsampledReasons: null
};
const UNSAMPLED = {
  status: 'UNSAMPLED',
  match: false,
  mismatchReasons: null,
  unsampledReasons: ['heatmap: zero vectors rendered']
};
const NOT_APPLICABLE = { status: 'NOT_APPLICABLE', match: false, mismatchReasons: null, unsampledReasons: null };

describe('resolveTruthVerdict — the row consumes parity on EVERY path', () => {
  it('MATCH with no issues is the only clean state', () => {
    const v = resolveTruthVerdict([], MATCH);
    expect(v.kind).toBe('clean');
    expect(v.notApplicable).toBe(false);
  });

  it('NOT_APPLICABLE is clean but qualified (resting state, no point selected)', () => {
    const v = resolveTruthVerdict([], NOT_APPLICABLE);
    expect(v.kind).toBe('clean');
    expect(v.notApplicable).toBe(true);
  });

  it('UNSAMPLED refuses, and carries why', () => {
    const v = resolveTruthVerdict([], UNSAMPLED);
    expect(v.kind).toBe('unverified');
    expect(v.parityReasons).toEqual(['heatmap: zero vectors rendered']);
  });

  it('truthIssues always outrank parity', () => {
    const v = resolveTruthVerdict([{ type: 'identity-collision' }], MATCH);
    expect(v.kind).toBe('violations');
    expect(v.issues).toHaveLength(1);
  });

  // ---- the two paths T-1 left open ----

  it('REGRESSION: a parity MISMATCH is a VIOLATION — never clean', () => {
    const v = resolveTruthVerdict([], MISMATCH);
    expect(v.kind).toBe('violations');
    expect(v.parityReasons).toEqual(['model: heatmap=GFS infobox=EURO']);
  });

  it('REGRESSION: a MISMATCH still reports even when useLayerTruthDiff found nothing', () => {
    expect(resolveTruthVerdict([], MISMATCH).kind).not.toBe('clean');
  });

  it('REGRESSION: an ABSENT parity instrument refuses — it does not pass', () => {
    expect(resolveTruthVerdict([], undefined).kind).toBe('unverified');
    expect(resolveTruthVerdict([], null).kind).toBe('unverified');
  });

  it('REGRESSION: a parity object with no status is unreadable, not clean', () => {
    expect(resolveTruthVerdict([], {}).kind).toBe('unverified');
  });

  it('REGRESSION: an UNRECOGNISED status is unreadable, not clean', () => {
    expect(resolveTruthVerdict([], { status: 'PENDING' }).kind).toBe('unverified');
  });

  it('a non-array truthIssues is not silently treated as "no issues"', () => {
    expect(resolveTruthVerdict(undefined, MATCH).kind).not.toBe('violations');
    expect(() => resolveTruthVerdict(undefined, MATCH)).not.toThrow();
  });
});
