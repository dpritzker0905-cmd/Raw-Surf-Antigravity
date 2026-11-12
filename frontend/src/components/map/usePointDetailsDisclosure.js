import { useLayoutEffect, useRef, useState } from 'react';

/** Disclosure state follows the measured layout, including resize without a React render. */
export default function usePointDetailsDisclosure() {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsRef = useRef(null);
  const subscription = useRef(null);
  useLayoutEffect(() => {
    const card = detailsRef.current;
    const root = card?.closest('[data-responsive-weather]');
    if (subscription.current?.root === root) return;
    subscription.current?.observer.disconnect();
    subscription.current = null;
    if (!root) return;
    const sync = () => {
      if (root.dataset.pointDetailsCompact === 'true') return;
      setDetailsExpanded(false);
      if (document.activeElement === card.querySelector('.weather-point-details-toggle')) {
        card.querySelector('.weather-point-header')?.focus({ preventScroll: true });
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-point-details-compact', 'data-responsive-weather'] });
    subscription.current = { root, observer };
  });
  useLayoutEffect(() => () => {
    subscription.current?.observer.disconnect();
    subscription.current = null;
  }, []);
  const onDetailsKeyDown = event => {
    if (event.key !== 'Escape' || !detailsExpanded) return;
    setDetailsExpanded(false);
    const toggle = event.currentTarget.querySelector('.weather-point-details-toggle');
    if (!toggle) return;
    const style = getComputedStyle(toggle);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    toggle.focus();
    if (document.activeElement === toggle) event.stopPropagation();
  };
  return { detailsExpanded, setDetailsExpanded, detailsRef, onDetailsKeyDown };
}
