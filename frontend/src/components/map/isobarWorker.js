// Isobars and H/L centres for one pressure frame, off the main thread (isobarStore.js posts the field; isobarContours.js does
// the work). Message in: { id, cols, rows, bounds, values (Float32Array), opts }. Out: { id, lines, centres, ms } or { id, error }.
import { isobarProducts } from './isobarContours';

self.onmessage = (e) => {
  const { id, cols, rows, bounds, values, opts } = e.data || {};
  const t0 = Date.now();
  try {
    const p = isobarProducts({ cols, rows, bounds, values }, opts || {});
    self.postMessage({ id, lines: p.lines, centres: p.centres, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
