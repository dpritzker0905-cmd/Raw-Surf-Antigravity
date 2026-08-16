/**
 * C4-MR-09 — disposeEngine's INVENTORY, pinned.
 *
 * ⛔ WHY THIS FILE EXISTS. Before 2026-08-16 there was NO test for disposeEngine anywhere, and its
 * inventory has been wrong twice in production:
 *   - `_residentScoreTex` was absent, leaking one grid-sized texture per dispose cycle in rating
 *     mode, and leaving a stale handle for the next context (R11-10b);
 *   - dispose used raw `gl.deleteTexture`, bypassing the accounting choke, so the telemetry drifted
 *     upward every theme/style swap (R11-10d).
 * Both were found in production, not in review, because "did dispose forget something?" was a
 * question no test asked. This asks it.
 *
 * ★ THE SHAPE: a teardown that frees a resource but keeps the field describing it. The field then
 * outlives its owner and the next reader cannot tell live state from residue.
 */
import { disposeEngine } from './WebGLMarineEngineInit';

const makeGl = () => ({
  deleteVertexArray: jest.fn(), deleteBuffer: jest.fn(), deleteFramebuffer: jest.fn(),
  deleteTexture: jest.fn(), deleteShader: jest.fn(), deleteProgram: jest.fn(),
  getAttachedShaders: jest.fn(() => []),
});

// Every field disposeEngine is responsible for clearing, seeded with a non-null sentinel so a
// missed one is visible rather than coincidentally already null.
const OVERLAY_STATE = ['_overlayMaskTex', '_overlayMaskBounds', '_overlayMaskTruthBox'];
const RESIDENT_STATE = ['_residentWaveTex', '_residentChlTex', '_residentBathTex', '_residentScoreTex',
  '_cachedMaskTex', '_cachedMaskGeoJSON', '_lastPatchedMask', '_landGeoJSON'];

const makeEngine = () => {
  const e = { clearBuffers: jest.fn(), _initialized: true };
  [...OVERLAY_STATE, ...RESIDENT_STATE].forEach((k) => { e[k] = { sentinel: k }; });
  return e;
};

describe('disposeEngine leaves no state behind', () => {
  it('nulls every resident/cached field it is responsible for', () => {
    const e = makeEngine();
    disposeEngine(e, makeGl());
    RESIDENT_STATE.forEach((k) => expect({ [k]: e[k] }).toEqual({ [k]: null }));
    expect(e._initialized).toBe(false);
  });

  it('nulls the overlay TRIPLE together — tex, bounds AND truth box', () => {
    // The C4-MR-09 defect: `_overlayMaskTruthBox` was absent from the inventory, so it survived its
    // own bounds. Not reachable through the render path today (overlayOn requires tex && bounds,
    // and the uniform site re-checks `ob === _overlayMaskBounds`), but a field outliving its owner
    // is how the previous two omissions began.
    const e = makeEngine();
    disposeEngine(e, makeGl());
    OVERLAY_STATE.forEach((k) => expect({ [k]: e[k] }).toEqual({ [k]: null }));
  });

  it('bounds and truth box are a PAIR — neither may survive the other', () => {
    // The pairing is the real invariant. Either one alone is a half-state: bounds without a truth
    // box under-constrains the gate, a truth box without bounds is residue from a dead session.
    const e = makeEngine();
    disposeEngine(e, makeGl());
    expect([e._overlayMaskBounds, e._overlayMaskTruthBox]).toEqual([null, null]);
  });

  it('is a no-op without a gl context (never throws on a torn-down canvas)', () => {
    const e = makeEngine();
    expect(() => disposeEngine(e, null)).not.toThrow();
    expect(e._overlayMaskBounds).toEqual({ sentinel: '_overlayMaskBounds' }); // untouched, deliberately
  });

  // NON-VACUITY — the seeding must actually be non-null, or every assertion above passes trivially.
  it('the fixture seeds non-null sentinels (guards against a vacuous suite)', () => {
    const e = makeEngine();
    [...OVERLAY_STATE, ...RESIDENT_STATE].forEach((k) => expect(e[k]).not.toBeNull());
  });
});
