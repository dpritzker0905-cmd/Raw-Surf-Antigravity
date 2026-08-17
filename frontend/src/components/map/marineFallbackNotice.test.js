/**
 * The raster-fallback disclosure. Its whole value is being SILENT in the normal case, so the
 * silence tests and the speaks-up test are equally load-bearing: a notice that is always on carries
 * as little information as a pass that is always on (the servedResolutionNotice rule).
 */
import { render, screen } from '@testing-library/react';
import { marineFallbackNotice, MarineFallbackRow } from './marineFallbackNotice';

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
    // The defect was a user being shown third-party wave HEIGHT while the legend said surf quality.
    // If this sentence ever loses that, the disclosure has stopped disclosing the thing that matters.
    const { title } = marineFallbackNotice(true, true);
    expect(title).toMatch(/height/i);
    expect(title).toMatch(/third-party/i);
    expect(title).toMatch(/retries/i);        // and that it is not permanent
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
});
