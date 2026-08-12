import { suppressShelteredWater, _resetShelterCache } from './marineMaskShelter';

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

// A pure RESHAPE: same flat water bytes in the same order, laid out at a different width/height.
// The content hash is therefore identical BY CONSTRUCTION, and only dsW x dsH differs — which is
// exactly the discriminator for "are the dimensions really in the cache key?".
const reshape = (rows, srcW, srcH, dstW, dstH) => {
  let flat = '';
  for (let y = 0; y < srcH; y++) for (let x = 0; x < srcW; x++) flat += rows[y][x];
  const out = [];
  for (let y = 0; y < dstH; y++) out.push(flat.slice(y * dstW, (y + 1) * dstW));
  return out;
};

// A field LARGER than 1000 px (40x30 = 1200) whose two variants differ ONLY in the final row —
// flat indices 1160-1199. Every existing fixture is 280 px, so a key that hashed just the first
// 1000 bytes would be indistinguishable from one that hashed everything. This is the fixture that
// can tell them apart.
const BIG_W = 40, BIG_H = 30;
const bigField = (openBottom) => {
  const rows = [];
  for (let y = 0; y < BIG_H; y++) {
    let s = '';
    for (let x = 0; x < BIG_W; x++) {
      let water = x < 8;                                                  // open strip on the border
      if (y >= 15 && y <= 28 && x >= 14 && x <= 29) water = true;         // the basin
      if (y === 21 && x >= 8 && x <= 13) water = true;                    // 1-px channel: seals it
      if (openBottom && y === 29 && x >= 14 && x <= 29) water = true;     // THE ONLY DIFFERENCE
      s += water ? '~' : '#';
    }
    rows.push(s);
  }
  return rows;
};

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
    // The verdict cache is MODULE state. Without this, case N's entries answer case N+1 and a
    // broken cache would be hidden by whichever test happened to run first.
    _resetShelterCache();
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

  // ⚠️ `created` ACCUMULATES across run() calls — it is reset per TEST, not per run. Returning
  // `created[0]` therefore handed back the FIRST run's downsample canvas for every later run in the
  // same test, so any hit-vs-miss pixel comparison compared one canvas with ITSELF. That is not a
  // weak assertion, it is a tautology: audit 11.4 showed a verdict cache returning an all-zero, an
  // all-one, or a fully INVERTED mask on every hit passed all 32 tests (mutants M2/M8/M9/M10).
  // ★ Capture the index THIS call will write to, so the canvas returned is the one it stamped.
  const run = (rows, opts, bounds = BOUNDS, srcW = W, srcH = H) => {
    created.__rows = rows;
    const before = created.length;
    const src = recordingCanvas(srcW, srcH, rows);
    const result = suppressShelteredWater(src.canvas, bounds, opts);
    return { result, src, ds: created[before] };
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

  // ---- the verdict cache ----
  // ★ The correctness property is not "it is fast", it is "a HIT is indistinguishable from a MISS".
  //   Everything else about the cache is an optimisation detail; this is the part that can ship a bug.

  describe('verdict cache', () => {
    beforeEach(() => { window.__RAW_GPU__ = {}; });
    afterEach(() => {
      delete window.__RAW_DISABLE_SHELTER_CACHE__;
      delete window.__RAW_MASK_INPUT_HASH__;
    });

    it('★ a HIT produces byte-identical stamped pixels to the MISS before it', () => {
      const first = run(NARROW);
      const missPixels = Uint8ClampedArray.from(first.ds.imageData().data);
      const second = run(NARROW);
      const hitPixels = second.ds.imageData().data;
      expect(window.__RAW_GPU__.shelterCache).toEqual(expect.objectContaining({ miss: 1, hit: 1 }));
      expect(Array.from(hitPixels)).toEqual(Array.from(missPixels));
    });

    it('★ a HIT returns the same verdict fields as the MISS', () => {
      const a = run(NARROW).result;
      const b = run(NARROW).result;
      expect(b).toEqual(a);
    });

    it('the cached mask is POST-close — a hit must not skip the close and leak a raw mask', () => {
      // Close is idempotent on a closed mask, so miss-then-hit and miss-then-miss must agree.
      const miss1 = Uint8ClampedArray.from(run(NARROW).ds.imageData().data);
      const hit = Uint8ClampedArray.from(run(NARROW).ds.imageData().data);
      _resetShelterCache();
      const miss2 = Uint8ClampedArray.from(run(NARROW).ds.imageData().data);
      expect(Array.from(hit)).toEqual(Array.from(miss2));
      expect(Array.from(miss1)).toEqual(Array.from(miss2));
    });

    it('different inputs do NOT collide — WIDE must not be served the NARROW verdict', () => {
      const narrow = run(NARROW).result;
      const wide = run(WIDE).result;
      expect(narrow.shelteredFrac).toBeGreaterThan(0);
      expect(wide.shelteredFrac).toBe(0);
      expect(window.__RAW_GPU__.shelterCache.hit).toBe(0);
    });

    // ---- key COMPLETENESS: the two halves of the key that no fixture used to vary ----
    // ★ Each of these carries a POSITIVE CONTROL over the key itself. Without one, a fixture that
    //   failed to construct the intended collision would sail through green and pin nothing — which
    //   is precisely how both of these properties went unguarded in the first place.

    it('the KEY includes the DIMENSIONS — same bytes and same nPx at a different shape must not collide', () => {
      window.__RAW_MASK_INPUT_HASH__ = true;
      const reshaped = reshape(NARROW, W, H, H, W);       // 14x20, byte-identical to NARROW's 20x14
      run(NARROW, undefined, BOUNDS, W, H);
      const b = run(reshaped, undefined, BOUNDS, H, W);

      // POSITIVE CONTROL: this fixture only tests dimensions if the hash and nPx really do match.
      const parts = Object.keys(window.__RAW_GPU__.shelteredInputs.keys).map((k) => k.split(':'));
      expect(parts).toHaveLength(2);
      expect(parts[0][0]).toBe(parts[1][0]);        // identical content hash
      expect(parts[0][1]).toBe(parts[1][1]);        // identical nPx
      expect(parts[0][2]).not.toBe(parts[1][2]);    // ONLY the dimensions differ

      // The property. Note the two masks are the same LENGTH, so a collision neither crashes nor
      // looks obviously wrong — it just paints the other shape's geometry.
      expect(window.__RAW_GPU__.shelterCache.hit).toBe(0);
      const served = Array.from(b.ds.imageData().data);
      _resetShelterCache();
      const fresh = Array.from(run(reshaped, undefined, BOUNDS, H, W).ds.imageData().data);
      expect(served).toEqual(fresh);
    });

    it('the KEY hashes the WHOLE field — a difference only in the last row must not collide', () => {
      window.__RAW_MASK_INPUT_HASH__ = true;
      const sealed = bigField(false);
      const openToBorder = bigField(true);              // differs at flat indices 1160-1199 only
      const a = run(sealed, undefined, BOUNDS, BIG_W, BIG_H);
      const b = run(openToBorder, undefined, BOUNDS, BIG_W, BIG_H);

      // POSITIVE CONTROL: the fixture is only meaningful if it is bigger than the truncation point
      // and the two variants genuinely differ in the tail.
      expect(BIG_W * BIG_H).toBeGreaterThan(1000);
      const parts = Object.keys(window.__RAW_GPU__.shelteredInputs.keys).map((k) => k.split(':'));
      expect(parts).toHaveLength(2);
      expect(parts[0][1]).toBe(parts[1][1]);        // identical nPx
      expect(parts[0][2]).toBe(parts[1][2]);        // identical dimensions
      expect(parts[0][0]).not.toBe(parts[1][0]);    // ONLY the content hash differs

      // The property, and it is a real verdict difference: sealing the basin off from the bottom
      // border is what makes it sheltered at all.
      expect(window.__RAW_GPU__.shelterCache.hit).toBe(0);
      expect(a.result.shelteredFrac).toBeGreaterThan(0);
      expect(b.result.shelteredFrac).toBe(0);
    });

    it('the kill switch restores the pre-cache path — every call a miss', () => {
      window.__RAW_DISABLE_SHELTER_CACHE__ = true;
      const a = run(NARROW).result;
      const b = run(NARROW).result;
      expect(b).toEqual(a);
      expect(window.__RAW_GPU__.shelterCache).toEqual(expect.objectContaining({ hit: 0, miss: 2 }));
    });

    it('SETTLE DEBOUNCE IS OFF unless the flag is a positive number', () => {
      // Default path must be untouched: three back-to-back calls all do real work.
      run(NARROW); run(NARROW); run(NARROW);
      const c = window.__RAW_GPU__.shelterCache;
      expect(c.deferred).toBeUndefined();
      expect(c.hit + c.miss).toBe(3);
    });

    it('evicts least-recently-used beyond the cap, and the evicted key recomputes correctly', () => {
      const fixtures = [NARROW, WIDE];
      // 5 distinct keys through a cap of 4: vary nPx via gapM so the pixels can stay the same.
      [1000, 2000, 3000, 4000, 5000].forEach((gapM) => run(fixtures[0], { gapM }));
      expect(window.__RAW_GPU__.shelterCache.size).toBeLessThanOrEqual(4);
      // The first key was evicted, so it recomputes — and must still be correct.
      const again = run(NARROW, { gapM: 1000 }).result;
      expect(again.nPx).toBe(1);
      expect(again.shelteredFrac).toBeGreaterThan(0);
    });
  });

  // ---- settle debounce (default OFF) ----
  // ⛔ Unlike the cache, this is NOT behaviour-preserving: a deferred call leaves the mask
  //    un-suppressed for that frame. These tests pin the behaviour change itself, so it cannot
  //    become default by accident, and pin the SAFETY metric that decides whether it may ever ship.

  describe('settle debounce', () => {
    let clock;
    beforeEach(() => {
      window.__RAW_GPU__ = {};
      clock = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => clock);
    });
    afterEach(() => { delete window.__RAW_MASK_SETTLE_DEBOUNCE_MS__; });

    it('a non-positive flag leaves the default path exactly as it was', () => {
      for (const v of [undefined, 0, -1, 'nonsense']) {
        _resetShelterCache(); window.__RAW_GPU__ = {};
        if (v === undefined) delete window.__RAW_MASK_SETTLE_DEBOUNCE_MS__;
        else window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = v;
        clock += 10_000;
        const r = run(NARROW).result;
        expect(r.applied).toBe(true);
        expect(window.__RAW_GPU__.shelterCache.deferred).toBeUndefined();
      }
    });

    it('DEFERS a call that arrives inside the settle window', () => {
      window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 250;
      const first = run(NARROW).result;          // settled (clock is far from 0)
      expect(first.applied).toBe(true);
      clock += 50;                                // still moving
      const second = run(NARROW).result;
      expect(second).toEqual(expect.objectContaining({ applied: false, deferred: true }));
    });

    it('★ a deferral does NO canvas work at all — that is the whole point and the whole risk', () => {
      window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 250;
      run(NARROW);
      clock += 50;
      const { src, ds } = run(NARROW);
      expect(ds).toBeUndefined();                 // no downsample canvas was even created
      expect(src.log.drawImage).toHaveLength(0);  // and the caller's canvas is left UN-SUPPRESSED
    });

    it('RESUMES work once the settle interval has passed', () => {
      window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 250;
      run(NARROW);
      clock += 50;
      expect(run(NARROW).result.deferred).toBe(true);
      clock += 300;                               // settled
      expect(run(NARROW).result.applied).toBe(true);
    });

    it('★ pendingDeferrals rises while deferring and RESETS on the next real classification', () => {
      // This is the metric that decides whether the feature may ever be default: a non-zero value
      // AT REST means a deferral was never followed and the mask is stuck un-suppressed.
      window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 250;
      run(NARROW);
      clock += 50; run(NARROW);
      clock += 50; run(NARROW);
      clock += 50; run(NARROW);
      const mid = window.__RAW_GPU__.shelterCache;
      expect(mid.deferred).toBe(3);
      expect(mid.pendingDeferrals).toBe(3);
      expect(mid.maxPendingDeferrals).toBe(3);
      clock += 400;
      run(NARROW);
      expect(window.__RAW_GPU__.shelterCache.pendingDeferrals).toBe(0);
      expect(window.__RAW_GPU__.shelterCache.maxPendingDeferrals).toBe(3);   // high-water kept
    });

    it('a GUARD REFUSAL is never counted as a deferral — ALL FOUR guards', () => {
      // ⚠️ This covered only two guards at first, and a mutation that counted a deferral inside the
      // `nPx > 48` guard passed 50/50 as a result. A refusal test that exercises half the refusal
      // paths is not a refusal test.
      window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 250;
      run(NARROW);
      clock += 10;
      suppressShelteredWater(null, BOUNDS);                                      // no canvas
      suppressShelteredWater(recordingCanvas(W, H, NARROW).canvas, null);        // no bounds
      run(NARROW, undefined, { west: -80, east: -70, south: 27, north: 29 });    // span >= 10
      run(NARROW, undefined, { west: -80, east: -80, south: 27, north: 29 });    // zero span
      run(NARROW, undefined, { west: -80.0, east: -79.9995, south: 27.999, north: 28.001 }); // nPx > 48
      expect(window.__RAW_GPU__.shelterCache.deferred).toBeUndefined();
    });
  });
});
