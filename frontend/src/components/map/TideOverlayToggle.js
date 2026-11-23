/**
 * TideOverlayToggle - the "Tides" button, beside Surf Rating in the desktop panel and the mobile sheet (owner 2026-11-15;
 * the collapsed mobile float carries neither). Independent of Surf Rating: both may be on. A real <button> with aria-pressed and a
 * text state (never colour alone). Hidden when the tier may not use it (LayerAccessResolver.canUseAddOn) or the kill
 * switch is set. Every mounted copy shares one state (useTideOverlayFlag).
 */
import React from 'react';
import { canUseAddOn } from './LayerAccessResolver';
import { tideOverlayDisabled } from './tideOverlayModel';
import { useTideOverlayFlag } from './useTideOverlay';

const SIZE = {
  sm: 'text-[9px] px-2 py-1',
  md: 'text-[10px] px-2.5 py-1.5',
  lg: 'text-[11px] px-3 py-2',
};

export default function TideOverlayToggle({ userTier, size = 'sm', isLight, isBeach, className = '' }) {
  const [on, toggle] = useTideOverlayFlag();
  if (tideOverlayDisabled() || !canUseAddOn(userTier, 'tide')) return null;
  const onClass = isLight ? 'bg-sky-600 text-white border-sky-500' : isBeach ? 'bg-amber-400 text-black border-amber-300' : 'bg-cyan-500 text-black border-cyan-400';
  const offClass = `${isLight ? 'text-gray-600' : isBeach ? 'text-cyan-200/80' : 'text-gray-400'} border-current opacity-70 hover:opacity-100`;
  return (
    <button type="button" onClick={toggle} aria-pressed={on} data-testid="tide-overlay-toggle"
            title="Tides: tide markers with modeled sea level at the visible surf spots for the selected forecast time (same tide as the spot infobox)"
            className={`leading-none rounded-full border whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-current ${SIZE[size] || SIZE.sm} ${on ? onClass : offClass} ${className}`}>
      {on ? 'Tides: ON' : 'Tides: OFF'}
    </button>
  );
}
