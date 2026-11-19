/**
 * marineFallbackField.js: the wave-HEIGHT picture drawn from OUR OWN grid when the marine engine has failed (2026-11-18,
 * Open-Meteo exit row 12; log docs/weather-program/log/2026-11-18-fable-webgl-fail-own-frames.md).
 *
 * WHY. When `webglMarineFailed` is set (the frame-rate guard, a shader that will not compile, a render error) the map used to
 * swap the marine layer for Open-Meteo raster tiles: a third party's grid and colours, on a user's screen. The fallback path
 * already holds our own grid for the hour (it feeds the particle canvas), so this module paints THAT into a small bitmap
 * with the theme's own height colours, and MarineFallbackFieldLayer hands the bitmap to MapLibre as a plain canvas source.
 * A plain raster layer is MapLibre's own code: the path that was already proven to draw on a device where ours failed.
 *
 * WHAT IT IS NOT. Height only: no surf-rating band, no crests, no bathymetry or lighting. The legend says so
 * (marineFallbackNotice). If the map's GL context itself is lost, nothing draws, this included.
 *
 * GEOMETRY. A MapLibre canvas source is stretched linearly in Web Mercator between its four corners, and our grid is regular
 * in latitude. So the bitmap's rows are laid out evenly in MERCATOR y and each row samples the grid at its own latitude.
 * The corners are the grid's outer cell EDGES (half a cell beyond the outer nodes), so a node's value sits on its own
 * coordinate. Latitude is clipped to Mercator's limit. A box that crosses the antimeridian is drawn with an east edge past
 * 180. A world grid is drawn ONCE (no wrapped copies at low zoom): a known limit, disclosed in the legend's tooltip.
 *
 * COLOUR. getThemedWaveColorJS (colorScales.js): the app's one JS mirror of the shader's height wash, for all three themes.
 * Baked into a lookup table once per theme so a redraw is a table read per pixel.
 *
 * Kill: window.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true (read per draw). Killed means NOTHING is drawn and the legend says
 * the layer is unavailable. It never brings a third party's tiles back: that path is gone.
 */
import { getThemedWaveColorJS } from './colorScales';

export const MERCATOR_MAX_LAT = 85.0511287798;
export const FALLBACK_MAX_WIDTH = 1024;
export const FALLBACK_MAX_HEIGHT = 512;
const PIXELS_PER_CELL = 4;
const LUT_MAX_M = 20;        // above every theme's cap; heights past it take the last entry
const LUT_N = 8192;          // 2.4 mm a step: under 1/255 of colour error on the steepest ramp segment

const W = () => (typeof window !== 'undefined' ? window : {});
export const ownMarineFallbackKilled = (win = W()) => win.__RAW_DISABLE_OWN_MARINE_FALLBACK__ === true;

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercY = (y) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** The theme's colour for a height in metres, rounded RGB. One source: the shader's JS mirror. */
export function fallbackHeightColor(heightM, theme) {
  const c = getThemedWaveColorJS(Math.max(0, Number(heightM) || 0), theme, false);
  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

const lutCache = new Map();
/** RGB lookup table over 0..LUT_MAX_M for a theme (cached; `sample` lets a test pass its own colour function). */
export function heightLut(theme, sample = fallbackHeightColor) {
  const key = sample === fallbackHeightColor ? theme : null;
  if (key && lutCache.has(key)) return lutCache.get(key);
  const lut = new Uint8Array(LUT_N * 3);
  for (let k = 0; k < LUT_N; k++) {
    const c = sample((k / (LUT_N - 1)) * LUT_MAX_M, theme);
    lut[k * 3] = c[0]; lut[k * 3 + 1] = c[1]; lut[k * 3 + 2] = c[2];
  }
  if (key) lutCache.set(key, lut);
  return lut;
}
export const lutIndex = (heightM) => Math.round(clamp(heightM / LUT_MAX_M, 0, 1) * (LUT_N - 1));

/**
 * Where the picture sits on the map, or null when the grid cannot be drawn. `bounds` are the outer NODES; the picture's
 * edges are half a cell beyond them, latitude clipped to Mercator's limit. `east` may exceed 180 (a box across the
 * antimeridian, or a world grid whose last node repeats the first).
 */
export function fallbackFieldExtent(grid) {
  const b = grid && grid.bounds; const cols = grid && grid.cols; const rows = grid && grid.rows;
  if (!b || !(cols >= 2) || !(rows >= 2) || !Array.isArray(grid.vectors) || grid.vectors.length !== cols * rows) return null;
  const { west, south, east, north } = b;
  if (![west, south, east, north].every(Number.isFinite) || !(north > south)) return null;
  const spanLng = east > west ? east - west : east + 360 - west;
  if (!(spanLng > 0)) return null;
  const dLng = spanLng / (cols - 1); const dLat = (north - south) / (rows - 1);
  const edgeSouth = clamp(south - dLat / 2, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);
  const edgeNorth = clamp(north + dLat / 2, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);
  if (!(edgeNorth > edgeSouth)) return null;
  const edgeWest = west - dLng / 2; const edgeEast = west + spanLng + dLng / 2;
  return {
    cols, rows, west, south, north, dLng, dLat, edgeWest, edgeEast, edgeSouth, edgeNorth,
    clippedNorth: north + dLat / 2 > MERCATOR_MAX_LAT, clippedSouth: south - dLat / 2 < -MERCATOR_MAX_LAT,
    // MapLibre's order: top-left, top-right, bottom-right, bottom-left
    coordinates: [[edgeWest, edgeNorth], [edgeEast, edgeNorth], [edgeEast, edgeSouth], [edgeWest, edgeSouth]],
  };
}

/** The bitmap's size for a grid: a few pixels a cell, capped; taller in proportion where Mercator stretches the box. */
export function fallbackFieldSize(extent, maxW = FALLBACK_MAX_WIDTH, maxH = FALLBACK_MAX_HEIGHT) {
  const width = clamp(Math.round(extent.cols * PIXELS_PER_CELL), 2, maxW);
  const spanY = mercY(extent.edgeNorth) - mercY(extent.edgeSouth);
  const spanX = ((extent.edgeEast - extent.edgeWest) * Math.PI) / 180;
  const height = clamp(Math.round((width * spanY) / spanX), 2, maxH);
  return { width, height };
}

/** The latitude a bitmap row's centre stands for (row 0 is the NORTH edge): even in Mercator y, not in latitude. */
export function rowLatitude(j, height, extent) {
  const yN = mercY(extent.edgeNorth); const yS = mercY(extent.edgeSouth);
  return latOfMercY(yN - ((j + 0.5) / height) * (yN - yS));
}
/** The longitude a bitmap column's centre stands for (may exceed 180 on a box across the antimeridian). */
export const colLongitude = (i, width, extent) => extent.edgeWest + ((i + 0.5) / width) * (extent.edgeEast - extent.edgeWest);

/**
 * The grid's height at a longitude and latitude inside the picture: bilinear over the four nodes around it, using only
 * nodes the grid marks as ocean. Returns -1 when the ocean nodes carry under half the weight (land, no data): transparent.
 * Grid rows run south to north (row 0 = south), as every reader of this grid assumes (GPUMarineLayer.interpolateMarine).
 */
export function fieldHeightAt(grid, extent, lng, lat) {
  const { cols, rows } = extent; const v = grid.vectors;
  const gx = clamp((lng - extent.west) / extent.dLng, 0, cols - 1);
  const gy = clamp((lat - extent.south) / extent.dLat, 0, rows - 1);
  const xi = Math.min(cols - 2, Math.floor(gx)); const yi = Math.min(rows - 2, Math.floor(gy));
  const fx = gx - xi; const fy = gy - yi;
  let wSum = 0; let hSum = 0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const p = v[(yi + dy) * cols + xi + dx];
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const h = nodeHeight(p);
      if (h >= 0) { wSum += w; hSum += w * h; }
    }
  }
  return wSum >= 0.5 ? hSum / wSum : -1;
}

/** A node's height in metres as the marine engine reads it (`height`, else `speed`), or -1 where the grid says land or
 *  no data (`isOcean` false, `is_valid` false, or no number). */
export function nodeHeight(p) {
  if (!p || !p.isOcean || p.is_valid === false) return -1;
  const h = typeof p.height === 'number' ? p.height : p.speed;
  return Number.isFinite(h) && h >= 0 ? h : -1;
}

/** Why there is nothing of ours to draw, or null when there is: 'killed', 'rating_grid' (a surf-rating grid carries SCORES in
 *  its height field; drawing it as wave height would be a lie), 'no_grid' (none, or malformed). */
export function whyNoFallbackField(grid, win = W()) {
  if (ownMarineFallbackKilled(win)) return 'killed';
  if (grid && grid.ratingMode) return 'rating_grid';
  return fallbackFieldExtent(grid) ? null : 'no_grid';
}

/**
 * The whole picture, with no canvas and no map: { width, height, data (RGBA, straight alpha), coordinates, extent }.
 * null when there is nothing of ours to draw (no grid, a malformed grid, or the kill). Pure apart from the kill read.
 */
export function renderFallbackField(grid, theme, opts = {}) {
  if (whyNoFallbackField(grid, opts.win)) return null;
  const extent = fallbackFieldExtent(grid);
  const { width, height } = fallbackFieldSize(extent, opts.maxWidth, opts.maxHeight);
  const lut = heightLut(theme, opts.sample);
  const data = new Uint8ClampedArray(width * height * 4);
  const lngs = new Float64Array(width);
  for (let i = 0; i < width; i++) lngs[i] = colLongitude(i, width, extent);
  let drawn = 0;
  for (let j = 0; j < height; j++) {
    const lat = rowLatitude(j, height, extent);
    for (let i = 0; i < width; i++) {
      const h = fieldHeightAt(grid, extent, lngs[i], lat);
      if (h < 0) continue;                       // alpha stays 0: land and no-data are transparent
      const k = lutIndex(h) * 3; const o = (j * width + i) * 4;
      data[o] = lut[k]; data[o + 1] = lut[k + 1]; data[o + 2] = lut[k + 2]; data[o + 3] = 255;
      drawn += 1;
    }
  }
  if (!drawn) return null;                       // an all-land or all-invalid grid: nothing of ours to show
  return { width, height, data, coordinates: extent.coordinates, extent, drawn };
}

/** The zoom opacity the field is drawn at: the ramp the tile fallback's marine slots used (MapWebGL, the default branch). */
export const FALLBACK_OPACITY_STOPS = [[2, 0.22], [5, 0.28], [8, 0.35], [12, 0.40]];
export const fallbackOpacityExpression = () => ['interpolate', ['linear'], ['zoom'], ...FALLBACK_OPACITY_STOPS.flat()];
