import { residentResolutionDeg } from './hudResidentTruth';

const grid = (cols, b) => ({ cols, bounds: b });
// Cold swell_2 press: 9x11 regional resident (0.25 deg), 181x80 world grid offered and refused by the engine.
const regional = grid(9, { west: -81.5, east: -79.5, south: 27.5, north: 30 });
const world = grid(181, { west: -180, east: 180, south: -80, north: 84 });
const win = (res, extra = {}) => ({ __MARINE_ENGINE__: { _waveData: { waveGrid: res } }, ...extra });

test('HUD reports the resident 0.25 deg grid, not the refused 2 deg world grid', () => {
  expect(residentResolutionDeg(win(regional), world)).toBe(0.25);
});
test('same grid or same cell size: no override', () => {
  expect(residentResolutionDeg(win(regional), regional)).toBeNull();
  expect(residentResolutionDeg(win(world), grid(181, world.bounds))).toBeNull();
});
test('no engine, no resident, or kill switch: no override', () => {
  expect(residentResolutionDeg({}, world)).toBeNull();
  expect(residentResolutionDeg(win(null), world)).toBeNull();
  expect(residentResolutionDeg(win(regional, { __RAW_DISABLE_HUD_RESIDENT_TRUTH__: true }), world)).toBeNull();
});
