/**
 * The far-edge hold's words (2026-10-25, the owner's day-14 test: "the ICON data is showing Saturday 13th day on the Sunday 14th
 * day"). Past a model's stored 14-day estimate the server holds its last frame (estimate_basis.type far_edge_hold). The status line
 * must say what is held, from the held frame's own time, never "Loading…" (the frame never arrives) nor a bare "estimated".
 */
import { describeDrawnFrame } from './drawnFrameReadout';
import { _resetMarineDrawnForTest, getMarineDrawn, publishMarineDrawn } from './marineDrawnFrame';

const SUN_5AM = Date.parse('2026-11-08T05:00:00Z');
const SAT_6PM = Date.parse('2026-11-07T18:00:00Z');
const req = { model: 'ICON', layer: 'waves', hour: 336, labelMs: SUN_5AM, instantMs: SUN_5AM };
const fmt = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });

describe('far-edge hold words', () => {
  afterEach(() => { delete window.__RAW_DISABLE_DRAWN_HOLD_WORDS__; _resetMarineDrawnForTest(); });

  test('a held frame with its served time says Holding <held time>, not Loading', () => {
    const r = describeDrawnFrame(req, { model: 'ICON', layer: 'waves', hour: 336, dataMs: SAT_6PM, estimated: true, basisType: 'far_edge_hold' });
    expect(r.state).toBe('held');
    expect(r.text).toBe(`Holding ${fmt(SAT_6PM)}’s ICON forecast: the 14-day estimate ends there`);
    expect(r.text).not.toMatch(/Loading/);
  });

  test('with no served time (the label path) it still names the held frame, from estimate_basis.held_from', () => {
    publishMarineDrawn({ hourOffset: 336, __componentLayer: 'waves', __sourceModel: 'ICON', is_estimated: true,
      estimate_basis: { type: 'far_edge_hold', held_from: '2026-11-07T18:00:00+00:00', gap_hours: 11 } });
    const drawn = getMarineDrawn();
    expect(drawn.heldFromMs).toBe(SAT_6PM);
    expect(drawn.dataMs).toBe(null);                                    // the label path: before, this read "Estimated forecast: estimated"
    const r = describeDrawnFrame(req, drawn);
    expect(r).toEqual({ state: 'held', text: `Holding ${fmt(SAT_6PM)}’s ICON forecast: the 14-day estimate ends there` });
  });

  test('the kill restores the previous words; other estimates are untouched', () => {
    window.__RAW_DISABLE_DRAWN_HOLD_WORDS__ = true;
    const killed = describeDrawnFrame(req, { model: 'ICON', layer: 'waves', hour: 336, dataMs: SAT_6PM, estimated: true, basisType: 'far_edge_hold' });
    expect(killed.state).toBe('pending');
    expect(killed.text).toMatch(/^Loading /);
    delete window.__RAW_DISABLE_DRAWN_HOLD_WORDS__;
    const blend = describeDrawnFrame(req, { model: 'ICON', layer: 'waves', hour: 336, dataMs: SUN_5AM, estimated: true, basisType: 'icon_persistence_gfs_blend' });
    expect(blend).toEqual({ state: 'estimated', text: 'Estimated forecast: beyond ICON’s native range' });
  });
});
