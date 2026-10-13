/**
 * requestRecorder — the A15-11 instrument, verified against known answers before it measures the app.
 *
 * Audit 15.0 measured ~11 weather requests within ~9 s of one layer activation, up to 5 launched in
 * the same 5 ms, and proposed a budget of <= 4 in flight. The E2E continuity test now records every
 * `/api/weather/*` request per gesture; these pin the arithmetic that turns those rows into the numbers.
 */
const { summarizeRequests, endpointOf, isWorldExtent } = require('../../e2e/requestRecorder');

const API = 'https://raw-surf-antigravity.onrender.com/api/weather';
const series = (bbox) => `${API}/grid_series?model=GFS&domain=marine&layer=waves&bbox=${bbox}&hours=0,3`;
const row = (url, start, end, label, extra = {}) => ({ url, start, end, label, status: 200, failed: false, ...extra });

describe('requestRecorder.endpointOf / isWorldExtent', () => {
  it('names the endpoint after /api/weather/', () => {
    expect(endpointOf(series('-81,27,-80,28'))).toBe('grid_series');
    expect(endpointOf(`${API}/grid?model=GFS`)).toBe('grid');
    expect(endpointOf(`${API}/point-rating?lat=1&lng=2`)).toBe('point-rating');
    expect(endpointOf('https://x/api/other')).toBe('other');
  });

  it('a world bbox is world-extent, a viewport is not, and so is a dateline-crossing world', () => {
    expect(isWorldExtent(series('-180,-80,180,85'))).toBe(true);
    expect(isWorldExtent(series('-81.2,27.1,-79.9,28.4'))).toBe(false);
    expect(isWorldExtent(series('170,-80,169,85'))).toBe(true);
    expect(isWorldExtent(`${API}/grid?west=-180&east=180&south=-80&north=85`)).toBe(true);
    expect(isWorldExtent(`${API}/products`)).toBe(false);
  });
});

describe('requestRecorder.summarizeRequests', () => {
  it('THE AUDIT SHAPE: one activation launching 5 in the same 5 ms meets a peak of 5', () => {
    const rows = [0, 1, 2, 4, 5].map((t) => row(series('-81,27,-80,28'), 1000 + t, 9000, 'activate:Waves'));
    rows.push(row(series('-180,-80,180,85'), 2000, 6000, 'activate:Waves'));
    const s = summarizeRequests(rows, 10000);
    expect(s.byLabel['activate:Waves']).toMatchObject({ n: 6, peakInFlight: 6, world: 1, failed: 0 });
    expect(s.peakInFlight).toBe(6);
  });

  it('serial requests never overlap: peak 1, and each gesture is counted on its own', () => {
    const rows = [row(series('0,0,1,1'), 0, 100, 'a'), row(series('0,0,1,1'), 100, 200, 'a'),
      row(series('0,0,1,1'), 300, 400, 'b')];
    const s = summarizeRequests(rows, 1000);
    expect(s.byLabel.a).toMatchObject({ n: 2, peakInFlight: 1, medianMs: 100, maxMs: 100 });
    expect(s.byLabel.b.n).toBe(1);
    expect(s.peakInFlight).toBe(1);
  });

  it('a gesture meets the contention an EARLIER gesture left in flight', () => {
    const rows = [row(series('0,0,1,1'), 0, 5000, 'toggle:Swell'), row(series('0,0,1,1'), 10, 5000, 'toggle:Swell'),
      row(series('0,0,1,1'), 2000, 2500, 'toggle:Wind Waves')];
    expect(summarizeRequests(rows, 6000).byLabel['toggle:Wind Waves'].peakInFlight).toBe(3);
  });

  it('an unfinished request stays open until now; failures and HTTP errors are counted', () => {
    const rows = [row(series('0,0,1,1'), 0, null, 'x'), row(series('0,0,1,1'), 500, 600, 'x', { failed: true }),
      row(series('0,0,1,1'), 700, 800, 'x', { status: 503 })];
    const s = summarizeRequests(rows, 1000);
    expect(s.byLabel.x).toMatchObject({ n: 3, peakInFlight: 2, failed: 2 });
  });

  it('nothing recorded is an empty summary, not a crash', () => {
    expect(summarizeRequests([], 0)).toEqual({ total: 0, peakInFlight: 0, peakInFlightSettled: 0, unsettled: 0,
      byLabel: {} });
  });

  it('SETTLED: a request that never finished is left out of the settled peak and counted instead', () => {
    const rows = [row(series('0,0,1,1'), 0, null, 'x'), row(series('0,0,1,1'), 500, 600, 'x'),
      row(series('0,0,1,1'), 550, 650, 'y')];
    const s = summarizeRequests(rows, 1000);
    expect(s).toMatchObject({ peakInFlight: 3, peakInFlightSettled: 2, unsettled: 1 });
    expect(s.byLabel.x).toMatchObject({ peakInFlight: 2, peakInFlightSettled: 1, unsettled: 1 });
    expect(s.byLabel.y).toMatchObject({ peakInFlight: 3, peakInFlightSettled: 2, unsettled: 0 });
  });

  it('THE MEASURED SHAPE (E2E 36372270148): one request cut off mid-flight beside four that finished', () => {
    const rows = [row(series('-180,-80,180,85'), 0, null, 'toggle:Waves')]
      .concat([10, 20, 30, 40].map((t) => row(series('-81,27,-80,28'), 5000 + t, 6000, 'model:ICON')));
    const s = summarizeRequests(rows, 9000);
    expect(s.byLabel['model:ICON']).toMatchObject({ peakInFlight: 5, peakInFlightSettled: 4 });
    expect(s).toMatchObject({ peakInFlight: 5, peakInFlightSettled: 4, unsettled: 1 });
  });
});
