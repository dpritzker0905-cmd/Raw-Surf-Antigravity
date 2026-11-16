// NO EMPTY LAYERS (2026-11-15, the advisor's red-team of #928): an own-only layer is offered only while one of its sets is published.
import { availabilityCheckKilled, publishedOwnOnlyLayers, setKeysOf } from './ownLayerAvailability';

afterEach(() => { delete window.__RAW_DISABLE_OWN_LAYER_AVAILABILITY__; });
const idx = { frames: [{ valid_time: '2026-11-15T06:00:00Z', path: 'a.bin' }] };

test('the set keys of each own-only layer', () => {
  expect(setKeysOf('gusts').sort()).toEqual(['EURO/weather/gust/global_0p25', 'GFS/weather/gust/global_0p25', 'ICON/weather/gust/global_0p25']);
  expect(setKeysOf('currents')).toEqual(['CMEMS/marine/currents/global_0p25']);
});

test('nothing published (the pilots steps are dark): neither layer is offered', async () => {
  expect(await publishedOwnOnlyLayers(async () => null)).toEqual({ gusts: false, currents: false });
});

test('one published set of a layer is enough; an empty index or a failed read is not', async () => {
  const pin = async (k) => (k === 'GFS/weather/gust/global_0p25' ? idx : k.startsWith('CMEMS') ? { frames: [] } : null);
  expect(await publishedOwnOnlyLayers(pin)).toEqual({ gusts: true, currents: false });
  const throws = async () => { throw new Error('cdn down'); };
  expect(await publishedOwnOnlyLayers(throws)).toEqual({ gusts: false, currents: false });
});

test('a set that disappears from latest.json hides the layer on the next check', async () => {
  let live = true;
  const pin = async (k) => (live && k.startsWith('CMEMS') ? idx : null);
  expect((await publishedOwnOnlyLayers(pin)).currents).toBe(true);
  live = false;
  expect((await publishedOwnOnlyLayers(pin)).currents).toBe(false);
});

test('its kill offers the layers unconditionally, as before the check', () => {
  expect(availabilityCheckKilled()).toBe(false);
  window.__RAW_DISABLE_OWN_LAYER_AVAILABILITY__ = true;
  expect(availabilityCheckKilled()).toBe(true);
});
