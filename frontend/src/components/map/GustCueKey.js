/**
 * GUST CUE KEY: the Gusts legend's line that says what the non-colour gustiness cue means (ACCESSIBILITY mandate: never
 * colour alone; the cue must be explained in text, not only drawn). It follows the A/B lever (windGustColour.gustCue):
 * 'flicker' | 'width' | 'hatch' | 'none'. The swatch is drawn in currentColor, so it takes the legend's theme-aware text
 * colour in dark, light and beach; the whole line carries one accessible sentence.
 */
import React from 'react';
import { gustCue } from './windGustColour';
import { GUST_HATCH } from './gustHatch';

function reducedMotion() {
  try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

/** The key's content for a cue (pure; exported for tests). null = nothing to explain. */
export function gustCueKeyText(cue, reduced = false) {
  const g1 = GUST_HATCH.gusty; const g2 = GUST_HATCH.veryGusty;
  if (cue === 'flicker') {
    return reduced
      ? { text: 'Gustiness pulse off (reduced motion)', label: 'Gustiness is not shown: the pulse that marks gusty air is off because reduced motion is on.' }
      : { text: 'Pulsing marks: gusty air', label: 'Marks that pulse in brightness are in gusty air: gusts at least 1.3 times the mean wind.' };
  }
  if (cue === 'width') {
    return { text: `Wide marks: gusts ≥ ${g1}× wind`, label: `Wider marks are in gusty air: gusts at least ${g1} times the mean wind, widest at ${g2} times.` };
  }
  if (cue === 'hatch') {
    return { text: `Hatched ≥ ${g1}× wind · crossed ≥ ${g2}×`,
      label: `Hatched areas are gusty: gusts at least ${g1} times the mean wind. Cross-hatched areas are very gusty: at least ${g2} times.` };
  }
  return null;
}

function Swatch({ cue }) {
  const common = { width: 22, height: 9, viewBox: '0 0 22 9', 'aria-hidden': true, focusable: 'false', className: 'shrink-0' };
  if (cue === 'width') {
    return (<svg {...common}><line x1="1" y1="2" x2="9" y2="2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="12" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>);
  }
  if (cue === 'hatch') {
    return (<svg {...common}><rect x="0.5" y="0.5" width="9" height="8" fill="none" stroke="currentColor" strokeOpacity="0.5" />
      <path d="M0.5 6.5 L6.5 0.5 M3.5 8.5 L9.5 2.5" stroke="currentColor" strokeWidth="1" />
      <rect x="12.5" y="0.5" width="9" height="8" fill="none" stroke="currentColor" strokeOpacity="0.5" />
      <path d="M12.5 6.5 L18.5 0.5 M15.5 8.5 L21.5 2.5 M12.5 2.5 L18.5 8.5 M15.5 0.5 L21.5 6.5" stroke="currentColor" strokeWidth="1" /></svg>);
  }
  // flicker: a dash and a fainter dash (the pulse's two ends)
  return (<svg {...common}><line x1="1" y1="4.5" x2="9" y2="4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="13" y1="4.5" x2="21" y2="4.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" /></svg>);
}

export default function GustCueKey({ className = '' }) {
  const cue = gustCue();
  const k = gustCueKeyText(cue, reducedMotion());
  if (!k) return null;
  return (
    <div role="note" aria-label={k.label} data-gust-cue={cue} className={`flex items-center gap-1 ${className}`}>
      <Swatch cue={cue} /><span aria-hidden="true">{k.text}</span>
    </div>
  );
}
