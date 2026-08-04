/**
 * ACCESSIBILITY: a slider must SAY what its number means, and it must say it BEFORE you touch it.
 *
 * MEASURED LIVE 2026-08-04 on the running map: both forecast wheels served
 * `aria-valuenow="0"` with `aria-valuetext=""`. A screen reader therefore announced a bare number
 * with no unit — "0", not "Now" — on a control whose whole purpose is choosing an hour.
 *
 * ⭐⭐ THE CAUSE WAS TWO OWNERS FOR ONE ATTRIBUTE, and only one of them ran at mount.
 * The JSX declared `aria-valuenow` and NOT `aria-valuetext`; the text was built inline inside the
 * imperative `setAria()`, which is called from the drag and keyboard handlers and from the
 * follow-external-value effect — and that effect is guarded by
 * `wheelSettleTarget(s.hour, max) !== value`, which is FALSE at mount. So the announcement existed
 * in the code and reached nobody until the user had already driven the control.
 * ⇒ `wheelValueText` is now the single source both paths read, and the JSX declares it, so it is
 *   correct from first paint.
 *
 * ⛔ THE MOUNT TEST IS THE ONE THAT MATTERS. A test that scrubs first and then asserts would have
 * PASSED against the broken build — `setAria` does fire once you interact. The defect is entirely
 * about the state a user LANDS on, so the assertion has to be made before any event is dispatched.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

import ForecastWheel, { wheelValueText } from './ForecastWheel';

// jsdom has no 2D canvas context; the wheel paints on mount. Stub it so the render under test is
// the ARIA surface, not the canvas backend.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    stroke: () => {}, fill: () => {}, fillRect: () => {}, fillText: () => {},
    measureText: () => ({ width: 10 }), save: () => {}, restore: () => {},
    translate: () => {}, scale: () => {}, arc: () => {}, closePath: () => {},
    setLineDash: () => {},
  });
});

describe('wheelValueText — the spoken half of aria-valuenow', () => {
  it('names the present rather than reading a zero', () => {
    expect(wheelValueText(0, false)).toBe('Now');
  });

  it('carries a UNIT, and gets the singular right', () => {
    expect(wheelValueText(1, false)).toBe('+1 hour');
    expect(wheelValueText(6, false)).toBe('+6 hours');
    expect(wheelValueText(336, false)).toBe('+336 hours');
  });

  it('radar counts frames from 1, because "frame 0" is not a thing a user sees', () => {
    expect(wheelValueText(0, true)).toBe('frame 1');
    expect(wheelValueText(11, true)).toBe('frame 12');
  });

  it('never returns an empty string — an empty valuetext is the defect this file exists for', () => {
    for (const isRadar of [false, true]) {
      for (const h of [0, 1, 2, 47, 336]) {
        expect(wheelValueText(h, isRadar)).toEqual(expect.any(String));
        expect(wheelValueText(h, isRadar).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('ForecastWheel — the announcement is present AT MOUNT', () => {
  const props = {
    isRadar: false, max: 336, value: 0, theme: 'dark',
    onPreview: () => {}, onCommit: () => {}, onScrubStart: () => {}, onScrubEnd: () => {},
  };

  it('exposes a non-empty aria-valuetext before any interaction', () => {
    render(<ForecastWheel {...props} />);
    const slider = screen.getByRole('slider', { name: 'Forecast timeline wheel' });

    expect(slider).toHaveAttribute('aria-valuenow', '0');
    // THE REGRESSION: this was "" on the live map.
    expect(slider.getAttribute('aria-valuetext')).toBe('Now');
  });

  it('agrees with aria-valuenow at a non-zero hour', () => {
    render(<ForecastWheel {...props} value={6} />);
    const slider = screen.getByRole('slider', { name: 'Forecast timeline wheel' });
    expect(slider).toHaveAttribute('aria-valuenow', '6');
    expect(slider.getAttribute('aria-valuetext')).toBe('+6 hours');
  });

  it('radar wheels announce frames and carry their own label', () => {
    render(<ForecastWheel {...props} isRadar value={3} max={12} />);
    const slider = screen.getByRole('slider', { name: 'Radar timeline wheel' });
    expect(slider.getAttribute('aria-valuetext')).toBe('frame 4');
  });

  it('the slider keeps the rest of its contract: range, focusability, role', () => {
    render(<ForecastWheel {...props} />);
    const slider = screen.getByRole('slider', { name: 'Forecast timeline wheel' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '336');
    expect(slider).toHaveAttribute('tabindex', '0');
  });
});
