// Test support (imported FIRST by the suites that pin an older crest/particle shader byte for byte: the crest density, the light
// crest cross, the height encoding, the spectrum): the 2026-11-03 motion fixes are ON by default and change ADVECT_FS and DRAW_VS, so
// this sets their kills before those files' static imports evaluate, and they keep testing the shader they were written for (set before
// load, each kill restores the old text exactly: motionFixes.killSwitch.test.js pins that against dev). Jest gives each test file its
// own window, so this cannot leak into other suites.
window.__RAW_DISABLE_FLOAT_PARTICLE_STATE__ = true;
window.__RAW_DISABLE_RK2_ADVECTION__ = true;
window.__RAW_DISABLE_CREST_LOCAL_PHASE__ = true;
window.__RAW_DISABLE_CREST_TEXEL_RANK__ = true;
