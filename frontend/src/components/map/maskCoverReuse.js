// WORLD MASK COVER-REUSE (2026-10-16). Pure rule for WebGLMarineTextureEncoder's mask cache.
//
// With the server's SERIES_THIN_NODE_BOUNDS on, a thinned world series frame carries the bounds of the cells it KEPT (north 80
// for a 181 x 83 frame thinned by 4) while the exact /grid frame keeps north 84. The encoder compared cached mask bounds to the
// incoming frame's bounds strictly, so every thinned <-> exact swap rebuilt the 4096 x 2048 world mask: 23 mask-sized texture
// uploads against 3 over a six-jump scrub in the offline harness (frontend/scripts/offline-backend), 4 to 8 extra per forward jump.
//
// The engine samples the mask by its OWN cached bounds (u_maskBounds = engine._cachedMaskBounds whenever the wave data holds the
// cached texture), so a cached world mask whose bounds COVER the incoming world frame is geometrically right for it. Reuse it.
//
// Scope is deliberately narrow: WORLD-span frames only (>= 340 deg of longitude, the client's own world threshold), cached bounds
// must cover all four edges, and the cached texture must be at least as dense as a rebuild would be. Every regional path keeps
// the strict compare and its retain / no-downgrade / patch-carry logic. With equal bounds (today's behaviour, flag off) this
// rule is never needed, so shipping it changes nothing until the server flag is on.
// Kill: window.__RAW_DISABLE_MASK_COVER_REUSE__ = true.
import { maskDensityPxPerDeg, incomingMaskDensityPxPerDeg } from './WebGLMarineMaskRenderer';

const WORLD_SPAN_DEG = 340;
const EDGE_EPS = 1e-6;
const DENSITY_SLACK = 0.99;

export function maskCoversWorldFrame(cachedBounds, cachedDims, incomingBounds) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_COVER_REUSE__ === true) return false;
  if (!cachedBounds || !cachedDims || !incomingBounds) return false;
  // A window that crosses the antimeridian (east < west) is left to the rebuild.
  if (cachedBounds.east < cachedBounds.west || incomingBounds.east < incomingBounds.west) return false;
  if (cachedBounds.east - cachedBounds.west < WORLD_SPAN_DEG) return false;
  if (incomingBounds.east - incomingBounds.west < WORLD_SPAN_DEG) return false;
  const covers = cachedBounds.west <= incomingBounds.west + EDGE_EPS && cachedBounds.east >= incomingBounds.east - EDGE_EPS
    && cachedBounds.south <= incomingBounds.south + EDGE_EPS && cachedBounds.north >= incomingBounds.north - EDGE_EPS;
  if (!covers) return false;
  return maskDensityPxPerDeg(cachedDims, cachedBounds) >= incomingMaskDensityPxPerDeg(incomingBounds) * DENSITY_SLACK;
}
