import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describeDrawnFrame, reconcileStaleBadge, formatForecastHour } from './drawnFrameReadout';
import { publishMarineDrawn, getMarineDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';
import { createLatestOnlyGate } from './latestOnlyGate';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const req = (hour, layer = 'waves', model = 'GFS') => ({ hour, layer, model });
const drawn = (hour, extra = {}) => ({ hour, layer: 'waves', model: 'GFS', estimated: false, basisType: null, ...extra });

describe('describeDrawnFrame: the selection against the drawn frame, in words', () => {
  test('the drawn frame IS the selection: nothing to say', () => {
    expect(describeDrawnFrame(req(24), drawn(24), { nowMs: NOW })).toBeNull();
  });
  test('a layer switch still loading names both layers', () => {
    const r = describeDrawnFrame(req(24, 'swell_2'), drawn(24), { nowMs: NOW });
    expect(r.state).toBe('pending');
    expect(r.text).toBe('Loading GFS Swell 2… still showing GFS Waves');
  });
  test('a model switch still loading names both models', () => {
    const r = describeDrawnFrame(req(24, 'waves', 'ICON'), drawn(24), { nowMs: NOW });
    expect(r).toMatchObject({ state: 'pending', text: 'Loading ICON Waves… still showing GFS Waves' });
  });
  test.each([1, 2, 3, -1, -3])('a drawn hour within the 3-h lattice is the nearest stored forecast (offset %i)', (off) => {
    const r = describeDrawnFrame(req(24), drawn(24 + off), { nowMs: NOW });
    expect(r.state).toBe('nearest');
    expect(r.text).toContain(formatForecastHour(24 + off, NOW));
    expect(r.text).toContain('nearest stored forecast');
  });
  test('a drawn hour far from the selection is still loading', () => {
    const r = describeDrawnFrame(req(120), drawn(35), { nowMs: NOW });
    expect(r.state).toBe('pending');
    expect(r.text).toBe(`Loading ${formatForecastHour(120, NOW)}… still showing ${formatForecastHour(35, NOW)}`);
  });
  test('an estimate says what it is, even on the selected hour', () => {
    expect(describeDrawnFrame(req(24, 'swell_2', 'ICON'), drawn(24, { layer: 'swell_2', model: 'ICON', estimated: true, basisType: 'icon_swell_2_gfs_euro_blend' }), { nowMs: NOW }))
      .toEqual({ state: 'estimated', text: 'Estimated forecast: blended from GFS and EURO' });
  });
  test('missing inputs say nothing (never a guess)', () => {
    expect(describeDrawnFrame(null, drawn(1))).toBeNull();
    expect(describeDrawnFrame(req(1), null)).toBeNull();
  });
});

describe('reconcileStaleBadge (T-05): decided from the drawn frame, never sticky', () => {
  afterEach(() => { delete window.__RAW_DISABLE_DRAWN_STALE_BADGE__; });
  test('shows while the drawn frame is genuinely pending', () => {
    expect(reconcileStaleBadge('ready', req(120), drawn(35))).toBe('retained_stale_warning');
    expect(reconcileStaleBadge(null, req(24, 'swell_1'), drawn(24))).toBe('retained_stale_warning');
  });
  test('clears a sticky warning once the drawn frame is the selection or its nearest frame', () => {
    expect(reconcileStaleBadge('retained_stale_warning', req(24), drawn(24))).toBeNull();
    expect(reconcileStaleBadge('retained_stale_warning', req(25), drawn(24))).toBeNull();
  });
  test('leaves other statuses alone, and non-marine layers untouched', () => {
    expect(reconcileStaleBadge('rate_limited', req(24), drawn(24))).toBe('rate_limited');
    expect(reconcileStaleBadge('x', req(24, 'rain'), drawn(3))).toBe('x');
  });
  test('kill switch returns the old status', () => {
    window.__RAW_DISABLE_DRAWN_STALE_BADGE__ = true;
    expect(reconcileStaleBadge('ready', req(120), drawn(35))).toBe('ready');
  });
});

describe('the drawn-frame store feeds the status line in the same frame', () => {
  beforeEach(() => _resetMarineDrawnForTest());
  test('publish records the uploaded grid identity', () => {
    publishMarineDrawn({ hourOffset: 6, __componentLayer: 'swell_2', __sourceModel: 'ICON', is_estimated: true,
      estimate_basis: { type: 'icon_swell_2_gfs_euro_blend' }, __gridProvider: 'gfs_euro_blend' });
    expect(getMarineDrawn()).toMatchObject({ hour: 6, layer: 'swell_2', model: 'ICON', estimated: true, basisType: 'icon_swell_2_gfs_euro_blend' });
  });
  test('ForecastTimeStatus re-renders on publish with an aria-live status (no poll wait)', () => {
    render(<ForecastTimeStatus model="GFS" layer="swell_2" hour={24} theme="dark" />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { publishMarineDrawn({ hourOffset: 24, __componentLayer: 'waves', __sourceModel: 'GFS' }); });
    const s = screen.getByRole('status');
    expect(s).toHaveAttribute('aria-live', 'polite');
    expect(s).toHaveTextContent('Loading GFS Swell 2… still showing GFS Waves');
    act(() => { publishMarineDrawn({ hourOffset: 24, __componentLayer: 'swell_2', __sourceModel: 'GFS' }); });
    expect(screen.queryByRole('status')).toBeNull();
  });
  test.each(['light', 'dark', 'beach'])('renders in the %s theme', (theme) => {
    render(<ForecastTimeStatus model="GFS" layer="waves" hour={25} theme={theme} />);
    act(() => { publishMarineDrawn({ hourOffset: 24, __componentLayer: 'waves', __sourceModel: 'GFS' }); });
    expect(screen.getByRole('status').getAttribute('data-drawn-state')).toBe('nearest');
  });
  test('3 h off on the 3-hourly marine lattice is an upgrade still owed (Loading); EURO past 144 h may be 3 h off', () => {
    const { unmount } = render(<ForecastTimeStatus model="GFS" layer="waves" hour={27} theme="dark" />);
    act(() => { publishMarineDrawn({ hourOffset: 24, __componentLayer: 'waves', __sourceModel: 'GFS' }); });
    expect(screen.getByRole('status').getAttribute('data-drawn-state')).toBe('pending');
    unmount();
    render(<ForecastTimeStatus model="EURO" layer="waves" hour={150} theme="dark" />);
    act(() => { publishMarineDrawn({ hourOffset: 147, __componentLayer: 'waves', __sourceModel: 'EURO' }); });
    expect(screen.getByRole('status').getAttribute('data-drawn-state')).toBe('nearest');
  });
  test('kill switch falls back to the old line', () => {
    window.__RAW_DISABLE_DRAWN_FRAME_READOUT__ = true;
    try {
      render(<ForecastTimeStatus model="GFS" layer="waves" hour={25} theme="dark" />);
      act(() => { publishMarineDrawn({ hourOffset: 24, __componentLayer: 'waves', __sourceModel: 'GFS' }); });
      expect(screen.queryByRole('status')).toBeNull();
    } finally { delete window.__RAW_DISABLE_DRAWN_FRAME_READOUT__; }
  });
});

describe('createLatestOnlyGate (T-04): one in flight, newest waiting', () => {
  test('a burst of N tasks runs at most two: the first and the newest', async () => {
    const gate = createLatestOnlyGate();
    const ran = [];
    let release;
    const first = new Promise((r) => { release = r; });
    gate.run(async () => { ran.push(0); await first; });
    for (let i = 1; i <= 8; i++) gate.run(async () => { ran.push(i); });
    expect(gate.busy()).toBe(true);
    release();
    for (let k = 0; k < 10; k++) await Promise.resolve();
    expect(ran).toEqual([0, 8]);
    expect(gate.busy()).toBe(false);
  });
  test('a failing task never blocks the next', async () => {
    const gate = createLatestOnlyGate();
    const ran = [];
    gate.run(async () => { throw new Error('boom'); });
    gate.run(async () => { ran.push('next'); });
    for (let k = 0; k < 10; k++) await Promise.resolve();
    expect(ran).toEqual(['next']);
  });
});

describe('describeDrawnFrame compares by INSTANT when known (the #267 rule)', () => {
  const T = Date.UTC(2026, 9, 19, 6, 0, 0);
  test('label differs but the data is exactly the requested instant: nothing to say', () => {
    expect(describeDrawnFrame({ hour: 4, layer: 'waves', model: 'GFS', instantMs: T }, { hour: 3, layer: 'waves', model: 'GFS', dataMs: T })).toBeNull();
  });
  test('label matches but the data is a neighbouring instant: nearest, named by its own time', () => {
    const r = describeDrawnFrame({ hour: 4, layer: 'waves', model: 'GFS', instantMs: T }, { hour: 4, layer: 'waves', model: 'GFS', dataMs: T - 3 * 3600000 });
    expect(r.state).toBe('nearest');
    expect(r.text).toContain(new Date(T - 3 * 3600000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' }));
  });
});
