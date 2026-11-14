/**
 * usePressureIsobars.js — labelled isobars (every 4 hPa, bold every 20) and H / L centres over the own-frames pressure field
 * (2026-10-24, per-model pressure; the lead's route, step 3). Dark with the field (it draws only while own frames draw pressure).
 * Kill: window.__RAW_DISABLE_RASTER_ISOBARS__ = true.
 *
 * NEVER A STALE LINE. The colour field cuts inside MapLibre's render (ownRasterLayer), and a GeoJSON setData lands a frame or
 * more later, so the lines are DOUBLE-BUFFERED: two sources (a, b), each with its line, label and centre layers. The wanted
 * frame's isobars (isobarStore: a worker, cached per frame) are loaded into the HIDDEN buffer as soon as a step picks the frame.
 * At the cut ('shown', fired inside the render), a buffer that already holds that frame becomes visible and the other hidden:
 * a layer's visibility is read when MapLibre draws it, and these layers draw after the field in the same pass, so the lines change
 * in the SAME frame as the colours. If the frame's isobars are not loaded yet, both buffers hide (no lines rather than old
 * lines) and the new ones appear the moment they load. No frame wanted (a gap): no lines.
 * Not colour-only: every isobar carries its hPa label, every centre an "H" / "L" and its pressure.
 */
import { useEffect, useRef } from 'react';
import { getOwnShown, getOwnWant, onOwnShown } from './ownRasterFrames';
import { getIsobars, isobarsOn, onIsobarsReady } from './isobarStore';
import { blendMs } from './ownRasterLayer';

const EMPTY = { type: 'FeatureCollection', features: [] };
const BUFS = ['a', 'b'];
const ids = (b) => ({
  lines: `own-raster-pressure-isobars-${b}`, centres: `own-raster-pressure-centres-${b}`,
  line: `own-raster-pressure-isobar-line-${b}`, label: `own-raster-pressure-isobar-label-${b}`, mark: `own-raster-pressure-centre-${b}`,
});
// Ink per theme: dark lines on light ground, light lines on dark; labels haloed in the ground colour so they read on any wash.
const INK = {
  dark: { line: 'rgba(241,245,249,0.55)', text: '#f1f5f9', halo: 'rgba(2,6,23,0.85)', high: '#fca5a5', low: '#93c5fd' },
  // DARK INK V2 (2026-10-24, the lead: the dark three-model still read faint): measured APCA |Lc| of the drawn lines against the
  // field under them, median / p90, dark 20.7 / 33.2 vs light 25.5 / 45.2 and beach 22.0 / 35.2 (apca_lines.py). Dark only: a
  // denser, slightly wider line. Kill: window.__RAW_DISABLE_ISOBAR_DARK_INK_V2__ = true (the V1 ink above).
  darkV2: { line: 'rgba(248,250,252,0.85)', text: '#f8fafc', halo: 'rgba(2,6,23,0.90)', high: '#fca5a5', low: '#93c5fd', width: 1.15 },
  light: { line: 'rgba(15,23,42,0.50)', text: '#0f172a', halo: 'rgba(255,255,255,0.90)', high: '#b91c1c', low: '#1d4ed8' },
  beach: { line: 'rgba(68,48,30,0.55)', text: '#3f2a17', halo: 'rgba(255,248,235,0.90)', high: '#9a3412', low: '#1e3a8a' },
};

const inkFor = (theme) => {
  if (theme === 'dark' || !INK[theme]) {
    const v1 = typeof window !== 'undefined' && window.__RAW_DISABLE_ISOBAR_DARK_INK_V2__ === true;
    return v1 ? INK.dark : INK.darkV2;
  }
  return INK[theme];
};
const lineWidth = (ink) => ['case', ['get', 'major'], 1.6 * (ink.width || 1), 0.8 * (ink.width || 1)];

/** A font stack the basemap already serves (its glyphs are the only ones loaded). */
function baseFont(map) {
  try {
    for (const l of map.getStyle().layers) {
      const f = l.type === 'symbol' && l.layout && l.layout['text-font'];
      if (Array.isArray(f) && f.length) return f;
    }
  } catch (e) { /* style mid-load */ }
  return null;
}

export function usePressureIsobars({ mapInstance, engaged, theme, beforeId, layer = 'pressure' }) {
  const st = useRef({ bufs: { a: { want: null, loaded: null }, b: { want: null, loaded: null } }, visible: null, added: false });
  const on = !!engaged && isobarsOn();

  useEffect(() => {
    if (!on || !mapInstance) return undefined;
    const S = st.current;
    const ink = inkFor(theme);
    const setVis = (b, v) => {
      const i = ids(b);
      for (const id of [i.line, i.label, i.mark]) { try { if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); } catch (e) { /* gone */ } }
    };
    // Telemetry (window.__RAW_ISOBARS__.visiblePath): the frame whose lines are on screen, for the lab's per-frame stale count.
    const note = (path) => { if (typeof window !== 'undefined') { window.__RAW_ISOBARS__ = window.__RAW_ISOBARS__ || {}; window.__RAW_ISOBARS__.visiblePath = path; } };
    // THE LINES CROSSFADE WITH THE FIELD (2026-11-12, the value blend in ownRasterLayer). While the colour field morphs from one
    // frame to the next, the outgoing frame's LINES fade out and the incoming frame's fade in over the same time (line-opacity,
    // a paint transition): they never snap in the middle of a blend. The numbers and the H / L markers still switch at once (two
    // sets of labels on screen would collide and flicker). No blend (the kill, reduced motion) = the instant switch, as before.
    S.fades = S.fades || {};
    const lineOpacity = (b, v, ms) => {
      const id = ids(b).line;
      try {
        if (!mapInstance.getLayer(id)) return;
        mapInstance.setPaintProperty(id, 'line-opacity-transition', { duration: ms, delay: 0 });
        mapInstance.setPaintProperty(id, 'line-opacity', v);
      } catch (e) { /* gone */ }
    };
    const endFade = (b) => { if (S.fades[b]) { clearTimeout(S.fades[b]); delete S.fades[b]; } };
    // A hidden buffer's lines rest at opacity 0, so when it is next shown inside a blend they rise from nothing (a 0 then 1 set
    // in one call is collapsed by the map into an instant appearance: measured 2026-11-12, the mid-blend picture equalled the end).
    const hideNow = (b) => { endFade(b); setVis(b, false); lineOpacity(b, 0, 0); };
    // The outgoing buffer: its numbers and markers go now, its lines fade out and are hidden when the fade ends.
    const fadeOut = (x, ms) => {
      const i = ids(x);
      for (const id of [i.label, i.mark]) { try { if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { /* gone */ } }
      lineOpacity(x, 0, ms);
      endFade(x);
      S.fades[x] = setTimeout(() => { delete S.fades[x]; if (S.visible !== x) hideNow(x); }, ms);
    };
    const show = (b) => {
      const ms = blendMs();
      const from = S.visible;
      // the other buffer is on screen, or already fading out (the cut came before these lines had loaded): rise as it falls
      const crossing = ms > 0 && BUFS.some((x) => x !== b && (x === from || S.fades[x]));
      for (const x of BUFS) {
        if (x === b) { endFade(x); setVis(x, true); lineOpacity(x, 1, crossing ? ms : 0); continue; }
        if (ms > 0 && x === from) fadeOut(x, ms);
        else if (!(ms > 0 && S.fades[x])) hideNow(x);
      }
      S.visible = b; note(S.bufs[b].want);
    };
    const hideAll = () => { for (const x of BUFS) hideNow(x); S.visible = null; note(null); };
    const load = (b, path) => {
      const prod = path && getIsobars(path);
      if (!prod) return false;
      const i = ids(b);
      if (S.fades[b]) hideNow(b);            // still fading out: it is about to hold another frame's lines, so it goes now
      try {
        mapInstance.getSource(i.lines).setData(prod.lines);
        mapInstance.getSource(i.centres).setData(prod.centres);
        S.bufs[b] = { want: path, loaded: null };
        return true;
      } catch (e) { return false; }
    };
    // the buffer to load the next frame into: not the one on screen, and not one whose lines are still fading out if there is a choice
    const hidden = () => BUFS.find((b) => b !== S.visible && !S.fades[b]) || BUFS.find((b) => b !== S.visible) || 'a';

    const add = () => {
      try {
        if (mapInstance.getSource(ids('a').lines)) return;
        const font = baseFont(mapInstance);
        const before = beforeId && mapInstance.getLayer(beforeId) ? beforeId : undefined;
        for (const b of BUFS) {
          const i = ids(b);
          mapInstance.addSource(i.lines, { type: 'geojson', data: EMPTY });
          mapInstance.addSource(i.centres, { type: 'geojson', data: EMPTY });
          mapInstance.addLayer({ id: i.line, type: 'line', source: i.lines, layout: { visibility: 'none', 'line-join': 'round' },
            paint: { 'line-color': ink.line, 'line-width': lineWidth(ink), 'line-opacity': 0 } }, before);
          if (font) {
            mapInstance.addLayer({ id: i.label, type: 'symbol', source: i.lines,
              layout: { visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 320, 'text-field': ['to-string', ['get', 'hpa']],
                'text-font': font, 'text-size': ['case', ['get', 'major'], 11, 10], 'text-keep-upright': true, 'text-allow-overlap': false },
              paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.4 } }, before);
            mapInstance.addLayer({ id: i.mark, type: 'symbol', source: i.centres,
              layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 15, 'text-line-height': 1.0,
                'text-allow-overlap': false, 'text-padding': 6 },
              paint: { 'text-color': ['match', ['get', 'kind'], 'H', ink.high, ink.low], 'text-halo-color': ink.halo, 'text-halo-width': 1.8 } }, before);
          }
          S.bufs[b] = { want: null, loaded: null };
        }
        S.visible = null;
        S.added = true;
        prepare(getOwnWant(layer));
        cut(getOwnShown(layer));
      } catch (e) { /* style mid-load: style.load re-adds */ }
    };

    // A step picked `path`: get its isobars into the hidden buffer now (the cut may come a frame later).
    const prepare = (path) => {
      if (!path) return;
      if (S.visible && S.bufs[S.visible].want === path) return;
      const h = hidden();
      if (S.bufs[h].want !== path) load(h, path);
    };
    // The field cut to `path` (inside the render): the buffer holding it, loaded, becomes visible; else no lines until it is.
    const cut = (path) => {
      if (!path) { hideAll(); return; }
      if (S.visible && S.bufs[S.visible].want === path && S.bufs[S.visible].loaded === path) return;
      const ready = BUFS.find((b) => S.bufs[b].want === path && S.bufs[b].loaded === path);
      if (ready) { show(ready); return; }
      // The new frame's lines are not loaded yet. No blend: no lines at all until they are (never a stale line). With the blend the
      // old lines fade out as the field morphs away from them, and the new ones fade in when they land (show, above).
      const ms = blendMs();
      if (ms > 0 && S.visible) { fadeOut(S.visible, ms); S.visible = null; note(null); } else hideAll();
      if (!BUFS.some((b) => S.bufs[b].want === path)) load(hidden(), path);
    };

    const offShown = onOwnShown((kind, l, path) => {
      if (l !== layer || !S.added) return;
      if (kind === 'want') { if (!path) hideAll(); else prepare(path); } else cut(path);
    });
    // Isobars computed (worker): the wanted or the shown frame's go straight into a buffer.
    const offReady = onIsobarsReady((path) => {
      if (!S.added) return;
      if (path === getOwnShown(layer) && !S.visible) { const h = hidden(); if (S.bufs[h].want !== path) load(h, path); }
      else if (path === getOwnWant(layer)) prepare(path);
    });
    // A buffer finished loading: if it holds the frame on screen, show it.
    const onData = (e) => {
      if (!e || !e.sourceId || !e.isSourceLoaded) return;
      const b = BUFS.find((x) => ids(x).lines === e.sourceId);
      if (!b) return;
      const buf = S.bufs[b];
      if (buf.want && buf.loaded !== buf.want) buf.loaded = buf.want;
      if (buf.loaded && buf.loaded === getOwnShown(layer) && S.visible !== b) show(b);
    };

    add();
    mapInstance.on('style.load', add);
    mapInstance.on('sourcedata', onData);
    return () => {
      offShown(); offReady();
      mapInstance.off('style.load', add);
      mapInstance.off('sourcedata', onData);
      for (const b of BUFS) endFade(b);
      try {
        for (const b of BUFS) {
          const i = ids(b);
          for (const id of [i.mark, i.label, i.line]) if (mapInstance.getLayer(id)) mapInstance.removeLayer(id);
          for (const id of [i.lines, i.centres]) if (mapInstance.getSource(id)) mapInstance.removeSource(id);
        }
      } catch (e) { /* style gone */ }
      S.added = false; S.visible = null;
    };
  }, [on, mapInstance, beforeId, layer]);   // theme is read at add time; the effect below repaints it

  // Theme: repaint the ink without rebuilding the buffers.
  useEffect(() => {
    if (!on || !mapInstance) return;
    const ink = inkFor(theme);
    for (const b of BUFS) {
      const i = ids(b);
      try {
        if (mapInstance.getLayer(i.line)) { mapInstance.setPaintProperty(i.line, 'line-color', ink.line); mapInstance.setPaintProperty(i.line, 'line-width', lineWidth(ink)); }
        if (mapInstance.getLayer(i.label)) { mapInstance.setPaintProperty(i.label, 'text-color', ink.text); mapInstance.setPaintProperty(i.label, 'text-halo-color', ink.halo); }
        if (mapInstance.getLayer(i.mark)) {
          mapInstance.setPaintProperty(i.mark, 'text-color', ['match', ['get', 'kind'], 'H', ink.high, ink.low]);
          mapInstance.setPaintProperty(i.mark, 'text-halo-color', ink.halo);
        }
      } catch (e) { /* style mid-load */ }
    }
  }, [on, mapInstance, theme]);
}
