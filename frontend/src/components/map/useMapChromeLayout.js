import { useLayoutEffect, useRef } from 'react';
import { syncForecastStatusDuplicates } from './forecastStatusDuplicates';

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
    const search = enabled ? root.querySelector('.weather-explorer-toggle') : null;
    let toolbar = enabled ? document.querySelector('[data-testid="bottom-nav"]') : null;
    const timelines = enabled ? [...root.querySelectorAll('[data-weather-timeline]')] : [];
    const immersiveMode = root?.classList.contains('immersive');
    const prior = subscription.current;
    if (prior && enabled && prior.root === root && prior.top === top && prior.search === search && prior.toolbar === toolbar && prior.immersiveMode === immersiveMode && prior.controlMode === root.dataset.mapControlMode
      && prior.timelines.length === timelines.length && timelines.every((el, i) => el === prior.timelines[i])) return;
    prior?.dispose();
    subscription.current = null;
    if (!enabled) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const currentToolbar = document.querySelector('[data-testid="bottom-nav"]');
      if (currentToolbar !== toolbar) {
        watchToolbar(toolbar, false); toolbar = currentToolbar; watchToolbar(toolbar, true);
        if (subscription.current) subscription.current.toolbar = toolbar;
      }
      const bounds = root.getBoundingClientRect();
      const documentStyle = getComputedStyle(document.documentElement);
      const rootText = parseFloat(documentStyle.fontSize) || 16;
      const toolbarBox = toolbar?.getBoundingClientRect();
      const toolbarVisible = !!(toolbarBox?.width && toolbarBox?.height && toolbarBox.top < bounds.bottom);
      const toolbarOffset = toolbarVisible ? Math.max(0, bounds.bottom - toolbarBox.top) : 0;
      const createBox = toolbar?.querySelector('[data-testid="bottomnav-create"]')?.getBoundingClientRect();
      const toolbarProtrude = toolbarVisible ? Math.max(0, parseFloat(documentStyle.getPropertyValue('--create-protrude')) || 0, createBox?.height ? toolbarBox.top - createBox.top : 0) : 0;
      root.dataset.weatherToolbarVisible = String(toolbarVisible);
      const searchBox = search?.getBoundingClientRect();
      const searchEnd = searchBox?.width ? searchBox.right - bounds.left + 12
        : parseFloat(root.style.getPropertyValue('--weather-search-end')) || 212;
      root.dataset.shortMapColumns = String(window.innerWidth >= 560 && window.innerWidth < 768
        && bounds.height < 240 && bounds.width - searchEnd >= 340);
      // This mode depends on viewport and text size, never on the space it
      // frees; opening/closing details cannot make the timeline oscillate.
      root.dataset.enlargedMobileTimeline = String(window.innerWidth < 768 && bounds.height < 600 && rootText >= 24);
      const immersive = root.classList.contains('immersive');
      const topHeight = (top?.getBoundingClientRect().height || 0) + 8;
      const heading = root.querySelector('.weather-map-heading');
      const headingReserve = heading ? heading.getBoundingClientRect().bottom - bounds.top + 8 : 8;
      const pointTop = Math.max(headingReserve, searchBox?.height ? searchBox.bottom - bounds.top + 8 : 8);
      const pointColumns = window.innerWidth >= 560 && window.innerWidth < 1024 && bounds.height < 480;
      root.dataset.pointColumns = String(pointColumns);
      let bottom = 0;
      timelines.forEach(el => {
        if (root.dataset.mapControlMode === 'explore') return;
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height) bottom = Math.max(bottom, bounds.bottom - rect.top + 8);
      });
      // Reserve the normal header and its focus ring as well as three root-text
      // lines for the enlarged curve. A 48px scrollport clips the 55px header.
      // Offer a separate reading area instead of clipping either keyboard target.
      const safeBottom = parseFloat(documentStyle.getPropertyValue('--safe-bottom'));
      const fallback = window.innerWidth < 768 && !immersive
        ? (Number.isFinite(safeBottom) ? Math.max(0, safeBottom) : 84) + 8 : 80;
      const bottomReserve = bottom || fallback;
      const available = Math.max(48, pointColumns
        ? bounds.height - pointTop - toolbarOffset - 16
        : bounds.height - topHeight - bottomReserve - 8);
      if (root.dataset.mapControlMode !== 'explore') root.dataset.pointDetailsCompact = String(available < Math.max(64, 3 * rootText));
      syncForecastStatusDuplicates(root);
      const values = { '--weather-top': topHeight, '--weather-heading': headingReserve, '--weather-point-top': pointTop, '--weather-bottom': bottomReserve, '--weather-height': bounds.height, '--weather-search-end': searchEnd, '--weather-toolbar-offset': toolbarOffset, '--weather-toolbar-protrude': toolbarProtrude };
      Object.entries(values).forEach(([name, value]) => {
        const next = `${name === '--weather-toolbar-offset' ? Math.round(value * 1000) / 1000 : Math.ceil(value)}px`;
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
    const watchToolbar = (element, add) => {
      if (!element) return;
      for (const type of ['transitionend', 'transitioncancel']) element[add ? 'addEventListener' : 'removeEventListener'](type, schedule);
      if (add) observer.observe(element); else observer.unobserve?.(element);
    };
    if (toolbar) for (const type of ['transitionend', 'transitioncancel']) toolbar.addEventListener(type, schedule);
    [root, top, search, toolbar, ...timelines].filter(Boolean).forEach(el => observer.observe(el));
    // BottomNav publishes its measured height on the document root, even when MapPage
    // itself does not rerender. Position-only changes do not notify ResizeObserver.
    const safeAreaObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    safeAreaObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const toolbarMountObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches?.('[data-testid="bottom-nav"]') || node.querySelector?.('[data-testid="bottom-nav"]'))))) schedule();
    });
    toolbarMountObserver?.observe(document.body, { childList: true, subtree: true });
    const statusObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    statusObserver?.observe(root, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['aria-hidden', 'aria-label', 'data-point-details-expanded'] });
    window.visualViewport?.addEventListener('resize', schedule);
    subscription.current = {
      root, top, search, toolbar, timelines, immersiveMode, controlMode: root.dataset.mapControlMode,
      dispose: () => {
        timelines.forEach(el => {
          el.removeEventListener('transitionend', schedule);
          el.removeEventListener('transitioncancel', schedule);
        });
        watchToolbar(toolbar, false);
        observer.disconnect();
        toolbarMountObserver?.disconnect();
        safeAreaObserver?.disconnect();
        statusObserver?.disconnect();
        root.querySelectorAll('[data-duplicate-point-time]').forEach(el => el.removeAttribute('data-duplicate-point-time'));
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
