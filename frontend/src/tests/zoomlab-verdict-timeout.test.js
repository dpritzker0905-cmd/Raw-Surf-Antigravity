const { analyzeTrace } = require('../../scripts/zoomlab-verdict');
const frames = [0, 100].map(t => ({ t, z: 6.862, L: 100, mult: 1, anim: new Array(40).fill(8) }));
const sources = ['featured photographers', 'friends on map', 'live photographers'];

it.each(sources)('keeps the observed %s Axios timeout non-green, with the correct cause', source => {
  // Error shapes from run34304969847. Both call sites log the caught API request error.
  const error = `[ERROR] Error fetching ${source}: AxiosError: timeout of 15000ms exceeded\n    at XMLHttpRequest.handleTimeout`;
  const result = analyzeTrace({ frames, consoleErrors: [error] });
  expect(result.verdict).toBe('REFUSE');
  expect(result.pass).toBe(false);
  expect(result.observable).toBe(false);
  expect(result.transportErrors).toBe(1);
  expect(result.hardRenderFindings).toHaveLength(0);
  expect(result.findings).toHaveLength(1);
});

it.each([
  '[ERROR] Error fetching friends on map: TypeError: timeout of 15000ms exceeded',
  '[ERROR] Error fetching featured photographers: TypeError: cannot read properties of undefined',
  '[ERROR] Error fetching friends on map: AxiosError: invalid render data',
  '[ERROR] Error fetching live photographers: TypeError: timeout of 15000ms exceeded',
  '[ERROR] Error fetching live photographers: AxiosError: invalid render data',
])('preserves nearby non-transport errors: %s', error => {
  const result = analyzeTrace({ frames, consoleErrors: [error] });
  expect(result.verdict).toBe('FAIL');
  expect(result.hardRenderFindings).toHaveLength(1);
});

it('a real renderer crash still fails alongside the newly recognized timeout', () => {
  const result = analyzeTrace({ frames, consoleErrors: [
    '[ERROR] Error fetching friends on map: AxiosError: timeout of 15000ms exceeded',
    'TypeError: broken marine render',
  ] });
  expect(result.verdict).toBe('FAIL');
  expect(result.transportErrors).toBe(1);
  expect(result.hardRenderFindings).toHaveLength(1);
});
