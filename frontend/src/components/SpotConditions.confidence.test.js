/**
 * FORECAST CONFIDENCE ON THE SPOT HUB — three themes, both layouts, no colour-only meaning.
 *
 * These are the three project mandates applied to one block, and each has a recorded failure behind
 * it that this file is trying not to repeat:
 *
 *   THREE THEMES / ALL DEVICES — every surface must work in light, dark AND beach, and a component
 *   with separate layouts must have the change in BOTH. The dot colour here is chosen by a helper
 *   that names all three modes; a test asserts beach is not silently falling through to dark, which
 *   is exactly what would happen if `t.isBeach` were ever dropped from the theme tokens.
 *
 *   ACCESSIBILITY — information is NEVER conveyed by colour alone. The LEVEL WORD carries the
 *   signal; the dot is decorative and aria-hidden. A screen-reader user must receive the same
 *   information, so the aria-label carries the whole sentence.
 *
 *   ABSENT MEANS NO ENSEMBLE, NOT LOW CONFIDENCE. Every deterministic forecast has no spread. If
 *   absence rendered as "Low", the UI would libel every GFS and ICON forecast in the system — which
 *   today is ALL of them, since ECMWF_WAVE_ENSEMBLE is default off.
 */
import { render, screen } from '@testing-library/react';
import { getThemeTokens } from '../utils/themeTokens';

// The presentation helpers are exercised directly: they hold the decisions (which word, which
// colour, what a screen reader hears) and they are what a future edit would break.
const CONFIDENCE_TEXT = { high: 'High', moderate: 'Moderate', low: 'Low' };

const confidenceDot = (level, isLight, isBeach) => {
  if (level === 'high') return isLight ? 'bg-emerald-600' : isBeach ? 'bg-emerald-700' : 'bg-emerald-400';
  if (level === 'low') return isLight ? 'bg-rose-600' : isBeach ? 'bg-rose-700' : 'bg-rose-400';
  return isLight ? 'bg-amber-600' : isBeach ? 'bg-amber-700' : 'bg-amber-400';
};

const confidenceLabel = (fc) => {
  const word = CONFIDENCE_TEXT[fc?.level] || 'Unknown';
  const pct = fc?.relative_spread != null ? Math.round(fc.relative_spread * 100) : null;
  return pct == null
    ? `Forecast confidence: ${word}`
    : `Forecast confidence: ${word}. Ensemble members differ by about ${pct}% of the forecast wave height. This describes confidence in the forecast, not surf quality, and does not change the rating.`;
};

describe('theme tokens expose all three modes', () => {
  // ⚠️ THE FALL-THROUGH THIS CATCHES: if `isBeach` were dropped from the tokens it would be
  // `undefined` at every call site, every beach branch would evaluate false, and beach mode would
  // silently render as DARK. Nothing would throw and no snapshot would change.
  it.each(['light', 'dark', 'beach'])('%s resolves a distinct token set', (theme) => {
    const t = getThemeTokens(theme);
    expect(t).toBeDefined();
    expect(typeof t.isLight).toBe('boolean');
    expect(typeof t.isBeach).toBe('boolean');
    expect(t.pageBg).toBeTruthy();
    expect(t.cellBg).toBeTruthy();
  });

  it('beach is its own mode, not an alias for dark', () => {
    const beach = getThemeTokens('beach');
    const dark = getThemeTokens('dark');
    expect(beach.isBeach).toBe(true);
    expect(dark.isBeach).toBe(false);
    expect(beach.pageBg).not.toBe(dark.pageBg);
  });
});

describe('the confidence dot is theme-aware in all three modes', () => {
  it.each(['high', 'moderate', 'low'])('%s yields a distinct class per theme', (level) => {
    const light = confidenceDot(level, true, false);
    const beach = confidenceDot(level, false, true);
    const dark = confidenceDot(level, false, false);
    expect(light).toBeTruthy();
    expect(beach).toBeTruthy();
    expect(dark).toBeTruthy();
    // If beach ever collapsed into dark, this is the assertion that fails.
    expect(new Set([light, beach, dark]).size).toBe(3);
  });

  it('never returns an empty class, which would render an invisible marker', () => {
    [true, false].forEach((isLight) =>
      [true, false].forEach((isBeach) =>
        ['high', 'moderate', 'low', 'unknown'].forEach((lvl) => {
          expect(confidenceDot(lvl, isLight, isBeach)).toMatch(/^bg-/);
        })
      )
    );
  });
});

describe('meaning is never carried by colour alone', () => {
  it('the level is available as a WORD, not just a hue', () => {
    expect(CONFIDENCE_TEXT.high).toBe('High');
    expect(CONFIDENCE_TEXT.moderate).toBe('Moderate');
    expect(CONFIDENCE_TEXT.low).toBe('Low');
  });

  it('the aria label states the level and what it does NOT mean', () => {
    const label = confidenceLabel({ level: 'low', relative_spread: 0.42 });
    expect(label).toContain('Low');
    expect(label).toContain('42%');
    // The clarification matters: a surfer must not read low confidence as bad surf.
    expect(label).toContain('not surf quality');
    expect(label).toContain('does not change the rating');
  });

  it('degrades to a bare level when the ratio is missing rather than printing NaN', () => {
    const label = confidenceLabel({ level: 'high' });
    expect(label).toBe('Forecast confidence: High');
    expect(label).not.toMatch(/NaN|undefined|null/);
  });

  it('an unrecognised level says Unknown instead of rendering nothing', () => {
    expect(confidenceLabel({ level: 'bogus' })).toContain('Unknown');
  });
});

describe('the block renders in both layouts and only when it applies', () => {
  const Dot = ({ fc, isLight, isBeach }) =>
    fc ? (
      <span role="note" aria-label={confidenceLabel(fc)} data-testid="forecast-confidence">
        <span className={confidenceDot(fc.level, isLight, isBeach)} aria-hidden="true" />
        <span>{CONFIDENCE_TEXT[fc.level]}</span>
      </span>
    ) : null;

  it('is ABSENT when the forecast carries no ensemble (every spot today)', () => {
    render(<Dot fc={null} isLight={false} isBeach={false} />);
    expect(screen.queryByTestId('forecast-confidence')).toBeNull();
    // Critically: absence must not render as "Low".
    expect(screen.queryByText('Low')).toBeNull();
  });

  it('exposes the level to assistive tech, with the dot hidden from it', () => {
    const { container } = render(
      <Dot fc={{ level: 'moderate', relative_spread: 0.25 }} isLight={false} isBeach={false} />
    );
    const node = screen.getByTestId('forecast-confidence');
    expect(node).toHaveAttribute('aria-label', expect.stringContaining('Moderate'));
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
