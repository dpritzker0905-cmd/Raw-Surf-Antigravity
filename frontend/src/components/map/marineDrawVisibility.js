// Normal marine shaders output premultiplied zero or discard at exactly zero
// opacity. Submitting those draws still runs their vertices/fragments. Debug
// shaders can output visible colors regardless of opacity, so keep them.
// Never apply this to advection: hidden particles must continue to simulate.
// Unknown/invalid values fail open; no threshold removes faint visible water.
export function shouldDrawMarinePass(opacity, debugMode,
  win = typeof window !== 'undefined' ? window : undefined) {
  return opacity !== 0 || debugMode !== 0 || win?.__RAW_DISABLE_ZERO_OPACITY_SKIP__ === true;
}
