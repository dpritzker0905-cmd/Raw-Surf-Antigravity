import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import StaleLayerChip from './StaleLayerChip';
import TimelineDrawerHeader from './TimelineDrawerHeader';
import ForecastTimeStatus from './ForecastTimeStatus';

// The stale-layer chip (gate: log 2026-11-15-claude-rating-band-sota.md section 12).
const RUN = '2026-11-16T06:00:00Z';
const STALE = { model: 'GFS', layer: 'waves', hour: 0, windOn: false };
const paint = (ratedRun, extra = {}) => {
  window.__RAW_GPU__ = { ratingBand: { active: true }, ...extra };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { ratingMode: true, ratedRun } } };
};
afterEach(() => {
  delete window.__RAW_GPU__; delete window.__MARINE_ENGINE__; delete window.__RAW_DISABLE_STALE_CHIP__;
  delete window.__RAW_DISABLE_RATED_RUN_LABEL__;
});

describe('the chip: shown only while the painted band lags', () => {
  test('one run behind: a real button with the clock, the short words, and the status line sentence as its name (gate 3)', () => {
    paint({ lagH: 6, runTime: RUN });
    const open = jest.fn();
    render(<StaleLayerChip stale={STALE} onOpen={open} textClass="text-gray-400" />);
    // WCAG 2.5.3 label in name (advisor, #978): the name STARTS WITH the visible words, then the status line's sentence
    const chip = screen.getByRole('button', { name: /^Ratings 6 h old\. Surf ratings from the .* run, 6 h older than the wave heights/ });
    expect(chip.tagName).toBe('BUTTON');
    expect(chip).toHaveTextContent('Ratings 6 h old');
    expect(chip).toHaveAttribute('aria-controls', 'weather-mobile-timeline-body');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');    // the icon is decoration; the words carry it
    chip.focus();
    expect(document.activeElement).toBe(chip);                                    // reachable by keyboard
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledTimes(1);                                        // a tap opens the drawer
  });

  test('every control case: no chip (gate 2)', () => {
    const none = (msg) => { const { container, unmount } = render(<StaleLayerChip stale={STALE} onOpen={() => {}} />); expect(container.querySelector('[data-stale-chip]')).toBe(null); unmount(); };
    paint({ lagH: 0, runTime: RUN }); none('zero lag');
    paint({ lagH: null, runTime: RUN }); none('unknown lag');
    paint({ lagH: 6, runTime: RUN }); window.__RAW_GPU__.ratingBand.active = false; none('band not painted');
    paint({ lagH: 6, runTime: RUN }, { ratingBandFade: { heldBy: 'edge' } }); none('band held');
    paint({ lagH: 6, runTime: RUN }); window.__MARINE_ENGINE__._waveData.waveGrid.ratingMode = false; none('not a rating grid');
    paint({ lagH: 6, runTime: RUN }); window.__RAW_DISABLE_STALE_CHIP__ = true; none('the chip kill');
    delete window.__RAW_DISABLE_STALE_CHIP__;
    paint({ lagH: 6, runTime: RUN }); window.__RAW_DISABLE_RATED_RUN_LABEL__ = true; none('the label kill');
    delete window.__RAW_GPU__; delete window.__MARINE_ENGINE__; none('nothing painted at all');
  });

  test('ONE SOURCE: the chip name equals the status line text for the same painted grid (gate 4)', () => {
    paint({ lagH: 6, runTime: RUN });
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="dark" />);
    const line = document.querySelector('[data-rated-run-label]');
    render(<StaleLayerChip stale={STALE} onOpen={() => {}} />);
    const chip = screen.getByRole('button', { name: /Surf ratings/ });
    expect(chip.getAttribute('aria-label').startsWith(chip.textContent)).toBe(true);   // label in name
    expect(chip.getAttribute('aria-label')).toContain(line.textContent);              // one source with the line
  });
});

describe('the collapsed header carries it; the open drawer does not (gate 6)', () => {
  test('collapsed: the chip after the header; expanded or no selection: the header exactly as before', () => {
    paint({ lagH: 6, runTime: RUN });
    const toggle = jest.fn();
    const { rerender, container } = render(<TimelineDrawerHeader expanded={false} onToggle={toggle} timeLabel="Now" stale={STALE} />);
    expect(container.querySelector('[data-stale-chip="ratings"]')).not.toBe(null);
    fireEvent.click(container.querySelector('[data-stale-chip]'));
    expect(toggle).toHaveBeenCalledTimes(1);                                     // the chip opens the same drawer
    rerender(<TimelineDrawerHeader expanded onToggle={toggle} timeLabel="Now" stale={STALE} />);
    expect(container.querySelector('[data-stale-chip]')).toBe(null);
    expect(screen.getAllByRole('button')).toHaveLength(3);                       // the header's own three buttons, unchanged
    rerender(<TimelineDrawerHeader expanded={false} onToggle={toggle} timeLabel="Now" />);
    expect(container.querySelector('[data-stale-chip]')).toBe(null);
  });
});

describe('the hold (advisor, #978): no flicker when the reader clears for a moment between scrub steps', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('a brief clear keeps the chip; a clear longer than HOLD_MS removes it; the kill removes it at once', () => {
    const { act } = require('@testing-library/react');
    const { HOLD_MS } = require('./StaleLayerChip');
    paint({ lagH: 6, runTime: RUN });
    const { container } = render(<StaleLayerChip stale={STALE} onOpen={() => {}} />);
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null);
    window.__RAW_GPU__.ratingBand.active = false;                       // the band held between two hours of a scrub
    act(() => { jest.advanceTimersByTime(1000); });
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null); // inside the hold: still there, the header does not move
    window.__RAW_GPU__.ratingBand.active = true;
    act(() => { jest.advanceTimersByTime(600); });
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null);
    window.__RAW_GPU__.ratingBand.active = false;
    act(() => { jest.advanceTimersByTime(HOLD_MS + 600); });
    expect(container.querySelector('[data-stale-chip]')).toBe(null);     // a real clear: gone after the hold
    window.__RAW_GPU__.ratingBand.active = true;
    act(() => { jest.advanceTimersByTime(600); });
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null);
    window.__RAW_DISABLE_STALE_CHIP__ = true;
    act(() => { jest.advanceTimersByTime(600); });
    expect(container.querySelector('[data-stale-chip]')).toBe(null);     // the kill: at once, no hold
  });

  test('a new layer, model or wind choice drops the hold at once; a new hour (the scrub) keeps it', () => {
    const { act } = require('@testing-library/react');
    paint({ lagH: 6, runTime: RUN });
    const { container, rerender } = render(<StaleLayerChip stale={STALE} onOpen={() => {}} />);
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null);
    window.__RAW_GPU__.ratingBand.active = false;                                   // nothing stale on the next selection
    rerender(<StaleLayerChip stale={{ ...STALE, hour: 3 }} onOpen={() => {}} />);   // a scrub step: the hold keeps the words
    act(() => { jest.advanceTimersByTime(600); });
    expect(container.querySelector('[data-stale-chip]')).not.toBe(null);
    rerender(<StaleLayerChip stale={{ ...STALE, hour: 3, layer: 'swell_1' }} onOpen={() => {}} />);   // another layer
    act(() => { jest.advanceTimersByTime(0); });
    expect(container.querySelector('[data-stale-chip]')).toBe(null);               // the old words never sit on a layer they do not describe
  });
});
