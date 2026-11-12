/**
 * radarAdvectCore.js — the advection nowcast's per-tile pipeline, with no DOM, no canvas and no maplibre import, so the SAME code
 * runs on the main thread (radarTileRecolor's advect-rv handler, the kill path) and in radarAdvectWorker.js (2026-11-12).
 * Moved verbatim from radarTileRecolor.makeAdvectHandler: parse the advect-rv URL, estimate motion once per observed pair, then
 * warp the latest observed tile (smooth 3x3 field -> neighbour-aware rigid -> isolated rigid). The caller supplies getTile(url)
 * -> { data: Uint8ClampedArray, w, h } (fetch + decode + its own cache) and decides what to do with the RGBA that comes back.
 */
import {
  estimateMotion, advectTile, advectTileWithNeighbors, advectTileSmoothField, SMOOTH_MOTION_OPTS,
} from './radarAdvection';

export const ADVECT_TTL_MS = 10 * 60 * 1000;
export const ADVECT_CACHE_MAX = 256;

// Step an observed RainViewer tile URL to its (gx,gy) neighbor by editing the x/y in the
// .../<size>/<z>/<x>/<y>/7/1_0.png path (2026-07-09, neighbor-aware advection fill). Longitude (x)
// wraps modulo 2^z; latitude (y) out of [0,2^z) → null (grid edge: that band stays transparent).
// Works for both proxied (/rv/...) and direct RainViewer URLs — the path tail is identical.
const RV_TILE_RE = /\/(256|512)\/(\d+)\/(\d+)\/(\d+)\/7\/1_0\.png(\?|$)/;
export function neighborTileUrl(url, gx, gy) {
  if (!gx && !gy) return url;
  const m = RV_TILE_RE.exec(url);
  if (!m) return null;
  const z = +m[2], x = +m[3], y = +m[4], n = 1 << z;
  let nx = (x + gx) % n; if (nx < 0) nx += n;
  const ny = y + gy;
  if (ny < 0 || ny >= n) return null;
  return url.replace(RV_TILE_RE, (_full, size, zz, _x, _y, tail) => `/${size}/${zz}/${nx}/${ny}/7/1_0.png${tail}`);
}

/** advect-rv://<leadFactor>|<prevTileUrl>|<currTileUrl> -> { leadFactor, prevUrl, currUrl }, or null when malformed. */
export function parseAdvectUrl(url) {
  const rest = String(url || '').replace(/^advect-rv:\/\//, '');
  const bar = rest.indexOf('|');
  if (bar < 0) return null;
  const leadFactor = parseFloat(rest.slice(0, bar));
  const [prevUrl, currUrl] = rest.slice(bar + 1).split('|');
  if (!prevUrl || !currUrl || !isFinite(leadFactor)) return null;
  return { leadFactor, prevUrl, currUrl };
}

/** Drop the oldest entry (by .ts) once a cache passes `max`. */
export function pruneOldest(map, max = ADVECT_CACHE_MAX) {
  if (map.size <= max) return;
  const oldest = [...map.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
  if (oldest) map.delete(oldest[0]);
}

export class AdvectCancelled extends Error {
  constructor() { super('advect cancelled'); this.cancelled = true; }
}

/**
 * One pipeline = one motion cache. warp(parsed, flags, isCancelled) resolves { data, w, h } (the warped centre tile, RGBA) and
 * rejects when an observed tile cannot be had (the caller then serves a TRANSPARENT tile, never a frozen echo) or when
 * isCancelled() turns true between steps (AdvectCancelled: the caller drops the request).
 * flags: { smoothOff, neighborOff } = window.__RAW_RADAR_ADVECT_SMOOTH_DISABLED__ / __RAW_RADAR_ADVECT_NEIGHBOR_DISABLED__.
 */
export function createAdvectPipeline({ getTile, nowFn = Date.now, motionCache = new Map() }) {
  const check = (isCancelled) => { if (isCancelled && isCancelled()) throw new AdvectCancelled(); };

  async function warp(parsed, flags = {}, isCancelled = null) {
    const now = nowFn();
    const { leadFactor, prevUrl, currUrl } = parsed;
    const curr = await getTile(currUrl);
    check(isCancelled);
    // Motion is lead-INDEPENDENT — estimate once per (prev,curr) tile pair, reuse across leads.
    const mkey = prevUrl + '|' + currUrl;
    let motion = motionCache.get(mkey);
    if (!motion || now - motion.ts > ADVECT_TTL_MS) {
      const prev = await getTile(prevUrl);
      check(isCancelled);
      motion = { ...estimateMotion(prev.data, curr.data, curr.w, curr.h), ts: now };
      motionCache.set(mkey, motion);
      pruneOldest(motionCache);
    }
    // Warp curr forward by motion×lead. NEIGHBOR-AWARE by default (2026-07-09): fill the upwind
    // incoming edge from the real echo of the upwind neighbor tile(s) so the warp does NOT leave
    // the grid of blank "vertical rectangle" bands that grow toward the horizon (leadFactor≈6 at
    // 60 min → up to a ~240px transparent band per 256px tile). |motion| stays < one tile, so at
    // most the 3 upwind neighbors are needed; each is a proxy/decoded-cached observed tile shared
    // across leads and adjacent advect tiles. Kill: __RAW_RADAR_ADVECT_NEIGHBOR_DISABLED__ (→ the
    // old isolated per-tile warp).
    const wx = motion.dx * leadFactor, wy = motion.dy * leadFactor;
    let warped = null;
    // SMOOTH MOTION FIELD (2026-07-11, default ON; kill __RAW_RADAR_ADVECT_SMOOTH_DISABLED__):
    // the rigid per-tile warp made adjacent tiles slide as disagreeing blocks ("movement is
    // very gridlike"). Estimate a HALF-RES vector for each 3×3 neighborhood tile (uniform
    // SMOOTH_MOTION_OPTS so a physical tile yields the same vector from every neighborhood →
    // shared edges interpolate identical vectors → field continuous across tile boundaries),
    // then warp each pixel along its own bilinearly-interpolated vector. Neighbor estimates
    // are cached ('sm|' keys) and shared — each observed tile is estimated once per catalog
    // rotation for the whole layer.
    if (flags.smoothOff !== true && flags.neighborOff !== true) {
      try {
        const tiles = { '0,0': curr.data };
        const motions = {};
        const jobs = [];
        for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
          const nCurrUrl = neighborTileUrl(currUrl, gx, gy);
          const nPrevUrl = neighborTileUrl(prevUrl, gx, gy);
          if (!nCurrUrl || !nPrevUrl) continue;
          const k = `${gx},${gy}`;
          jobs.push((async () => {
            const nCurr = (gx === 0 && gy === 0) ? curr : await getTile(nCurrUrl);
            if (!(gx === 0 && gy === 0)) tiles[k] = nCurr.data;
            const smKey = 'sm|' + nPrevUrl + '|' + nCurrUrl;
            let sm = motionCache.get(smKey);
            if (!sm || now - sm.ts > ADVECT_TTL_MS) {
              const nPrev = await getTile(nPrevUrl);
              sm = { ...estimateMotion(nPrev.data, nCurr.data, nCurr.w, nCurr.h, SMOOTH_MOTION_OPTS), ts: now };
              motionCache.set(smKey, sm);
              pruneOldest(motionCache);
            }
            motions[k] = sm;
          })().catch(() => {})); // missing/expired neighbor → smooth field falls back per-cell
        }
        await Promise.all(jobs);
        if (!(isCancelled && isCancelled())) warped = advectTileSmoothField(tiles, motions, curr.w, curr.h, leadFactor);
      } catch (e) {
        warped = null; // any smooth-path failure → rigid fallback below
      }
    }
    check(isCancelled);
    if (!warped && flags.neighborOff !== true && (Math.abs(wx) >= 1 || Math.abs(wy) >= 1)) {
      const tiles = { '0,0': curr.data };
      const gxs = wx > 0 ? [-1, 0] : wx < 0 ? [0, 1] : [0];
      const gys = wy > 0 ? [-1, 0] : wy < 0 ? [0, 1] : [0];
      const jobs = [];
      for (const gy of gys) for (const gx of gxs) {
        if (gx === 0 && gy === 0) continue;
        const nurl = neighborTileUrl(currUrl, gx, gy);
        if (!nurl) continue;
        jobs.push(getTile(nurl).then((t) => { tiles[`${gx},${gy}`] = t.data; }).catch(() => {}));
      }
      if (jobs.length) await Promise.all(jobs);
      check(isCancelled);
      warped = advectTileWithNeighbors(tiles, curr.w, curr.h, wx, wy);
    } else if (!warped) {
      warped = advectTile(curr.data, curr.w, curr.h, wx, wy);
    }
    return { data: warped, w: curr.w, h: curr.h };
  }

  return { warp, motionCache };
}
