// Test support (imported FIRST by the suites that pin an older marine colour shader byte for byte: the light spectrum, the height
// encoding): the hour blend (marineHourBlend.js) adds text to HEATMAP_FS when it is enabled (it is opt-in, OFF by default since
// 2026-11-15, so today this changes nothing; it stays for the day the default flips), so this sets its kill before those
// files' static imports evaluate, and they keep testing the shader they were written for (set before load, the kill returns the
// shader as it came: marineHourBlend.test.js pins that). Jest gives each test file its own window, so this cannot leak.
window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true;
