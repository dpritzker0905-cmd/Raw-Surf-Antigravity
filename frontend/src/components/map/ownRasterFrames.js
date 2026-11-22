/**
 * ownRasterFrames.js — the raster weather layers from OUR OWN static frames instead of Open-Meteo's .om files (2026-10-23).
 *
 * WHY. The owner: "I want ... all the layers ... instant load upon activating the toggle, and instant scrub" and "we want free
 * grib data". Today each raster hour is a 38-166 MB Open-Meteo .om file read in 64 KB ranges (1.1-5 MB per hour per layer,
 * a whole-world decode per hour; baseline in docs/weather-program/log/2026-10-22-claude-raster-instant.md), under
 * Open-Meteo's terms. The ingest now publishes the free NOAA GRIB fields as immutable gzipped RSWF frames on our CDN
 * (backend/services/frame_binary.py; the publisher is the static-frames lane's), one set per model x layer, listed in
 * v1/latest.json. Phase 1 is GFS mean-sea-level pressure:
 *   set  GFS/weather/pressure/global_0p5   720 x 361, outer cell centres -180..179.5 / -90..90, south row first, no wrap
 *        column; f000-f336 every 3 h; field 6 pressure_hpa u16 (value = code * 0.1 + 799.9, code 0 = no data).
 * This module holds the data side: the pinned index (staticFrames' pin rules), the frame for an asked time (the nearest stored
 * frame within 3 h, pickIndexFrame: NO time interpolation, the status line says "nearest stored forecast"), a direction-aware
 * window of at most +-2 frames (+-1 on handhelds) and a small LRU of decoded Float32 fields. Raster frames do NOT join any
 * idle whole-run fill (egress): only the window is fetched, on demand. ownRasterLayer.js draws; useOwnRasterFrames.js wires.
 *
 * Cloud cover (the 'satellite' layer) is ON by default since D-052 (2026-10-26, DEFAULT_ON_LAYERS); pressure since 2026-11-12 (the
 * owner: "Yes, publish pressure"; kill window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true). Every other layer is DARK:
 * window.__RAW_RASTER_OWN_FRAMES__ = true (or localStorage '__RAW_RASTER_OWN_FRAMES__' = 'true') turns it on;
 * window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true, the static-frames global kill or the per-set kill
 * (__RAW_DISABLE_STATIC_FRAMES_SETS__) turn it off. Any miss (no set published, no index) falls back to the .om path.
 * Telemetry: window.__RAW_OWN_RASTER__.
 */
import { fetchFrameBytes, getPinnedIndex, loadFrameParsed, markStaticPinStale, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';
import { decodeOwnField, decodeWorkerKilled } from './ownRasterDecode';
import { pickIndexFrame } from './staticFrameCodec';
import { isHandheldDevice } from './deviceTier';
import { applyWaterTempLandFill } from './waterTempLandFill';

export const PRESSURE_FIELD = 6;
export const TEMP_FIELD = 7;      // temp_c: u16, value = code * 0.05 - 100.05 (code 0 = no data); 2 m air temperature, deg C
export const CLOUD_FIELD = 8;     // cloud_pct: u8, value = code - 1 (code 0 = no data); total cloud cover, %
export const PRECIP_FIELD = 10;   // precip_mm_h: u16, value = code * 0.01 - 0.01 (code 0 = no data); mm/h in the step before the hour
// ONE-BYTE BAND fields (2026-11-16, lever A of #928's 4G gate; backend frame_binary.BAND_FIELDS): u8, code k -> the band centre
// (k - 1) x step + step / 2 through the generic descriptor; 255 = saturated (the top band). A set lists its fields in preference
// order, so frames published before the change (field 4) still decode during the rollout.
export const GUST_BAND_FIELD = 12;     // gusts, 0.5 kn bands
export const CURRENT_BAND_FIELD = 13;  // ocean current speed, 0.02 kn bands
export const SPEED_FIELD = 4;     // speed: u16, value = code * 0.01 - 0.01 (code 0 = no data); knots (gusts; the wind frames' field)
export const FOG_FIELD = 11;     // visibility_m: u16, value = code - 1 (code 0 = no data); surface visibility, metres (GFS VIS)
// PER-MODEL (2026-10-24; the owner, 2026-10-23 20:13 EDT: "Yes start it", answering "start the per-model pressure route?" after
// "We want each models pressure showing"): one published set per model. The layer follows the model selector; past a model's
// last frame (EURO 240 h, ICON 180 h) the GFS frame stands in, labelled as an estimate (the wave layers' extension policy).
export const OWN_RASTER_SETS = {
  pressure: {
    models: { GFS: 'GFS/weather/pressure/global_0p5', EURO: 'EURO/weather/pressure/global_0p5', ICON: 'ICON/weather/pressure/global_0p5' },
    fallback: 'GFS', field: PRESSURE_FIELD, unit: 'hPa',
  },
  // AIR TEMPERATURE (2026-10-24, the lead's order after per-model pressure): GFS TMP 2 m only (#515's set, f000-f336 every 3 h).
  // EURO and ICON have no own set yet, so with those picked the layer stays on the .om path, which draws that model as before
  // (no GFS frames under a EURO or ICON label, and so no stand-in tail either).
  // PER MODEL since 2026-11-14 (the overnight instant lane): ECMWF 2t and DWD ICON T_2M sets, as pressure. A model whose set is
  // not published yet misses (no index) and stays on the .om path, which draws that model as before.
  temperature: {
    // EURO at 0.25 deg (ECMWF 2t, every point: the .om ifs025 grid, #888); GFS and ICON at 0.5 deg.
    models: { GFS: 'GFS/weather/temperature/global_0p5', EURO: 'EURO/weather/temperature/global_0p25', ICON: 'ICON/weather/temperature/global_0p5' },
    fallback: null, field: TEMP_FIELD, unit: '°C',
  },
  // FOG (2026-11-14): GFS surface visibility, the field the .om path draws for EVERY model (it pins ncep_gfs025 for fog,
  // openMeteoEndpoints.js), so every model reads the GFS set here too: the same field under the same label as before.
  fog: {
    models: { GFS: 'GFS/weather/fog/global_0p25', EURO: 'GFS/weather/fog/global_0p25', ICON: 'GFS/weather/fog/global_0p25' },
    fallback: null, field: FOG_FIELD, unit: 'm',
  },
  // WATER TEMPERATURE (2026-11-14): the model's SKIN temperature, as the .om path's surface_temperature: GFS for GFS and for ICON
  // (DWD ICON has no skin temperature; the .om path makes the same cross-fall), ECMWF skt for EURO when its set is published.
  // Land is covered as on the .om path: an ocean fill against the Natural Earth land mask at decode (landFill), and the layer
  // anchored below the ocean mask's land fill (MapWebGL).
  // ICON (G4, 2026-11-17): the Copernicus ocean model's top-layer temperature (1/6 deg world set, hourly mean every 3 h), not
  // GFS's skin under ICON's name: the credit and status line say Copernicus (sourceModel). ON by default (DEFAULT_ON_MODELS).
  water_temp: {
    models: { GFS: 'GFS/weather/water_temp/global_0p25', EURO: 'EURO/weather/water_temp/global_0p25', ICON: 'CMEMS/marine/water_temp/global_1p6' },
    fallback: null, field: TEMP_FIELD, unit: '°C', landFill: true,
  },
  // CLOUD COVER (2026-10-24): the app's 'satellite' layer draws forecast total cloud cover (Satellite IR was discontinued,
  // useWeatherState). GFS TCDC, the instantaneous entire-atmosphere message (#515's set). GFS only, as air temperature.
  satellite: {
    // 0.25 deg (the owner, 2026-10-25: "Go with your recommendation if that is state of the art"): 1440 x 721, so cloud
    // edges are not one-cell 0.5-degree steps. The shader and the wrap test take the grid from each frame.
    models: { GFS: 'GFS/weather/cloud_cover/global_0p25' },
    fallback: null, field: CLOUD_FIELD, unit: '%',
  },
  // PRECIPITATION (2026-11-12, the owner: "Yes, build it"): the app's 'rain' layer from GFS APCP (frame_set_raster.py,
  // set `precipitation`): mm/h in the hour before the frame (the 3-hour mean past f120), the same meaning as the .om field,
  // on the 0.25-degree grid, hourly to f120. DARK: drawn only behind the lever (window.__RAW_RASTER_OWN_FRAMES__ = 'rain') until
  // the owner's side-by-side. Kill: window.__RAW_DISABLE_RASTER_OWN_RAIN__ = true.
  // EURO (2026-11-12, the owner: "Yes, add ICON and EURO precipitation after the blend"): ECMWF `tp` as the mean rate over each
  // 3-hour step to 144 h and 6-hour step to 240 h (set `precipitation_euro`), on the same grid. Past EURO's last frame the GFS
  // frame stands in, labelled as an estimate, as pressure does (the 14-day scrubber is never cut to a model's own range).
  // ICON has no set: with ICON picked the layer stays on the .om path.
  rain: {
    models: { GFS: 'GFS/weather/precipitation/global_0p25', EURO: 'EURO/weather/precipitation/global_0p25' },
    fallback: 'GFS', field: PRECIP_FIELD, unit: 'mm/h',
  },
  // GUSTS (2026-11-15, the owner approved Gusts as a new picker layer; "these lanes need to serve instantly from real GFS, EURO,
  // and ICON lanes from GRIB"): EACH MODEL'S OWN gust, in KNOTS (the wind layer's unit), 0.25 deg (frame_set_raster.py sets
  // `gust`, `gust_euro`, `gust_icon`): GFS GUST (instantaneous, hourly to 120 h), ECMWF 10fg (max since the previous step, 3/6 h)
  // and DWD ICON VMAX_10M (max since the previous output, hourly to 78 h). The credit says which definition is on screen
  // (LayerDataCredit). Past EURO's 240 h / ICON's 180 h the GFS frame stands in, labelled as an estimate (pressure's policy).
  // OWN-FRAMES ONLY (`ownOnly`): there is no .om path behind it, so a miss draws nothing and the status line says so.
  // ON by default (DEFAULT_ON_LAYERS); kill: window.__RAW_DISABLE_RASTER_OWN_GUSTS__ = true.
  gusts: {
    models: { GFS: 'GFS/weather/gust/global_0p25', EURO: 'EURO/weather/gust/global_0p25', ICON: 'ICON/weather/gust/global_0p25' },
    // PAST EACH MODEL'S RANGE (EURO 240 h, ICON 180 h): NO GUSTS, and the status line says so (`endNote`). The owner, 2026-11-15
    // 19:27 EST: "I dont want icon wind past 7.5 days switched to gfs, we need a scientific estimation" (the same for gusts):
    // never another model's field, never a loop. The ECMWF ensemble gust (member median, p90 risk cue; log §8, PR #939) plugs
    // in later as a BEYOND strategy named here per model (`beyond: { ICON: 'ens_mean_extension', ... }` + a `fallback`).
    fallback: null, endNote: true, field: [GUST_BAND_FIELD, SPEED_FIELD], unit: 'kn', ownOnly: true,
  },
  // OCEAN CURRENTS (2026-11-15, the owner approved Currents as a new picker layer): Copernicus Marine's global ocean model,
  // surface current SPEED in knots (field 4) every 6 h to 240 h on 0.25 deg (frame_set_raster.py set `currents`); each frame
  // also carries the direction the water flows TOWARD (field 1, the wind frames' layout, uv_convention 1) for a flow overlay.
  // One ocean model for every picked model (the credit names Copernicus Marine). Own frames only; ON with a kill:
  // window.__RAW_DISABLE_RASTER_OWN_CURRENTS__ = true. Past day 10 there is no frame: the status line says so.
  currents: {
    models: { GFS: 'CMEMS/marine/currents/global_0p25', EURO: 'CMEMS/marine/currents/global_0p25', ICON: 'CMEMS/marine/currents/global_0p25' },
    // PER-PICKER OCEAN MODELS (2026-11-22): GFS, EURO and ICON have no open surface-current forecast, so each picker gets its own
    // independent ocean model, credited under its OWN name (sourceModel -> MODEL_SOURCE / LayerDataCredit): ICON -> Canada GIOPS
    // (ECCC; DWD runs no ocean model), GFS -> NOAA Global RTOFS (its own lane), EURO stays Copernicus. An entry replaces the
    // `models` key while it is on: `on` (its default) unless `kill` is set, or the `lever` opts in. DARK until the set has a
    // published run (a miss on an own-only layer draws nothing): flip `on` after the first publish. A killed or off entry reads
    // `models` (Copernicus) again.
    modelSets: {
      ICON: { key: 'GIOPS/marine/currents/global_0p25', on: false, lever: '__RAW_GIOPS_CURRENTS__', kill: '__RAW_DISABLE_GIOPS_CURRENTS__' },
    },
    fallback: null, field: [CURRENT_BAND_FIELD, SPEED_FIELD], unit: 'kn', ownOnly: true,
  },
};
/** The status line past a model's own frames for a layer with `endNote` (gusts): "ICON gusts end at day 7.5; ensemble estimate
 *  coming" (the owner's word, 2026-11-15 19:27 EST; the director's wording). `lastMs` = the model's last frame, `runMs` its run. */
export function endNoteText(layer, model, lastMs, runMs) {
  const set = OWN_RASTER_SETS[layer];
  // GFS gusts run the whole 14 days: past its last frame only a newer run is missing, not a model's range.
  if (!set || !set.endNote || up(model) === 'GFS' || !Number.isFinite(lastMs) || !Number.isFinite(runMs)) return null;
  const days = Math.round(((lastMs - runMs) / 86400000) * 10) / 10;
  const name = { gusts: 'gusts' }[layer] || layer;
  return `${up(model)} ${name} end at day ${days}; ensemble estimate coming`;
}
/** Layers drawn ONLY from our own frames (no .om path behind them): the picker shows them, a miss shows nothing. */
export const OWN_ONLY_LAYERS = Object.freeze(Object.keys(OWN_RASTER_SETS).filter((l) => OWN_RASTER_SETS[l].ownOnly));
// Who the frames come from, for the legend credit and the status line.
export const MODEL_SOURCE = { GFS: 'NOAA GFS', EURO: 'ECMWF', ICON: 'DWD ICON', CMEMS: 'Copernicus Marine', GIOPS: 'Canada GIOPS (ECCC)' };
const up = (m) => String(m || 'GFS').toUpperCase();
/** The model whose data a layer's set for `model` really holds (the set key's first part): GFS for fog and gusts under any picked
 *  model, so the credit and the status line never name ECMWF or DWD over NOAA's field. */
export function sourceModel(layer, model = 'GFS') {
  const key = setKey(layer, model);
  return key ? key.split('/')[0] : up(model);
}
/** The set key for a layer and model, or null when that model has no own set. */
export function setKey(layer, model = 'GFS') {
  const set = OWN_RASTER_SETS[layer];
  if (!set) return null;
  const alt = set.modelSets && set.modelSets[up(model)];
  if (alt && modelSetOn(alt)) return alt.key;
  return set.models[up(model)] || null;
}
/** Is a per-picker `modelSets` entry on? Its kill wins; then its lever (window, or localStorage for a phone); then its default. */
export function modelSetOn(alt) {
  const w = W();
  if (w[alt.kill] === true) return false;
  let lever = w[alt.lever];
  if (lever === undefined || lever === null) {
    try { lever = w.localStorage ? w.localStorage.getItem(alt.lever) : null; } catch (e) { lever = null; }
  }
  if (lever === true || lever === '1' || lever === 'true') return true;
  return alt.on === true;
}
// What a no-data node becomes in the uploaded field: far below every real value of every layer (air temperatures are negative,
// so the shader's no-data test is `< NO_DATA_BELOW`, never `< 0`).
export const MISSING = -9999;
export const NO_DATA_BELOW = -9000;
const LRU_MAX = 6;                // the desktop window (4) plus the last two shown
const STEPS_KEPT = 400;

const W = () => (typeof window !== 'undefined' ? window : {});

/** Layers whose own frames draw with no lever set; each is its own owner decision (D-052, 2026-10-26, the owner: "Flip both: the
 *  MARINE_GULF_FILL_MID_TARGETED repo variable and cloud 0.25 deg (repo var, then the client key after one publish)").
 *  Kill one layer: window.__RAW_DISABLE_RASTER_OWN_<LAYER>__ = true (cloud: __RAW_DISABLE_RASTER_OWN_SATELLITE__); kill all:
 *  __RAW_DISABLE_RASTER_OWN_FRAMES__. A miss (set not in latest.json, no index) still falls back to the .om path. */
// PRESSURE (2026-11-12): the owner, "Yes, publish pressure", answering "Turn on pressure frame publishing in the ingest so I can
// flip pressure on?". GFS, EURO and ICON each draw their own published set (a scrub step rebinds a resident texture instead of
// decoding a whole-world .om hour), with the labelled isobars and H/L markers that ride the own-frames field.
// Kill: window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true (the .om colour field, no isobars, as before).
// FOG (2026-11-14, the director's overnight lane, relaying the owner 23:35 EST: "improve the fog, air temp, and water temp along with
// the others, so that all lanes are upgrades and instant"): built for every model on the .om path's own grid (GFS 0.25 deg).
// DEFAULT-OFF PENDING THE OWNER (2026-11-14, vote split 08:31Z): the pre-registered gate was not met in full (desktop and phone
// numbers: docs/weather-program/log/2026-11-14-opus-raster-own-three.md), so Reflection said no and SubQ yes; David's rule needs
// both. Turning it on is one line: add 'fog' here. Until then the lever reaches it (window.__RAW_RASTER_OWN_FRAMES__ = 'fog').
// Kill: __RAW_DISABLE_RASTER_OWN_FOG__.
// GUSTS (2026-11-15): a NEW layer, own frames only, ships ON (CLAUDE.md: new layers ship ON with a kill switch). Kill:
// __RAW_DISABLE_RASTER_OWN_GUSTS__ (the picker then hides the layer, MapWeatherControls). CURRENTS (2026-11-15), the same:
// kill __RAW_DISABLE_RASTER_OWN_CURRENTS__.
export const DEFAULT_ON_LAYERS = Object.freeze(['satellite', 'pressure', 'gusts', 'currents']);
// PER-MODEL DEFAULTS (2026-11-14, the director), under the no-regression rule: a layer moves to own frames by default only where its
// set is at least as fine as what the .om path draws today.
//  - water_temp EURO: ECMWF skt at 0.25 deg = the .om ifs025: built, DEFAULT-OFF pending the owner (vote split 08:31Z, as fog).
//  - water_temp ICON (DWD ICON has no sea temperature): the Copernicus ocean-model set (G4), ON (David 2026-11-17: "make them
//    start on, with a test and kill switch"); the section 11 observation check runs after, as its guardrail. Until the set is
//    published a miss keeps ICON on the .om path (GFS skin, as before). Kill: __RAW_DISABLE_RASTER_OWN_WATER_TEMP__.
//  - water_temp GFS: OFF (the .om gfs013, 0.117 deg, is finer than the 0.25 deg set).
//  - temperature EURO: ECMWF 2t at 0.25 deg = the .om ifs025 (#888): built, DEFAULT-OFF pending the owner (as fog).
//  - temperature GFS: OFF until a pre-registered visual-parity comparison at z5 / z7 / z9 (desktop + phone) shows the 0.5 deg set +
//    ETOPO downscale no coarser than the .om gfs013. ICON: OFF (0.5 deg vs dwd_icon ~0.125 deg; a 0.125 deg set is not built).
// Kills: __RAW_DISABLE_RASTER_OWN_TEMPERATURE__, __RAW_DISABLE_RASTER_OWN_WATER_TEMP__ (each the .om path, as before).
// Turning them on: { temperature: ['EURO'], water_temp: ['EURO'] } here. The lever reaches every model meanwhile.
export const DEFAULT_ON_MODELS = Object.freeze({ water_temp: ['ICON'] });   // G4 (David 2026-11-17: start on, with a test and kill)

/** Is the own-frames path on for this layer and model? Synchronous, no I/O. A model without its own set (or with its set killed)
 *  stays on the .om path, which draws that model as before (never another model's frames under its label). */
export function ownFramesOn(layer, model = 'GFS') {
  const key = setKey(layer, model);
  if (!key) return false;
  const w = W();
  if (w.__RAW_DISABLE_RASTER_OWN_FRAMES__ === true) return false;
  if (w[`__RAW_DISABLE_RASTER_OWN_${String(layer).toUpperCase()}__`] === true) return false;
  let lever = w.__RAW_RASTER_OWN_FRAMES__;
  if (lever === undefined || lever === null || lever === false) {
    try { lever = w.localStorage ? w.localStorage.getItem('__RAW_RASTER_OWN_FRAMES__') : null; } catch (e) { lever = null; }
  }
  const covered = leverCovers(lever, layer) || DEFAULT_ON_LAYERS.includes(layer) || (DEFAULT_ON_MODELS[layer] || []).includes(up(model));
  return covered && staticFramesEnabled() && !!staticFramesBase() && staticSetEnabled(key);
}

/** The lever's value covers a layer: true / 'true' = every own layer; a comma list ('pressure,temperature') = those layers.
 *  Each layer is its own owner decision, so a flip can name exactly the layers it means. */
export function leverCovers(lever, layer) {
  if (lever === true || lever === 'true') return true;
  if (typeof lever !== 'string') return false;
  return lever.split(',').map((s) => s.trim()).includes(layer);
}

export function tel() {
  const w = W();
  if (!w.__RAW_OWN_RASTER__) {
    w.__RAW_OWN_RASTER__ = { loads: 0, loadErrors: 0, bytes: 0, decodeMs: [], misses: {}, steps: [], shown: null, want: null, pin: null };
  }
  return w.__RAW_OWN_RASTER__;
}
export function noteMiss(reason) { const t = tel(); t.misses[reason] = (t.misses[reason] || 0) + 1; }

// The last index pinned per layer and model: a toggle draws from it at once (one frame round trip) while ownIndex refreshes it.
const _lastIndex = {};
export const lastIndex = (layer, model = 'GFS') => _lastIndex[`${layer}/${up(model)}`] || null;

/** The pinned index for a layer's set of one model (async; null when none is published or the path is off). */
export async function ownIndex(layer, model = 'GFS') {
  if (!ownFramesOn(layer, model)) return null;
  try {
    const idx = await getPinnedIndex(setKey(layer, model));
    if (idx) _lastIndex[`${layer}/${up(model)}`] = idx;
    if (idx) tel().pin = { layer, model: up(model), index: idx.path || null, run: idx.run || null, frames: idx.frames.length, validMs: framesOf(idx).map((f) => Date.parse(f.valid_time)) };
    return idx || null;
  } catch (e) { return null; }
}

/**
 * The frames a scrub walks for one model: its own, then (when it has a fallback and the fallback's index is given) the
 * fallback's frames past its last one, flagged `estimated` (the basis the status line names). Each entry is a shallow copy
 * carrying the set key it loads from (`setKey`) and the model it shows (`model`); the indexes are never mutated.
 */
export function combinedFrames(layer, model, index, fallbackIndex) {
  const m = up(model);
  const own = framesOf(index).map((f) => ({ ...f, setKey: setKey(layer, m), model: sourceModel(layer, m), estimated: null }));
  const set = OWN_RASTER_SETS[layer] || {};
  const fb = set.fallback;
  if (!fallbackIndex || !fb || fb === m || !own.length) return own;
  const strategy = BEYOND[(set.beyond && set.beyond[m]) || 'gfs_standin'];
  return own.concat(strategy ? strategy({ layer, model: m, own, fallback: fb, fallbackIndex }) : []);
}

/** PAST A MODEL'S RANGE: how the hours after its last own frame are filled, one named strategy per (layer, model) in a set's
 *  `beyond` map (default 'gfs_standin', the pressure / rain / EURO wind rule). A strategy returns the tail entries, each
 *  { ...frame, setKey, model, estimated: <basis the status line words> }. The long-range method the senior research lead is
 *  choosing (2026-11-15) plugs in here as a new entry; looping a model's own days is deliberately NOT one of them. */
export const BEYOND = {
  gfs_standin: ({ layer, own, fallback, fallbackIndex }) => {
    const last = Date.parse(own[own.length - 1].valid_time);
    return framesOf(fallbackIndex).filter((f) => Date.parse(f.valid_time) > last)
      .map((f) => ({ ...f, setKey: setKey(layer, fallback), model: fallback, estimated: 'gfs_estimated_fallback' }));
  },
};

/** The entry to show for an asked time in a combined list: the nearest within 3 h of the model's own, else (past its range)
 *  of the stand-in tail. pickIndexFrame's rule on each part, so own frames always win inside the model's range. */
export function combinedFrameAt(frames, validMs) {
  const own = frames.filter((f) => !f.estimated);
  const f = pickIndexFrame({ frames: own }, validMs);
  if (f && f.path) return f;
  const lastOwn = own.length ? Date.parse(own[own.length - 1].valid_time) : -Infinity;
  if (validMs <= lastOwn) return null;
  const g = pickIndexFrame({ frames: frames.filter((x) => x.estimated) }, validMs);
  return g && g.path ? g : null;
}

/** The index's frames that have a file, in valid-time order (the window walks these). */
export function framesOf(index) {
  return index && Array.isArray(index.frames) ? index.frames.filter((f) => f && f.path) : [];
}

/** The frame to show for an asked time: the nearest stored one within 3 h, or null (a gap: the caller shows nothing). */
export function frameAt(index, validMs) {
  const f = pickIndexFrame(index, validMs);
  return f && f.path ? f : null;
}

export function windowRadius() { return isHandheldDevice() ? 1 : 2; }
/** PHONE PREFETCH (2026-11-15, the gusts/currents gate): handhelds keep +-1 frame, and at a brisk scrub (a step every ~250 ms) the
 *  next hourly 0.25-deg frame (~0.9 MB, ~230 ms to fetch at 150 ms latency) was not there yet: GFS gusts' phone step p50 was
 *  361 ms, almost all window misses. The own-only layers keep TWO frames ahead in the scrub direction on every device (one
 *  behind). Scoped to them, so the live lanes keep their measured behaviour. Kill: __RAW_DISABLE_OWN_ONLY_PREFETCH2__. */
export function ownWindowRadius(layer) {
  const base = windowRadius();
  if (!OWN_ONLY_LAYERS.includes(layer) || W().__RAW_DISABLE_OWN_ONLY_PREFETCH2__ === true || meteredLink()) return base;
  return Math.max(2, base);
}
/** A link the user or the browser marks as costly or slow (Save-Data, or an effective type below 4G): the own-only layers' frames
 *  are 0.9-1.8 MB, so they keep the device's own prefetch radius there (the advisor's red-team of #928, condition 3). */
export function meteredLink(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
  if (!c) return false;
  return c.saveData === true || ['slow-2g', '2g', '3g'].includes(c.effectiveType);
}

/**
 * The frame positions to hold, in fetch priority: the shown one, then up to `radius` ahead in the scrub direction, then one
 * behind (a reversal then costs no wait). `dir` < 0 is a backward scrub. Desktop (radius 2): 4 frames; handheld (1): 3.
 */
export function planWindow(cur, n, dir, radius) {
  if (!(n > 0) || !(cur >= 0) || cur >= n) return [];
  const d = dir < 0 ? -1 : 1;
  const out = [cur];
  for (let k = 1; k <= radius; k++) { const a = cur + d * k; if (a >= 0 && a < n) out.push(a); }
  const b = cur - d;
  if (radius >= 1 && b >= 0 && b < n) out.push(b);
  return out;
}

/** WATER TEMP's land cover at decode, as the .om path's (openMeteoProtocol -> waterTempLandFill): land-contaminated skin-temperature
 *  cells take their clean water neighbours' mean against the Natural Earth land mask of THIS lattice (rows south first, the same
 *  orientation as the .om grids the mask was written for). The mask builds once per lattice; the first frame waits for it so no
 *  frame is ever drawn with land heat at the coast. No mask (no OffscreenCanvas): the field draws as is, noted, and the ocean
 *  mask's land fill still covers the interior. Kills: the .om path's own (__RAW_WT_LANDMASK_DISABLED__, __RAW_WT_COASTAL_QC_DISABLED__). */
export async function landFill(field) {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (g.__RAW_WT_LANDMASK_DISABLED__ === true) return;
  const b = field.bounds || {};
  const bounds = Array.isArray(b) ? b : [b.west, b.south, b.east, b.north];
  let mask = null;
  try { const om = await import('./openMeteoProtocol'); mask = await om.landCellMaskReady(field.cols, field.rows, bounds); } catch (e) { mask = null; }
  if (!mask || mask.length !== field.values.length) { noteMiss('wt_landfill_skipped'); return; }
  const v = field.values;
  for (let i = 0; i < v.length; i++) if (v[i] === MISSING) v[i] = NaN;
  applyWaterTempLandFill(v, mask, field.cols, field.rows, g.__RAW_WT_COASTAL_QC_DISABLED__ === true);
  let min = Infinity; let max = -Infinity;
  for (let i = 0; i < v.length; i++) {
    if (Number.isFinite(v[i])) { if (v[i] < min) min = v[i]; if (v[i] > max) max = v[i]; } else v[i] = MISSING;
  }
  field.min = min; field.max = max;
}

/** A decoded frame's one field as the renderer uploads it: Float32 values, MISSING for no data. */
export function toField(parsed, fieldId) {
  const ids = Array.isArray(fieldId) ? fieldId : [fieldId];   // preference order (a band field first, then its two-byte form)
  const fid = ids.find((id) => parsed && parsed.fields && parsed.fields[id]);
  const src = fid !== undefined ? parsed.fields[fid] : null;
  if (!src || src.length !== parsed.cols * parsed.rows) return null;
  const values = new Float32Array(src.length);
  let min = Infinity; let max = -Infinity;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isFinite(v)) { values[i] = v; if (v < min) min = v; if (v > max) max = v; } else values[i] = MISSING;
  }
  return {
    cols: parsed.cols, rows: parsed.rows, bounds: parsed.bounds, values, min, max,
    validMs: parsed.validEpoch * 1000, runMs: Number.isFinite(parsed.runEpoch) ? parsed.runEpoch * 1000 : null,
  };
}

// ── decoded fields: one load per path, shared; an LRU over the window ────────────────────────────────────────────
const _fields = new Map();
const _inflight = new Map();
// FAILED-LOAD BACKOFF (2026-11-14): a frame whose load failed (404, CORS, offline, undecodable) is not asked again by the pump
// for FAIL_BACKOFF_MS. Before this, pump() re-started the same failed load from its own .then: an endless request loop, and a
// near-hot one offline (fetch rejects at once). Kill: window.__RAW_DISABLE_RASTER_OWN_FAIL_BACKOFF__ = true.
export const FAIL_BACKOFF_MS = 30000;
const _failedAt = new Map();
const backoffOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_FAIL_BACKOFF__ === true);
const inBackoff = (path, now = Date.now()) => backoffOn() && _failedAt.has(path) && now - _failedAt.get(path) < FAIL_BACKOFF_MS;
// One re-pump per failed frame when its backoff ends, so a viewer parked on that frame (no further step) still gets it after a
// blip. Deduped per path; all cleared when nothing is wanted (the layer's unmount sets an empty window) and by the test reset.
const _retryTimers = new Map();
function noteFailed(path) {
  _failedAt.set(path, Date.now());
  if (!backoffOn() || _retryTimers.has(path)) return;
  _retryTimers.set(path, setTimeout(() => { _retryTimers.delete(path); pump(); }, FAIL_BACKOFF_MS + 1));
}
function clearRetryTimers() { for (const t of _retryTimers.values()) clearTimeout(t); _retryTimers.clear(); }

/** The decoded field for a frame path, if held (no I/O; refreshes its LRU place). */
export function getField(path) {
  const f = _fields.get(path);
  if (f) { _fields.delete(path); _fields.set(path, f); }
  return f || null;
}

function keep(path, field) {
  _fields.set(path, field);
  while (_fields.size > LRU_MAX) _fields.delete(_fields.keys().next().value);
}

/** Load (fetch + inflate + parse + field) one frame; null on any failure. Shared per path; never aborted once started (a
 *  started frame is at most a window away, and the pump below bounds how many start). */
export function loadField(layer, frame, priority) {
  if (!frame || !frame.path) return Promise.resolve(null);
  const have = getField(frame.path);
  if (have) return Promise.resolve(have);
  const set = OWN_RASTER_SETS[layer];
  if (!set) return Promise.resolve(null);
  const key = frame.setKey || setKey(layer, 'GFS');
  let p = _inflight.get(frame.path);
  if (!p) {
    p = (async () => {
      const t = tel();
      t.loads += 1;
      // OWN-ONLY LAYERS (gusts, currents; 2026-11-15): fetch + inflate in staticFrames' worker, then decode ONLY the drawn field
      // to Float32 in ownRasterDecode's worker (no main-thread parse of every field). The live lanes keep the shared path.
      if (set.ownOnly && !decodeWorkerKilled()) return loadOwnOnly(key, frame, priority, set, t);
      // Fetch priority (staticFrames, #479): 'high' for the frame the step wants, 'low' for the rest of the window.
      const got = await loadFrameParsed(key, frame, undefined, priority ? { priority } : undefined);
      if (!got) { t.loadErrors += 1; noteMiss('load_failed'); noteFailed(frame.path); return null; }
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const field = toField(got.parsed, set.field);
      if (field && set.landFill) await landFill(field);
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!field) { noteMiss('no_field'); noteFailed(frame.path); return null; }
      _failedAt.delete(frame.path);
      t.bytes += got.wire || 0;
      t.decodeMs.push(Math.round((t1 - t0) * 10) / 10);
      if (t.decodeMs.length > 50) t.decodeMs.shift();
      keep(frame.path, field);
      return field;
    })().finally(() => _inflight.delete(frame.path));
    _inflight.set(frame.path, p);
  }
  return p;
}

/** The own-only layers' load: worker fetch + inflate, worker decode of the one field; the same checks and telemetry as the
 *  shared path (a frame whose valid time is not its index entry's is refused; 404 / 400 re-pins the set). */
async function loadOwnOnly(key, frame, priority, set, t) {
  const got = await fetchFrameBytes(frame.url || staticFramesBase() + frame.path, undefined, priority);
  if (!got || got.error) {
    if (got && (got.status === 404 || got.status === 400 || got.status === 'integrity')) markStaticPinStale(key);
    t.loadErrors += 1; noteMiss(got && got.status ? `http_${got.status}` : 'load_failed'); noteFailed(frame.path); return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let field = null;
  try { field = await decodeOwnField(got.buffer, set.field, MISSING); } catch (e) { field = null; }
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!field || Math.abs(field.validMs - Date.parse(frame.valid_time)) > 1000) {
    noteMiss(field ? 'valid_time_mismatch' : 'no_field'); noteFailed(frame.path); return null;
  }
  _failedAt.delete(frame.path);
  t.bytes += got.wire || 0;
  t.decodeMs.push(Math.round((t1 - t0) * 10) / 10);
  if (t.decodeMs.length > 50) t.decodeMs.shift();
  t.decodeOffThread = (t.decodeOffThread || 0) + (field.offThread ? 1 : 0);
  delete field.offThread;
  keep(frame.path, field);
  return field;
}

// ── the window pump: at most MAX_IN_FLIGHT loads, started in the wanted order; a frame that left the window is never started ──
export const MAX_IN_FLIGHT = 3;
const _pump = { layer: null, wanted: [], onField: null };

/** Replace the wanted window (frames in priority order). onField(path, field) fires for each wanted frame as it lands. */
export function setWanted(layer, frames, onField) {
  _pump.layer = layer;
  _pump.wanted = (frames || []).filter((f) => f && f.path);
  _pump.onField = onField || null;
  if (!_pump.wanted.length) clearRetryTimers();
  pump();
}

function pump() {
  const { layer, wanted } = _pump;
  wanted.forEach((f, i) => {
    if (_inflight.size >= MAX_IN_FLIGHT) return;
    if (_fields.has(f.path) || _inflight.has(f.path) || inBackoff(f.path)) return;
    loadField(layer, f, i === 0 ? 'high' : 'low').then((field) => {
      if (field && _pump.onField && _pump.wanted.some((w) => w.path === f.path)) _pump.onField(f.path, field);
      pump();
    });
  });
}

// ── which layers are drawn from our frames right now (the legend credit reads it) ──────────────────────────────────
let _engaged = Object.freeze({});
const _engagedSubs = new Set();
/** `on`: false, or the model of the frame on screen ('GFS' | 'EURO' | 'ICON'; `true` reads as GFS). */
export function setEngaged(layer, on) {
  const v = on === true ? 'GFS' : (on || false);
  if ((_engaged[layer] || false) === v) return;
  _engaged = Object.freeze({ ..._engaged, [layer]: v });
  for (const fn of _engagedSubs) { try { fn(); } catch (e) { /* a subscriber's error is its own */ } }
}
export const getEngaged = () => _engaged;
export function subscribeEngaged(fn) { _engagedSubs.add(fn); return () => _engagedSubs.delete(fn); }

// ── the frame on screen, per layer (the isobar layer follows the colour field's cut exactly) ─────────────────────────────
// `shown` fires INSIDE MapLibre's render, the moment the field cuts (subscribers may only flip layer visibility there); `want`
// fires when a step picks its frame (before the cut), so the next frame's isobars can be prepared in a hidden buffer.
const _shown = {}; const _want = {};
const _shownSubs = new Set();
const _emit = (kind, layer, path) => { for (const fn of _shownSubs) { try { fn(kind, layer, path || null); } catch (e) { /* a subscriber's own */ } } };
export function emitOwnShown(layer, path) { _shown[layer] = path || null; _emit('shown', layer, path); }
export function emitOwnWant(layer, path) { _want[layer] = path || null; _emit('want', layer, path); }
export const getOwnShown = (layer) => _shown[layer] || null;
export const getOwnWant = (layer) => _want[layer] || null;
/** fn(kind: 'shown' | 'want', layer, path) */
export function onOwnShown(fn) { _shownSubs.add(fn); return () => _shownSubs.delete(fn); }

/** Record one scrub step for the hit-rate-vs-velocity read: was the wanted frame already decoded when asked? */
export function noteStep(path, hit, at = Date.now()) {
  const s = tel().steps;
  s.push([at, path, hit ? 1 : 0]);
  if (s.length > STEPS_KEPT) s.shift();
}

export function _resetOwnRasterFramesForTest() {
  _fields.clear();
  _inflight.clear();
  _failedAt.clear();
  clearRetryTimers();
  _pump.layer = null; _pump.wanted = []; _pump.onField = null;
  _engaged = Object.freeze({});
  for (const k of Object.keys(_shown)) delete _shown[k];
  for (const k of Object.keys(_want)) delete _want[k];
  _shownSubs.clear();
  for (const k of Object.keys(_lastIndex)) delete _lastIndex[k];
  const w = W();
  delete w.__RAW_OWN_RASTER__;
}
