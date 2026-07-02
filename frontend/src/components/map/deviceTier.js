/**
 * deviceTier.js — the single source of truth for device-capability tiering (particle pools, grid
 * densities). The signal is the DEVICE (handheld UA / coarse-pointer+touch / CPU cores), NEVER the
 * transient window width alone: WebGLMarineLayer used a one-shot `window.innerWidth < 768` at engine
 * creation, so a desktop browser with a momentarily narrow window got the HALVED mobile particle pool
 * (36,864 vs 87,616) and kept it until the next engine re-create — live-caught in the user's console
 * 2026-07-02 ("[WebGLMarine] ... 36864 wave crests" on a desktop). Capability signals cannot change
 * mid-session, so the tier is stable and no resize handling is needed.
 *
 * Tiers: handheld (phones/tablets — halved marine pool for GPU/memory headroom; mobile fetch grids
 * only when ALSO actually narrow) · weak (≤4 cores — reduced canvas particle counts) · full.
 */

export function isHandheldDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaHandheld = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ masquerades as macOS: coarse primary pointer + real multi-touch is the reliable tell.
  let coarseTouch = false;
  try {
    coarseTouch = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches
      && (navigator.maxTouchPoints || 0) > 1;
  } catch (e) { /* matchMedia unavailable (tests/jsdom) → UA answer stands */ }
  return uaHandheld || coarseTouch;
}

// Preserves the exact pre-existing "weak" semantic (GPUWindLayer): few cores = smaller canvas pools.
export function isWeakDevice() {
  if (typeof navigator === 'undefined') return false;
  return (navigator.hardwareConcurrency || 4) <= 4;
}

// Marine crest pool resolution: 296² = 87,616 on desktop/laptop (any window size); 192² = 36,864 on
// handhelds. Laptops have fine pointers → full tier by construction.
export function getMarineParticleRes() {
  return isHandheldDevice() ? 192 : 296;
}
