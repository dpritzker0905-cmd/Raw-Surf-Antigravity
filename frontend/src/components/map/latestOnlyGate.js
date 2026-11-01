/**
 * latestOnlyGate.js — at most ONE task in flight, at most ONE waiting, and the waiting one is always the newest.
 *
 * WHY (T-04, scrub audit 2026-10-18): the wind scrub effect started a network fetch for every hour the timeline paused
 * on for 150 ms — keys, the +1h/+1d buttons and autoplay — with no way to cancel it. Aborting is not the answer either:
 * windController shares one in-flight request per target, created with the FIRST caller's signal, so an abort hands
 * every joined caller a safe-zero grid (the "signal is aborted … conformed safe zero grid" lines in the owner's
 * 2026-10-19 log). This gate coalesces instead: a burst of N hour changes costs at most two fetches (the one already
 * running and the final hour), on a 1-CPU backend that serves production and dev.
 *
 * run(fn) never rejects; fn's own errors are its own business (the callers already log and hold the last frame).
 */
export function createLatestOnlyGate() {
  let running = false;
  let waiting = null;
  const start = (fn) => {
    running = true;
    Promise.resolve()
      .then(fn)
      .catch(() => { /* the task logs its own failure */ })
      .finally(() => {
        running = false;
        if (waiting) { const next = waiting; waiting = null; start(next); }
      });
  };
  return {
    /** 'started' when fn runs now; 'queued' when it replaced the waiting task (it runs after the current one). */
    run(fn) {
      if (running) { waiting = fn; return 'queued'; }
      start(fn);
      return 'started';
    },
    busy: () => running,
    waiting: () => !!waiting,
  };
}
