import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const focusVisible = node => {
  node?.focus({ preventScroll: true });
  node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
};

/** Preserve user-requested focus across replacement desktop disclosure buttons. */
export function useWeatherPanelDisclosure(isImmersive = false) {
  const [requestedCollapsed, setRequestedCollapsed] = useState(false);
  const [immersiveExpanded, setImmersiveExpanded] = useState(false);
  const isCollapsed = requestedCollapsed || (isImmersive && !immersiveExpanded);
  const toggleRef = useRef(null);
  useLayoutEffect(() => { setImmersiveExpanded(false); }, [isImmersive]);
  const focusRequested = useRef(false);
  useLayoutEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    focusVisible(toggleRef.current);
  }, [isCollapsed]);
  const togglePanel = collapsed => {
    focusRequested.current = true;
    setRequestedCollapsed(collapsed);
    setImmersiveExpanded(isImmersive && !collapsed);
  };
  return [isCollapsed, toggleRef, togglePanel];
}

/** Non-modal layer panel: move focus in/out, without trapping page navigation. */
export default function WeatherLayerSheet({ onClose, children, ...props }) {
  const sheetRef = useRef(null);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    const map = sheet.closest('[data-responsive-weather], [data-testid="map-page-container"]');
    const opener = map?.querySelector('[data-testid="weather-layers-btn"]');
    const visible = () => getComputedStyle(sheet).display !== 'none'
      && getComputedStyle(sheet).visibility !== 'hidden';
    const focusFirst = () => focusVisible(sheet.querySelector('button'));
    let lastFocused = document.activeElement;
    const rememberFocus = event => { lastFocused = event.target; };
    document.addEventListener('focusin', rememberFocus);
    let wasVisible = visible();
    if (wasVisible) focusFirst();
    const onResize = () => {
      const isVisible = visible();
      if (isVisible === wasVisible) return;
      wasVisible = isVisible;
      // Chrome can blur a CSS-hidden control before dispatching resize.
      const focused = document.activeElement === document.body ? lastFocused : document.activeElement;
      const desktop = map?.querySelector('.weather-desktop-panel');
      const desktopTimeline = map?.querySelector('.weather-desktop-timeline');
      if (!isVisible && (sheet.contains(focused) || focused === document.body)) {
        const target = focused?.matches('[role="slider"]')
          ? desktopTimeline?.querySelector('[role="slider"]')
          : (desktop?.matches('button') ? desktop : desktop?.querySelector('button'));
        focusVisible(target);
      } else if (isVisible && (desktop?.contains(focused) || desktopTimeline?.contains(focused) || focused === document.body)) {
        if (desktopTimeline?.contains(focused)) focusVisible(sheet.querySelector('[role="slider"]'));
        else focusFirst();
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('focusin', rememberFocus);
      if (opener?.isConnected && getComputedStyle(opener).display !== 'none'
        && (sheet.contains(document.activeElement) || document.activeElement === document.body)) {
        focusVisible(opener);
      }
    };
  }, []);
  return <div {...props} ref={sheetRef} role="presentation" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && onClose) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }}>{children}</div>;
}
