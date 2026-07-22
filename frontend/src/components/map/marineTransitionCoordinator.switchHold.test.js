/**
 * SWITCH-HOLD for model/layer-switch clears (2026-07-21, user "switching models and layers is the issue
 * with the clearing"). Live-proven root: a model/LAYER switch fires the non_renderable_terminal clear in
 * the WebGLMarineLayer data-commit effect BEFORE beginTransition sets __MARINE_TRANSITIONING__ (a
 * multi-render effect-ordering race), so the hold flag is false and the heatmap blanks ~875ms until the
 * new target commits — even though the resident GPU texture is still alive. shouldHoldFrameThroughSwitch
 * makes the hold cover the switch window WITHOUT depending on the flag race: hold the last-good renderable
 * frame through the switch, bounded by a TTL, keyed on the target so each switch restarts the clock.
 */
import {
  shouldHoldFrameThroughSwitch,
  noteMarineRenderableCommit,
  markDisplayed,
  displayMatchesRequested,
  __resetForTests,
} from './marineTransitionCoordinator';
import { decideMarineCommit } from './WebGLMarineEngine';

const base = (over = {}) => ({
  hasRenderableResident: true,
  modelOrLayerChanged: true,
  residentRegionalAtGlobalViewport: false,
  targetKey: 'EURO|waves',
  ...over,
});

describe('shouldHoldFrameThroughSwitch', () => {
  beforeEach(() => { __resetForTests(); });
  afterEach(() => {
    __resetForTests();
    delete window.__RAW_DISABLE_SWITCH_HOLD__;
    delete window.__RAW_SWITCH_HOLD_TTL_MS__;
    delete window.__MARINE_SWITCH_HOLD_COUNT__;
    delete window.__MARINE_CHURN__;
    delete window.__MARINE_CHURN_RESET__;
  });

  it('HOLDS the last-good frame through a model/layer switch (renderable resident, within TTL)', () => {
    expect(shouldHoldFrameThroughSwitch(base(), 1000)).toBe(true);
  });

  it('counts the hold in telemetry', () => {
    shouldHoldFrameThroughSwitch(base(), 1000);
    shouldHoldFrameThroughSwitch(base(), 1200);
    expect(window.__MARINE_SWITCH_HOLD_COUNT__).toBe(2);
  });

  it('does NOT hold when it is NOT a switch (modelOrLayerChanged false — the same-target path owns that)', () => {
    expect(shouldHoldFrameThroughSwitch(base({ modelOrLayerChanged: false }), 1000)).toBe(false);
  });

  it('does NOT hold without a renderable resident (nothing worth keeping — blank is no worse)', () => {
    expect(shouldHoldFrameThroughSwitch(base({ hasRenderableResident: false }), 1000)).toBe(false);
  });

  it('does NOT hold a regional resident at a global viewport (the zoom-out bridge owns that clamped-rectangle case)', () => {
    expect(shouldHoldFrameThroughSwitch(base({ residentRegionalAtGlobalViewport: true }), 1000)).toBe(false);
  });

  it('EXPIRES past the TTL — a stalled switch blanks rather than holding a stale frame forever', () => {
    expect(shouldHoldFrameThroughSwitch(base(), 1000)).toBe(true);        // clock starts at 1000
    expect(shouldHoldFrameThroughSwitch(base(), 1000 + 1999)).toBe(true); // just inside 2s
    expect(shouldHoldFrameThroughSwitch(base(), 1000 + 2001)).toBe(false); // past 2s → clear
    // churn records the expiry
    expect(window.__MARINE_CHURN__.counts.switch_hold_expired).toBe(1);
  });

  it('a NEW target restarts the clock (each distinct switch gets a fresh window)', () => {
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 1000)).toBe(true);
    // ...4s later, still holding EURO would have expired (past the 2s TTL)...
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 5000)).toBe(false);
    // ...but switching to a DIFFERENT target restarts the window even at the same instant
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'ICON|waves' }), 5000)).toBe(true);
  });

  it('noteMarineRenderableCommit resets the clock — a later same-target hold gets a fresh window', () => {
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 1000)).toBe(true);
    noteMarineRenderableCommit(); // the EURO frame committed
    // a same-target transient much later still gets a fresh window (no inherited stale clock)
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 20000)).toBe(true);
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 20000 + 2001)).toBe(false);
  });

  it('is fully disabled by the kill switch (restores the legacy blank-on-switch behaviour)', () => {
    window.__RAW_DISABLE_SWITCH_HOLD__ = true;
    expect(shouldHoldFrameThroughSwitch(base(), 1000)).toBe(false);
  });

  it('honours the TTL tuning knob', () => {
    window.__RAW_SWITCH_HOLD_TTL_MS__ = 5000;
    expect(shouldHoldFrameThroughSwitch(base(), 1000)).toBe(true);
    expect(shouldHoldFrameThroughSwitch(base(), 1000 + 4999)).toBe(true);
    expect(shouldHoldFrameThroughSwitch(base(), 1000 + 5001)).toBe(false);
  });

  it('honours an injected win object over the global', () => {
    expect(shouldHoldFrameThroughSwitch(base(), 1000, { __RAW_DISABLE_SWITCH_HOLD__: true })).toBe(false);
    expect(shouldHoldFrameThroughSwitch(base(), 1000, {})).toBe(true);
  });

  it('non-switch / no-resident / regional-at-global all clear the clock (a stale window cannot linger)', () => {
    shouldHoldFrameThroughSwitch(base(), 1000);                                   // start a window
    expect(shouldHoldFrameThroughSwitch(base({ modelOrLayerChanged: false }), 1100)).toBe(false); // clears clock
    // a fresh switch after that gets a clean window from 1200, not the old 1000 start
    expect(shouldHoldFrameThroughSwitch(base(), 1200)).toBe(true);
    expect(shouldHoldFrameThroughSwitch(base(), 1200 + 1999)).toBe(true);
    expect(shouldHoldFrameThroughSwitch(base(), 1200 + 2001)).toBe(false);
  });
});

// TRUTH-SAFETY LOCK (workflow Lens A must-change): the switch-hold's entire truth-safety guarantee rests
// on the held frame's DISPLAYED identity staying the OLD one — the layer's hold branch just `return`s and
// never calls markDisplayed with the new target, so the infobox parity gate (displayMatchesRequested)
// stays FALSE and the card shows "updating" instead of relabeling the old field as the new selection.
// This pins that invariant so a future refactor can't silently start marking the held frame as the new target.
describe('switch-hold truth-safety: displayMatchesRequested stays false through the hold', () => {
  beforeEach(() => { __resetForTests(); });
  afterEach(() => { __resetForTests(); delete window.__MARINE_SWITCH_HOLD_COUNT__; });

  it('a held OLD frame is NEVER reported as matching the NEW requested target until the new frame actually commits', () => {
    // The frame on screen is GFS/waves (the held frame); the user just selected EURO/waves.
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0 });
    // While the switch-hold is active the layer never re-marks displayed → parity gate sees a mismatch.
    expect(shouldHoldFrameThroughSwitch(base({ targetKey: 'EURO|waves' }), 1000)).toBe(true);
    expect(displayMatchesRequested({ model: 'EURO', layer: 'waves', hour: 0 })).toBe(false); // → card shows "updating"
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0 })).toBe(true);   // still honestly GFS
    // Only when the genuinely-new EURO frame commits does the layer markDisplayed(EURO) → parity flips.
    markDisplayed({ model: 'EURO', layer: 'waves', hour: 0 });
    expect(displayMatchesRequested({ model: 'EURO', layer: 'waves', hour: 0 })).toBe(true);
  });
});

// NO-WEDGE LOCK (workflow Lens B must-change): the held old frame must never WEDGE the new-target commit.
// A model/layer switch is NEVER a downgrade/subcover reject — decideMarineCommit must pass it so the new
// renderable frame replaces the held one. Locks WebGLMarineEngine's "MODEL SWITCH IS NEVER A DOWNGRADE".
describe('switch-hold no-wedge: decideMarineCommit never rejects a cross-model/layer commit', () => {
  const grid = (over = {}) => ({
    bounds: { west: -82, east: -79, south: 27, north: 29 },
    cols: 13, rows: 13, __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0,
    vectors: new Array(169), __renderable: true, coverage_scope: 'regional', ...over,
  });
  const coveredVp = [-81.5, 27.5, -79.5, 28.5];

  it('a CROSS-MODEL incoming is accepted (reject:false) even zoomed-in and covered', () => {
    const d = decideMarineCommit(grid({ __sourceModel: 'GFS' }), grid({ __sourceModel: 'EURO', cols: 21, rows: 17 }), 9, coveredVp);
    expect(d.reject).toBe(false);
  });

  it('a CROSS-LAYER incoming is accepted (reject:false) — never holds one layer under another', () => {
    const d = decideMarineCommit(grid({ __componentLayer: 'waves' }), grid({ __componentLayer: 'swell_1', cols: 9, rows: 9 }), 9, coveredVp);
    expect(d.reject).toBe(false);
  });
});
