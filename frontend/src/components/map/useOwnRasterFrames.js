/**
 * useOwnRasterFrames.js — wires one raster layer to our own static frames (ownRasterFrames.js) and its custom GL layer
 * (ownRasterLayer.js). Phase 1 (2026-10-23): GFS pressure, DARK behind window.__RAW_RASTER_OWN_FRAMES__; 2026-10-24: per-model
 * pressure and GFS air temperature (one hook per layer; the app shows one weather layer at a time, useWeatherState.toggleLayer).
 *
 * Returns `engaged`: true while this layer is drawn from our frames. MapWebGL then leaves the layer out of the .om path
 * entirely (no Open-Meteo request for it). Engagement is decided synchronously from the levers, so .om never starts in
 * parallel; if no index can be pinned (the set is not published yet, the CDN is down) it disengages and the .om path draws
 * the layer as before.
 * Per scrub step: the frame for Date.now() + offset (the .om path's own clock), the window around it in the scrub direction
 * (ownRasterFrames.planWindow), already-decoded fields offered to the layer at once, the rest pumped in priority order.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CUSTOM_COLOR_SCALES, applyPrecipColorScale, applyThemePressureScale } from './colorScales';
import {
  createOwnRasterLayer, buildStepLut, PRESSURE_LUT, PRESSURE_OPACITY_STOPS, TEMPERATURE_LUT, TEMPERATURE_OPACITY_STOPS,
  CLOUD_LUT, SATELLITE_OPACITY_STOPS, RAIN_LUT, RAIN_OPACITY_STOPS, FOG_LUT, FOG_OPACITY_STOPS, WATER_TEMP_LUT, waterTempOpacityStops, GUST_OPACITY_STOPS, CURRENTS_OPACITY_STOPS,
  scaleForTheme, opacityAtZoom,
} from './ownRasterLayer';
import { RASTER_NAMES, getRasterDrawn, publishRasterDrawn, rasterReadoutKilled } from './rasterDrawnFrame';
import { requestIsobars } from './isobarStore';
import { GUST_LUT, gustScale, gustDarkFieldOn, gustFieldOpacity } from './gustPalette';
import { setShownGustField, gustFieldTint } from './gustParticles';
import { setShownCurrentField, setOfPath } from './currentParticles';
import { v2FieldTint } from './WebGLWindUtils';
import { CURRENTS_LUT, currentsScale } from './currentsPalette';
import { loadDownscale, setDownscaled } from './ownRasterDownscale';
import {
  OWN_ONLY_LAYERS, ownOnlyFor, gapFillFor, gapFillIndex, gapFillOffsetOn, setKey, endNoteText, sourceModel, combinedFrameAt, combinedFrames, emitOwnShown, emitOwnWant, framesOf, getField, lastIndex, noteMiss, noteStep, OWN_RASTER_SETS, ownFramesOn, ownIndex,
  planWindow, setEngaged, setWanted, tel, ownWindowRadius,
} from './ownRasterFrames';
import { FILL_MODEL } from './ownRasterGapFill';

export const ownLayerId = (layer) => `own-raster-${layer}`;

// The colour scale the .om path draws for each layer, theme applied (the same object openMeteoProtocol hands the library).
// Air temperature has no app override: the .om path draws the tile library's own 'temperature' scale (not theme-varied), read
// from the settings openMeteoProtocol registered (window.__OM_PROTOCOL_SETTINGS__), else from the library itself (step 3).
const LIB_SCALE = { temperature: 'temperature', satellite: 'cloud_cover', water_temp: 'sea_surface_temperature' };
const registeredScale = (name) => {
  const s = typeof window !== 'undefined' ? window.__OM_PROTOCOL_SETTINGS__ : null;
  return (s && s.colorScales && s.colorScales[name]) || null;
};
const SCALES = {
  pressure: (theme) => { applyThemePressureScale(theme); return CUSTOM_COLOR_SCALES.pressure_msl; },
  temperature: () => registeredScale(LIB_SCALE.temperature),
  // cloud cover has light / dark colour sets: resolved per theme as the .om URL's dark=true does (scaleForTheme)
  satellite: (theme) => scaleForTheme(registeredScale(LIB_SCALE.satellite), theme),
  // precipitation: the app's own ramp, the object the .om path draws (not theme-varied; applyPrecipColorScale honours its kill)
  rain: () => { applyPrecipColorScale(); return CUSTOM_COLOR_SCALES.precipitation; },
  // fog: the app's forced custom `visibility` scale (the object the .om path registers), not theme-varied
  fog: () => registeredScale('visibility') || CUSTOM_COLOR_SCALES.visibility || null,
  // water temp: the .om path's surface_temperature = the library's sea_surface_temperature (colorScales.aliasSurfaceTemperature)
  water_temp: () => registeredScale('surface_temperature') || registeredScale(LIB_SCALE.water_temp),
  // gusts (2026-11-15): the wind layer's own legend ramp per theme (gustPalette.js), so a knot reads the same on both layers
  gusts: (theme) => gustScale(theme),
  // currents (2026-11-15): viridis by speed, alpha per theme (currentsPalette.js)
  currents: (theme) => currentsScale(theme),
};
const LUTS = { pressure: PRESSURE_LUT, temperature: TEMPERATURE_LUT, satellite: CLOUD_LUT, rain: RAIN_LUT, fog: FOG_LUT, water_temp: WATER_TEMP_LUT, gusts: GUST_LUT, currents: CURRENTS_LUT };
// Each layer's .om slot ramp ('raster-opacity' over zoom in MapWebGL; pinned by ownRasterLayer.test.js).
// Layers drawn terrain-adjusted (ownRasterDownscale.js): air temperature only, and GFS only: the elevation asset is real ground
// minus GFS's own 0.5-degree terrain, so it would mis-correct ECMWF or ICON temperatures (their model terrain differs).
const DOWNSCALED = { temperature: true };
const downscaled = (layer, model) => !!DOWNSCALED[layer] && model === 'GFS';
const OPACITY = {
  pressure: PRESSURE_OPACITY_STOPS, temperature: TEMPERATURE_OPACITY_STOPS, satellite: SATELLITE_OPACITY_STOPS, rain: RAIN_OPACITY_STOPS,
  fog: FOG_OPACITY_STOPS, water_temp: waterTempOpacityStops, gusts: GUST_OPACITY_STOPS, currents: CURRENTS_OPACITY_STOPS,
};
const opacityOf = (layer) => (typeof OPACITY[layer] === 'function' ? OPACITY[layer]() : OPACITY[layer]);
// Isobar ink per theme (only drawn with window.__RAW_OWN_RASTER_ISOBARS__ set; off by default).
const ISO_INK = { dark: [1, 1, 1, 0.5], beach: [0.24, 0.18, 0.12, 0.5], light: [0.12, 0.16, 0.24, 0.5] };

/** The edge note's kill (the half-gap rule everywhere, as before): window.__RAW_DISABLE_RASTER_EDGE_NEAREST_NOTE__ = true. */
export const edgeNoteOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_EDGE_NEAREST_NOTE__ === true);
/** First frame first's kill (see the step effect): window.__RAW_DISABLE_OWN_FIRST_FRAME_FIRST__ = true. */
export const firstFrameFirstOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_OWN_FIRST_FRAME_FIRST__ === true);
export const sameFrameOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_SAME_FRAME__ === true);
/** How long an own-only model waits after a failed index read before it asks again (no .om fallback behind it, 2026-11-18). */
export const OWN_ONLY_RETRY_MS = 60000;
// SCOPE (2026-11-14, the advisor's red-team of #889): the handover and the same-frame step apply ONLY to the layers this lane
// built (default-OFF pending the owner, reachable with the lever). Pressure and satellite are live defaults with no before/after
// measurement of either change (the handover also starts their .om path on a cold toggle: extra Open-Meteo requests and a decode
// thrown away), so they and rain keep dev's exact behaviour until a measured batch of their own.
export const HANDOVER_LAYERS = Object.freeze(['fog', 'temperature', 'water_temp']);
const handoverLayer = (layer) => HANDOVER_LAYERS.includes(layer);

export function useOwnRasterFrames({ mapInstance, layer, model, active, timeOffsetHours, theme, beforeId }) {
  const M = String(model || 'GFS').toUpperCase();
  // GAP FILL (2026-11-22, ownRasterGapFill.js): the picked model's gaps are filled from GFS's own set (and ICON air temperature's
  // coarser ICON set), labelled; read whether or not GFS's own layer is on by default.
  const fill = gapFillFor(layer, M);
  const hasFill = !!fill;
  const fillCoarse = fill ? fill.coarse || null : null;
  const FB = fill ? FILL_MODEL : ((OWN_RASTER_SETS[layer] && OWN_RASTER_SETS[layer].fallback) || null);
  const wanted = !!active && ownFramesOn(layer, M);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(null);
  const [fbIndex, setFbIndex] = useState(null);
  const [offIndex, setOffIndex] = useState(null);    // the gap fill's S (ownRasterGapFill b'), only behind its dark lever      // the stand-in past the model's range (GFS), when another model is picked
  const [gen, setGen] = useState(0);          // bumps each time the GL layer is (re)added: the step effect re-offers fields
  const ref = useRef({ layerObj: null, prevOffset: null, dir: 1, shownRec: null, wantRec: null, byPath: new Map() });
  // With a gap fill, a missing own set still draws (the fill covers every hour): only a fill that is missing too disengages.
  const engaged = wanted && (!failed || (hasFill && !!fbIndex));
  const useStepEffect = useRef(handoverLayer(layer) && sameFrameOn() ? useLayoutEffect : useEffect).current;
  // HANDOVER (2026-11-14): the .om path keeps drawing until OUR layer has drawn a frame of this engagement; only then does the
  // hook report it (MapWebGL drops the layer from the .om list on that report). A cold toggle, an unpublished set or a slow
  // index read therefore never shows a blank map. Kill: window.__RAW_DISABLE_RASTER_OWN_HANDOVER__ = true (report at once).
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!engaged) setShown(false); }, [engaged]);

  useEffect(() => { if (!wanted) setFailed(false); }, [wanted]);
  useEffect(() => { setFailed(false); }, [M]);        // a model without a published set fails alone: switching back retries
  // The legend credit names the source only once a frame set is pinned (before that nothing is drawn from it), and then the
  // model of the frame ON SCREEN (a GFS stand-in past EURO's range is NOAA's data): set from onShown below.
  const drawing = engaged && (!!index || (hasFill && !!fbIndex));
  // Drawing from the gap fill alone (no own set of the picked model, or it failed): the credit is the fill's from the start.
  const fillOnly = drawing && (!index || failed || !setKey(layer, M));
  // An own-only model that is claimed with nothing drawn (killed, unpublished, pre-index; 2026-11-18) reports '<MODEL>:idle': the
  // credit names that model's own source with no note and never "© Open-Meteo" (Open-Meteo no longer draws it); the status line
  // keeps its "unavailable" readout (rasterDrawnFrame reads the value as truthy).
  const claimed = !!active && ownOnlyFor(layer, M);
  useEffect(() => {
    setEngaged(layer, drawing ? (fillOnly ? `${FILL_MODEL}:fill:${M}` : sourceModel(layer, M)) : (claimed ? `${sourceModel(layer, M)}:idle` : false));
    return () => setEngaged(layer, false);
  }, [layer, drawing, fillOnly, claimed, M]);
  // RETRY (2026-11-18, the advisor's HOLD on #1071): with no .om fallback, one failed index read must not latch "unavailable" for
  // the session. An own-only model retries every OWN_ONLY_RETRY_MS while the layer is on (a read of latest.json only when it is
  // due, staticFrames' pin rules). Kill: window.__RAW_DISABLE_RASTER_OWN_RETRY__ = true (the latch, as before).
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!failed || !wanted || !ownOnlyFor(layer, M)) return undefined;
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_RETRY__ === true) return undefined;
    const t = setTimeout(() => { setFailed(false); setRetry((n) => n + 1); }, OWN_ONLY_RETRY_MS);
    return () => clearTimeout(t);
  }, [failed, wanted, layer, M]);

  // 0. PREWARM (the toggle's latest.json + index round trips, before the toggle): with the lever on and the layer off, pin the
  // index once the map is idle. Two small JSON reads per map load, NO frames (raster frames never join an idle fill).
  // Kill: window.__RAW_DISABLE_RASTER_OWN_PREWARM__ = true.
  const leverOn = ownFramesOn(layer, M);
  useEffect(() => {
    if (!leverOn || active || lastIndex(layer, M) || !mapInstance) return undefined;
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_PREWARM__ === true) return undefined;
    let done = false; let idleId = null;
    const go = () => { if (!done) { done = true; ownIndex(layer, M).catch(() => {}); } };
    const onIdle = () => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(go, { timeout: 4000 });
      else setTimeout(go, 0);
    };
    mapInstance.once('idle', onIdle);
    return () => {
      done = true;
      try { mapInstance.off('idle', onIdle); } catch (e) { /* map gone */ }
      if (idleId !== null && typeof window !== 'undefined' && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
    };
  }, [leverOn, active, layer, M, mapInstance]);

  // 1. The pinned index for this engagement: the remembered one at once (prewarm or an earlier toggle), refreshed in the
  // background (a new run is taken on the next step, as staticFrames' pin rules allow).
  useEffect(() => {
    if (!wanted) { setIndex(null); return undefined; }
    let alive = true;
    const memo = lastIndex(layer, M);
    setIndex(memo && framesOf(memo).length ? memo : null);   // a model switch never keeps the other model's index
    ownIndex(layer, M).then(async (idx) => {
      if (!alive) return;
      if (idx && framesOf(idx).length) { if (idx !== memo) setIndex(idx); return; }
      if (memo) return;
      noteMiss('no_index');
      // ICON air temperature: its own coarser set before any GFS (ownRasterGapFill.js, fill a).
      const coarse = fillCoarse ? await gapFillIndex(layer, M, 'coarse') : null;
      if (!alive) return;
      if (coarse) setIndex(coarse); else setFailed(true);
    });
    return () => { alive = false; };
  }, [wanted, layer, M, retry, fillCoarse]);

  // 1b. The stand-in's index (GFS) for hours past the picked model's last frame: never capped, labelled as an estimate.
  useEffect(() => {
    if (!wanted || !FB || FB === M) { setFbIndex(null); return undefined; }
    let alive = true;
    const memo = lastIndex(layer, FB);
    setFbIndex(memo && framesOf(memo).length ? memo : null);
    (hasFill ? gapFillIndex(layer, M, 'fill') : ownIndex(layer, FB))
      .then((idx) => { if (alive && idx && framesOf(idx).length && idx !== memo) setFbIndex(idx); });
    return () => { alive = false; };
  }, [wanted, layer, M, FB, hasFill, retry]);

  // 1b'. The gap fill's MODEL - GFS offset set (b', DARK: window.__RAW_RASTER_GAPFILL_OFFSET__ = true; null otherwise).
  const offsetLever = gapFillOffsetOn();
  useEffect(() => {
    if (!wanted || !hasFill || !offsetLever) { setOffIndex(null); return undefined; }
    let alive = true;
    gapFillIndex(layer, M, 'offset').then((idx) => { if (alive) setOffIndex(idx || null); });
    return () => { alive = false; };
  }, [wanted, layer, M, hasFill, offsetLever]);

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

  // 1c. OWN-ONLY layers (gusts): no .om path behind them, so a miss (killed, set not published, no index) draws nothing. Say so
  // on the status line rather than show an unexplained empty map.
  // Own-only per model too (ICON air temperature, 2026-11-18): ownOnlyFor.
  const ownOnly = OWN_ONLY_LAYERS.includes(layer) || ownOnlyFor(layer, M);
  useEffect(() => {
    if (!ownOnly || !active || drawing || rasterReadoutKilled()) return undefined;
    const name = RASTER_NAMES[layer] || layer;
    publishRasterDrawn({ layer, shown: null, want: null, unavailable: `${name}: no published forecast yet` });
    return () => { const cur = getRasterDrawn(); if (cur && cur.layer === layer && cur.unavailable) publishRasterDrawn(null); };
  }, [ownOnly, active, drawing, layer]);

  // 2. The GL layer: added below the wind particles (the .om slots' anchor), re-added after a style reload.
  useEffect(() => {
    if (!engaged || !mapInstance) return undefined;
    const st = ref.current;
    const id = ownLayerId(layer);
    const add = () => {
      try {
        if (mapInstance.getLayer(id)) return;
        st.layerObj = createOwnRasterLayer({
          id, lutMap: LUTS[layer], opacityStops: opacityOf(layer), shaderIsobars: layer === 'pressure',
          // the full elevation asset cannot be held on this device: the 1/8-deg fallback (ownRasterDownscale.js)
          onDownscaleFail: (why) => { noteMiss(`dz_${why}`); st.dzVariant = 'lo'; setGen((g) => g + 1); },
          onFail: (why) => { noteMiss(`gl_${why}`); setFailed(true); },
        });
        st.layerObj.onShown((path, field, drawnFactor) => {
          tel().shown = { path, at: Date.now(), validMs: field ? field.validMs : null };
          // Called from MapLibre's render: publish after it (subscribers re-render React).
          // the entry the step asked for when it is this file (two entries may share one file)
          const e = st.wantEntry && st.wantEntry.path === path ? st.wantEntry : st.byPath.get(path);
          st.shownRec = { url: path, dataMs: field ? field.validMs : NaN, model: e ? e.model : M, estimated: e ? e.estimated : null,
            fill: !!(e && e.gap), coarse: !!(e && e.coarse), nearestMaxHours: st.nearestMaxHours || 1, drawnFactor: drawnFactor || 1,
            // the drawn field's own longitude spacing (degrees), read from its decoded grid: the source line names it (rasterDrawnFrame)
            gridDeg: field && field.cols > 1 && field.bounds ? (field.bounds.east - field.bounds.west) / (field.cols - 1) : null };
          emitOwnShown(layer, path);                     // synchronous: the isobars cut with the field, in the same frame
          if (layer === 'gusts') setShownGustField(field || null);   // the wind particles take their colour from it (gustParticles.js)
          if (layer === 'currents') setShownCurrentField(field || null, setOfPath(path));   // the particles flow on it (currentParticles.js)
          if (path && st.widen) Promise.resolve().then(() => { if (st.widen) st.widen(); });   // first frame on screen: prefetch now
          // A gap-fill frame reports '<MODEL(S)>:fill:<PICKED>': the credit names every source in it and says it is an estimate.
          const rec = st.shownRec;
          const eng = rec ? (rec.fill ? `${rec.model}:fill:${M}` : rec.model) : sourceModel(layer, M);
          Promise.resolve().then(() => { publish(); setEngaged(layer, eng); if (path) setShown(true); });
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
      emitOwnShown(layer, null);
      if (layer === 'gusts') setShownGustField(null);
      if (layer === 'currents') setShownCurrentField(null);
    };
  }, [engaged, mapInstance, layer, beforeId]);

  // 3. The palette, per theme (a step LUT of the .om path's own scale).
  useEffect(() => {
    const L = ref.current.layerObj;
    if (!engaged || !L || !SCALES[layer]) return undefined;
    let alive = true;
    const apply = (scale) => {
      if (!alive || ref.current.layerObj !== L) return;
      if (!scale || !Array.isArray(scale.breakpoints)) { noteMiss('no_scale'); return; }   // no LUT: the layer draws nothing
      L.setLut(buildStepLut(scale, LUTS[layer]), LUTS[layer]);
    };
    const scale = SCALES[layer](theme);
    if (scale || !LIB_SCALE[layer]) apply(scale);
    else {
      import('@openmeteo/weather-map-layer')
        .then((m) => apply(scaleForTheme(m.defaultOmProtocolSettings && m.defaultOmProtocolSettings.colorScales[LIB_SCALE[layer]], theme)))
        .catch(() => apply(null));
    }
    if (layer === 'pressure') L.setIsobarColor(ISO_INK[theme] || ISO_INK.dark);
    // Gusts tint the basemap on light and beach exactly as the wind field does (gustParticles.gustFieldTint); read each frame,
    // so both kills act live.
    if (layer === 'gusts' && typeof L.setTint === 'function') {
      L.setTint((z) => gustFieldTint(theme, z, (zz) => opacityAtZoom(GUST_OPACITY_STOPS, zz), v2FieldTint(theme)));
    }
    // DARK FIELD PARITY (gustPalette.gustDarkFieldOn): dark draws at the wind field's own opacity (0.48), decided with the LUT just built.
    if (layer === 'gusts' && typeof L.setOpacityAt === 'function') {
      // Captured with the LUT, never re-read per frame: a kill set later must not pair this LUT with the other opacity.
      const op = gustDarkFieldOn(theme) ? gustFieldOpacity(theme, 2, () => 0, {}) : null;
      L.setOpacityAt(op === null ? null : () => op);
    }
    return () => { alive = false; };
  }, [engaged, layer, theme, gen]);

  // 3b. Air temperature's elevation downscale (ownRasterDownscale.js): T + lapse * dz once its static asset is resident. The
  // field draws as is until then. Kill: window.__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__ = true.
  useEffect(() => {
    const L = ref.current.layerObj;
    if (!engaged || !L || !downscaled(layer, M)) return undefined;
    let alive = true;
    loadDownscale(ref.current.dzVariant).then((asset) => {
      if (!alive || ref.current.layerObj !== L || !asset) return;
      if (L.setDownscale(asset)) setDownscaled(layer, true);
    });
    // The layer outlives a model switch (its GL effect does not depend on the model): clear the correction on the way out, so a
    // switch to EURO or ICON never keeps GFS's terrain correction on another model's field.
    return () => { alive = false; setDownscaled(layer, false); if (ref.current.layerObj === L) L.setDownscale(null); };
  }, [engaged, layer, gen, M]);

  // 4. Each step: the frame for the asked time, the window around it, the hard cut when it is resident.
  // SAME FRAME (2026-11-14): a LAYOUT effect, so the layer is told the new frame in the same commit that paints the new time
  // label, before that paint (a passive effect ran after it: the label led the field by one painted frame on every step).
  // Kill: window.__RAW_DISABLE_RASTER_OWN_SAME_FRAME__ = true (read once per mount: the effect kind never changes mid-life).
  useStepEffect(() => {
    const st = ref.current;
    const L = st.layerObj;
    if (!engaged || (!index && !(hasFill && fbIndex)) || !L) return;
    const frames = combinedFrames(layer, M, failed ? null : index, fbIndex, offIndex);
    st.byPath = new Map(frames.slice().reverse().map((x) => [x.path, x]));   // a file's own-model entry wins over a stand-in entry
    const offset = Number(timeOffsetHours) || 0;
    if (st.prevOffset !== null && offset !== st.prevOffset) st.dir = offset > st.prevOffset ? 1 : -1;
    st.prevOffset = offset;
    const validMs = Date.now() + offset * 3600000;
    const f = combinedFrameAt(frames, validMs);
    if (!f) {
      L.want(null);
      emitOwnWant(layer, null);
      st.wantRec = null;
      if (ownOnly && !rasterReadoutKilled()) {   // own-only: nothing else draws this hour (past the set's last frame)
        const last = frames.length ? Date.parse(frames[frames.length - 1].valid_time) : NaN;
        const runMs = index ? Date.parse(index.run_time || index.run || '') : NaN;
        const end = validMs > last ? endNoteText(layer, M, last, runMs) : null;   // past the model's range: say whose range ended
        publishRasterDrawn({ layer, shown: null, want: null, unavailable: end || `${RASTER_NAMES[layer] || layer}: no forecast for this hour` });
      } else publish();
      noteMiss('no_frame');
      if (layer === 'gusts') setShownGustField(null);   // past the gust range: the particles drop the last frame's colours (advisor hold, #1079)
      if (layer === 'currents') setShownCurrentField(null);   // no current frame for the hour: no particles (the status line says so)
      tel().want = { validMs, path: null, at: Date.now() };
      setWanted(layer, [], null);
      return;
    }
    const cur = frames.findIndex((x) => x.path === f.path);
    // Half the gap to the neighbouring frames: within it the line says "the nearest stored forecast" (3-hourly: 1 h).
    const at = (i) => (frames[i] ? Date.parse(frames[i].valid_time) : NaN);
    const gaps = [at(cur) - at(cur - 1), at(cur + 1) - at(cur)].filter((g) => Number.isFinite(g) && g > 0);
    st.nearestMaxHours = Math.floor((gaps.length ? Math.max(...gaps) / 3600000 : 1) / 2);
    // AT A SET'S EDGE (2026-11-15, the gusts/currents 14-day scrub: the last frame drawn 2 h from the asked hour with no note):
    // there is no neighbour beyond the first / last frame, so half a gap is not the bound; the pick reaches a whole 3-hour
    // window (pickIndexFrame), and the note must cover all of it.
    // The seam between a model's last own frame and the stand-in after it is an edge too: own frames win up to 3 h past the
    // model's range (combinedFrameAt), so its last frame can be drawn 2 h from the asked hour with the stand-in nearer in the list.
    const seam = !!(frames[cur + 1] && frames[cur + 1].estimated && !frames[cur].estimated);
    if ((cur === 0 || cur === frames.length - 1 || seam) && edgeNoteOn()) st.nearestMaxHours = Math.max(st.nearestMaxHours, 3);
    st.wantEntry = f;
    st.wantRec = { url: f.path, dataMs: Date.parse(f.valid_time), model: f.model, estimated: f.estimated, fill: !!f.gap, coarse: !!f.coarse, nearestMaxHours: st.nearestMaxHours };
    if (st.shownRec) st.shownRec = { ...st.shownRec, nearestMaxHours: st.shownRec.url === f.path ? st.nearestMaxHours : st.shownRec.nearestMaxHours };
    publish();
    const full = planWindow(cur, frames.length, st.dir, ownWindowRadius(layer)).map((i) => frames[i]);
    // FIRST FRAME FIRST (2026-11-16, the advisor's condition 3 on #928: on a throttled link the cold toggle's first frame shared
    // the bandwidth with the prefetched neighbours, ~6 s to first paint on Fast 4G). Own-only layers fetch only the wanted
    // frame until a frame of this engagement is on screen; onShown then widens to the full window. Kill:
    // window.__RAW_DISABLE_OWN_FIRST_FRAME_FIRST__ = true (the whole window at once, as before).
    const firstOnly = ownOnly && !st.shownRec && firstFrameFirstOn();
    const win = firstOnly ? [f] : full;
    st.widen = firstOnly ? () => { st.widen = null; setWanted(layer, full, st.onFieldCb); } : null;
    // Isobars (pressure): asked of the worker as a frame lands, never computed in this step (isobarStore caches per path).
    const iso = layer === 'pressure' ? requestIsobars : null;
    for (const w of win) { const got = getField(w.path); if (got) { L.offerField(w.path, got); if (iso) iso(w.path, got); } }
    noteStep(f.path, L.isResident(f.path) || !!getField(f.path));
    L.want(f.path);
    emitOwnWant(layer, f.path);
    tel().want = { validMs, path: f.path, frameMs: Date.parse(f.valid_time), model: f.model, estimated: f.estimated, at: Date.now() };
    st.onFieldCb = (path, field) => { const now = ref.current.layerObj; if (now) now.offerField(path, field); if (iso) iso(path, field); };
    setWanted(layer, win, st.onFieldCb);
  }, [engaged, index, fbIndex, offIndex, failed, timeOffsetHours, layer, M, gen]);

  // NO .om FALLBACK for an own-only model of a handover layer (ICON air temperature, 2026-11-18): while the layer is on, it stays
  // claimed, so MapWebGL never draws (or asks Open-Meteo for) the .om copy: not on a cold toggle, not on a missing set, index or
  // hour, and NOT under a kill either (the director, relaying the owner: no kill switch falls back to Open-Meteo). A kill (layer,
  // own-frames or per-set) only stops our frames; the status line then says "unavailable" (1c), as for gusts and currents.
  if (active && ownOnlyFor(layer, M)) return true;
  if (!handoverLayer(layer) || (typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_HANDOVER__ === true)) return engaged;
  return engaged && shown;
}
