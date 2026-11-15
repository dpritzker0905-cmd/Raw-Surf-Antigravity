// Scrub-step re-render bail-outs (scrubRenderBailouts.js): the slot-URL bail-out and the derived scrubbing flag, each with its
// kill's off path. The census that motivated them: docs/weather-program/log/2026-11-15-opus-scrub-render-census.md.
import React, { useState } from 'react';
import { act, render } from '@testing-library/react';
import { shallowSameMap, keepSlotUrlsIfSame, scrubbingFlag, modalsStayClosed, MODAL_OPEN_FLAGS } from './scrubRenderBailouts';

const mockExactArgs = [];
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('../../hooks/useExactPointFetch', () => ({ useExactPointFetch: (a) => { mockExactArgs.push({ isScrubbing: a.isScrubbing, settledOffset: a.settledOffset, hour: a.timeOffsetHours }); return {
  exactPoint: null, exactPointResponse: null, exactPointStatus: 'idle',
  setExactPointStatus: jest.fn(), setExactPointResponse: jest.fn(), setEstimateTrigger: jest.fn(),
}; } }));
jest.mock('./usePointRating', () => ({ usePointRating: () => null }));
jest.mock('./marineDrawnFrame', () => ({ useMarineDrawnFrame: () => null }));
jest.mock('./usePointTide', () => ({ usePointTide: () => ({ status: 'idle', data: null }) }));

const { MapForecastOverlay } = (() => {
  const original = global.fetch;
  global.fetch = () => Promise.reject(new Error('offline UI test'));
  try { return require('./MapForecastOverlay'); } finally { global.fetch = original; }
})();

afterEach(() => {
  delete window.__RAW_DISABLE_SLOT_URL_BAILOUT__;
  delete window.__RAW_DISABLE_DERIVED_SCRUBBING__;
  delete window.__RAW_DISABLE_CLOSED_MODALS_SKIP__;
  mockExactArgs.length = 0;
  jest.useRealTimers();
});

describe('shallowSameMap', () => {
  test('same keys and Object.is values are the same; anything else is not', () => {
    expect(shallowSameMap({ a: 'x', b: 'y' }, { b: 'y', a: 'x' })).toBe(true);
    expect(shallowSameMap({ a: 'x' }, { a: 'z' })).toBe(false);
    expect(shallowSameMap({ a: 'x' }, { a: 'x', b: undefined })).toBe(false);
    expect(shallowSameMap({ a: 'x', b: undefined }, { a: 'x', c: undefined })).toBe(false);
    expect(shallowSameMap({ a: NaN }, { a: NaN })).toBe(true);
    expect(shallowSameMap({}, null)).toBe(false);
  });
});

// A component holding slot URLs the way useOpenMeteoTileUrls does (functional merge), counting its renders.
function SlotHolder({ onRender, setterRef }) {
  const [urls, setUrls] = useState({ 'rain-slot-0': 'om://a' });
  setterRef.current = setUrls;
  onRender(urls);
  return null;
}
const mergeSame = (prev) => keepSlotUrlsIfSame(prev, { ...prev, 'rain-slot-0': 'om://a' });

describe('slot-URL bail-out', () => {
  test('ON: an unchanged merge keeps the previous object, so React skips the re-render', () => {
    const seen = []; const setter = { current: null };
    render(<SlotHolder onRender={(u) => seen.push(u)} setterRef={setter} />);
    act(() => { setter.current(mergeSame); });
    act(() => { setter.current(mergeSame); });
    expect(seen).toHaveLength(1);
    act(() => { setter.current((prev) => keepSlotUrlsIfSame(prev, { ...prev, 'rain-slot-1': 'om://b' })); });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ 'rain-slot-0': 'om://a', 'rain-slot-1': 'om://b' });
  });

  test('OFF PATH: __RAW_DISABLE_SLOT_URL_BAILOUT__ commits every resolve (a new object each time)', () => {
    window.__RAW_DISABLE_SLOT_URL_BAILOUT__ = true;
    const seen = []; const setter = { current: null };
    render(<SlotHolder onRender={(u) => seen.push(u)} setterRef={setter} />);
    act(() => { setter.current(mergeSame); });
    act(() => { setter.current(mergeSame); });
    expect(seen).toHaveLength(3);
    expect(seen[2]).not.toBe(seen[1]);
    expect(seen[2]).toEqual(seen[1]);
  });
});

describe('derived scrubbing flag', () => {
  beforeEach(() => { window.__RAW_DISABLE_INFOBOX_TIDE__ = true; });   // the tide readout is not under test
  afterEach(() => { delete window.__RAW_DISABLE_INFOBOX_TIDE__; });
  test('scrubbingFlag: hour vs settled hour when on; the legacy state when killed', () => {
    expect(scrubbingFlag(3, 0, false)).toBe(true);
    expect(scrubbingFlag(3, 3, true)).toBe(false);
    window.__RAW_DISABLE_DERIVED_SCRUBBING__ = true;
    expect(scrubbingFlag(3, 0, false)).toBe(false);
    expect(scrubbingFlag(3, 3, true)).toBe(true);
  });

  const props = { activeLayer: 'waves', activeModel: 'GFS', currentWeather: {}, forecastData: null, marineData: null,
    longPressLocation: { lat: 28.34, lng: -80.58 }, timeOffsetHours: 0 };

  test('ON: the hour change itself reads as scrubbing, with no extra render; settles after 200 ms', () => {
    jest.useFakeTimers();
    const { rerender } = render(<MapForecastOverlay {...props} />);
    act(() => { jest.advanceTimersByTime(250); });
    mockExactArgs.length = 0;
    rerender(<MapForecastOverlay {...props} timeOffsetHours={3} />);
    const atStep = mockExactArgs.filter((a) => a.hour === 3);
    expect(atStep.length).toBeGreaterThan(0);
    expect(atStep.every((a) => a.isScrubbing === true && a.settledOffset === 0)).toBe(true);
    const rendersBeforeSettle = atStep.length;
    act(() => { jest.advanceTimersByTime(250); });
    const last = mockExactArgs[mockExactArgs.length - 1];
    expect(last).toEqual({ isScrubbing: false, settledOffset: 3, hour: 3 });
    expect(rendersBeforeSettle).toBe(1);   // no effect-driven second render for the scrubbing flag
  });

  test('OFF PATH: __RAW_DISABLE_DERIVED_SCRUBBING__ keeps the state (false at the hour change, true one render later)', () => {
    window.__RAW_DISABLE_DERIVED_SCRUBBING__ = true;
    jest.useFakeTimers();
    const { rerender } = render(<MapForecastOverlay {...props} />);
    act(() => { jest.advanceTimersByTime(250); });
    mockExactArgs.length = 0;
    rerender(<MapForecastOverlay {...props} timeOffsetHours={3} />);
    const atStep = mockExactArgs.filter((a) => a.hour === 3 && a.settledOffset === 0);
    expect(atStep[0].isScrubbing).toBe(false);
    expect(atStep[atStep.length - 1].isScrubbing).toBe(true);
    expect(atStep.length).toBeGreaterThanOrEqual(2);
    act(() => { jest.advanceTimersByTime(250); });
    expect(mockExactArgs[mockExactArgs.length - 1]).toEqual({ isScrubbing: false, settledOffset: 3, hour: 3 });
  });
});

describe('closed-modals skip', () => {
  const closed = Object.fromEntries(MODAL_OPEN_FLAGS.map((k) => [k, false]));
  test('skips only while every modal stays closed; any opening or closing renders', () => {
    expect(modalsStayClosed({ ...closed, user: 1 }, { ...closed, user: 2, onX: () => {} })).toBe(true);
    for (const k of MODAL_OPEN_FLAGS) {
      expect(modalsStayClosed(closed, { ...closed, [k]: true })).toBe(false);   // opening renders with fresh props
      expect(modalsStayClosed({ ...closed, [k]: true }, closed)).toBe(false);   // closing renders (exit)
      expect(modalsStayClosed({ ...closed, [k]: true }, { ...closed, [k]: true })).toBe(false);   // open: props flow as before
    }
  });

  test('MapPageModals: a closed set does not re-render on an unrelated prop change; opening one does', () => {
    const React2 = require('react');
    let renders = 0;
    const Inner = (p) => { renders += 1; return null; };
    const Memo = React2.memo(Inner, modalsStayClosed);
    const { rerender } = render(<Memo {...closed} user={1} />);
    rerender(<Memo {...closed} user={2} />);
    expect(renders).toBe(1);
    rerender(<Memo {...closed} showRequestProModal user={3} />);
    expect(renders).toBe(2);
  });

  test('OFF PATH: __RAW_DISABLE_CLOSED_MODALS_SKIP__ re-renders on every parent render', () => {
    window.__RAW_DISABLE_CLOSED_MODALS_SKIP__ = true;
    expect(modalsStayClosed(closed, closed)).toBe(false);
  });

  test('the flag list covers every isOpen / show flag MapPageModals reads', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'MapPageModals.js'), 'utf8');
    // every show* name in the component's props (setShow* setters and the local alias showSelfie excluded)
    const flags = [...new Set((src.match(/[^A-Za-z]show[A-Z][A-Za-z]*/g) || []).map((n) => n.slice(1)).filter((n) => n !== 'showSelfie'))];
    expect(flags.sort()).toEqual([...MODAL_OPEN_FLAGS].sort());
  });
});
