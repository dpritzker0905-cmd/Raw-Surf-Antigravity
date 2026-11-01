import React from 'react';
import { Clock } from 'lucide-react';

/**
 * The infobox's frame words (audit 2026-10-27, P1-C/D): which frame and which hour its numbers come from, in the heatmap
 * status line's sentences (infoboxFrameTime.describeInfoboxFrame). A listitem of the overlay's card list whose accessible
 * name is the sentence itself (text, never colour alone); `view.wordsClass` carries the three themes.
 */
export function InfoboxFrameWords({ view }) {
  const words = view && view.words;
  if (!words || !words.text) return null;
  return (
    <div role="listitem" aria-label={words.text} data-testid="forecast-overlay-frame-words"
         className={`pt-1.5 mt-1.5 border-t text-[9px] font-semibold flex items-center gap-1.5 ${view.wordsClass || ''}`}>
      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">{words.text}</span>
    </div>
  );
}

export default InfoboxFrameWords;
