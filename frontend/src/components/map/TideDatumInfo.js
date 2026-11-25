/**
 * TideDatumInfo.js - the ONE per-location tide datum info tip (owner decision B, 2026-11-25).
 *
 * The visible tide line is a plain number ("Tide 1.2 ft, rising"); what zero means here (MLLW in the US, local mean sea
 * level elsewhere), the minus-tide note and the cross-border note are said ONCE per location, here. A real <button> with
 * aria-expanded / aria-controls; Enter and Space toggle it (native button), Escape closes it and returns focus to the
 * button. Theme-aware (light, dark, beach) through the caller's isLight / isBeach, like TideReadout.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { datumLegendText, datumTipLabel } from './tideDatum';

export default function TideDatumInfo({ datum, isLight, isBeach }) {
  const [open, setOpen] = useState(false);
  const panelId = `tide-datum-tip-${useId().replace(/:/g, '')}`;
  const btn = useRef(null);
  const tip = useRef(null);
  // The visual pass (2026-11-25): on a phone the MLLW text (~270 px) is taller than the infobox's scroll window
  // (~238 px). The panel is capped and scrolls itself (focusable, so a keyboard can scroll it), and opening it brings
  // it into view inside the card.
  useEffect(() => {
    if (open && tip.current && typeof tip.current.scrollIntoView === 'function') tip.current.scrollIntoView({ block: 'nearest' });
  }, [open]);
  const muted = isLight ? 'text-gray-600' : isBeach ? 'text-cyan-200/80' : 'text-gray-400';
  const panel = isLight ? 'bg-white border-gray-200 text-gray-800'
    : isBeach ? 'bg-black/85 border-cyan-900/60 text-cyan-50' : 'bg-zinc-900 border-zinc-700 text-gray-200';
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      if (btn.current) btn.current.focus();
    }
  };
  return (
    <span className="inline-flex flex-col" onKeyDown={onKeyDown}>
      <button
        ref={btn}
        type="button"
        data-testid="tide-datum"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`text-[9px] underline decoration-dotted underline-offset-2 rounded-sm min-h-[24px] px-0.5 ${muted} focus-visible:outline focus-visible:outline-2 focus-visible:outline-current`}
      >
        <span aria-hidden="true">ⓘ </span>{datumTipLabel(datum)}
      </button>
      <span id={panelId} ref={tip} role="note" aria-label="About the tide zero" tabIndex={open ? 0 : -1} data-testid="tide-datum-tip"
            hidden={!open}
            className={`mt-0.5 max-w-[220px] max-h-[160px] overflow-y-auto whitespace-normal rounded-md border px-1.5 py-1 text-[10px] leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-current ${open ? 'block' : ''} ${panel}`}>
        {datumLegendText(datum)}
      </span>
    </span>
  );
}
