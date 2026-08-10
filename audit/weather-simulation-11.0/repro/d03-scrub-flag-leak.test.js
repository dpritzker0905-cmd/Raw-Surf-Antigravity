/**
 * AGENT G / RED TEAM repro for FINDING D-03.
 * READ-ONLY audit artifact. Imports production source by absolute path; mutates nothing.
 *
 * Question under test: if ForecastWheel unmounts after pointer release but BEFORE the settle RAF
 * converges, does window.isScrubbingTimeline stay true forever?
 *
 * The onScrubStart/onScrubEnd callbacks below are byte-faithful to what MapWeatherControls.js
 * actually passes at :514-515 (wheelScrubStart/wheelScrubEnd, defined at :458-470).
 */
/* eslint-disable */
const NM = 'C:/Users/dprit/Raw-Surf/frontend/node_modules/';
const React = require(NM + 'react');
const { render, fireEvent, act } = require(NM + '@testing-library/react');
const ForecastWheel =
  require('C:/Users/dprit/Raw-Surf/frontend/src/components/map/ForecastWheel.js').default;

// jsdom has no 2D canvas context; the wheel paints on mount (same stub the repo's own
// ForecastWheel.valuetext.test.js installs at :28-36).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }), save() {}, restore() {},
    translate() {}, scale() {}, arc() {}, closePath() {}, setLineDash() {},
  });
});

// Deterministic RAF queue so "the frame has not run yet" is a state we can hold.
let rafQueue, rafId, cancelled;
beforeEach(() => {
  rafQueue = new Map(); rafId = 0; cancelled = [];
  global.requestAnimationFrame = (cb) => { rafId += 1; rafQueue.set(rafId, cb); return rafId; };
  global.cancelAnimationFrame = (id) => { cancelled.push(id); rafQueue.delete(id); };
  window.requestAnimationFrame = global.requestAnimationFrame;
  window.cancelAnimationFrame = global.cancelAnimationFrame;
  delete window.isScrubbingTimeline;
});

function flushRaf(n = 60) {
  act(() => {
    for (let i = 0; i < n && rafQueue.size; i++) {
      const [id, cb] = rafQueue.entries().next().value;
      rafQueue.delete(id);
      cb(performance.now());
    }
  });
}

// EXACT mirror of MapWeatherControls.js:458-470.
const wheelScrubStart = () => {
  window.isScrubbingTimeline = true;
  window.dispatchEvent(new CustomEvent('timeline_scrub_start'));
};
const wheelScrubEnd = () => {
  window.isScrubbingTimeline = false;
  window.lastScrubTime = Date.now();
  window.dispatchEvent(new CustomEvent('timeline_scrub_end'));
};

function mount(extra) {
  return render(React.createElement(ForecastWheel, Object.assign({
    isRadar: false, max: 336, value: 0, theme: 'dark',
    onPreview() {}, onCommit() {},
    onScrubStart: wheelScrubStart, onScrubEnd: wheelScrubEnd,
  }, extra)));
}

describe('D-03: window.isScrubbingTimeline lifetime across the wheel gesture', () => {
  test('CONTROL: a completed gesture clears the flag', () => {
    const { getByRole } = mount();
    const wheel = getByRole('slider');

    fireEvent.pointerDown(wheel, { clientX: 100, pointerId: 1 });
    expect(window.isScrubbingTimeline).toBe(true);          // gate armed

    fireEvent.pointerUp(wheel, { clientX: 100, pointerId: 1 });
    expect(window.isScrubbingTimeline).toBe(true);          // still armed: settle is on a RAF

    flushRaf();
    expect(window.isScrubbingTimeline).toBe(false);         // finish() ran -> released
  });

  test('LEAK: unmount after release but before the settle frame leaves the flag TRUE', () => {
    const { getByRole, unmount } = mount();
    const wheel = getByRole('slider');

    fireEvent.pointerDown(wheel, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(wheel, { clientX: 100, pointerId: 1 });
    expect(window.isScrubbingTimeline).toBe(true);
    expect(rafQueue.size).toBeGreaterThan(0);               // settle RAF is pending

    unmount();                                              // ForecastWheel.js:321 cancels s.raf
    flushRaf();

    expect(window.isScrubbingTimeline).toBe(true);          // <-- STUCK
    expect(rafQueue.size).toBe(0);                          // nothing left to ever release it
  });

  test('LEAK: unmount mid-drag (no pointerup at all) also leaves it TRUE', () => {
    const { getByRole, unmount } = mount();
    const wheel = getByRole('slider');

    fireEvent.pointerDown(wheel, { clientX: 100, pointerId: 1 });
    unmount();
    flushRaf();

    expect(window.isScrubbingTimeline).toBe(true);
  });

  test('COUNTEREVIDENCE: pointercancel IS handled, so a cancelled gesture self-heals', () => {
    const { getByRole } = mount();
    const wheel = getByRole('slider');

    fireEvent.pointerDown(wheel, { clientX: 100, pointerId: 1 });
    fireEvent.pointerCancel(wheel, { clientX: 100, pointerId: 1 });  // ForecastWheel.js:342
    flushRaf();

    expect(window.isScrubbingTimeline).toBe(false);
  });

  test('ALT PATH: a prop change that re-identifies `draw` cancels the settle RAF WITHOUT unmount', () => {
    const { getByRole, rerender } = mount();
    const wheel = getByRole('slider');

    fireEvent.pointerDown(wheel, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(wheel, { clientX: 100, pointerId: 1 });
    expect(window.isScrubbingTimeline).toBe(true);

    // `max` is a dep of draw(), which is a dep of the resize effect whose cleanup cancels s.raf.
    // MapWeatherControls.js:506 feeds max from maxForecastHours (:278), which is derived from
    // resolveForecastWindow(userTier, activeModel, activeLayer).
    act(() => {
      rerender(React.createElement(ForecastWheel, {
        isRadar: false, max: 240, value: 0, theme: 'dark',
        onPreview() {}, onCommit() {},
        onScrubStart: wheelScrubStart, onScrubEnd: wheelScrubEnd,
      }));
    });
    flushRaf();

    // Report whichever way it lands; this arm exists to find out, not to assert a wish.
    console.log('[D-03 alt-path] isScrubbingTimeline after max change =', window.isScrubbingTimeline);
    expect([true, false]).toContain(window.isScrubbingTimeline);
  });
});
