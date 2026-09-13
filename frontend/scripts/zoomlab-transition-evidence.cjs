// A separate provenance audit. Optical PASS does not establish which forecast was displayed.
// This reads captured engine/encoder objects only; it never changes a render decision.
const fs = require('fs');
const zonedInstant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const text = value => typeof value === 'string' && value.trim().length > 0;
const bounds = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
  && value[2] > value[0] && value[3] > value[1];
const pitch = grid => bounds(grid?.bounds) && Number.isInteger(grid.cols) && grid.cols > 1
  ? (grid.bounds[2] - grid.bounds[0]) / (grid.cols - 1) : null;

function encoderFor(encodes, grid, at) {
  const gridId = grid.id;
  const candidates = encodes.filter(e => e?.grid?.id === gridId && Number.isFinite(e.at) && e.at <= at);
  if (!candidates.length) return { gap: 'missing-encoder-join' };
  const keys = candidates.map(e => JSON.stringify([e.identity, e.hourOffset, e.grid]));
  if (new Set(keys).size !== 1) return { gap: 'ambiguous-encoder-identity' };
  const e = candidates.reduce((a, b) => a.at > b.at ? a : b);
  for (const key of ['model', 'layer', 'rating', 'cols', 'rows', 'bounds']) {
    if (JSON.stringify(e.grid[key]) !== JSON.stringify(grid[key])) return { gap: 'encoder-descriptor-mismatch' };
  }
  if (e.complete !== true || !Array.isArray(e.values) || !Number.isSafeInteger(e.cells) || e.cells < 1
      || e.cells !== grid.cols * grid.rows || e.values.length !== e.cells) return { gap: 'incomplete-encoder' };
  const i = e.identity || {};
  const cycle = zonedInstant(i.model_run_time), served = zonedInstant(i.served_valid_time);
  if (i.model_run_time_status !== 'known' || cycle === null || served === null
      || !text(i.upstream_provider) || !text(i.source_dataset) || !Number.isFinite(e.hourOffset)
      || i.frame_substituted !== false || i.frame_offset_hours !== 0 || e.estimated !== false) {
    return { gap: 'unknown-or-substituted-identity' };
  }
  return { encodeSeq: e.seq, cycle, served, hour: e.hourOffset, provider: i.upstream_provider, dataset: i.source_dataset };
}

function analyzeTransitions(evidence) {
  const observations = [], findings = [], gaps = [];
  const events = Array.isArray(evidence?.events) ? evidence.events : [];
  const encodes = Array.isArray(evidence?.encoder?.encodes) ? evidence.encoder.encodes : [];
  if (!evidence || !Array.isArray(evidence.events)) gaps.push('missing-lifecycle-capture');
  if (evidence?.eventsSeen !== events.length + (evidence?.eventsDropped || 0)) gaps.push('lifecycle-count-mismatch');
  if (evidence?.encoder?.seen !== encodes.length + (evidence?.encoder?.dropped || 0)) gaps.push('encoder-count-mismatch');
  if (new Set(events.map(e => e?.seq)).size !== events.length) gaps.push('duplicate-event-sequence');
  for (const [name, value] of Object.entries({ eventsDropped: evidence?.eventsDropped, errors: evidence?.errors,
    encoderDropped: evidence?.encoder?.dropped, encoderErrors: evidence?.encoder?.errors })) {
    if (value !== 0) gaps.push(`${name}-${Number.isFinite(value) ? value : 'unknown'}`);
  }
  let acceptedCommits = 0, regionalToGlobal = 0;
  for (const e of events) {
    // Bridge calls nest setWaveData. Count the actual resident mutation once, at that common choke.
    if (e?.method !== 'setWaveData' || e.threw) continue;
    const r = e.before?.resident, g = e.after?.resident;
    if (!r || !g || r.id === g.id) continue;
    acceptedCommits++;
    if (!bounds(r.bounds) || !bounds(g.bounds) || pitch(r) === null || pitch(g) === null) {
      gaps.push(`event-${e.seq}-unknown-grid-geometry`); continue;
    }
    if (r.bounds[2] - r.bounds[0] >= 340 || g.bounds[2] - g.bounds[0] < 359 || pitch(g) <= 1) continue;
    regionalToGlobal++;
    const o = { eventSeq: e.seq, method: e.method, t: e.t, end: e.end,
      residentId: r.id, incomingId: g.id, zoom: e.before.lastZoom,
      viewport: e.before.lastViewport, longitudePitchRatio: pitch(g) / pitch(r) };
    observations.push(o);
    if (!Number.isFinite(e.t) || !Number.isFinite(e.end) || e.end < e.t || !bounds(o.viewport)) {
      o.gap = 'unknown-event-time-or-viewport'; continue;
    }
    const a = encoderFor(encodes, r, e.t), b = encoderFor(encodes, g, e.end);
    if (a.gap || b.gap) { o.gap = a.gap || b.gap; continue; }
    o.resident = a; o.incoming = b;
    if (![r.model, g.model, r.layer, g.layer].every(text)
        || typeof r.rating !== 'boolean' || typeof g.rating !== 'boolean') { o.gap = 'unknown-selection'; continue; }
    if (r.model !== g.model || r.layer !== g.layer || a.hour !== b.hour || r.rating !== g.rating
        || a.provider !== b.provider || a.dataset !== b.dataset || a.served !== b.served) {
      o.classification = 'changed-selection-or-validity'; continue;
    }
    o.runDeltaHours = (b.cycle - a.cycle) / 3600000;
    const span = Math.max(o.viewport[2] - o.viewport[0], o.viewport[3] - o.viewport[1]);
    o.classification = o.runDeltaHours < 0 ? 'earlier-model-cycle' : 'equal-or-later-model-cycle';
    // Report the measured regression. This does not assert that a newer model has better skill.
    if (o.runDeltaHours < 0 && span <= 40) findings.push({ type: 'GLOBAL_RUN_REGRESSION', ...o });
  }
  for (const o of observations) if (o.gap) gaps.push(`event-${o.eventSeq}-${o.gap}`);
  if (!regionalToGlobal) gaps.push('no-regional-to-global-transition-observed');
  const complete = gaps.length === 0;
  return { schema: 1, scope: 'Same-selection, same-valid-time regional-to-coarse-global model-cycle regression at viewport spans <=40 degrees',
    verdict: findings.length ? 'FINDINGS' : complete ? 'PASS' : 'REFUSE', complete,
    acceptedCommits, regionalToGlobal, observations, findings, gaps,
    limits: 'Captured setWaveData/encoder object joins only. PASS covers this narrow provenance check, not field equality, forecast skill, all transitions, or optical availability. Pending origin is not inferred from timing.' };
}

module.exports = { analyzeTransitions };
if (require.main === module) {
  try {
    if (!process.argv[2]) throw Error('usage: node zoomlab-transition-evidence.cjs <opacity.json>');
    const result = analyzeTransitions(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.verdict === 'FINDINGS' ? 1 : result.verdict === 'REFUSE' ? 3 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
