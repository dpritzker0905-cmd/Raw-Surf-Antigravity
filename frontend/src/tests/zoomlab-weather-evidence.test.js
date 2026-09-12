const { EventEmitter } = require('events');
const { attachWeatherEvidence } = require('../../scripts/zoomlab-weather-evidence.cjs');
const g = () => ({ model: 'GFS', model_run_time: '2026-09-12T00:00:00Z', cols: 2, rows: 2,
  bounds: { west: 0, south: 0, east: 1, north: 1 }, vectors: [{ lat: 0, lng: 0, is_valid: false,
    waves: { height: 2, is_valid: false }, private: 'secret' }], token: 'secret', user: { name: 'secret' } });
const response = (raw, suffix = '/api/weather/grid_series?token=secret', origin = 'https://raw-surf-antigravity.onrender.com') => ({
  url: () => origin + suffix, status: () => 200, request: () => ({ method: () => 'GET' }),
  body: async () => Buffer.from(JSON.stringify(raw)),
});
it('copies only selected weather fields and distinguishes an absent mask from false/null', async () => {
  const page = new EventEmitter(), stop = attachWeatherEvidence(page), data = g();
  data.vectors.push({ lng: 1, lat: 0, isOcean: null });
  page.emit('response', response({ frames: [data], model: 'GFS' }));
  const s = await stop(), r = s.responses[0];
  expect(r).toMatchObject({ route: 'weather-grid-series', complete: true, frameCount: 1 });
  expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
  const vs = r.frames[0].vectors;
  expect(vs[0]).toMatchObject({ is_valid: false, waves: { is_valid: false, height: 2 } });
  expect(vs[1].isOcean).toBeNull(); expect(vs[1].is_valid).toBeUndefined();
  expect(JSON.stringify(s)).not.toContain('secret');
  expect(page.listenerCount('response')).toBe(0);
});
it('ignores private routes, lookalike hosts and writes', async () => {
  const p = new EventEmitter(), stop = attachWeatherEvidence(p);
  p.emit('response', response(g(), '/api/friends'));
  p.emit('response', response(g(), '/api/weather/grid', 'https://raw-surf-antigravity.onrender.com.evil.test'));
  p.emit('response', { ...response(g()), request: () => ({ method: () => 'POST' }) });
  expect((await stop()).seen).toBe(0);
});
it('does not claim complete when the frame or vector budget truncates a response', async () => {
  const p = new EventEmitter(), stop = attachWeatherEvidence(p);
  p.emit('response', response({ frames: Array.from({ length: 65 }, g) }));
  const s = await stop();
  expect(s.framesDropped).toBe(1); expect(s.responses[0].complete).toBe(false);
  const p2 = new EventEmitter(), stop2 = attachWeatherEvidence(p2), huge = g();
  huge.vectors = Array(100001).fill({ lat: 0 }); p2.emit('response', response(huge, '/api/weather/grid'));
  expect((await stop2()).responses[0].frames[0]).toMatchObject({ complete: false, reason: 'vector-budget', vectors: null });
});
it('preserves unavailable bodies and response caps as explicit evidence gaps', async () => {
  const p = new EventEmitter(), stop = attachWeatherEvidence(p);
  p.emit('response', { ...response(g()), body: async () => { throw Error('secret'); } });
  for (let i = 0; i < 34; i++) p.emit('response', response(g()));
  const s = await stop();
  expect(s).toMatchObject({ seen: 35, dropped: 3, errors: 1 });
  expect(s.responses[0]).toMatchObject({ complete: false, reason: 'body-unavailable-or-invalid' });
  expect(JSON.stringify(s)).not.toContain('secret');
});
