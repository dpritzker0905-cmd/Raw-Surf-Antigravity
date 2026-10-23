// Test support (imported FIRST by the suites that pin light's v2 wash and its crests, D-033/D-034/D-036): sets the spectrum's kill before
// those files' static imports evaluate, so they keep testing v2 exactly now that the spectrum (D-037) is light's default. Jest gives each
// test file its own window, so this cannot leak into other suites. marineWaveSpectrum.test.js pins the spectrum itself.
window.__RAW_DISABLE_WAVE_SPECTRUM__ = true;
