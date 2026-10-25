// useDeferredSimField (#570): the simulation field's inputs move as ONE deferred value, so an urgent update (the wind toggle's
// click) renders with the previous inputs and the field rebuilds in a background render; the kill switch hands back the urgent
// inputs on the same render.
import { renderHook } from '@testing-library/react';
import { useDeferredSimField } from './useDeferredSimField';

const base = { windData: { revision: 1 }, marineData: { grid: { vectors: [] } }, activeModel: 'GFS', timeOffsetHours: 0, activeMarineLayer: 'waves' };

afterEach(() => { delete window.__RAW_DISABLE_SIM_FIELD_DEFER__; });

test('settles on the latest inputs, all fields together', () => {
  const { result, rerender } = renderHook((p) => useDeferredSimField(p), { initialProps: base });
  expect(result.current).toMatchObject(base);
  const next = { ...base, windData: { revision: 2 }, activeMarineLayer: null };
  rerender(next);
  expect(result.current.windData).toBe(next.windData);
  expect(result.current.activeMarineLayer).toBeNull();
});

test('the same inputs keep the same object (the field memo holds)', () => {
  const { result, rerender } = renderHook((p) => useDeferredSimField(p), { initialProps: base });
  const first = result.current;
  rerender({ ...base });
  expect(result.current).toBe(first);
});

test('the kill switch returns the urgent inputs', () => {
  window.__RAW_DISABLE_SIM_FIELD_DEFER__ = true;
  const { result, rerender } = renderHook((p) => useDeferredSimField(p), { initialProps: base });
  const next = { ...base, activeMarineLayer: 'swell_1' };
  rerender(next);
  expect(result.current.activeMarineLayer).toBe('swell_1');
});
