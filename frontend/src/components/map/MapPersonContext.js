import React, { useEffect, useRef, useState } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { Link } from 'react-router-dom';
import { useThemeName } from '../../contexts/ThemeContext';
import { mapChromeTheme } from './mapChromeTheme';

/** Feature context gestures are independent of normal click and map-coordinate gestures. */
export function useExplorePinContext(enabled) {
  const [person, setPerson] = useState(null);
  const gesture = useRef({ timer: null, held: false, x: 0, y: 0 });
  const trigger = useRef(null);
  const lastFocused = useRef(null);
  const cancel = () => { clearTimeout(gesture.current.timer); gesture.current.timer = null; };
  useEffect(() => {
    if (!enabled) { cancel(); gesture.current.held = false; setPerson(null); }
    const secondTouch = event => { if (event.pointerType === 'touch' && event.isPrimary === false) cancel(); };
    const rememberFocus = event => { lastFocused.current = event.target; };
    const forgetFocus = event => { if (!event.relatedTarget) lastFocused.current = null; };
    const outsidePointer = event => { if (!event.target.closest?.('.weather-person-card')) lastFocused.current = null; };
    document.addEventListener('focusin', rememberFocus);
    document.addEventListener('focusout', forgetFocus);
    document.addEventListener('pointerdown', outsidePointer);
    document.addEventListener('pointerdown', secondTouch);
    return () => { cancel(); document.removeEventListener('focusin', rememberFocus); document.removeEventListener('focusout', forgetFocus); document.removeEventListener('pointerdown', outsidePointer); document.removeEventListener('pointerdown', secondTouch); };
  }, [enabled]);
  const open = (event, value, kind) => { trigger.current = event.currentTarget; setPerson({ value, kind }); };
  const handlers = (value, kind) => enabled == null ? {} : ({
    onContextMenuCapture: event => {
      event.preventDefault(); event.stopPropagation(); cancel();
      if (enabled) open(event, value, kind);
    },
    onKeyDown: event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation();
      if (enabled) open(event, value, kind);
    },
    onPointerDown: event => {
      cancel(); gesture.current.held = false;
      if (!enabled || event.pointerType !== 'touch' || event.isPrimary === false) return;
      const target = event.currentTarget;
      gesture.current.x = event.clientX; gesture.current.y = event.clientY;
      gesture.current.timer = setTimeout(() => { gesture.current.held = true; trigger.current = target; setPerson({ value, kind }); }, 500);
    },
    onPointerMove: event => { if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 8) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: () => { cancel(); gesture.current.held = false; },
    onClickCapture: event => { if (gesture.current.held) { gesture.current.held = false; if (event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } } },
  });
  return { person: enabled ? person : null, handlers, close: (restoreFocus = false) => { setPerson(null); if (restoreFocus === true || restoreFocus === 'if-focused' && lastFocused.current?.closest('.weather-person-card')) { const target = trigger.current; if (target?.isConnected) target.focus(); else document.querySelector('.weather-explorer-toggle')?.focus(); } } };
}

export function MapPersonContextCard({ person, onClose, onPhotographerClick }) {
  const c = mapChromeTheme(useThemeName());
  const closeButton = useRef(null);
  const card = useRef(null);
  const identity = person ? `${person.kind}:${person.value.id}` : '';
  useEffect(() => { closeButton.current?.focus(); }, [identity]);
  useEffect(() => {
    if (!person) return;
    const escape = event => {
      if (event.key === 'Escape' && card.current?.contains(event.target)) { event.preventDefault(); event.stopPropagation(); onClose(true); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [person, onClose]);
  if (!person) return null;
  const { value, kind } = person;
  return <Popup longitude={Number(value.longitude)} latitude={Number(value.latitude)} closeButton={false} closeOnClick={false} maxWidth="240px" className="weather-person-popup" onClose={() => onClose(false)}>
    <section ref={card} aria-label={`${kind === 'friend' ? 'Friend' : 'Photographer'} details`} className={`weather-person-card rounded-xl border shadow-xl p-3 ${c.surface} ${c.surfaceText}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className={`text-xs ${c.mutedText}`}>{kind === 'friend' ? 'Friend' : 'Photographer'}</p><h2 className="font-semibold break-words">{value.full_name || (kind === 'friend' ? 'Friend' : 'Photographer')}</h2></div>
        <button type="button" ref={closeButton} aria-label="Close person details" className={`rounded-lg ${c.iconButton}`} onClick={() => onClose(true)}>×</button>
      </div>
      {value.current_spot_name && <p className={`text-sm break-words ${c.mutedText}`}>{value.current_spot_name}</p>}
      <div className="flex flex-wrap gap-2 mt-2">
        {value.id && <Link className={`text-sm rounded-lg px-2 flex items-center ${c.chipIdle}`} to={`/profile/${encodeURIComponent(value.id)}`}>View profile</Link>}
        {kind === 'photographer' && <button type="button" className={`text-sm rounded-lg px-2 ${c.chipIdle}`} onClick={() => { onClose(false); onPhotographerClick?.(value); }}>View session</button>}
      </div>
    </section>
  </Popup>;
}
