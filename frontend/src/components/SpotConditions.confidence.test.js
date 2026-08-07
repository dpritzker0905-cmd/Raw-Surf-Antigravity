/**
 * FORECAST CONFIDENCE ON THE SPOT HUB — three themes, both layouts, no colour-only meaning.
 *
 * ⚠️⚠️ WHAT THIS FILE USED TO BE, AND WHY IT WAS WORTHLESS (MASTER-AUDIT-10.0 §1.6, row F).
 * It imported nothing from `SpotConditions.js`. It re-declared its own `CONFIDENCE_TEXT`,
 * `confidenceDot` and `confidenceLabel`, and its "render" tests rendered a LOCAL `<Dot>`
 * re-implementation. Every assertion passed against a COPY. Deleting the entire confidence block
 * from the shipped component would have left this suite green — and the audit's absence check
 * (`git ls-files frontend/src | grep test | xargs grep -ln SpotConditions`) returned nothing, so no
 * frontend test anywhere bound to the real component.
 *
 * ★ THE FIX IS THE IMPORT. The helpers are now exported from the component and imported here, and
 * the render tests mount the REAL `<SpotConditions>` with a mocked API client. A test that
 * re-implements its subject measures the test author, not the code.
 *
 * The three mandates this block has to satisfy, each with a recorded failure behind it:
 *
 *   THREE THEMES / ALL DEVICES — light, dark AND beach, and a component with separate layouts must
 *   carry the change in BOTH. Asserted through the mounted component, per layout, per theme.
 *
 *   ACCESSIBILITY — information is NEVER conveyed by colour alone. The LEVEL WORD carries the
 *   signal; the dot is decorative and aria-hidden; the aria-label carries the whole sentence.
 *
 *   ABSENT MEANS NO ENSEMBLE, NOT LOW CONFIDENCE. A deterministic forecast has no spread. If
 *   absence rendered as "Low" the UI would libel every forecast that carries no ensemble.
 *   ⚠️ CORRECTED 2026-08-07: this file used to say that was "ALL of them, since ECMWF_WAVE_ENSEMBLE
 *   is default off". The flag has been ON since `b648098d` and the spread reaches ~15% of sampled
 *   EURO spots, so absence is now the MAJORITY case rather than the only case.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { getThemeTokens } from '../utils/themeTokens';

// ⭐ THE WHOLE POINT OF THE FILE: bind to the shipped component, not to a copy of it.
import SpotConditions, {
  CONFIDENCE_TEXT,
  confidenceDot,
  confidenceLabel,
} from './SpotConditions';

let mockTheme = 'dark';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import apiClient from '../lib/apiClient';

const FC_MODERATE = { level: 'moderate', spread_m: 0.31, relative_spread: 0.25, calibrated: false };

/** Route the component's four fetches; `forecast_confidence` is what varies. */
function mockApi(forecastConfidence) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/conditions/')) {
      return Promise.resolve({
        data: {
          current: {
            wave_height_ft: 4.2,
            wave_period: 12,
            wind_speed: 8,
            wind_direction: 290,
            ...(forecastConfidence ? { forecast_confidence: forecastConfidence } : {}),
          },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  mockTheme = 'dark';
  jest.clearAllMocks();
});

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

// ── THROUGH THE REAL COMPONENT ───────────────────────────────────────────────────────────────────
// Everything above still exercises helpers in isolation; a helper can be perfect and never be
// called. These mount the shipped component, so deleting the block fails them.

describe('the shipped component renders the block in both layouts', () => {
  it('EXPANDED: renders the level word, the sentence, and hides the dot from assistive tech',
    async () => {
      mockApi(FC_MODERATE);
      render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
      const node = await screen.findByTestId('forecast-confidence');
      expect(node).toHaveAttribute('aria-label', confidenceLabel(FC_MODERATE));
      expect(within(node).getByTestId('forecast-confidence-level')).toHaveTextContent('Moderate');
      expect(node.querySelector('[aria-hidden="true"]')).toBeTruthy();
      // `calibrated: false` is stated, not hidden — it is legibility, not validated skill.
      expect(node).toHaveTextContent('uncalibrated');
    });

  it('COMPACT: the sibling layout carries the SAME signal', async () => {
    mockApi(FC_MODERATE);
    render(<SpotConditions spotId="spot-1" spotName="Peniche" compact />);
    const node = await screen.findByTestId('forecast-confidence-compact');
    expect(node).toHaveAttribute('aria-label', confidenceLabel(FC_MODERATE));
    // The dot alone would be colour-only meaning; sr-only text is what makes it accessible.
    expect(node).toHaveTextContent('Moderate');
    expect(node.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('ABSENT means no ensemble — the block does not render, and never says "Low"', async () => {
    mockApi(null);
    render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
    // ⭐ THE ANCHOR IS THE CONTROL. "Swell" sits inside the same `{current ? ...}` grid as the
    // confidence block and immediately before it, so its presence proves the grid rendered and the
    // block WOULD have appeared had the payload carried one. Waiting on something outside that
    // gate would make this assertion pass even if the component had failed to render at all.
    await screen.findByText('Swell');
    expect(screen.queryByTestId('forecast-confidence')).toBeNull();
    expect(screen.queryByText('Low')).toBeNull();
  });

  it('...and the SAME anchor shows the block WITH an ensemble — the paired positive', async () => {
    mockApi(FC_MODERATE);
    render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
    await screen.findByText('Swell');
    expect(screen.queryByTestId('forecast-confidence')).not.toBeNull();
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['beach', 'beach'],
  ])('THREE THEMES: %s produces its own dot class through the component', async (theme) => {
    mockTheme = theme;
    mockApi(FC_MODERATE);
    const { unmount } = render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
    const node = await screen.findByTestId('forecast-confidence');
    const dot = node.querySelector('[aria-hidden="true"]');
    const t = getThemeTokens(theme);
    expect(dot.className).toContain(confidenceDot(FC_MODERATE.level, t.isLight, t.isBeach));
    unmount();
  });

  it('the three themes are MUTUALLY DISTINCT as actually rendered, not just as computed',
    async () => {
      const seen = [];
      for (const theme of ['light', 'dark', 'beach']) {
        mockTheme = theme;
        mockApi(FC_MODERATE);
        const { unmount } = render(<SpotConditions spotId="spot-1" spotName="Peniche" />);
        const node = await screen.findByTestId('forecast-confidence');
        seen.push(node.querySelector('[aria-hidden="true"]').className);
        unmount();
      }
      // ⭐ This is the assertion the old file could not make: it compared a helper against itself.
      expect(new Set(seen).size).toBe(3);
    });
});
