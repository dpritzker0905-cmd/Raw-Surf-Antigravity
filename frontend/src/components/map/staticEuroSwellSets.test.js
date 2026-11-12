/**
 * The EURO swell world sets (2026-11-12, move 3): listed in STATIC_SETS so the client reads what the publisher has written since
 * D-059 (frame_set.EURO_SWELL_SETS), each enabled by default and all off under window.__RAW_DISABLE_STATIC_EURO_SWELL__.
 */
import { EURO_SWELL_SET_KEYS, euroSwellSetsOn, isEuroSwellSetKey } from './staticEuroSwellSets';
import { STATIC_SETS, staticSetEnabled } from './staticFrames';

afterEach(() => { delete window.__RAW_DISABLE_STATIC_EURO_SWELL__; delete window.__RAW_DISABLE_STATIC_FRAMES_SETS__; });

describe('EURO swell world sets', () => {
  it('names the six keys the publisher writes (plain + filled x swell_1 / swell_2 / wind_waves), all in STATIC_SETS', () => {
    expect([...EURO_SWELL_SET_KEYS].sort()).toEqual([
      'EURO/marine/swell_1/global_mid', 'EURO/marine/swell_1/global_mid_filled',
      'EURO/marine/swell_2/global_mid', 'EURO/marine/swell_2/global_mid_filled',
      'EURO/marine/wind_waves/global_mid', 'EURO/marine/wind_waves/global_mid_filled',
    ]);
    EURO_SWELL_SET_KEYS.forEach((k) => expect(STATIC_SETS).toContain(k));
    expect(isEuroSwellSetKey('EURO/marine/waves/global_mid')).toBe(false);
  });

  it('ON by default: every EURO swell set is enabled', () => {
    expect(euroSwellSetsOn()).toBe(true);
    EURO_SWELL_SET_KEYS.forEach((k) => expect(staticSetEnabled(k)).toBe(true));
  });

  it('OFF PATH: the kill disables every EURO swell set and nothing else', () => {
    window.__RAW_DISABLE_STATIC_EURO_SWELL__ = true;
    expect(euroSwellSetsOn()).toBe(false);
    EURO_SWELL_SET_KEYS.forEach((k) => expect(staticSetEnabled(k)).toBe(false));
    expect(staticSetEnabled('EURO/marine/waves/global_mid')).toBe(true);
    expect(staticSetEnabled('GFS/marine/swell_1/global_mid')).toBe(true);
  });

  it('the per-set kill still reaches one EURO swell set', () => {
    window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['EURO/marine/swell_2/global_mid_filled'];
    expect(staticSetEnabled('EURO/marine/swell_2/global_mid_filled')).toBe(false);
    expect(staticSetEnabled('EURO/marine/swell_1/global_mid_filled')).toBe(true);
  });
});
