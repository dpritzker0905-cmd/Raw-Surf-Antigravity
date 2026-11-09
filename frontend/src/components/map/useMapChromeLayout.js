import { useLayoutEffect, useRef } from 'react';

// Display-only rollout. Set before mounting MapPage to restore the previous layout.
export const responsiveWeatherOn = () => typeof window === 'undefined' || window.__RAW_DISABLE_RESPONSIVE_WEATHER__ !== true;
export const showPointTide = layer => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(layer);

/** Measure occupied chrome rather than guessing card offsets from viewport width.
 * CSS handles placement; this never changes map, selection, playback, or forecast state.
 */
export function useMapChromeLayout(rootRef) {
  const lastLayout = useRef(null);
  const subscription = useRef(null);
  // Reconcile late-mounted/replaced chrome after each commit without rebuilding observers for ordinary renders.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const enabled = root && responsiveWeatherOn() && typeof ResizeObserver !== 'undefined';
    const top = enabled ? root.querySelector('.top-rail-container') : null;
    const timelines = enabled ? [...root.querySelectorAll('[data-weather-timeline]')] : [];
    const immersiveMode = root?.classList.contains('immersive');
    const prior = subscription.current;
    if (prior && enabled && prior.root === root && prior.top === top && prior.immersiveMode === immersiveMode
      && prior.timelines.length === timelines.length && timelines.every((el, i) => el === prior.timelines[i])) return;
    prior?.dispose();
    subscription.current = null;
    if (!enabled) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const bounds = root.getBoundingClientRect();
      const immersive = root.classList.contains('immersive');
      const topHeight = immersive ? 8 : (top?.getBoundingClientRect().height || 0) + 8;
      let bottom = 0;
      timelines.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height) bottom = Math.max(bottom, bounds.bottom - rect.top + 8);
      });
      // Below three root-text lines the scrollport cannot contain the tide curve
      // or a large-text control. Offer a separate reading area instead of clipping it.
      const documentStyle = getComputedStyle(document.documentElement);
      const rootText = parseFloat(documentStyle.fontSize) || 16;
      const safeBottom = parseFloat(documentStyle.getPropertyValue('--safe-bottom'));
      const fallback = window.innerWidth < 768 && !immersive
        ? (Number.isFinite(safeBottom) ? Math.max(0, safeBottom) : 84) + 8 : 80;
      const bottomReserve = bottom || fallback;
      const available = Math.max(48, bounds.height - topHeight - bottomReserve - 8);
      root.dataset.pointDetailsCompact = String(available < 3 * rootText);
      const values = { '--weather-top': topHeight, '--weather-bottom': bottomReserve, '--weather-height': bounds.height };
      Object.entries(values).forEach(([name, value]) => {
        const next = `${Math.ceil(value)}px`;
        if (root.style.getPropertyValue(name) !== next) root.style.setProperty(name, next);
      });
      // Reflow can shrink a scrollport without moving keyboard focus. Keep its
      // focused descendant visible; a newly closed disclosure receives focus.
      const layout = [bounds.width, bounds.height, topHeight, bottomReserve, rootText].join(':');
      const geometryChanged = layout !== lastLayout.current;
      lastLayout.current = layout;
      const focused = document.activeElement;
      const panel = focused?.closest?.('.weather-point-card, .weather-layer-sheet, .weather-desktop-panel, [data-weather-timeline], .weather-map-actions');
      // Ordinary selection/render updates must not pull a user's scroll position
      // back to the focused chart. Reveal focus only when chrome geometry changes.
      if (geometryChanged && panel && root.contains(panel)
        && getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).visibility !== 'hidden') {
        if (panel.matches('.weather-point-card') && root.dataset.pointDetailsCompact === 'true' && panel.dataset.pointDetailsExpanded !== 'true') {
          panel.querySelector('.weather-point-details-toggle')?.focus({ preventScroll: true });
        } else {
          focused.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    // A bottom-position transition changes occupied space without resizing a node.
    timelines.forEach(el => {
      el.addEventListener('transitionend', schedule);
      el.addEventListener('transitioncancel', schedule);
    });
    const observer = new ResizeObserver(schedule);
    [root, top, ...timelines].filter(Boolean).forEach(el => observer.observe(el));
    // BottomNav publishes its measured height on the document root, even when MapPage
    // itself does not rerender. Position-only changes do not notify ResizeObserver.
    const safeAreaObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    safeAreaObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.visualViewport?.addEventListener('resize', schedule);
    subscription.current = {
      root, top, timelines, immersiveMode,
      dispose: () => {
        timelines.forEach(el => {
          el.removeEventListener('transitionend', schedule);
          el.removeEventListener('transitioncancel', schedule);
        });
        observer.disconnect();
        safeAreaObserver?.disconnect();
        cancelAnimationFrame(raf);
        window.visualViewport?.removeEventListener('resize', schedule);
      },
    };
    measure();
  });
  useLayoutEffect(() => () => {
    subscription.current?.dispose();
    subscription.current = null;
  }, []);
}
