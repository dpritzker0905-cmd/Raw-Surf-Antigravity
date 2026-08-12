import { suppressShelteredWater } from './marineMaskShelter';

/**
 * `suppressShelteredWater` — the CANVAS WRAPPER around classifySheltered.
 *
 * `marineMaskShelter.canonical.test.js` pins the classifier core. This pins the part an
 * optimisation would actually touch: the downsample, the `getImageData` readback, the morphological
 * close, and the stamp-back. Profiling on 2026-08-12 put this path at ~2.9 s of `getImageData` plus
 * ~1.4 s of its own JS, concentrated in the first ~11 s after activation
 * (GATE6_getImageData_IS_STARTUP_NOT_STEADY_STATE.md).
 *
 * ★ Two of these assertions guard fixes that cost live debugging to find, and BOTH are one-line
 *   flags that a perf change would plausibly flip:
 *     - the downsample draws with `imageSmoothingEnabled = TRUE` — area-averaging is what makes a
 *       sub-pixel canal read as a connected water run (the Canal Grande mottle, 2026-07-04);
 *     - the stamp-back draws with it FALSE and RESTORES the previous value — hard-edged, and it
 *       must not leak a smoothing change back to the caller's context.
 *   Neither is visible in the returned value. Only the call sequence shows them.
 *
 * jsdom has no 2D canvas, so both canvases are recording fakes — the same approach as the WebGL
 * mock in WebGLMarineTextureEncoder.stateScope.test.js. That is a feature here: it makes the draw
 * calls and their flags observable, which a real canvas would hide.
 */

// '~' water (R=255), '#' land (R=0). The classifier thresholds at R >= 128.
const NARROW = [
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############'
];
const WIDE = [
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~#####~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###',
  '~~~~~#####~~~~~~~###',
  '~~~~~###############',
  '~~~~~###############',
  '~~~~~###############'
];
const W = 20, H = 14;

// bounds chosen so nPx lands on 1, matching the canonical-core suite:
//   spanLon 0.1 deg, latMid 28 -> mPerPx = (0.1*111320*cos28)/20 ~= 491 m/px
//   nPx = round((1000/2)/491) = 1
const BOUNDS = { west: -80.0, east: -79.9, south: 27.95, north: 28.05 };

function pixelsFrom(rows, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = rows[y] && rows[y][x] === '~' ? 255 : 0;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

function recordingCanvas(width, height, rows) {
  const log = { getContext: [], drawImage: [], putImageData: 0, getImageData: [] };
  let lastImageData = null;
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage(...a) {
      log.drawImage.push({ smoothingAtDraw: ctx.imageSmoothingEnabled, dw: a[3], dh: a[4] });
    },
    getImageData(x, y, gw, gh) {
      log.getImageData.push({ x, y, gw, gh });
      lastImageData = { data: rows ? pixelsFrom(rows, gw, gh) : new Uint8ClampedArray(gw * gh * 4), width: gw, height: gh };
      return lastImageData;
    },
    putImageData() { log.putImageData++; }
  };
  const canvas = {
    width, height,
    getContext(type, opts) { log.getContext.push({ type, opts }); return ctx; }
  };
  return { canvas, ctx, log, imageData: () => lastImageData };
}

describe('suppressShelteredWater — canvas wrapper', () => {
  let created;
  let origCreateElement;

  beforeEach(() => {
    created = [];
    origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (String(tag).toLowerCase() !== 'canvas') return origCreateElement(tag);
      // The downsample canvas. Its pixels are supplied by whichever geometry the test installed.
      const rec = recordingCanvas(0, 0, created.__rows);
      created.push(rec);
      return rec.canvas;
    });
  });
  afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_SHELTERED_GAP_M__; });

  const run = (rows, opts, bounds = BOUNDS, srcW = W, srcH = H) => {
    created.__rows = rows;
    const src = recordingCanvas(srcW, srcH, rows);
    const result = suppressShelteredWater(src.canvas, bounds, opts);
    return { result, src, ds: created[0] };
  };

  // ---- guards: the boundaries an optimisation is most likely to "tidy" ----

  it('REFUSES a missing canvas or bounds', () => {
    expect(suppressShelteredWater(null, BOUNDS)).toBe(false);
    expect(suppressShelteredWater(recordingCanvas(W, H, NARROW).canvas, null)).toBe(false);
  });

  it('REFUSES a span of 10 deg or wider (coarse tiers cannot resolve entrances)', () => {
    expect(run(NARROW, undefined, { west: -80, east: -70, south: 27, north: 29 }).result).toBe(false);
    expect(run(NARROW, undefined, { west: -80, east: -60, south: 27, north: 29 }).result).toBe(false);
  });

  it('REFUSES a zero or inverted span', () => {
    expect(run(NARROW, undefined, { west: -80, east: -80, south: 27, north: 29 }).result).toBe(false);
  });

  it('REFUSES when the analysis radius exceeds 48 px (extreme zoom-in)', () => {
    // A very small span makes mPerPx tiny, so nPx = (gapM/2)/mPerPx blows past the cap.
    const tiny = { west: -80.0, east: -79.9995, south: 27.999, north: 28.001 };
    expect(run(NARROW, undefined, tiny).result).toBe(false);
  });

  // ---- the two documented live fixes, neither visible in the return value ----

  it('★ the DOWNSAMPLE draws with imageSmoothingEnabled TRUE (the Canal Grande mottle fix)', () => {
    const { ds } = run(NARROW);
    expect(ds.log.drawImage).toHaveLength(1);
    expect(ds.log.drawImage[0].smoothingAtDraw).toBe(true);
  });

  it('★ the STAMP-BACK draws with smoothing FALSE and RESTORES the caller\'s value', () => {
    const { src } = run(NARROW);
    expect(src.log.drawImage).toHaveLength(1);
    expect(src.log.drawImage[0].smoothingAtDraw).toBe(false);   // hard-edged
    expect(src.ctx.imageSmoothingEnabled).toBe(true);           // restored, not leaked
  });

  it('the stamp-back restores a caller value of FALSE too, not just true', () => {
    created.__rows = NARROW;
    const src = recordingCanvas(W, H, NARROW);
    src.ctx.imageSmoothingEnabled = false;
    suppressShelteredWater(src.canvas, BOUNDS);
    expect(src.ctx.imageSmoothingEnabled).toBe(false);
  });

  it('both contexts are requested with willReadFrequently (readback path)', () => {
    const { src, ds } = run(NARROW);
    expect(ds.log.getContext[0].opts).toEqual({ willReadFrequently: true });
    expect(src.log.getContext[0].opts).toEqual({ willReadFrequently: true });
  });

  // ---- the verdict, end to end through the wrapper ----

  it('a NARROW entrance yields a suppressed basin', () => {
    const { result } = run(NARROW);
    expect(result.applied).toBe(true);
    expect(result.nPx).toBe(1);
    expect(result.shelteredFrac).toBeGreaterThan(0);
  });

  it('★ the SAME geometry with a WIDE entrance suppresses nothing', () => {
    const { result } = run(WIDE);
    expect(result.applied).toBe(true);
    expect(result.shelteredFrac).toBe(0);
  });

  it('the all-open verdict short-circuits before the stamp-back', () => {
    const { src, ds } = run(WIDE);
    // Nothing sheltered => no morphological close, no putImageData, no draw back to the source.
    expect(ds.log.putImageData).toBe(0);
    expect(src.log.drawImage).toHaveLength(0);
  });

  it('sheltered pixels are stamped 64/64/64/255 and open pixels are made transparent', () => {
    const { ds } = run(NARROW);
    const px = ds.imageData().data;
    let stamped = 0;
    for (let i = 0; i < W * H; i++) {
      const a = px[i * 4 + 3];
      if (a === 255) { stamped++; expect(px[i * 4]).toBe(64); expect(px[i * 4 + 1]).toBe(64); expect(px[i * 4 + 2]).toBe(64); }
      else expect(a).toBe(0);
    }
    expect(stamped).toBeGreaterThan(0);
  });

  it('the readback covers the whole downsampled grid exactly once', () => {
    const { ds } = run(NARROW);
    expect(ds.log.getImageData).toEqual([{ x: 0, y: 0, gw: W, gh: H }]);
  });

  // ---- knobs ----

  it('opts.gapM overrides the channel gap and moves nPx', () => {
    expect(run(NARROW, { gapM: 1000 }).result.nPx).toBe(1);
    expect(run(NARROW, { gapM: 4000 }).result.nPx).toBe(4);
  });

  it('__RAW_SHELTERED_GAP_M__ is honoured when opts.gapM is absent', () => {
    window.__RAW_SHELTERED_GAP_M__ = 4000;
    expect(run(NARROW).result.nPx).toBe(4);
  });

  it('PINNED: the downsample is capped at 1024 px wide', () => {
    // ⚠️ MY FIRST FIXTURE HERE WAS PHYSICALLY IMPOSSIBLE and the code was right to refuse it: a
    // 4096 px canvas over the 0.1 deg BOUNDS is 9.6 m/px, so nPx = 52 and the `> 48` guard fires.
    // A wide canvas implies a wide span. 1 deg over 1024 ds px is ~96 m/px -> nPx 5, comfortably
    // inside the cap. The guard was not the bug; the fixture was.
    const wideSpan = { west: -80.0, east: -79.0, south: 27.5, north: 28.5 };
    const { ds, result } = run(NARROW, undefined, wideSpan, 4096, 2048);
    expect(result).not.toBe(false);
    expect(ds.log.getImageData[0].gw).toBe(1024);
    expect(ds.log.drawImage[0].dw).toBe(1024);
    expect(ds.log.drawImage[0].dh).toBe(512);   // aspect preserved: 2048 * (1024/4096)
  });

  it('PINNED: a canvas narrower than the cap is NOT upscaled', () => {
    const { ds } = run(NARROW);
    expect(ds.log.getImageData[0].gw).toBe(W);
  });

  // ---- the call counters, pinned because an unverified instrument is what got us here ----
  // `__RAW_MASK_REPATCH_LOG__` was trusted as a proxy for this function's call count and was
  // written somewhere else entirely. These counters exist to answer that question at the function
  // itself, so they get the same treatment as any other instrument: a test that fails if they lie.

  describe('__RAW_GPU__ call counters', () => {
    beforeEach(() => { window.__RAW_GPU__ = {}; });

    it('counts EVERY entry, including ones the guards refuse', () => {
      run(NARROW);                                                        // works
      suppressShelteredWater(null, BOUNDS);                               // refused: no canvas
      run(NARROW, undefined, { west: -80, east: -70, south: 27, north: 29 }); // refused: span >= 10
      expect(window.__RAW_GPU__.shelteredCalls).toBe(3);
    });

    it('counts WORK separately from entries — refusals are nearly free and must not be conflated', () => {
      run(NARROW);
      suppressShelteredWater(null, BOUNDS);
      run(NARROW, undefined, { west: -80, east: -70, south: 27, north: 29 });
      expect(window.__RAW_GPU__.shelteredCalls).toBe(3);
      expect(window.__RAW_GPU__.shelteredWorkCalls).toBe(1);
    });

    it('a refusal increments entries but NEVER work', () => {
      suppressShelteredWater(null, BOUNDS);
      expect(window.__RAW_GPU__.shelteredCalls).toBe(1);
      expect(window.__RAW_GPU__.shelteredWorkCalls).toBeUndefined();
    });

    it('creates __RAW_GPU__ when absent rather than throwing', () => {
      delete window.__RAW_GPU__;
      expect(() => run(NARROW)).not.toThrow();
      expect(window.__RAW_GPU__.shelteredCalls).toBe(1);
    });
  });

  // ---- input-redundancy instrument ----
  // Measures how much of the classifier's work is re-deciding unchanged input. It hashes 500k+
  // bytes per call, so "off by default" is a correctness property of the instrument itself, not a
  // preference: an instrument must not tax the product.

  describe('__RAW_GPU__.shelteredInputs (redundancy instrument)', () => {
    beforeEach(() => { window.__RAW_GPU__ = {}; });
    afterEach(() => { delete window.__RAW_MASK_INPUT_HASH__; });

    it('is OFF by default — no hashing, no bucket', () => {
      run(NARROW);
      expect(window.__RAW_GPU__.shelteredInputs).toBeUndefined();
    });

    it('stays off when the flag is merely truthy-adjacent, not exactly true', () => {
      window.__RAW_MASK_INPUT_HASH__ = 1;
      run(NARROW);
      expect(window.__RAW_GPU__.shelteredInputs).toBeUndefined();
    });

    it('IDENTICAL inputs count as one distinct key and a repeat', () => {
      window.__RAW_MASK_INPUT_HASH__ = true;
      run(NARROW); run(NARROW); run(NARROW);
      const m = window.__RAW_GPU__.shelteredInputs;
      expect(m.total).toBe(3);
      expect(m.distinct).toBe(1);
      expect(m.repeats).toBe(2);
    });

    it('DIFFERENT geometry yields a different key — the hash actually discriminates', () => {
      window.__RAW_MASK_INPUT_HASH__ = true;
      run(NARROW); run(WIDE);
      const m = window.__RAW_GPU__.shelteredInputs;
      expect(m.total).toBe(2);
      expect(m.distinct).toBe(2);
      expect(m.repeats).toBe(0);
    });

    it('a different nPx is a different key even on identical pixels', () => {
      window.__RAW_MASK_INPUT_HASH__ = true;
      run(NARROW, { gapM: 1000 });   // nPx 1
      run(NARROW, { gapM: 4000 });   // nPx 4
      expect(window.__RAW_GPU__.shelteredInputs.distinct).toBe(2);
    });
  });
});
