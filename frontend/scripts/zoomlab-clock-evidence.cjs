// A browser sample occurs between observer send/receive. Preserve that interval rather than
// pretending independent monotonic clocks share an origin or subtracting wall-clock times.
async function sampleBrowserClock(page, observerClock) {
  const before = observerClock();
  const browser = await page.evaluate(() => ({ monoMs: performance.now(), utcMs: Date.now() }));
  const after = observerClock();
  const valid = [before.monoMs, after.monoMs, browser.monoMs].every(Number.isFinite)
    && after.monoMs >= before.monoMs;
  return { before, browser, after, valid,
    observerMinusBrowserMs: valid ? [before.monoMs - browser.monoMs, after.monoMs - browser.monoMs] : null };
}
module.exports = { sampleBrowserClock };
