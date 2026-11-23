/**
 * ownFrameReadout.js - the infobox reads the frame the map DRAWS (SOTA-GAP inspection 2026-11-23, finding 10; ONE FORECAST
 * COMPOSITION). DARK (D-001): build flag REACT_APP_INFOBOX_OWN_FRAME=true, default off; the runtime switch
 * window.__RAW_DISABLE_INFOBOX_OWN_FRAME__ = true can only turn it off.
 *
 * Before: the raster layers drawn from our own CDN frames (useOwnRasterFrames: pressure, air temp, cloud, rain, fog, water temp,
 * gusts, currents) had no .om slots, so the infobox's decodedOmSampler kept the NEWEST Open-Meteo tile of any model and hour
 * decoded earlier in the session (or nothing), the air temperature card read the point forecast while the map drew the GFS
 * field terrain-adjusted, and gusts and currents had no card at all.
 *
 * After (flag on, the active layer engaged on own frames): the card's number is sampled from the EXACT field the GPU was given at
 * the cut (recorded by noteShownFrame from the layer's onShown, the same moment the map changes), exactly as the fragment shader
 * samples it (ownRasterLayer.FS: cell-centre lattice, bilinear, integer longitude wrap on full-circle grids, any corner below
 * -9000 = no data), plus the air temperature's lapse * dz through the shader's own CPU mirror (ownRasterLayer.downscaleAt).
 * An engaged layer with no value says so ("no data" / "Loading"): it never falls back to another source (panel, 2026-11-23).
 * The GPU's 160 ms value blend between frames is transient; the card reads the frame being cut TO.
 */
import { useEffect, useReducer } from 'react';
import { Wind, CloudRain, ArrowUp, Gauge, Thermometer, Cloud, Eye, Waves } from 'lucide-react';
import { getEngaged, subscribeEngaged, MODEL_SOURCE, OWN_ONLY_LAYERS } from './ownRasterFrames';
import { downscaleAt, wrapsLongitude } from './ownRasterLayer';
import { getDownscaleAsset, subscribeDownscaled } from './ownRasterDownscale';
import { gustWindowLabel, gustLeadHours } from './gustWindow';
import { formatReadoutDate } from './readoutDateFormat';
import { degToCompass } from './forecastHelpers';

const W = () => (typeof window !== 'undefined' ? window : {});
const NO_DATA_BELOW = -9000;
const HOUR_MS = 3600000;
const HOUR_ONLY = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });   // "10 AM", the device's zone (as formatReadoutDate)

export function infoboxOwnFrameEnabled() {
  return process.env.REACT_APP_INFOBOX_OWN_FRAME === 'true' && W().__RAW_DISABLE_INFOBOX_OWN_FRAME__ !== true;
}

// ── the frame on screen, per layer: { path, field, model, estimated, fill } (set at the GL cut) ─────────────────────────────
const _shown = {};
const _subs = new Set();
export function noteShownFrame(layer, rec) {
  _shown[layer] = rec && rec.path && rec.field ? rec : null;
  for (const fn of _subs) { try { fn(layer); } catch (e) { /* a subscriber's own */ } }
}
export const getShownFrame = (layer) => _shown[layer] || null;
export function subscribeShownFrame(fn) { _subs.add(fn); return () => _subs.delete(fn); }
export function _resetOwnFrameReadoutForTest() { for (const k of Object.keys(_shown)) delete _shown[k]; _subs.clear(); }

/** PURE: the field's value at (lat, lng) exactly as ownRasterLayer's fragment shader computes it, or null (no data / outside). */
export function fieldValueAt(field, lat, lng) {
  if (!field || !field.values || !(field.cols > 1) || !(field.rows > 1) || !field.bounds) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { cols, rows, bounds: b, values } = field;
  const dLon = (b.east - b.west) / (cols - 1);
  const dLat = (b.north - b.south) / (rows - 1);
  const lon = ((((lng + 180) % 360) + 360) % 360) - 180;   // the shader's fract(merc.x) * 360 - 180
  const fx = (lon - b.west) / dLon;
  const fy = Math.min(Math.max((lat - b.south) / dLat, 0), rows - 1);
  let c0; let c1; let tx;
  if (wrapsLongitude(field)) {
    const x0 = Math.floor(fx); tx = fx - x0;
    c0 = ((x0 % cols) + cols) % cols; c1 = c0 + 1 >= cols ? 0 : c0 + 1;
  } else {
    if (fx < 0 || fx > cols - 1) return null;
    const x0 = Math.min(Math.floor(fx), cols - 2); tx = fx - x0;
    c0 = x0; c1 = x0 + 1;
  }
  const y0 = Math.min(Math.floor(fy), rows - 2); const ty = fy - y0;
  const at = (c, r) => values[r * cols + c];
  const a = at(c0, y0); const bb = at(c1, y0); const c = at(c0, y0 + 1); const d = at(c1, y0 + 1);
  if (![a, bb, c, d].every(Number.isFinite) || Math.min(a, bb, c, d) < NO_DATA_BELOW) return null;
  return (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** PURE: the flow direction (degrees TOWARD) at the nearest node of a field's one-byte direction codes, or null. */
export function directionTowardAt(field, lat, lng) {
  if (!field || !field.dirCodes || !field.bounds) return null;
  const { cols, rows, bounds: b } = field;
  const lon = ((((lng + 180) % 360) + 360) % 360) - 180;
  let ix = Math.round((lon - b.west) / ((b.east - b.west) / (cols - 1)));
  const iy = Math.round((lat - b.south) / ((b.north - b.south) / (rows - 1)));
  if (wrapsLongitude(field)) ix = ((ix % cols) + cols) % cols;
  if (ix < 0 || ix >= cols || iy < 0 || iy >= rows) return null;
  return (field.dirCodes[iy * cols + ix] * 360) / 256;
}

/**
 * The readout for `layer` at (lat, lng): null when it does not apply (flag off, or the layer is not drawn from our frames), else
 * { engaged: true, value (null = no data here, undefined = no frame on screen yet), validMs, runMs, model, downscaled, towardDeg }.
 */
export function ownFrameValueAt(layer, lat, lng, deps = {}) {
  if (!infoboxOwnFrameEnabled()) return null;
  const engaged = deps.engaged !== undefined ? deps.engaged : getEngaged();
  if (!layer || !engaged || !engaged[layer]) return null;
  // An own-only model claimed with nothing to draw ('<SOURCE>:idle': killed, unpublished, past its range): the map is empty.
  if (String(engaged[layer]).endsWith(':idle')) return { engaged: true, layer, value: null, unavailable: true };
  const rec = deps.shown !== undefined ? deps.shown : getShownFrame(layer);
  // No frame of ours on screen yet: during the HANDOVER the .om path still draws the layer, so its own (strict) readout stands;
  // gusts and currents have no .om path, so their card waits.
  if (!rec) return OWN_ONLY_LAYERS.includes(layer) ? { engaged: true, layer, value: undefined } : null;
  let value = fieldValueAt(rec.field, lat, lng);
  const asset = deps.downscale !== undefined ? deps.downscale : getDownscaleAsset(layer);
  const downscaled = value != null && !!asset && layer === 'temperature';
  if (downscaled) value += asset.lapse * downscaleAt(asset, lng, lat);
  return {
    engaged: true, layer, value, validMs: rec.field.validMs, runMs: rec.field.runMs, model: rec.model || null, path: rec.path,
    estimated: rec.estimated || null, downscaled, towardDeg: layer === 'currents' ? directionTowardAt(rec.field, lat, lng) : null,
  };
}

/** React: the readout, re-read at every cut of this layer's frame and when its terrain correction comes or goes. */
export function useOwnFrameValue(layer, lat, lng) {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const offShown = subscribeShownFrame((l) => { if (l === layer) bump(); });
    const offDz = subscribeDownscaled(bump);
    const offEngaged = subscribeEngaged(bump);
    return () => { offShown(); offDz(); offEngaged(); };
  }, [layer]);
  return ownFrameValueAt(layer, lat, lng);
}

/** The visibility words the Fog card has always used (forecastCardCompiler), one copy. */
export function visibilityWords(m) {
  if (m == null) return null;
  if (m < 1000) return 'Dense Fog (<1km)';
  if (m < 5000) return 'Moderate Fog';
  if (m < 10000) return 'Light Fog';
  if (m >= 20000) return 'Clear';
  return `Clear (${Math.round(m / 1000)} km)`;
}

const fahrenheit = (c) => Math.round((c * 9) / 5 + 32);
const SPEC = {
  pressure: { icon: Gauge, label: 'Pressure', color: 'text-rose-400', text: (v) => `${Math.round(v)} hPa`, say: (v) => `Pressure ${Math.round(v)} hectopascals` },
  temperature: { icon: Thermometer, label: 'Air Temp', color: 'text-orange-400', text: (v) => `${fahrenheit(v)}°F`, say: (v) => `Air temperature ${fahrenheit(v)} degrees Fahrenheit` },
  water_temp: { icon: Thermometer, label: 'Water Temp', color: 'text-sky-400', text: (v) => `${fahrenheit(v)}°F`, say: (v) => `Water temperature ${fahrenheit(v)} degrees Fahrenheit`, none: 'Land / no data' },
  satellite: { icon: Cloud, label: 'Cloud Cover', color: 'text-sky-300', text: (v) => `${Math.round(v)}%`, say: (v) => `Cloud cover ${Math.round(v)} percent` },
  rain: { icon: CloudRain, label: 'Precip', color: 'text-blue-400', text: (v) => `${Math.max(0, v).toFixed(1)} mm/h`, say: (v) => `Precipitation ${Math.max(0, v).toFixed(1)} millimetres per hour` },
  fog: { icon: Eye, label: 'Visibility', color: 'text-gray-300', text: visibilityWords, say: (v) => `Visibility ${visibilityWords(v)}, ${Math.round(v)} metres` },
  gusts: { icon: Wind, label: 'Gusts', color: 'text-orange-400', text: (v) => `${Math.round(v)} kts`, say: (v) => `Wind gusts ${Math.round(v)} knots` },
  currents: { icon: Waves, label: 'Current', color: 'text-cyan-400', text: (v) => `${v.toFixed(1)} kts`, say: (v) => `Ocean current ${v.toFixed(1)} knots` },
};
const COMPASS_WORDS = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast',
  SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west',
  WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };

/**
 * PURE: the cards for an own-frame readout (replacing the layer's own cards), or null when the readout does not apply.
 * `selectedMs` = the wheel's instant (forecastSelectionMs); when the frame on screen is another hour (EURO's 3-hourly steps, a
 * held frame) the card says which, beside the status line's words.
 */
export function ownFrameCards(readout, { selectedMs, isLoading = false } = {}) {
  if (!readout || !readout.engaged) return null;
  const s = SPEC[readout.layer];
  if (!s) return null;
  if (readout.value === undefined) return [{ icon: s.icon, label: s.label, value: 'Loading', color: s.color }];
  if (readout.unavailable) {
    return [{ icon: s.icon, label: s.label, value: 'Unavailable', color: s.color, ariaLabel: `${s.label}: no forecast on the map for this time` }];
  }
  if (readout.value === null) {
    return [{ icon: s.icon, label: s.label, value: s.none || (isLoading ? 'Loading' : 'No data here'), color: s.color,
      ariaLabel: `${s.label}: no data at this point in the frame on the map` }];
  }
  const v = readout.value;
  const when = Number.isFinite(readout.validMs) ? formatReadoutDate(new Date(readout.validMs), 'hour') : null;
  const other = when && Number.isFinite(selectedMs) && Math.abs(readout.validMs - selectedMs) >= HOUR_MS / 2;
  const source = MODEL_SOURCE[String(readout.model || '').split(/[+:]/)[0]] || null;
  // WHICH gust the number is (gustWindow.js: instantaneous GFS, or ECMWF / ICON's maximum over the hours before), by its own lead
  const gustWindow = readout.layer === 'gusts'
    ? gustWindowLabel(readout.model, gustLeadHours({ dataMs: readout.validMs, runMs: readout.runMs })) : null;
  // The visible note stays short (a phone row truncates it): the hour alone on the wheel's own day, else the day and hour; the
  // accessible name below always carries the full time.
  const sameDay = other && new Date(readout.validMs).toDateString() === new Date(selectedMs).toDateString();
  const at = other ? `at ${sameDay ? HOUR_ONLY.format(new Date(readout.validMs)) : when}` : null;
  const notes = [gustWindow, readout.downscaled ? 'terrain-adjusted' : null, at].filter(Boolean);
  let aria = s.say(v);
  if (gustWindow) aria += `, ${gustWindow.toLowerCase()}`;
  if (readout.downscaled) aria += ', adjusted for terrain';
  if (readout.estimated) aria += ', estimated';
  if (when) aria += `, forecast for ${when}`;
  if (source) aria += `, ${source}`;
  const cards = [{ icon: s.icon, label: s.label, value: s.text(v), color: s.color, ariaLabel: aria, note: notes.join(' · ') || undefined }];
  if (readout.layer === 'currents' && Number.isFinite(readout.towardDeg)) {
    const c = degToCompass(readout.towardDeg);
    cards.push({ icon: ArrowUp, label: `to ${c}`, value: `${Math.round(readout.towardDeg)}°`, color: 'text-cyan-300', rotate: readout.towardDeg,
      ariaLabel: `Current flowing toward the ${COMPASS_WORDS[c] || c}, ${Math.round(readout.towardDeg)} degrees` });
  }
  return cards;
}
