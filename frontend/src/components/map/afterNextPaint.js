/**
 * afterNextPaint.js — run work AFTER the browser's next frame instead of inside the task that is building it (2026-10-25,
 * the wind toggle's click task: one 87-141 ms task whose setWindData landed 70-118 ms in, with series planning, the layer
 * truth diff and other bookkeeping ahead of it). A requestAnimationFrame callback runs just before the next paint; a
 * MessageChannel message posted from it runs just AFTER that paint. A hidden tab never paints, so a 100 ms timer is the floor.
 * Never use this for anything the frame being painted needs.
 */
const HIDDEN_TAB_FLOOR_MS = 100;

/** Calls `fn` after the next paint; returns a cancel function. */
export function afterNextPaintCb(fn) {
  let done = false;
  const go = () => { if (done) return; done = true; clearTimeout(floor); try { fn(); } catch (e) { /* never throw into the frame */ } };
  const floor = setTimeout(go, HIDDEN_TAB_FLOOR_MS);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (done) return;
      if (typeof MessageChannel === 'function') {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); go(); };
        ch.port2.postMessage(0);
      } else {
        setTimeout(go, 0);
      }
    });
  }
  return () => { done = true; clearTimeout(floor); };
}

/** A promise that resolves after the next paint (see afterNextPaintCb). */
export function afterNextPaint() {
  return new Promise((resolve) => { afterNextPaintCb(resolve); });
}
