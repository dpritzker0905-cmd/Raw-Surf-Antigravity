const { sampleBrowserClock } = require('../../scripts/zoomlab-clock-evidence.cjs');
it('reports the clock-offset interval including observer latency without equating wall clocks', async () => {
  const clock = jest.fn().mockReturnValueOnce({ monoMs: 100, utcMs: 9000 }).mockReturnValueOnce({ monoMs: 140, utcMs: 8000 });
  const page = { evaluate: async () => ({ monoMs: 10000, utcMs: 123456 }) };
  expect(await sampleBrowserClock(page, clock)).toMatchObject({ valid: true, observerMinusBrowserMs: [-9900, -9860] });
});
it.each([[140, 100], [NaN, 150], [100, Infinity]])('refuses invalid/reversed observer times %s..%s', async (a, b) => {
  const clock = jest.fn().mockReturnValueOnce({ monoMs: a }).mockReturnValueOnce({ monoMs: b });
  expect(await sampleBrowserClock({ evaluate: async () => ({ monoMs: 2 }) }, clock)).toMatchObject({ valid: false, observerMinusBrowserMs: null });
});
