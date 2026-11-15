// Test support (imported FIRST by marineHourBlend.test.js): the hour blend is OFF by default and its shader text is added only
// when the opt-in is set before the shaders load, so this sets it before that file's static imports evaluate. Jest gives each
// test file its own window, so this cannot leak.
window.__RAW_ENABLE_HOUR_BLEND__ = true;
