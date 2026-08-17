import { servedResolutionNotice, ServedResolutionRow } from './servedResolutionNotice';
import { marineFallbackNotice, MarineFallbackRow, useMarineFallbackState } from './marineFallbackNotice';
import React from 'react';

/**
 * legendTicks.js — put a legend's NUMBERS where its COLOURS are (2026-08-09, report R11-11 item 3).
 *
 * THE DEFECT. `buildGradientCSS` places each colour stop at its VALUE position along the bar
 * (`(bp[i] - min) / range`), because that is what the raster actually does — the legend has to
 * describe the pixel mapping or it is decoration. The labels underneath were laid out with
 * `flex justify-between`, i.e. EVENLY. Those two agree only when the breakpoints are uniformly
 * spaced, and none of the rendered scales are. Measured before the fix, worst label-vs-colour
 * offset as a fraction of bar width:
 *
 *     rain        47.1 pp   ("6" sits at 57.1% of the bar; 6 mm/h is coloured at 10.0%)
 *     waves       20.0 pp   (also swell_1, swell_2, wind_waves — same shape)
 *     pressure    18.1 pp
 *
 * A user reading the rain legend mid-bar was off by roughly a factor of six.
 *
 * ⚠️ THE FIX HAS A TRAP, WHICH IS WHY THIS IS A MODULE AND NOT A ONE-LINE STYLE CHANGE. Moving the
 * labels to their true positions makes clustered breakpoints COLLIDE: pressure's 1005/1009/1013 land
 * within ~11 pp of each other, and at ~8px type in a ~220px bar their text overlaps into mush. A
 * legend that is precisely positioned and unreadable is not an improvement over one that is
 * readable and wrong. So ticks are dropped when they would collide — first and last always kept,
 * because the ends are the scale's anchors.
 */

/** Value-proportional tick positions, identical in formula to buildGradientCSS's colour stops.
 *  Returns [{label, pct}] with pct in 0..100. `format(value, index, isLast)` renders the text. */
export function valueTicks(breakpoints, format) {
  if (!Array.isArray(breakpoints) || breakpoints.length === 0) return [];
  const min = breakpoints[0];
  const range = breakpoints[breakpoints.length - 1] - min || 1;
  return breakpoints.map((bp, i) => ({
    label: format ? format(bp, i, i === breakpoints.length - 1) : String(bp),
    pct: ((bp - min) / range) * 100,
  }));
}

/** Evenly spaced ticks — for legends whose gradient is hand-authored WITHOUT percentages, which CSS
 *  then distributes evenly. Their labels were always correct; this keeps them that way explicitly
 *  rather than by accident, so the two kinds of legend render through one path. */
export function evenTicks(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return [];
  if (labels.length === 1) return [{ label: labels[0], pct: 0 }];
  return labels.map((label, i) => ({ label, pct: (i / (labels.length - 1)) * 100 }));
}

/**
 * Drop ticks that would overlap, keeping the FIRST and LAST (the scale's anchors).
 *
 * `minGapPct` is the smallest gap, in percent of bar width, that two labels can sit at and still be
 * readable. Greedy left-to-right, then the last tick is forced in — evicting the previously kept
 * one if that is what it takes, since a missing endpoint mislabels the whole scale.
 */
export function dropCollisions(ticks, minGapPct = 12) {
  if (!Array.isArray(ticks) || ticks.length <= 2) return ticks || [];
  const kept = [ticks[0]];
  for (let i = 1; i < ticks.length - 1; i++) {
    if (ticks[i].pct - kept[kept.length - 1].pct >= minGapPct) kept.push(ticks[i]);
  }
  const last = ticks[ticks.length - 1];
  while (kept.length > 1 && last.pct - kept[kept.length - 1].pct < minGapPct) kept.pop();
  kept.push(last);
  return kept;
}

/** CSS transform that keeps a tick's text inside the bar: the ends align to their edge, the rest
 *  centre on their value. Without this the 0 label hangs half off the left edge. */
export function tickTransform(pct) {
  if (pct <= 0.01) return 'translateX(0)';
  if (pct >= 99.99) return 'translateX(-100%)';
  return 'translateX(-50%)';
}

/** The tick row under a legend bar. Absolute positions, because the colours are at value
 *  positions; `justify-between` here is what put rain's "6" 47 pp from its own colour.
 *  `pct` is measured on the SAME axis as the bar above it, so the container must be the bar's
 *  width with no horizontal padding, or every tick inherits the padding as an offset. */
// `showResolution` is OPT-IN and belongs here rather than at the three call sites: every layout
// renders LegendTicks directly under its gradient, so this is the one seam that reaches the
// desktop panel, the collapsed mobile float and the expanded mobile sheet at once — and it keeps
// MapWeatherControls (grandfathered over the 800-LOC ratchet, shrink-only) from growing at all.
// Opt-in because the surf-RATING band renders its own LegendTicks; the grid coarseness belongs to
// the data layer's key, not to the rating key, and showing it twice would be noise.
// The raster-fallback disclosure rides the SAME opt-in as the resolution notice, for the same
// reason: it is a fact about the DATA LAYER, so it belongs on the data layer's key and would be
// noise repeated under the rating key. Riding `showResolution` also makes it appear exactly once
// across all three layouts. It stays silent unless the fallback is actually engaged.
export function LegendTicks({ ticks, className, showResolution = false }) {
  // Hooks must run before any early return, or the hook order changes with `ticks` (React rule).
  const marineFailed = useMarineFallbackState();
  const ratingOn = typeof window !== 'undefined'
    && (window.__SURF_MODE__ === true
      || (window.__SURF_MODE__ === undefined && typeof window.localStorage !== 'undefined'
          && window.localStorage.getItem('__SURF_MODE__') === 'true'));
  if (!Array.isArray(ticks) || ticks.length === 0) return null;
  const d = (showResolution && typeof window !== 'undefined' && window.__MARINE_PROJECTION_DIAG__) || null;
  const notice = d ? servedResolutionNotice(d.resolution, d.resolutionSource) : null;
  const fallback = showResolution ? marineFallbackNotice(marineFailed, ratingOn) : null;
  return (
    <>
    <div className={`relative w-full ${className || ''}`} style={{ height: '0.85rem' }}>
      {ticks.map((t, i) => (
        <span
          key={i}
          className="absolute top-0 whitespace-nowrap"
          style={{ left: `${t.pct}%`, transform: tickTransform(t.pct) }}
        >
          {t.label}
        </span>
      ))}
    </div>
    <ServedResolutionRow notice={notice} className={className} />
    <MarineFallbackRow notice={fallback} className={className} />
    </>
  );
}
