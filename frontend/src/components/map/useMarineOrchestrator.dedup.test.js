/**
 * Orchestrator dedup sites must be state-authoritative (2026-07-03, HANDOFF night-2 §5).
 * The three layer-switch commit sites (instant cache-hit, backend cache hit, local cache remap)
 * used to skip on the sig LEDGER alone — the same divergence class as the bd61afda wedge: the
 * ledger records commits the ENGINE may reject downstream, so ledger==sig with state!=sig skipped
 * the commit AND early-returned the whole layer-switch flow (no fallback fetch) → stale display.
 * shouldSkipDuplicateCommit encodes the rule: skip ONLY when ledger AND prev state both match.
 */
import { shouldSkipDuplicateCommit } from './useMarineOrchestrator';

describe('shouldSkipDuplicateCommit (state-authoritative orchestrator dedup)', () => {
  const SIG = 'GFS_waves_0_open-meteo_37x17_n629_ch87048911';
  const OTHER = 'GFS_waves_0_open-meteo_13x13_n169_ch12345678';

  it('SKIPS a true duplicate: ledger AND prev state both hold this exact signature', () => {
    expect(shouldSkipDuplicateCommit(SIG, SIG, SIG)).toBe(true);
  });

  it('COMMITS the wedge case: ledger holds the sig but state holds a DIFFERENT grid', () => {
    // The engine rejected the earlier commit after the ledger recorded it (no-downgrade race).
    // A ledger-only skip here strands the display; state disagreement must let it through.
    expect(shouldSkipDuplicateCommit(SIG, SIG, OTHER)).toBe(false);
  });

  it('COMMITS after a ledger invalidation even when state content is identical (recovery hatch)', () => {
    // Recovery paths (engine-empty §2b, toggle re-feed, model switch) null the ledger to force an
    // identical-content re-commit through so the upload effect re-fires.
    expect(shouldSkipDuplicateCommit(SIG, null, SIG)).toBe(false);
  });

  it('COMMITS when there is no prev state at all (first commit)', () => {
    expect(shouldSkipDuplicateCommit(SIG, SIG, null)).toBe(false);
  });

  it('never skips a null/empty signature', () => {
    expect(shouldSkipDuplicateCommit(null, null, null)).toBe(false);
    expect(shouldSkipDuplicateCommit('', '', '')).toBe(false);
  });
});
