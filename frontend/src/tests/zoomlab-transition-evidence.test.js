const { analyzeTransitions } = require('../../scripts/zoomlab-transition-evidence.cjs');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const regional = { id: 1, cols: 17, rows: 17, bounds: [-83, 26, -79, 30], model: 'GFS', layer: 'waves', rating: false };
  const global = { id: 2, cols: 181, rows: 82, bounds: [-180, -78, 180, 84], model: 'GFS', layer: 'waves', rating: false };
  const encode = (grid, cycle, at) => ({ grid, at, seq: grid.id, hourOffset: 0, estimated: false, complete: true,
    cells: grid.cols * grid.rows, values: Array.from({ length: grid.cols * grid.rows }, () => [1]),
    identity: { model_run_time: cycle, model_run_time_status: 'known', served_valid_time: '2026-09-12T00:00:00Z',
      upstream_provider: 'noaa', source_dataset: 'ncep_gfswave025', frame_offset_hours: 0, frame_substituted: false } });
  return { eventsSeen: 1, eventsDropped: 0, errors: 0, events: [{ seq: 1, t: 2000, end: 2010, method: 'setWaveData', incoming: global,
    before: { resident: regional, pending: null, lastZoom: 6.666, lastViewport: [-83.8, 26.2, -76.2, 29.8] }, after: { resident: global, pending: null } }],
    encoder: { seen: 2, dropped: 0, errors: 0, encodes: [encode(regional, '2026-09-11T06:00:00Z', 0), encode(global, '2026-09-10T12:00:00Z', 2005)] } };
}
it('detects an 18-hour model-cycle regression despite a successful resident commit', () => {
  const r = analyzeTransitions(fixture());
  expect(r).toMatchObject({ verdict: 'FINDINGS', complete: true, regionalToGlobal: 1 });
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0]).toMatchObject({ type: 'GLOBAL_RUN_REGRESSION', runDeltaHours: -18, longitudePitchRatio: 8 });
});
it.each(['2026-09-11T06:00:00Z', '2026-09-11T02:00:00-04:00', '2026-09-12T06:00:00Z'])('accepts equal/later zoned cycles %s', cycle => {
  const e = fixture(); e.encoder.encodes[1].identity.model_run_time = cycle;
  expect(analyzeTransitions(e)).toMatchObject({ verdict: 'PASS', findings: [] });
});
it.each(['model', 'layer', 'rating', 'hour', 'provider', 'dataset', 'served'])('separates a deliberate or different %s target', key => {
  const e = fixture(), g = e.events[0].after.resident, b = e.encoder.encodes[1];
  if (key === 'model') g.model = 'ICON';
  if (key === 'layer') g.layer = 'swell_1';
  if (key === 'rating') g.rating = true;
  if (key === 'hour') b.hourOffset = 3;
  if (key === 'provider') b.identity.upstream_provider = 'other';
  if (key === 'dataset') b.identity.source_dataset = 'other';
  if (key === 'served') b.identity.served_valid_time = '2026-09-12T03:00:00Z';
  expect(analyzeTransitions(e).observations[0].classification).toBe('changed-selection-or-validity');
  expect(analyzeTransitions(e).findings).toEqual([]);
});
it.each(['cycle', 'status', 'served', 'provider', 'offset', 'substitution', 'estimated', 'hour', 'model', 'rating'])('refuses unknown or unsuitable %s', key => {
  const e = fixture(), b = e.encoder.encodes[1];
  if (key === 'cycle') b.identity.model_run_time = '2026-09-10T12:00:00';
  if (key === 'status') b.identity.model_run_time_status = 'unknown';
  if (key === 'served') b.identity.served_valid_time = 'nonsense';
  if (key === 'provider') delete b.identity.upstream_provider;
  if (key === 'offset') b.identity.frame_offset_hours = 1;
  if (key === 'substitution') b.identity.frame_substituted = true;
  if (key === 'estimated') b.estimated = null;
  if (key === 'hour') b.hourOffset = null;
  if (key === 'model') e.events[0].after.resident.model = null;
  if (key === 'rating') e.events[0].after.resident.rating = null;
  expect(analyzeTransitions(e)).toMatchObject({ verdict: 'REFUSE', complete: false, findings: [] });
});
it.each([39.999, 40, 40.001])('bounds the narrow-view finding at span %s', span => {
  const e = fixture(); e.events[0].before.lastViewport = [-100, 20, -100 + span, 35];
  expect(analyzeTransitions(e).findings.length).toBe(span <= 40 ? 1 : 0);
});
it('does not count nested bridge wrappers, unchanged residents, or rejected commits twice', () => {
  const e = fixture(), event = e.events[0];
  e.events.push({ ...event, seq: 2, method: 'bridgeToCoarseGlobalIfHeld' });
  e.events.push({ ...event, seq: 3, after: event.before });
  e.eventsSeen = 3;
  expect(analyzeTransitions(e).regionalToGlobal).toBe(1);
});
it('refuses missing, future-only, incomplete or ambiguous encoder joins', () => {
  for (const change of [e => { e.encoder.encodes = []; }, e => { e.encoder.encodes[1].at = 2011; },
    e => { e.encoder.encodes[1].complete = false; }, e => { e.encoder.encodes[1].values = []; },
    e => { const b = clone(e.encoder.encodes[1]); b.at = 2006; b.identity.model_run_time = '2026-09-11T06:00:00Z'; e.encoder.encodes.push(b); }]) {
    const e = fixture(); change(e); expect(analyzeTransitions(e).verdict).toBe('REFUSE');
  }
});
it('accepts identical repeated identity encodes and selects the latest eligible snapshot', () => {
  const e = fixture(), b = clone(e.encoder.encodes[1]); b.at = 2006; b.seq = 3; e.encoder.encodes.push(b);
  e.encoder.seen = 3;
  expect(analyzeTransitions(e).findings[0].incoming.encodeSeq).toBe(3);
});
it.each([null, {}, { events: [] }])('never turns absent capture or zero observed transitions into PASS', e => {
  expect(analyzeTransitions(e).verdict).toBe('REFUSE');
});
it('retains an observed finding when dropped evidence makes the overall audit incomplete', () => {
  const e = fixture(); e.eventsDropped = 2;
  expect(analyzeTransitions(e)).toMatchObject({ verdict: 'FINDINGS', complete: false });
});
it('refuses to certify a non-finding when capture counters are missing or inconsistent', () => {
  for (const change of [e => { delete e.eventsSeen; }, e => { e.encoder.seen++; }, e => { e.events[0].seq = undefined; e.events.push(e.events[0]); }]) {
    const e = fixture(); e.encoder.encodes[1].identity.model_run_time = '2026-09-12T06:00:00Z'; change(e);
    expect(analyzeTransitions(e)).toMatchObject({ verdict: 'REFUSE', complete: false });
  }
});
it('refuses inconsistent encoder geometry or selection even when object IDs match', () => {
  const e = fixture(); e.encoder.encodes[1].grid = { ...e.encoder.encodes[1].grid, model: 'ICON' };
  expect(analyzeTransitions(e)).toMatchObject({ verdict: 'REFUSE', complete: false });
});
it.each(['time', 'geometry', 'viewport'])('refuses invalid %s without manufacturing a comparison', key => {
  const e = fixture();
  if (key === 'time') e.events[0].end = 1999;
  if (key === 'geometry') e.events[0].after.resident.bounds = [180, -78, -180, 84];
  if (key === 'viewport') e.events[0].before.lastViewport = null;
  expect(analyzeTransitions(e).verdict).toBe('REFUSE');
});
