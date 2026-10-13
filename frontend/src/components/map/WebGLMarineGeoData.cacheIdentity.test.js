import { getMarineGeoData } from './WebGLMarineGeoData';

const cols = 3, rows = 3, n = cols * rows;
const bounds = west => ({ west, east: west + 1, south: 27, north: 28 });
const allWater = () => new Uint8Array(n).fill(1);
const mask = index => Uint8Array.from({ length: n }, (_, i) => i === index ? 0 : 1);
const channel = (data, offset) => Array.from({ length: n }, (_, i) => data[i * 4 + offset]);

test('equal ocean counts cannot reuse a different spatial mask', () => {
  const b = bounds(-90);
  const first = getMarineGeoData(cols, rows, b, mask(0), n, false);
  const second = getMarineGeoData(cols, rows, b, mask(4), n, false);
  expect(channel(second.dataMask, 0)).toEqual(Array.from(mask(4), x => x * 255));
  expect(second).not.toBe(first);
  expect(channel(first.dataMask, 0)).toEqual(Array.from(mask(0), x => x * 255));
});

test('equal true-ocean counts preserve each current texel flag for land-aware sampling', () => {
  const b = bounds(-91), water = allWater();
  const first = getMarineGeoData(cols, rows, b, water, n, false, null, mask(0));
  const second = getMarineGeoData(cols, rows, b, water, n, false, null, mask(4));
  expect(channel(second.dataChl, 3)).toEqual(Array.from(mask(4), x => x * 255));
  expect(second).not.toBe(first);
  // A positive control: the actual ocean still contributes, and an unchanged layout still hits.
  expect(second.dataChl[3]).toBe(255);
  expect(getMarineGeoData(cols, rows, b, water, n, false, null, mask(4))).toBe(second);
});

test('equal motion-water counts cannot unlock the previous frame\'s cells', () => {
  const b = bounds(-92), water = allWater();
  const first = getMarineGeoData(cols, rows, b, water, n, false, mask(0));
  const second = getMarineGeoData(cols, rows, b, water, n, false, mask(4));
  expect(channel(second.dataMask, 1)).toEqual(Array.from(mask(4), x => x * 255));
  expect(second).not.toBe(first);
  expect(channel(second.dataMask, 0)).toEqual(new Array(n).fill(255));
});

test('mutable encoder scratch arrays cannot change the cached identity retroactively', () => {
  const b = bounds(-93), ocean = mask(0), motion = mask(1), truth = mask(2);
  const first = getMarineGeoData(cols, rows, b, ocean, n, false, motion, truth);
  ocean[0] = motion[1] = truth[2] = 1;
  ocean[3] = motion[4] = truth[5] = 0;
  const second = getMarineGeoData(cols, rows, b, ocean, n, false, motion, truth);
  expect(channel(second.dataMask, 0)).toEqual(Array.from(ocean, x => x * 255));
  expect(channel(second.dataMask, 1)).toEqual(Array.from(motion, x => x * 255));
  expect(channel(second.dataChl, 3)).toEqual(Array.from(truth, x => x * 255));
  expect(channel(first.dataChl, 3)).toEqual(Array.from(mask(2), x => x * 255));
});

test('identical data in new arrays reuses the cached geometry', () => {
  const b = bounds(-94);
  const first = getMarineGeoData(cols, rows, b, mask(0), n, false, mask(1), mask(2));
  expect(getMarineGeoData(cols, rows, { ...b }, mask(0), n, false, mask(1), mask(2))).toBe(first);
});

test('global seam handling and processed length are part of the derivation identity', () => {
  const b = bounds(-95), ocean = mask(0);
  const local = getMarineGeoData(cols, rows, b, ocean, n, false);
  const global = getMarineGeoData(cols, rows, b, ocean, n, true);
  expect(global.dataMask[0]).toBe(127);
  expect(local.dataMask[0]).toBe(0);
  const partial = getMarineGeoData(cols, rows, b, ocean, n - 1, false);
  expect(partial.dataMask[(n - 1) * 4]).toBe(0);
  expect(local.dataMask[(n - 1) * 4]).toBe(255);
});
