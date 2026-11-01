/**
 * marineSeekIdentity.js — the two identity checks the scrub audit (2026-10-18, W-2) found missing: T-03 (a stale request's
 * error may not blank the display) and T-06 (parity compares model and layer, not the hour alone). The call sites are pinned
 * in useMarineDataFetcherCore.race.test.js and marineRenderParity.test.js; these pin the rules themselves.
 */
import { marineErrorOwnsDisplay, parityIdentityMatches, resolveMarineFetchModel } from './marineSeekIdentity';

const cur = { model: 'EURO', layer: 'waves', hour: 48 };
const own = (over, win = {}) => marineErrorOwnsDisplay({ requestId: 5, currentRequestId: 5, intent: cur, current: cur, ...over }, win);

describe('marineErrorOwnsDisplay (T-03)', () => {
  it('the current request, same target: owns the display', () => {
    expect(own({})).toBe(true);
  });
  it('a superseded request at the same hour does NOT (the defect: hour equality was enough)', () => {
    expect(own({ requestId: 4, intent: { ...cur, model: 'GFS' } })).toBe(false);
    expect(own({ requestId: 4 })).toBe(false);
  });
  it('the newest request whose target moved on (model, layer or hour) does not', () => {
    expect(own({ intent: { ...cur, model: 'GFS' } })).toBe(false);
    expect(own({ intent: { ...cur, layer: 'swell_1' } })).toBe(false);
    expect(own({ intent: { ...cur, hour: 45 } })).toBe(false);
  });
  it('an invocation that failed before taking an id (0) is judged by its target alone', () => {
    expect(own({ requestId: 0 })).toBe(true);
    expect(own({ requestId: 0, intent: { ...cur, model: 'GFS' } })).toBe(false);
  });
  it('never while scrubbing', () => {
    expect(own({ scrubbing: true })).toBe(false);
  });
  it('kill switch: back to the hour-only test', () => {
    expect(own({ requestId: 4, intent: { ...cur, model: 'GFS' } }, { __RAW_DISABLE_MARINE_ERROR_IDENTITY__: true })).toBe(true);
  });
});

describe('resolveMarineFetchModel mirrors the fetcher', () => {
  it('ICON past 168 h without the backend ICON flag draws GFS; with it, ICON', () => {
    expect(resolveMarineFetchModel('ICON', 'waves', 200, false)).toBe('GFS');
    expect(resolveMarineFetchModel('ICON', 'waves', 200, true)).toBe('ICON');
    expect(resolveMarineFetchModel('ICON', 'waves', 168, false)).toBe('ICON');
  });
  it('past the display horizon (336 h) EURO and ICON draw GFS', () => {
    expect(resolveMarineFetchModel('EURO', 'waves', 337, true)).toBe('GFS');
    expect(resolveMarineFetchModel('EURO', 'swell_1', 337, true)).toBe('GFS');
    expect(resolveMarineFetchModel('ICON', 'waves', 337, true)).toBe('GFS');
    expect(resolveMarineFetchModel('EURO', 'waves', 336, true)).toBe('EURO');
  });
});

describe('parityIdentityMatches (T-06)', () => {
  const sig = { activeModel: 'GFS', activeMarineLayer: 'waves', componentLayer: 'waves' };
  it('model and layer must both match', () => {
    expect(parityIdentityMatches(sig, 'GFS', 'waves', 48, true, {})).toBe(true);
    expect(parityIdentityMatches(sig, 'EURO', 'waves', 48, true, {})).toBe(false);
    expect(parityIdentityMatches(sig, 'GFS', 'swell_1', 48, true, {})).toBe(false);
  });
  it('a componentLayer of "none" falls back to the layer selected at upload', () => {
    expect(parityIdentityMatches({ ...sig, componentLayer: 'none', activeMarineLayer: 'swell_1' }, 'GFS', 'swell_1', 0, true, {})).toBe(true);
  });
  it('unknown fields never fail the check', () => {
    expect(parityIdentityMatches({}, 'EURO', 'waves', 0, true, {})).toBe(true);
    expect(parityIdentityMatches(null, 'EURO', 'waves', 0, true, {})).toBe(true);
  });
  it('kill switch', () => {
    expect(parityIdentityMatches(sig, 'EURO', 'waves', 48, true, { __RAW_DISABLE_PARITY_IDENTITY__: true })).toBe(true);
  });
});
