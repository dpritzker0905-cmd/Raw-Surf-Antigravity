/**
 * R-3 (scrub audit 2026-10-18, T-01): the wheel unmounted or redrawn MID-COAST must still finish the gesture.
 *
 * The canvas effect's cleanup only cancelled the coast/settle rAF, so `finish()` (the final commit + onScrubEnd) never ran when
 * the mobile sheet closed or `draw` changed mid-coast (a model switch changes `max`; a theme/radar flip changes colours/pitch).
 * The parent's onScrubEnd is the only thing that clears `window.isScrubbingTimeline`, and while it is set every pan/zoom marine
 * fetch, wind moveend, autoplay tick and the scrub-settle net are dropped: the map froze until the next drag.
 *
 * The coast is frozen mid-flight by a hand-held rAF queue that never runs.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import ForecastWheel, { wheelGestureNeedsFinish } from './ForecastWheel';

let clock;
let rafQueue;
const realRaf = global.requestAnimationFrame;
const realCaf = global.cancelAnimationFrame;
const realNow = performance.now;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fillText: () => {},
  });
  if (typeof window.PointerEvent === 'undefined') {
    // jsdom has no PointerEvent; without one fireEvent.pointer* drops clientX.
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId || 1; this.isPrimary = init.isPrimary !== false; }
    };
  }
});

beforeEach(() => {
  clock = 1000;
  rafQueue = [];
  performance.now = () => clock;
  global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  global.cancelAnimationFrame = () => {};
  delete window.__RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__;
  delete window.__RAW_DISABLE_WHEEL_DRAG_COMMIT__;
});
afterEach(() => {
  global.requestAnimationFrame = realRaf;
  global.cancelAnimationFrame = realCaf;
  performance.now = realNow;
  delete window.__RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__;
});

function mountWheel(extra = {}) {
  const props = { isRadar: false, max: 336, value: 10, theme: 'dark',
    onPreview: jest.fn(), onCommit: jest.fn(), onScrubStart: jest.fn(), onScrubEnd: jest.fn(), ...extra };
  const view = render(<ForecastWheel {...props} />);
  const box = view.getByRole('slider');
  return { ...view, box, props };
}

/** A fast leftward flick of 8 hours (14 px per hour), released while still moving: the wheel COASTS. */
function flick(box) {
  let x = 400;
  fireEvent.pointerDown(box, { clientX: x, pointerId: 1 });
  for (let i = 0; i < 4; i++) { clock += 16; x -= 28; fireEvent.pointerMove(box, { clientX: x, pointerId: 1 }); }
  clock += 4;
  fireEvent.pointerUp(box, { clientX: x, pointerId: 1 });
}

describe('interrupted pointer input', () => {
  it('cancellation settles the last detent without release inertia, and leaves pinch zoom to the browser', () => {
    const { box, props } = mountWheel();
    fireEvent.pointerDown(box, { clientX: 400, pointerId: 1 });
    for (let i = 1; i <= 4; i++) { clock += 16; fireEvent.pointerMove(box, { clientX: 400 - i * 28, pointerId: 1 }); }
    clock += 4;
    fireEvent.pointerCancel(box, { pointerId: 1 });
    act(() => { for (let i = 0; i < 200 && rafQueue.length; i++) { clock += 16; rafQueue.shift()(clock); } });
    expect(props.onCommit).toHaveBeenLastCalledWith(18);
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
    expect(box.style.touchAction).toBe('pan-y pinch-zoom');
    fireEvent.pointerCancel(box, { pointerId: 1 });
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(props.onCommit).toHaveBeenLastCalledWith(19);
  });

  it('right-click and a second pointer cannot start or take over a primary scrub', () => {
    const { box, props } = mountWheel();
    fireEvent.pointerDown(box, { button: 2, clientX: 400, pointerId: 3 });
    expect(props.onScrubStart).not.toHaveBeenCalled();
    fireEvent.pointerDown(box, { clientX: 400, pointerId: 1 });
    fireEvent.pointerDown(box, { clientX: 50, pointerId: 2, isPrimary: false });
    clock += 100;
    fireEvent.pointerMove(box, { clientX: 0, pointerId: 2, isPrimary: false });
    fireEvent.pointerUp(box, { pointerId: 2, isPrimary: false });
    expect(props.onScrubStart).toHaveBeenCalledTimes(1);
    expect(box.getAttribute('aria-valuenow')).toBe('10');
    fireEvent.pointerMove(box, { clientX: 386, pointerId: 1 });
    fireEvent.pointerCancel(box, { pointerId: 1 });
    act(() => { for (let i = 0; i < 100 && rafQueue.length; i++) { clock += 16; rafQueue.shift()(clock); } });
    expect(props.onCommit).toHaveBeenLastCalledWith(11);
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
  });
});


describe('wheelGestureNeedsFinish (pure)', () => {
  it('a running coast or settle needs finishing on any cancel; a drag only on unmount', () => {
    expect(wheelGestureNeedsFinish({ coasting: true }, false, {})).toBe(true);
    expect(wheelGestureNeedsFinish({ settling: true }, false, {})).toBe(true);
    expect(wheelGestureNeedsFinish({ dragging: true }, false, {})).toBe(false);   // a redraw mid-drag: the drag carries on
    expect(wheelGestureNeedsFinish({ dragging: true }, true, {})).toBe(true);
    expect(wheelGestureNeedsFinish({}, true, {})).toBe(false);                     // nothing open: nothing to finish
    expect(wheelGestureNeedsFinish({ coasting: true }, true, { __RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__: true })).toBe(false);
  });
});

describe('R-3: unmount / redraw mid-coast', () => {
  it('unmount mid-coast commits the detent under the wheel and ends the scrub (was: neither)', () => {
    const { box, props, unmount } = mountWheel();
    flick(box);
    expect(rafQueue.length).toBeGreaterThan(0);                 // the coast is running (frozen here)
    expect(props.onScrubEnd).not.toHaveBeenCalled();
    const hourUnderWheel = Number(box.getAttribute('aria-valuenow'));
    expect(hourUnderWheel).toBe(18);
    unmount();
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenLastCalledWith(18);

    // Component-level preference simulation, not a browser/device motion check.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' });
    rafQueue = [];
    try {
      const reduced = mountWheel();
      flick(reduced.box);
      expect(reduced.props.onCommit).toHaveBeenLastCalledWith(18);
      expect(reduced.props.onScrubEnd).toHaveBeenCalledTimes(1);
      expect(rafQueue).toHaveLength(0); // The same gesture settles immediately without inertia.
      reduced.unmount();
      expect(reduced.props.onScrubEnd).toHaveBeenCalledTimes(1);
    } finally {
      if (originalMatchMedia === undefined) delete window.matchMedia;
      else window.matchMedia = originalMatchMedia;
    }
  });

  it('a redraw mid-coast (max changes on a model switch) finishes the gesture once, and the wheel then follows external values again', () => {
    const { box, props, rerender } = mountWheel();
    flick(box);
    act(() => { rerender(<ForecastWheel {...props} max={240} />); });
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenLastCalledWith(18);
    // `s.coasting` used to stay true, so the follow-external-value effect ignored autoplay/model resets until the next pointerdown.
    act(() => { rerender(<ForecastWheel {...props} max={240} value={40} />); });
    expect(box.getAttribute('aria-valuenow')).toBe('40');
  });

  it('unmount with the pointer still down ends the scrub too', () => {
    const { box, props, unmount } = mountWheel();
    fireEvent.pointerDown(box, { clientX: 400, pointerId: 1 });
    unmount();
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('a redraw mid-DRAG does not end the drag (the handlers are re-bound and the gesture carries on)', () => {
    const { box, props, rerender } = mountWheel();
    fireEvent.pointerDown(box, { clientX: 400, pointerId: 1 });
    act(() => { rerender(<ForecastWheel {...props} theme="light" />); });
    expect(props.onScrubEnd).not.toHaveBeenCalled();
    clock += 200;
    fireEvent.pointerUp(box, { clientX: 400, pointerId: 1 });   // slow release -> settle, still the same gesture
    expect(rafQueue.length).toBeGreaterThan(0);
  });

  it('kill switch __RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__ restores cancel-only (the defect: no scrub end)', () => {
    window.__RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__ = true;
    const { box, props, unmount } = mountWheel();
    flick(box);
    unmount();
    expect(props.onScrubEnd).not.toHaveBeenCalled();
  });
});
