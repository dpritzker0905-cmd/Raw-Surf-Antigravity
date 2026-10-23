/**
 * frameImageProof.js — the one-field proof's browser half (2026-10-19). DARK, and it never draws.
 *
 * The ingest lane (backend/scripts/publish_frame_images.py) publishes the world-view GFS wave field nearest now as one
 * static PNG to the PUBLIC Supabase bucket `weather-frames`. This module answers two questions in the real browser:
 *   1. PARITY: does the decoded image equal what /grid serves for the same valid time, node by node?
 *   2. TIME-TO-CORRECT: how long until the correct field is in memory, CDN image vs the 1-CPU box's /grid?
 * The image path sends ZERO requests to the Render box (only the Supabase CDN host), so its server CPU is zero by
 * construction; the result lists every host it fetched so that claim is checked, not assumed.
 *
 * Encoding (backend/services/frame_image.py, ENCODING): R,G = height uint16 big-endian, 0 = no data, else
 * round(h / 0.001) + 1; B = direction / 360 * 255; A = 255. Row 0 = north. Decoded with colour management and
 * premultiplication OFF, or the browser would rewrite the bytes.
 *
 * ON (default off): window.__RAW_FRAME_PROOF__ = true, or localStorage '__RAW_FRAME_PROOF__' = 'true', then reload.
 * Result: window.__RAW_FRAME_PROOF_RESULT__ (and one console.info line). Re-run: window.__RAW_RUN_FRAME_PROOF__().
 */
export const FRAME_BUCKET = 'weather-frames';
export const FRAME_ENCODING = 'rg_u16_height_mm_plus1__b_dir_u8__a255';
export const SCALE_M = 0.001;
const NODE_EPS = 1e-3; // fraction of a cell: a /grid vector farther than this from an image node is not compared

export function frameProofEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__RAW_FRAME_PROOF__) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('__RAW_FRAME_PROOF__') === 'true') return true;
  } catch (e) { /* storage blocked: stay off */ }
  return false;
}

export function publicObjectUrl(supabaseUrl, path) {
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${FRAME_BUCKET}/${path}`;
}

/** The decoded height at an exact image node: a number (m), null (no data), or undefined (not on a node). */
export function heightAtNode(rgba, frame, lat, lng) {
  const { width, height, bounds } = frame;
  const col = ((lng - bounds.west) / (bounds.east - bounds.west)) * (width - 1);
  const row = ((bounds.north - lat) / (bounds.north - bounds.south)) * (height - 1);
  const c = Math.round(col);
  const r = Math.round(row);
  if (Math.abs(col - c) > NODE_EPS || Math.abs(row - r) > NODE_EPS) return undefined;
  if (c < 0 || c >= width || r < 0 || r >= height) return undefined;
  const i = (r * width + c) * 4;
  const code = (rgba[i] << 8) | rgba[i + 1];
  return code === 0 ? null : (code - 1) * SCALE_M;
}

/** Compare /grid's vectors with the decoded image. Pure. */
export function compareFrameToGrid(frame, rgba, vectors) {
  const out = { compared: 0, offNode: 0, bad: 0, missingMismatch: 0, maxAbsErrM: 0, samples: [] };
  for (const v of vectors || []) {
    const got = heightAtNode(rgba, frame, v.lat, v.lng);
    if (got === undefined) { out.offNode += 1; continue; }
    out.compared += 1;
    const want = v.is_valid === false || !Number.isFinite(v.speed) ? null : v.speed;
    if ((want === null) !== (got === null)) {
      out.missingMismatch += 1;
      out.bad += 1;
      if (out.samples.length < 5) out.samples.push({ lat: v.lat, lng: v.lng, grid: want, image: got });
      continue;
    }
    if (want === null) continue;
    const err = Math.abs(want - got);
    out.maxAbsErrM = Math.max(out.maxAbsErrM, err);
    if (err > SCALE_M / 2 + 1e-9) {
      out.bad += 1;
      if (out.samples.length < 5) out.samples.push({ lat: v.lat, lng: v.lng, grid: want, image: got });
    }
  }
  out.maxAbsErrM = Math.round(out.maxAbsErrM * 1e6) / 1e6;
  return out;
}

/** Browser decode with the byte-preserving options; returns { rgba, width, height }. */
export async function decodePngRgba(blob) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap; // read BEFORE close(): a closed ImageBitmap reports 0 x 0 (caught by the browser run)
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  bitmap.close?.();
  return { rgba: data, width, height };
}

const hostOf = (url) => { try { return new URL(url).host; } catch (e) { return String(url); } };

/**
 * Run the proof once. Every dependency is injectable so the logic is testable without a network or a canvas.
 * Returns { ok, frame, parity, timingsMs: { manifest, image, decode, imagePathTotal, grid }, hosts }.
 */
export async function runFrameProof({ supabaseUrl, gridUrl, fetchImpl = fetch, decode = decodePngRgba,
  clock = () => performance.now() } = {}) {
  const hosts = { image: new Set(), grid: new Set() };
  const timed = async (kind, url, read) => {
    hosts[kind].add(hostOf(url));
    const t0 = clock();
    const resp = await fetchImpl(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
    const body = await read(resp);
    return [body, clock() - t0];
  };
  const manifestUrl = `${publicObjectUrl(supabaseUrl, 'manifest.json')}?cb=${Math.floor(Date.now() / 60000)}`;
  const [index, tManifest] = await timed('image', manifestUrl, (r) => r.json());
  const frame = index && Array.isArray(index.frames) ? index.frames[0] : null;
  if (!frame || frame.encoding !== FRAME_ENCODING) throw new Error('frame manifest missing or unknown encoding');
  const [blob, tImage] = await timed('image', publicObjectUrl(supabaseUrl, frame.path), (r) => r.blob());
  const t0 = clock();
  const { rgba, width, height } = await decode(blob);
  const tDecode = clock() - t0;
  if (width !== frame.width || height !== frame.height) throw new Error(`decoded ${width}x${height}, manifest says ${frame.width}x${frame.height}`);
  const query = new URLSearchParams({ model: frame.model, domain: 'marine', layer: frame.layer, valid_time: frame.valid_time,
    bbox: [frame.bounds.west, frame.bounds.south, frame.bounds.east, frame.bounds.north].join(',') });
  const [product, tGrid] = await timed('grid', `${gridUrl}?${query}`, (r) => r.json());
  const parity = compareFrameToGrid(frame, rgba, product && product.grid && product.grid.vectors);
  const sameSource = !!product && product.valid_time === frame.valid_time;
  const round = (x) => Math.round(x * 10) / 10;
  return {
    ok: sameSource && parity.compared > 0 && parity.bad === 0,
    frame: { path: frame.path, bytes: frame.bytes, width, height, valid_time: frame.valid_time,
      grid_valid_time: product && product.valid_time, grid_product_id: product && product.product_id },
    parity,
    timingsMs: { manifest: round(tManifest), image: round(tImage), decode: round(tDecode),
      imagePathTotal: round(tManifest + tImage + tDecode), grid: round(tGrid) },
    hosts: { image: [...hosts.image], grid: [...hosts.grid] },
  };
}

/** Wire the dark proof onto window; runs once on install. No effect unless frameProofEnabled(). */
export function installFrameProof({ gridUrl, supabaseUrl = process.env.REACT_APP_SUPABASE_URL } = {}) {
  if (typeof window === 'undefined' || !frameProofEnabled()) return false;
  window.__RAW_RUN_FRAME_PROOF__ = () => runFrameProof({ supabaseUrl, gridUrl })
    .then((result) => {
      window.__RAW_FRAME_PROOF_RESULT__ = result;
      console.info('[FRAME-PROOF]', JSON.stringify({ ok: result.ok, parity: result.parity, timingsMs: result.timingsMs, hosts: result.hosts }));
      return result;
    })
    .catch((err) => {
      window.__RAW_FRAME_PROOF_RESULT__ = { ok: false, error: String(err && err.message ? err.message : err) };
      console.warn('[FRAME-PROOF] failed:', window.__RAW_FRAME_PROOF_RESULT__.error);
      return window.__RAW_FRAME_PROOF_RESULT__;
    });
  window.__RAW_RUN_FRAME_PROOF__();
  return true;
}
