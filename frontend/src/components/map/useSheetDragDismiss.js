import { useCallback, useEffect, useRef, useState } from 'react';

/** One close path for the grabber, X, backdrop and Escape; only pointer-up completes a drag. */
export default function useSheetDragDismiss(sheetRef, onClose) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimer = useRef(null);
  const latestClose = useRef(onClose);
  const gesture = useRef({ active: false, startY: 0, startTime: 0, offset: 0, pointerId: null });
  const suppressClick = useRef(false);
  useEffect(() => { latestClose.current = onClose; }, [onClose]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const requestClose = useCallback(() => {
    if (closingRef.current || !latestClose.current) return;
    closingRef.current = true;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.dataset.sheetDragging = 'false';
      const map = sheet.closest('[data-responsive-weather], [data-testid="map-page-container"]');
      const opener = map?.querySelector('[data-testid="weather-layers-btn"]');
      if (opener?.isConnected && !opener.closest('[inert]') && getComputedStyle(opener).display !== 'none') opener.focus({ preventScroll: true });
    }
    setClosing(true);
    const legacy = sheet?.closest('[data-responsive-weather]')?.dataset.responsiveWeather !== 'true';
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    closeTimer.current = setTimeout(() => { closeTimer.current = null; latestClose.current?.(); }, reduced || legacy ? 0 : 180);
  }, [sheetRef]);

  const resetDrag = useCallback(() => {
    gesture.current.active = false;
    if (sheetRef.current) {
      sheetRef.current.dataset.sheetDragging = 'false';
      sheetRef.current.style.setProperty('--weather-sheet-drag', '0px');
    }
  }, [sheetRef]);
  useEffect(() => {
    const secondaryTouch = event => {
      if (gesture.current.active && event.pointerType === 'touch' && event.isPrimary === false) { suppressClick.current = true; resetDrag(); }
    };
    document.addEventListener('pointerdown', secondaryTouch);
    return () => document.removeEventListener('pointerdown', secondaryTouch);
  }, [resetDrag]);
  const releaseCapture = event => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleProps = {
    onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false; },
    onPointerDown: event => {
      if (closingRef.current || event.button > 0) return;
      const s = gesture.current;
      if (s.active && s.pointerId !== event.pointerId) { resetDrag(); suppressClick.current = true; return; }
      if (event.isPrimary === false) return;
      Object.assign(s, { active: true, startY: event.clientY, startTime: Date.now(), offset: 0, pointerId: event.pointerId });
      suppressClick.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (sheetRef.current) sheetRef.current.dataset.sheetDragging = 'true';
      event.stopPropagation();
    },
    onPointerMove: event => {
      const s = gesture.current;
      if (!s.active || event.pointerId !== s.pointerId) return;
      s.offset = Math.max(0, event.clientY - s.startY);
      sheetRef.current?.style.setProperty('--weather-sheet-drag', `${s.offset}px`);
    },
    onPointerUp: event => {
      const s = gesture.current;
      if (!s.active || event.pointerId !== s.pointerId) return;
      s.offset = Math.max(0, event.clientY - s.startY);
      s.active = false;
      releaseCapture(event);
      suppressClick.current = Math.abs(event.clientY - s.startY) > 8;
      const threshold = Math.min(96, Math.max(48, (sheetRef.current?.getBoundingClientRect().height || 0) * .15));
      const velocity = s.offset / Math.max(1, Date.now() - s.startTime);
      if (s.offset >= threshold || (s.offset > 24 && velocity > .45)) requestClose();
      else resetDrag();
    },
    onPointerCancel: event => { releaseCapture(event); suppressClick.current = true; resetDrag(); },
    onLostPointerCapture: () => { if (gesture.current.active) { suppressClick.current = true; resetDrag(); } },
    onClick: event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } requestClose(); },
  };
  return { closing, requestClose, handleProps };
}
