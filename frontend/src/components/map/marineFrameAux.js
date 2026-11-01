/**
 * marineFrameAux.js — a stored frame's OWN chl/bath texture bytes (Stage A of instant toggles, 2026-10-22).
 *
 * The engine's chlorophyll and bathymetry textures derive from a frame's validity masks alone (WebGLMarineGeoData.getMarineGeoData,
 * called by encodeMarineTexture with the post-extrapolation ocean mask and the true one). A step inside one run shows a stored frame
 * over the resident's chl/bath while the masks differ by a few cells (marineFrameStoreRuntime VALIDITY_TOLERANCE_CELLS); a switch to
 * ANOTHER MODEL's frame differs by far more (its own land and ice masks), so it carries these exact bytes and uploads them with the
 * wave texture. They are the encoder's own bytes by construction: the same function on the same masks (pinned by
 * marineFramePack.parity.test.js). The cost is getMarineGeoData's (~63 ms per real frame, measured), so only warm frames get them,
 * in idle time.
 */
import { getMarineGeoData } from './WebGLMarineGeoData';

const unbits = (bits, n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return out;
};

/** { chl, bath, cols, rows, validityHash } for a pack (marineFramePack.packStaticFrame's result), or null when it lacks its masks. */
export function auxForPack(pack) {
  if (!pack || !pack.validityBits || !pack.oceanBitsPost || !(pack.cols > 0) || !(pack.rows > 0)) return null;
  const n = pack.cols * pack.rows;
  const truth = unbits(pack.validityBits, n);
  const ocean = unbits(pack.oceanBitsPost, n);
  const g = getMarineGeoData(pack.cols, pack.rows, pack.bounds, ocean, n, pack.isGlobal, null, truth);
  if (!g || !g.dataChl || !g.dataBath) return null;
  return { chl: g.dataChl, bath: g.dataBath, cols: pack.cols, rows: pack.rows, validityHash: pack.validityHash };
}
