import { resolveCoarseBaseSwap } from './WebGLMarineEngine';

// Regression guard for the 2026-07-16 zoom-out "clearing" root (deep zoom/pan forensics, deterministically
// reproduced on the live harness): _captureCoarseBase used to FREE the held coarse base before re-encoding,
// so a re-encode that threw / returned no wave texture left _coarseBaseData NULL — and BOTH zoom-out bridges
// (paint WebGLMarineCustomLayer.js:229 + data bridgeToCoarseGlobalIfHeld) require a held base, so a null base
// fell through to the ~700ms blank/clearBuffers on the next zoom-out. The atomic swap encodes FIRST and keeps
// the last-good base on failure. resolveCoarseBaseSwap is the pure decision. Kill: __RAW_DISABLE_ATOMIC_COARSE_BASE__.

const validBase = (tag) => ({ u_waveTexture: { __tag: tag || 'new' } });

describe('resolveCoarseBaseSwap — atomic coarse-base swap (the zoom-out clear fix)', () => {
  it('adopts the new base and frees the old when the re-encode SUCCEEDS (atomic)', () => {
    const prev = validBase('old');
    const next = validBase('new');
    const r = resolveCoarseBaseSwap(prev, next, true);
    expect(r.next).toBe(next);       // resident becomes the fresh base
    expect(r.toFree).toBe(prev);     // old set freed AFTER the swap
  });

  it('KEEPS the last-good base when the re-encode FAILS (atomic) — the fix: never null on failure', () => {
    const prev = validBase('old');
    const r = resolveCoarseBaseSwap(prev, null, true);
    expect(r.next).toBe(prev);       // <-- the bridge still has a base → NO zoom-out clear
    expect(r.toFree).toBe(null);     // nothing freed (we kept it)
  });

  it('treats an encoded object with no wave texture as a FAILURE (keeps prev)', () => {
    const prev = validBase('old');
    const r = resolveCoarseBaseSwap(prev, { u_waveTexture: null }, true);
    expect(r.next).toBe(prev);
    expect(r.toFree).toBe(null);
  });

  it('adopts the new base with nothing to free when there was no prior base (cold capture)', () => {
    const next = validBase('first');
    const r = resolveCoarseBaseSwap(null, next, true);
    expect(r.next).toBe(next);
    expect(r.toFree).toBe(null);
  });

  it('never asks to free the SAME object it is adopting (idempotent re-capture)', () => {
    const same = validBase('same');
    const r = resolveCoarseBaseSwap(same, same, true);
    expect(r.next).toBe(same);
    expect(r.toFree).toBe(null);
  });

  it('KILL SWITCH (non-atomic): caller already freed prev, so just adopt the encoded (or null)', () => {
    // legacy path — _captureCoarseBase already called _freeCoarseBase(gl) before encoding, so prev is gone.
    const next = validBase('new');
    expect(resolveCoarseBaseSwap(null, next, false)).toEqual({ next, toFree: null });
    // legacy + failed encode → nothing held (the pre-fix blank window this whole change removes)
    expect(resolveCoarseBaseSwap(null, null, false)).toEqual({ next: null, toFree: null });
  });
});
