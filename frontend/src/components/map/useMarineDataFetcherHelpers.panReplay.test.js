/**
 * §4.3 PAN-REPLAY goldens (2026-07-13, round-12 pt4): the same-target dedup skip buffers a
 * completion-replay intent ONLY when the viewport has moved off the in-flight request's
 * bounds. Same-viewport duplicates (the activation multi-trigger class the no-abort dedup
 * protects) must stay silent — that property is what makes the replay non-self-feeding.
 */
import { bufferPanMovedReplay } from './useMarineDataFetcherHelpers';

const baseArgs = (over = {}) => ({
  inflight: { rawModel: 'GFS', layer: 'waves', hour: 0, boundsKey: 'vpA' },
  currentViewportHash: 'vpB',
  source: 'moveend',
  model: 'GFS',
  layer: 'waves',
  hour: 0,
  pendingMarineIntentRef: { current: null },
  logPipelineEventHelper: undefined,
  win: {},
  ...over,
});

describe('bufferPanMovedReplay (§4.3 pan-replay)', () => {
  it('buffers a replay intent when the viewport moved off the in-flight bounds', () => {
    const ref = { current: null };
    const events = [];
    const ok = bufferPanMovedReplay(baseArgs({
      pendingMarineIntentRef: ref,
      logPipelineEventHelper: (t, d) => events.push({ t, d }),
    }));
    expect(ok).toBe(true);
    expect(ref.current).toMatchObject({ source: 'moveend_panmoved', model: 'GFS', layer: 'waves', hour: 0 });
    expect(events[0].t).toBe('intent_buffered_panmoved');
  });

  it('stays silent for a same-viewport duplicate (activation multi-trigger class)', () => {
    const ref = { current: null };
    const ok = bufferPanMovedReplay(baseArgs({ currentViewportHash: 'vpA', pendingMarineIntentRef: ref }));
    expect(ok).toBe(false);
    expect(ref.current).toBeNull();
  });

  it('stays silent when the hash is unavailable (degenerate viewport / torn-down map)', () => {
    expect(bufferPanMovedReplay(baseArgs({ currentViewportHash: null }))).toBe(false);
    expect(bufferPanMovedReplay(baseArgs({
      currentViewportHash: undefined,
      getViewportHash: () => { throw new Error('map gone'); },
    }))).toBe(false);
    expect(bufferPanMovedReplay(baseArgs({
      inflight: { rawModel: 'GFS', layer: 'waves', hour: 0 }, // no boundsKey (older intent shape)
    }))).toBe(false);
  });

  it('falls back to getViewportHash when no precomputed hash is passed (enqueue site)', () => {
    const ref = { current: null };
    const ok = bufferPanMovedReplay(baseArgs({
      currentViewportHash: undefined,
      getViewportHash: () => 'vpMoved',
      pendingMarineIntentRef: ref,
    }));
    expect(ok).toBe(true);
    expect(ref.current.source).toBe('moveend_panmoved');
  });

  it('kill switch __RAW_PAN_REPLAY_DISABLED__ restores the silent legacy skip', () => {
    const ref = { current: null };
    const ok = bufferPanMovedReplay(baseArgs({
      win: { __RAW_PAN_REPLAY_DISABLED__: true },
      pendingMarineIntentRef: ref,
    }));
    expect(ok).toBe(false);
    expect(ref.current).toBeNull();
  });

  it('never double-suffixes _panmoved on a replayed source (loop hygiene)', () => {
    const ref = { current: null };
    bufferPanMovedReplay(baseArgs({ source: 'moveend_panmoved_pending', pendingMarineIntentRef: ref }));
    expect(ref.current.source).toBe('moveend_panmoved_pending');
  });
});
