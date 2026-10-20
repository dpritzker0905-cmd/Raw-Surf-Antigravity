/**
 * staticFrameCodec.js — the browser half of the static frame codec (step 2b, 2026-10-20). Pure; no I/O.
 *
 * The ingest runner publishes every stored world wave product as one gzipped little-endian binary frame
 * (backend/services/frame_binary.py documents the layout; this file is its decoder twin) plus a run index.
 * This module turns a decompressed frame back into the SAME objects the backend serves today, so everything
 * downstream (mapNormalizedGridToWebGL, frameToMarineData, the arbiter, WebGLMarineTextureEncoder) runs unchanged:
 *   - gridJsonFromFrame:   the /api/weather/grid response (a NormalizedProduct) for one requested valid time;
 *   - seriesFrameFromFrame: one /api/weather/grid_series frame (full resolution: no decimated_stride).
 * pickIndexFrame mirrors the server's choice of product for a requested time (mid_res_tier.pick_mid_item).
 */

export const FRAME_MAGIC = [0x52, 0x53, 0x57, 0x46]; // "RSWF"
export const SUPPORTED_ENCODING = 1;
export const SUPPORTED_TRANSFORM = 1;
export const FIELD = { HEIGHT: 0, DIRECTION: 1, PERIOD: 2, DIR_CONFIDENCE: 3 };
const HEADER_FIXED = 72;
const DESCRIPTOR_BYTES = 24;
const NO_MISSING = 0xFFFFFFFF;
export const WINDOW_MS = 3 * 3600 * 1000; // find_candidates' +-3 h

export function isGzip(bytes) {
  return !!bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Parse a DECOMPRESSED frame. Returns { cols, rows, bounds, validEpoch, runEpoch, uvConvention, fields } where
 * fields[id] = Float64Array of values (NaN = missing). Throws on a bad magic, an unsupported version, a truncated
 * plane or an unsupported dtype, so a caller can fall back to /grid.
 */
export function parseFrame(buffer) {
  const buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const bytes = new Uint8Array(buf);
  if (bytes.length < HEADER_FIXED || FRAME_MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('static frame: bad magic');
  const dv = new DataView(buf);
  const encoding = dv.getUint16(4, true);
  const transform = dv.getUint16(6, true);
  if (encoding !== SUPPORTED_ENCODING) throw new Error(`static frame: unsupported encoding_version ${encoding}`);
  if (transform !== SUPPORTED_TRANSFORM) throw new Error(`static frame: unsupported transform_version ${transform}`);
  const cols = dv.getUint16(8, true);
  const rows = dv.getUint16(10, true);
  const fieldMask = dv.getUint32(12, true);
  const rowOrder = dv.getUint8(16);
  const colOrder = dv.getUint8(17);
  const fieldCount = dv.getUint8(18);
  const uvConvention = dv.getUint8(19);
  const headerBytes = dv.getUint32(20, true);
  if (rowOrder !== 0 || colOrder !== 0) throw new Error('static frame: unsupported node order');
  const bounds = { west: dv.getFloat64(24, true), south: dv.getFloat64(32, true), east: dv.getFloat64(40, true), north: dv.getFloat64(48, true) };
  const validEpoch = dv.getFloat64(56, true);
  const runEpoch = dv.getFloat64(64, true);
  const n = cols * rows;
  const fields = {};
  let pos = headerBytes;
  for (let f = 0; f < fieldCount; f++) {
    const d = HEADER_FIXED + f * DESCRIPTOR_BYTES;
    const id = dv.getUint8(d);
    const dtype = dv.getUint8(d + 1);
    const layout = dv.getUint8(d + 2);
    const missing = dv.getUint32(d + 4, true);
    const scale = dv.getFloat64(d + 8, true);
    const offset = dv.getFloat64(d + 16, true);
    if (dtype !== 1 && dtype !== 2) throw new Error(`static frame: unsupported dtype ${dtype}`);
    const size = n * dtype;
    if (pos + size > bytes.length) throw new Error(`static frame: truncated field ${id}`);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let code;
      if (dtype === 1) code = bytes[pos + k];
      else if (layout === 1) code = bytes[pos + k] | (bytes[pos + n + k] << 8);
      else code = bytes[pos + 2 * k] | (bytes[pos + 2 * k + 1] << 8);
      out[k] = (missing !== NO_MISSING && code === missing) ? NaN : code * scale + offset;
    }
    fields[id] = out;
    pos += size;
  }
  return { cols, rows, fieldMask, bounds, validEpoch, runEpoch, uvConvention, fields };
}

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Rebuild the stored product's vectors (row 0 = south, column 0 = west, the product's own order), in the exact
 * shape /grid serializes: {lat, lng, speed, direction, u, v, period, gust, value, is_valid, dir_confidence}.
 * u, v follow from height and direction by the frame's uv convention (0: u = -h sin d, as the ingest normalizer).
 */
export function buildVectors(parsed) {
  const { cols, rows, bounds, fields } = parsed;
  const H = fields[FIELD.HEIGHT];
  const D = fields[FIELD.DIRECTION];
  const P = fields[FIELD.PERIOD];
  const C = fields[FIELD.DIR_CONFIDENCE];
  if (!H) throw new Error('static frame: no height field');
  const sign = parsed.uvConvention === 1 ? 1 : -1;
  const dLat = rows > 1 ? (bounds.north - bounds.south) / (rows - 1) : 0;
  const dLng = cols > 1 ? (bounds.east - bounds.west) / (cols - 1) : 0;
  const out = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = r6(bounds.south + r * dLat);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const lng = r6(bounds.west + c * dLng);
      const h = H[i];
      const valid = !Number.isNaN(h);
      const dir = D ? (Number.isNaN(D[i]) ? 0 : r2(D[i])) : 0;
      const per = P ? (Number.isNaN(P[i]) ? null : r2(P[i])) : null;
      const conf = C ? (Number.isNaN(C[i]) ? null : r4(C[i])) : null;
      if (!valid) {
        out[i] = { lat, lng, speed: 0, direction: dir, u: 0, v: 0, period: per, gust: null, value: null, is_valid: false, dir_confidence: conf };
        continue;
      }
      const speed = r4(h);
      const rad = dir * (Math.PI / 180);
      out[i] = {
        lat, lng, speed, direction: dir,
        u: r4(sign * speed * Math.sin(rad)) + 0, v: r4(sign * speed * Math.cos(rad)) + 0,
        period: per, gust: null, value: null, is_valid: true, dir_confidence: conf,
      };
    }
  }
  return out;
}

const _ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/** The API's own time format (no milliseconds): 2026-10-20T00:00:00Z. */
export function apiIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const bboxString = (b) => (b ? `${(+b.west).toFixed(4)},${(+b.south).toFixed(4)},${(+b.east).toFixed(4)},${(+b.north).toFixed(4)}` : null);

/**
 * The frame /grid would serve for a requested valid time: the nearest within 3 h, authoritative before estimated,
 * the earlier on a tie (index frames are sorted by valid time). Null when no frame is within the window.
 */
export function pickIndexFrame(index, validMs) {
  if (!index || !Array.isArray(index.frames) || !Number.isFinite(validMs)) return null;
  for (const estimated of [false, true]) {
    let best = null;
    let bestDiff = Infinity;
    for (const f of index.frames) {
      if (!!f.is_estimated !== estimated) continue;
      const diff = Math.abs(_ms(f.valid_time) - validMs);
      if (diff <= WINDOW_MS && diff < bestDiff) { best = f; bestDiff = diff; }
    }
    if (best) return best;
  }
  return null;
}

/** One frame's full product metadata: the index's shared values with the frame's own on top. */
export function frameMeta(index, frame) {
  return { ...(index.common_meta || {}), ...(frame.meta || {}) };
}

function honesty(frame, askMs) {
  const servedMs = _ms(frame.valid_time);
  const offsetH = Math.round(((servedMs - askMs) / 3600000) * 100) / 100;
  return {
    valid_time: apiIso(askMs),
    served_valid_time: apiIso(servedMs),
    frame_offset_hours: offsetH + 0,
    frame_substituted: Math.abs(offsetH) > 0.5,
  };
}

/**
 * The /grid response for `askIso` built from a decoded frame: the same fields mid_res_tier + resolve_grid put on
 * a world request (coverage_scope 'regional', coverage_mode 'regional_tile', the echo of the asked time plus the
 * served-time honesty fields), and `static_frame` naming where it came from.
 */
export function gridJsonFromFrame(index, frame, vectors, { askIso, requestedBbox } = {}) {
  const meta = frameMeta(index, frame);
  const grid = frame.grid || index.grid;
  const askMs = _ms(askIso);
  const h = honesty(frame, Number.isFinite(askMs) ? askMs : _ms(frame.valid_time));
  return {
    model: meta.model, provider: meta.provider, domain: meta.domain, layer: meta.layer,
    run_time: meta.run_time, model_run_time: meta.model_run_time ?? null,
    model_run_time_status: meta.model_run_time_status || 'missing', ingested_at: meta.ingested_at ?? null,
    ...h,
    is_forecast_authoritative: !!meta.is_forecast_authoritative, is_estimated: !!meta.is_estimated,
    estimate_basis: meta.estimate_basis ?? null, coverage: meta.coverage || null,
    value_kind: meta.value_kind || 'wave_height', value_unit: meta.value_unit || 'm',
    display_unit_hint: meta.display_unit_hint || 'ft',
    product_id: meta.product_id || null,
    units: meta.units || { speed: 'm', direction: 'degrees', period: 'seconds' },
    source_variables: meta.source_variables || [], freshness_sec: meta.freshness_sec ?? null,
    warnings: meta.warnings || [], is_test_fixture: !!meta.is_test_fixture,
    source_dataset: meta.source_dataset ?? null, upstream_provider: meta.upstream_provider ?? null,
    upstream_model: meta.upstream_model ?? null, coarse_fill: meta.coarse_fill ?? null,
    region_id: meta.region_id || null, tile_id: meta.region_id || null,
    coverage_mode: 'regional_tile', coverage_scope: 'regional', is_dynamic_viewport_product: false,
    requested_bbox: bboxString(requestedBbox), served_bbox: bboxString(grid && grid.bounds),
    partial_coverage: false, stale: false, staleReason: null,
    grid: {
      bounds: grid.bounds, cols: grid.cols, rows: grid.rows, vectors,
      diagnostics: {
        ...(meta.diagnostics || {}),
        cols: grid.cols, rows: grid.rows, vectorCount: vectors.length,
        renderable: vectors.some((v) => v.speed > 0), partial_coverage: false,
        valid_time: h.valid_time, served_valid_time: h.served_valid_time, frame_offset_hours: h.frame_offset_hours,
      },
    },
    static_frame: { index: index.path || null, path: frame.path, run: index.run || null, sha256: frame.sha256 || null },
  };
}

/** One /grid_series frame (the shape marineSeriesFrame.frameToMarineData reads), full resolution. */
export function seriesFrameFromFrame(index, frame, vectors, { hourOffset, askIso } = {}) {
  const meta = frameMeta(index, frame);
  const grid = frame.grid || index.grid;
  const askMs = _ms(askIso);
  return {
    hour_offset: hourOffset,
    ...honesty(frame, Number.isFinite(askMs) ? askMs : _ms(frame.valid_time)),
    cols: grid.cols, rows: grid.rows, bounds: grid.bounds, vectors,
    provider: meta.provider, is_estimated: !!meta.is_estimated, rating_mode: false,
    model_run_time: meta.model_run_time ?? null, model_run_time_status: meta.model_run_time_status || 'missing',
    ingested_at: meta.ingested_at ?? null, run_time: meta.run_time ?? null,
    upstream_provider: meta.upstream_provider ?? null, source_dataset: meta.source_dataset ?? null,
    estimate_basis: meta.estimate_basis ?? null,
    product_id: meta.product_id || null, region_id: meta.region_id || null, upstream_model: meta.upstream_model ?? null,
    wind_lane: null, static_frame: frame.path,
  };
}
