// Test support (imported FIRST by the suites that pin today's crest shader: the light palette and style, the height encoding, the
// spectrum, the dark storm crest): beach's crest lift (marineBeachCrestLift.js) is ON by default, so this sets its kill before those
// files' static imports evaluate, and they keep testing the shader they were written for. Jest gives each test file its own window,
// so this cannot leak into other suites. marineBeachCrestLift.test.js pins the lift.
window.__RAW_DISABLE_BEACH_CREST_LIFT__ = true;
