import { arrayMax, arrayMin } from '../components/map/marineControllerUtils';

describe('arrayMax / arrayMin — spread-free reducers', () => {
  test('basic max/min', () => {
    expect(arrayMax([1, 5, 3])).toBe(5);
    expect(arrayMin([4, 2, 9])).toBe(2);
  });

  test('empty array returns the fallback', () => {
    expect(arrayMax([])).toBe(0);
    expect(arrayMin([])).toBe(0);
    expect(arrayMax([], null)).toBeNull();
    expect(arrayMin([], null)).toBeNull();
  });

  test('handles negative values', () => {
    expect(arrayMax([-5, -2, -9])).toBe(-2);
    expect(arrayMin([-5, -2, -9])).toBe(-9);
  });

  // The whole point: a global marine grid has tens of thousands of cells. Math.max(...arr)
  // throws "Maximum call stack size exceeded" at this size; the reducer must not.
  test('does NOT overflow on a very large array (the global-grid crash)', () => {
    const big = new Array(200000);
    for (let i = 0; i < big.length; i++) big[i] = i % 977; // max 976
    expect(() => Math.max(...big)).toThrow(); // sanity: the spread really does blow up
    expect(arrayMax(big)).toBe(976);
    expect(arrayMin(big)).toBe(0);
  });
});
