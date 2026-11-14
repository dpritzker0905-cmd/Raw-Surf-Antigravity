/**
 * Every own-frames set a layer names must be a set the static-frames reader knows (2026-11-12). ownRasterFrames.test.js mocks
 * staticFrames, so it cannot see this: the rain set was wired without its STATIC_SETS entry and silently stayed on the .om path.
 */
import { OWN_RASTER_SETS } from './ownRasterFrames';
import { staticSetEnabled } from './staticFrames';

describe('own raster sets are known to the static-frames reader', () => {
  const keys = Object.entries(OWN_RASTER_SETS).flatMap(([layer, set]) => Object.values(set.models).map((key) => [layer, key]));
  test('there is at least one set per own-frames layer', () => {
    expect(keys.map(([layer]) => layer)).toEqual(expect.arrayContaining(['pressure', 'temperature', 'satellite', 'rain']));
  });
  test.each(keys)('%s: %s is enabled by default', (_layer, key) => {
    expect(staticSetEnabled(key)).toBe(true);
  });
  test('a set nobody listed is refused', () => {
    expect(staticSetEnabled('GFS/weather/precipitation/global_9p9')).toBe(false);
  });
});
