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
    const chip = screen.getByRole('button', { name: /^Surf ratings from the .* run, 6 h older than the wave heights/ });
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
    expect(screen.getByRole('button', { name: /Surf ratings/ })).toHaveAccessibleName(line.textContent);
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
