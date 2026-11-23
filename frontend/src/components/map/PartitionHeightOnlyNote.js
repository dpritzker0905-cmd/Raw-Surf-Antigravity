import React from 'react';

/**
 * The legend line that replaces the Surf Rating key over a PARTITION layer (Swell 1, Swell 2, Wind Waves) while Rating is on:
 * that layer shows its own height, never a surf rating (partitionHeightOnly.js, bug hunt 2026-11-22 D). The rating lives on the
 * Waves (total sea) layer, the spot glyphs and the spot pages. Theme-aware through the caller's text class (light, dark, beach);
 * a plain-text note, so screen readers hear it in place (role="note" with a full aria-label).
 */
export const PARTITION_NOTE_TEXT = 'Height only, no surf rating';
export const PARTITION_NOTE_HINT = 'Surf rating: Waves layer and spots';
export const PARTITION_NOTE_ARIA = 'This layer shows wave height only, with no surf rating. '
  + 'The surf rating is shown on the Waves layer and on the surf spots.';

export function PartitionHeightOnlyNote({ className = '' }) {
  return (
    <div role="note" aria-label={PARTITION_NOTE_ARIA} data-testid="partition-height-only-note" className={`mb-1.5 ${className}`}>
      <div className="font-semibold">{PARTITION_NOTE_TEXT}</div>
      <div className="opacity-80">{PARTITION_NOTE_HINT}</div>
    </div>
  );
}
