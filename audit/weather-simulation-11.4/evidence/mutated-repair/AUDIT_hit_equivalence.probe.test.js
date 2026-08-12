/**
 * AUDIT 11.4 — audit-only probe. Runs in a DISPOSABLE worktree; never shipped.
 *
 * The shipped suite's two star-marked cache tests are TAUTOLOGICAL: `run()` returns
 * `ds: created[0]` while `created` accumulates across run() calls, so the SECOND run's
 * downsample canvas is never read. Proven by M8/M9/M10 — a cache that returns an all-zero,
 * all-one, or fully INVERTED mask on every hit passes all 32 tests.
 *
 * This probe does two things the suite cannot:
 *   1. PROVES the harness defect by object identity.
 *   2. Performs the real hit-vs-miss equivalence comparison, reading the canvas each run
 *      ACTUALLY used — i.e. it independently checks whether the shipped code is correct.
 *
 * It is written so that it FAILS under M8/M9/M10 and PASSES on the pristine repair. That is the
 * discrimination the shipped tests lack, and it is the drop-in replacement for them.
 */
import { suppressShelteredWater, _resetShelterCache } from './marineMaskShelter';

const NARROW = [
  '~~~~~###############', '~~~~~###############', '~~~~~###############', '~~~~~###############',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~~~~~~~~~~~~~###',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~###############',
  '~~~~~###############', '~~~~~###############'
];
const W = 20, H = 14;
const BOUNDS = { west: -80.0, east: -79.9, south: 27.95, north: 28.05 };

function pixelsFrom(rows, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = rows[y] && rows[y][x] === '~' ? 255 : 0;
    const i = (y * w + x) * 4;
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  return px;
}
function recordingCanvas(width, height, rows) {
  const log = { drawImage: [], putImageData: 0 };
  let lastImageData = null;
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage() { log.drawImage.push(1); },
    getImageData(x, y, gw, gh) {
      lastImageData = { data: rows ? pixelsFrom(rows, gw, gh) : new Uint8ClampedArray(gw * gh * 4), width: gw, height: gh };
      return lastImageData;
    },
    putImageData() { log.putImageData++; }
  };
  return { canvas: { width, height, getContext: () => ctx }, ctx, log, imageData: () => lastImageData };
}

describe('AUDIT 11.4 — hit/miss equivalence, reading the canvas each run actually used', () => {
  let created, origCreateElement;
  beforeEach(() => {
    _resetShelterCache();
    window.__RAW_GPU__ = {};
    created = [];
    origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (String(tag).toLowerCase() !== 'canvas') return origCreateElement(tag);
      const rec = recordingCanvas(0, 0, created.__rows);
      created.push(rec);
      return rec.canvas;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  // ⭐ THE FIX: return the canvas THIS run created, not created[0].
  const run = (rows, opts) => {
    created.__rows = rows;
    const before = created.length;
    const src = recordingCanvas(W, H, rows);
    const result = suppressShelteredWater(src.canvas, BOUNDS, opts);
    return { result, ds: created[before] };
  };

  it('PROVES the shipped harness defect: created[0] is NOT the second run\'s canvas', () => {
    const a = run(NARROW);
    const b = run(NARROW);
    expect(created.length).toBe(2);
    expect(b.ds).not.toBe(a.ds);        // the runs used DIFFERENT canvases ...
    expect(created[0]).toBe(a.ds);      // ... but the shipped run() returns this one for BOTH.
  });

  it('★ a HIT stamps byte-identical pixels to the MISS (read from the correct canvas)', () => {
    const miss = run(NARROW);
    const missPixels = Array.from(miss.ds.imageData().data);
    const hit = run(NARROW);
    const hitPixels = Array.from(hit.ds.imageData().data);
    expect(window.__RAW_GPU__.shelterCache).toEqual(expect.objectContaining({ miss: 1, hit: 1 }));
    expect(hitPixels.length).toBe(missPixels.length);
    expect(hitPixels).toEqual(missPixels);
  });

  it('★ the HIT mask is POST-close: hit equals a fresh MISS after a cache reset', () => {
    run(NARROW);
    const hit = Array.from(run(NARROW).ds.imageData().data);
    _resetShelterCache();
    const freshMiss = Array.from(run(NARROW).ds.imageData().data);
    expect(hit).toEqual(freshMiss);
  });

  it('the stamped mask is non-trivial (guards against a vacuous all-equal comparison)', () => {
    const miss = run(NARROW);
    const d = miss.ds.imageData().data;
    let shelteredPx = 0, openPx = 0;
    for (let i = 0; i < d.length; i += 4) (d[i + 3] === 255 ? shelteredPx++ : openPx++);
    expect(shelteredPx).toBeGreaterThan(0);
    expect(openPx).toBeGreaterThan(0);
  });
});
