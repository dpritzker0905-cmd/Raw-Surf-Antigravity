/**
 * The raster-fallback disclosure. Its whole value is being SILENT in the normal case, so the
 * silence tests and the speaks-up test are equally load-bearing: a notice that is always on carries
 * as little information as a pass that is always on (the servedResolutionNotice rule).
 */
import { render, screen, act } from '@testing-library/react';
import { marineFallbackNotice, MarineFallbackRow, useMarineFallbackFieldState } from './marineFallbackNotice';

describe('marineFallbackNotice', () => {
  afterEach(() => { delete window.__RAW_LEGEND_FALLBACK_NOTICE__; });

  it('says NOTHING while the WebGL marine layer is healthy — the silence that gives it meaning', () => {
    expect(marineFallbackNotice(false, true)).toBeNull();
    expect(marineFallbackNotice(false, false)).toBeNull();
  });

  it('names the LOST BAND when Surf Rating is on — the thing the user can actually see missing', () => {
    const n = marineFallbackNotice(true, true);
    expect(n).not.toBeNull();
    expect(n.label).toMatch(/surf-rating band unavailable/i);
  });

  it('does not promise a band when Surf Rating is off, but still discloses the downgrade', () => {
    const n = marineFallbackNotice(true, false);
    expect(n.label).toMatch(/simplified wave layer/i);
    expect(n.label).not.toMatch(/rating band/i);
  });

  it('the tooltip states the SUBSTITUTION, not just "reduced graphics"', () => {
    // The defect was a user being shown wave HEIGHT while the legend said surf quality.
    // If this sentence ever loses that, the disclosure has stopped disclosing the thing that matters.
    const { title } = marineFallbackNotice(true, true);
    expect(title).toMatch(/height/i);
    expect(title).toMatch(/not surf quality/i);
    expect(title).toMatch(/retries/i);        // and that it is not permanent
  });

  it('says the picture is THIS APP\'S OWN forecast, never a third party\'s (exit row 12: the tiles are gone)', () => {
    for (const n of [marineFallbackNotice(true, true), marineFallbackNotice(true, false), marineFallbackNotice(true, true, { drawn: false, reason: 'no_grid' })]) {
      expect(`${n.label} ${n.title}`).not.toMatch(/third[- ]party|open-?meteo/i);
    }
    expect(marineFallbackNotice(true, false).title).toMatch(/this app's own wave HEIGHT forecast/);
  });

  it('says in TEXT that the rating band and the crests are not drawn on this device, whichever toggle is on', () => {
    expect(marineFallbackNotice(true, true).label).toMatch(/crests not drawn on this device/i);
    expect(marineFallbackNotice(true, false).label).toMatch(/crests not drawn on this device/i);
    for (const n of [marineFallbackNotice(true, true), marineFallbackNotice(true, false), marineFallbackNotice(true, false, { drawn: false, reason: 'killed' })]) {
      expect(n.title).toMatch(/surf-rating coastal band and the animated crests are not\s+drawn on this device/i);
    }
  });

  it('discloses the known limit: at world zoom the picture is not repeated across the date line', () => {
    expect(marineFallbackNotice(true, false).title).toMatch(/drawn once and is not repeated across the date line/i);
  });

  it('with NOTHING of ours to draw it says the layer is UNAVAILABLE, for every reason there is', () => {
    for (const reason of ['no_grid', 'rating_grid', 'killed', 'no_ocean', 'draw_failed']) {
      const n = marineFallbackNotice(true, true, { drawn: false, reason });
      expect(n.unavailable).toBe(true);
      expect(n.label).toMatch(/wave layer unavailable on this device/i);
      expect(n.label).not.toMatch(/simplified/i);
      expect(n.title).toMatch(/nothing is drawn/i);
    }
  });

  it('a drawn field, an unknown field state and an inactive layer all keep the "simplified" row', () => {
    for (const field of [{ drawn: true, reason: null }, null, undefined, { drawn: false, reason: 'inactive' }]) {
      const n = marineFallbackNotice(true, false, field);
      expect(n.unavailable).toBeUndefined();
      expect(n.label).toMatch(/simplified wave layer/i);
    }
  });

  it('still says nothing while the engine is healthy, whatever the field state says', () => {
    expect(marineFallbackNotice(false, true, { drawn: false, reason: 'no_grid' })).toBeNull();
  });

  it('kill switch silences it', () => {
    window.__RAW_LEGEND_FALLBACK_NOTICE__ = false;
    expect(marineFallbackNotice(true, true)).toBeNull();
  });
});

describe('MarineFallbackRow', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<MarineFallbackRow notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces itself to assistive tech and carries the meaning in TEXT, not colour', () => {
    const notice = marineFallbackNotice(true, true);
    render(<MarineFallbackRow notice={notice} className="text-white/60" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent(/surf-rating band unavailable/i);
    expect(el).toHaveAttribute('title', notice.title);
    // CLAUDE.md: colour comes from the caller's theme-aware class, so the row works in
    // light / dark / beach without knowing which one it is in.
    expect(el.className).toContain('text-white/60');
  });

  it('the UNAVAILABLE row is the same accessible text row, in each theme\'s own class', () => {
    const notice = marineFallbackNotice(true, false, { drawn: false, reason: 'no_grid' });
    for (const cls of ['text-white/60', 'text-slate-600', 'text-amber-900/70']) {   // dark, light, beach callers
      const { unmount } = render(<MarineFallbackRow notice={notice} className={cls} />);
      const el = screen.getByRole('status');
      expect(el).toHaveTextContent(/wave layer unavailable on this device/i);
      expect(el).toHaveAttribute('title', notice.title);
      expect(el.className).toContain(cls);
      unmount();
    }
  });
});

describe('useMarineFallbackFieldState', () => {
  afterEach(() => { delete window.__RAW_OWN_MARINE_FALLBACK__; });
  const Probe = () => { const s = useMarineFallbackFieldState(); return <span data-testid="s">{s ? `${s.drawn}:${s.reason}` : 'unknown'}</span>; };

  it('is unknown until the field layer publishes, reads the global at mount, and follows the event', () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('s')).toHaveTextContent('unknown');
    unmount();
    window.__RAW_OWN_MARINE_FALLBACK__ = { drawn: true, reason: null };
    render(<Probe />);
    expect(screen.getByTestId('s')).toHaveTextContent('true:null');
    act(() => { window.dispatchEvent(new CustomEvent('rawsurf:marine-fallback-field', { detail: { drawn: false, reason: 'no_grid' } })); });
    expect(screen.getByTestId('s')).toHaveTextContent('false:no_grid');
  });
});
