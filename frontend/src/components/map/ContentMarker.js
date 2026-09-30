/**
 * ContentMarker — react-map-gl's Marker whose CONTENT carries the semantics, not its positioning wrapper.
 *
 * MapLibre 5.x `Marker.addTo` gives every marker wrapper `role="button"` and aria-label "Map marker" unless the
 * element already has them. Ours hold real <button>s with their own labels (spot glyphs with the rating text,
 * clusters, photographers), so assistive technology meets a button INSIDE a button: axe `nested-interactive`,
 * serious, 8-9 nodes on the map page in every theme (W-10 R5, a production build, 2026-09-30). The wrapper only
 * positions; it is not a control (it is not even focusable: MapLibre adds tabindex only with a popup, and no
 * marker here uses one). So it becomes role="none" with no label, and the inner control is what a screen reader
 * and the keyboard reach. A marker with no interactive content is then plain content, not an anonymous "button".
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Marker } from 'react-map-gl/maplibre';

/** PURE-ish: strip the control semantics MapLibre put on a marker wrapper. Safe on null. */
export const makeWrapperPresentational = (el) => {
  if (!el) return;
  el.setAttribute('role', 'none');
  el.removeAttribute('aria-label');
};

export const ContentMarker = forwardRef((props, ref) => {
  const inner = useRef(null);
  useImperativeHandle(ref, () => inner.current, []);
  // A child's effects run before its parent's, so this runs AFTER the Marker's own effect (MapLibre's addTo,
  // which is where the role and label are set): overriding here always wins.
  useEffect(() => {
    makeWrapperPresentational(inner.current?.getElement?.());
  }, []);
  return <Marker ref={inner} {...props} />;
});
ContentMarker.displayName = 'ContentMarker';

export default ContentMarker;
