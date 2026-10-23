/**
 * useOwnRasterFrames.js — wires one raster layer to our own static frames (ownRasterFrames.js) and its custom GL layer
 * (ownRasterLayer.js). Phase 1 (2026-10-23): GFS pressure, DARK behind window.__RAW_RASTER_OWN_FRAMES__.
 *
 * Returns `engaged`: true while this layer is drawn from our frames. MapWebGL then leaves the layer out of the .om path
 * entirely (no Open-Meteo request for it). Engagement is decided synchronously from the levers, so .om never starts in
 * parallel; if no index can be pinned (the set is not published yet, the CDN is down) it disengages and the .om path draws
 * the layer as before.
 * Per scrub step: the frame for Date.now() + offset (the .om path's own clock), the window around it in the scrub direction
 * (ownRasterFrames.planWindow), already-decoded fields offered to the layer at once, the rest pumped in priority order.
 */
import { useEffect, useRef, useState } from 'react';
import { CUSTOM_COLOR_SCALES, applyThemePressureScale } from './colorScales';
import { createOwnRasterLayer, buildStepLut, PRESSURE_LUT } from './ownRasterLayer';
import { getRasterDrawn, publishRasterDrawn, rasterReadoutKilled } from './rasterDrawnFrame';
import {
  framesOf, frameAt, getField, noteMiss, noteStep, OWN_RASTER_SETS, ownFramesOn, ownIndex, planWindow, setEngaged, setWanted, tel, windowRadius,
} from './ownRasterFrames';

export const ownLayerId = (layer) => `own-raster-${layer}`;

// The colour scale the .om path draws for each layer, theme applied (the same object openMeteoProtocol hands the library).
const SCALES = {
  pressure: (theme) => { applyThemePressureScale(theme); return CUSTOM_COLOR_SCALES.pressure_msl; },
};
const LUTS = { pressure: PRESSURE_LUT };
// Isobar ink per theme (only drawn with window.__RAW_OWN_RASTER_ISOBARS__ set; off by default).
const ISO_INK = { dark: [1, 1, 1, 0.5], beach: [0.24, 0.18, 0.12, 0.5], light: [0.12, 0.16, 0.24, 0.5] };

export function useOwnRasterFrames({ mapInstance, layer, model, active, timeOffsetHours, theme, beforeId }) {
  const wanted = !!active && ownFramesOn(layer, model);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(null);
  const [gen, setGen] = useState(0);          // bumps each time the GL layer is (re)added: the step effect re-offers fields
  const ref = useRef({ layerObj: null, prevOffset: null, dir: 1, shownRec: null, wantRec: null });
  const engaged = wanted && !failed;

  useEffect(() => { if (!wanted) setFailed(false); }, [wanted]);
  // The legend credit names NOAA only once a frame set is pinned (before that nothing is drawn from it).
  const drawing = engaged && !!index;
  useEffect(() => { setEngaged(layer, drawing); return () => setEngaged(layer, false); }, [layer, drawing]);

  // 1. The pinned index for this engagement.
  useEffect(() => {
    if (!wanted) { setIndex(null); return undefined; }
    let alive = true;
    ownIndex(layer).then((idx) => {
      if (!alive) return;
      if (idx && framesOf(idx).length) setIndex(idx);
      else { noteMiss('no_index'); setFailed(true); }
    });
    return () => { alive = false; };
  }, [wanted, layer]);

  // The status line under the timeline (rasterDrawnFrame, #471): the shown and the wanted frame, in the .om pairs' shape, so the
  // same words apply ("Loading 3 PM... still showing 12 PM", "Showing 3 PM: the nearest stored forecast" between 3-hourly frames).
  const publish = () => {
    if (rasterReadoutKilled()) return;
    const st = ref.current;
    publishRasterDrawn({ layer, shown: st.shownRec, want: st.wantRec });
  };
  useEffect(() => () => {
    ref.current.shownRec = null; ref.current.wantRec = null;
    const cur = getRasterDrawn();
    if (cur && cur.layer === layer) publishRasterDrawn(null);
  }, [layer, drawing]);

  // 2. The GL layer: added below the wind particles (the .om slots' anchor), re-added after a style reload.
  useEffect(() => {
    if (!engaged || !mapInstance) return undefined;
    const st = ref.current;
    const id = ownLayerId(layer);
    const add = () => {
      try {
        if (mapInstance.getLayer(id)) return;
        st.layerObj = createOwnRasterLayer({ id, lutMap: LUTS[layer], onFail: (why) => { noteMiss(`gl_${why}`); setFailed(true); } });
        st.layerObj.onShown((path, field) => {
          tel().shown = { path, at: Date.now(), validMs: field ? field.validMs : null };
          // Called from MapLibre's render: publish after it (subscribers re-render React).
          st.shownRec = { url: path, dataMs: field ? field.validMs : NaN, model: OWN_RASTER_SETS[layer].model, nearestMaxHours: st.nearestMaxHours || 1 };
          Promise.resolve().then(publish);
        });
        const before = beforeId && mapInstance.getLayer(beforeId) ? beforeId : undefined;
        mapInstance.addLayer(st.layerObj, before);
        setGen((g) => g + 1);
      } catch (e) { noteMiss('add_layer_failed'); }
    };
    add();
    mapInstance.on('style.load', add);
    return () => {
      mapInstance.off('style.load', add);
      try { if (mapInstance.getLayer(id)) mapInstance.removeLayer(id); } catch (e) { /* style gone */ }
      st.layerObj = null;
      setWanted(layer, [], null);
    };
  }, [engaged, mapInstance, layer, beforeId]);

  // 3. The palette, per theme (a step LUT of the .om path's own scale).
  useEffect(() => {
    const L = ref.current.layerObj;
    if (!engaged || !L || !SCALES[layer]) return;
    L.setLut(buildStepLut(SCALES[layer](theme), LUTS[layer]), LUTS[layer]);
    L.setIsobarColor(ISO_INK[theme] || ISO_INK.dark);
  }, [engaged, layer, theme, gen]);

  // 4. Each step: the frame for the asked time, the window around it, the hard cut when it is resident.
  useEffect(() => {
    const st = ref.current;
    const L = st.layerObj;
    if (!engaged || !index || !L) return;
    const frames = framesOf(index);
    const offset = Number(timeOffsetHours) || 0;
    if (st.prevOffset !== null && offset !== st.prevOffset) st.dir = offset > st.prevOffset ? 1 : -1;
    st.prevOffset = offset;
    const validMs = Date.now() + offset * 3600000;
    const f = frameAt(index, validMs);
    if (!f) {
      L.want(null);
      st.wantRec = null; publish();
      noteMiss('no_frame');
      tel().want = { validMs, path: null, at: Date.now() };
      setWanted(layer, [], null);
      return;
    }
    const cur = frames.findIndex((x) => x.path === f.path);
    // Half the gap to the neighbouring frames: within it the line says "the nearest stored forecast" (3-hourly: 1 h).
    const at = (i) => (frames[i] ? Date.parse(frames[i].valid_time) : NaN);
    const gaps = [at(cur) - at(cur - 1), at(cur + 1) - at(cur)].filter((g) => Number.isFinite(g) && g > 0);
    st.nearestMaxHours = Math.floor((gaps.length ? Math.max(...gaps) / 3600000 : 1) / 2);
    st.wantRec = { url: f.path, dataMs: Date.parse(f.valid_time), model: OWN_RASTER_SETS[layer].model, nearestMaxHours: st.nearestMaxHours };
    if (st.shownRec) st.shownRec = { ...st.shownRec, nearestMaxHours: st.shownRec.url === f.path ? st.nearestMaxHours : st.shownRec.nearestMaxHours };
    publish();
    const win = planWindow(cur, frames.length, st.dir, windowRadius()).map((i) => frames[i]);
    for (const w of win) { const got = getField(w.path); if (got) L.offerField(w.path, got); }
    noteStep(f.path, L.isResident(f.path) || !!getField(f.path));
    L.want(f.path);
    tel().want = { validMs, path: f.path, frameMs: Date.parse(f.valid_time), at: Date.now() };
    setWanted(layer, win, (path, field) => { const now = ref.current.layerObj; if (now) now.offerField(path, field); });
  }, [engaged, index, timeOffsetHours, layer, gen]);

  return engaged;
}
