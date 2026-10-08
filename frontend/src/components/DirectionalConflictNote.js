import React from 'react';

export default function DirectionalConflictNote({ conflict, textClass = '' }) {
  if (!['swell_aimed_away', 'size_and_quality_disagree_on_swell_exposure'].includes(conflict?.reason)) return null;
  const text = conflict.reason === 'swell_aimed_away'
    ? 'Bulk swell is aimed away from this coast. Indirect waves are not included in this estimate.'
    : 'Off-angle swell: the breaking-height estimate may be too high. Treat it as an upper bound.';
  return (
    <p role="note" aria-label="Swell direction warning" className={`text-xs ${textClass}`}>
      {text}
    </p>
  );
}
