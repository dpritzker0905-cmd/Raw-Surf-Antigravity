/**
 * AUDIT — is the settle gate PASS-AGNOSTIC?
 *
 * `suppressShelteredWater` serves TWO distinct analysis passes with different `gapM`:
 *   - the BASIN pass       (gapM 1000, regional canvas, span >= 0.5 deg)
 *   - the NARROW-WATER pass(gapM 120,  crisp canvas,    span <  0.5 deg) — the Canal Grande fix
 *
 * The settle gate keys on ONE module-global timestamp (`_lastShelterWorkAt`) with no notion of
 * which pass is asking. HYPOTHESIS: with the debounce on, a basin call immediately followed by a
 * narrow call starves the narrow pass — and because a real classification RESETS pendingDeferrals,
 * the basin pass would also hide the backlog the narrow deferral creates... or not, depending on
 * order. Both halves are tested here.
 */
import { suppressShelteredWater, _resetShelterCache, markMaskViewportSettled } from './marineMaskShelter';

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
  let last = null;
  const ctx = { imageSmoothingEnabled: true, drawImage() {}, putImageData() {},
    getImageData(x, y, gw, gh) { last = { data: pixelsFrom(rows, gw, gh), width: gw, height: gh }; return last; } };
  return { canvas: { width, height, getContext: () => ctx } };
}

describe('AUDIT — settle gate: does one pass starve the other?', () => {
  let created, orig;
  beforeEach(() => {
    _resetShelterCache();
    window.__RAW_GPU__ = {};
    created = [];
    orig = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (String(tag).toLowerCase() !== 'canvas') return orig(tag);
      const rec = recordingCanvas(0, 0, created.__rows); created.push(rec); return rec.canvas;
    });
  });
  afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_MASK_SETTLE_DEBOUNCE_MS__; });

  const run = (opts) => {
    created.__rows = NARROW;
    const src = recordingCanvas(W, H, NARROW);
    return suppressShelteredWater(src.canvas, BOUNDS, opts);
  };

  it('CONTROL: with the debounce OFF both passes run back-to-back', () => {
    const basin = run({ gapM: 1000 });
    const narrow = run({ gapM: 120, stash: false });
    expect(basin.applied).toBe(true);
    expect(narrow.applied).toBe(true);
    expect(window.__RAW_GPU__.shelterCache.deferred).toBeUndefined();
  });

  it('⚠️ with the debounce ON, a BASIN call starves the immediately-following NARROW call', () => {
    window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 1000;
    markMaskViewportSettled();                       // the layer says "viewport settled"
    const basin = run({ gapM: 1000 });                // consumes the settled slot
    const narrow = run({ gapM: 120, stash: false });  // different PASS, same global timestamp
    expect(basin.applied).toBe(true);
    expect(narrow).toEqual(expect.objectContaining({ applied: false, deferred: true }));
  });

  it('⚠️ and the backlog SURVIVES at rest — nothing re-drives the starved pass', () => {
    window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 1000;
    markMaskViewportSettled();
    run({ gapM: 1000 });                              // basin works, resets pendingDeferrals to 0
    run({ gapM: 120, stash: false });                 // narrow deferred -> backlog 1
    expect(window.__RAW_GPU__.shelterCache.pendingDeferrals).toBe(1);
  });

  it('a second settle marker DOES let the starved pass through', () => {
    window.__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 1000;
    markMaskViewportSettled();
    run({ gapM: 1000 });
    markMaskViewportSettled();                        // one marker per PASS would be needed
    const narrow = run({ gapM: 120, stash: false });
    expect(narrow.applied).toBe(true);
    expect(window.__RAW_GPU__.shelterCache.pendingDeferrals).toBe(0);
  });
});
