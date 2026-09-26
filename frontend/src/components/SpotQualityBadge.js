import React from 'react';
import { RATING_LABEL, RATING_COLOR } from './map/surfRating';

/**
 * Surf QUALITY on the spot hub (audit 15.0, 2026-09-26).
 *
 * The backend has computed a rating for the hub on every request (a wind sample plus
 * `compute_surf_rating`, the same engine as the map glyphs) since July, and the route dropped it, so
 * the hub showed a size and never a quality: "a size without a quality is also incomplete"
 * (CLAUDE.md). A blown-out 6 ft and a groomed 6 ft rendered identically.
 *
 * Same vocabulary and palette as the map card's Rating badge (RATING_LABEL / RATING_COLOR), so the
 * two surfaces read the same. Accessibility: the level is a WORD and the aria-label carries the
 * whole sentence; the coloured dot is decorative. Absent when the rating did not run: an unknown
 * quality is not rendered as a bad one.
 */
export const qualityLabel = (current) => {
  const level = current?.rating_level;
  if (!level || level === 'unknown' || !Number.isFinite(current?.rating)) return null;
  return `Surf quality: ${RATING_LABEL[level] || level}, ${Math.round(current.rating)} out of 100`;
};

export const SpotQualityBadge = ({ current, compact = false, textClass = '', mutedClass = '', cellBg = '' }) => {
  const aria = qualityLabel(current);
  if (!aria) return null;
  const level = current.rating_level;
  const word = RATING_LABEL[level] || level;
  const dot = (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: RATING_COLOR[level] || RATING_COLOR.unknown }}
      aria-hidden="true"
    />
  );
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1" role="note" aria-label={aria} data-testid="spot-quality-compact">
        {dot}
        <span className={`text-[10px] ${textClass}`}>{word}</span>
      </span>
    );
  }
  return (
    <div className={`${cellBg} rounded-lg p-3 col-span-2 flex items-center gap-2`} role="note" aria-label={aria}
      data-testid="spot-quality">
      {dot}
      <p className={`text-sm font-medium ${textClass}`}>
        Surf quality: <span data-testid="spot-quality-level">{word}</span>
      </p>
      <span className={`ml-auto text-xs ${mutedClass}`}>{Math.round(current.rating)}/100</span>
    </div>
  );
};

export default SpotQualityBadge;
