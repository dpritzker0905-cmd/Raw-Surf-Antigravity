import {
  beginTransition,
  endTransition,
  isTransitioning,
  getTarget,
  __resetForTests,
} from '../components/map/marineTransitionCoordinator';

beforeEach(() => {
  __resetForTests();
});

describe('Coordinator: non-owning generation ownership verification', () => {
  test('stale generation cannot end transition, only active owning generation can', () => {
    // 1. const a = beginTransition({ model:'GFS', layer:'waves' });
    const a = beginTransition({ model: 'GFS', layer: 'waves' });

    // 2. const b = beginTransition({ model:'ICON', layer:'waves' });
    const b = beginTransition({ model: 'ICON', layer: 'waves' });

    // 3. asserts endTransition(a) === false (a is stale)
    expect(endTransition(a)).toBe(false);

    // 4. asserts isTransitioning() === true
    expect(isTransitioning()).toBe(true);

    // 5. asserts getTarget().model === 'ICON'
    expect(getTarget().model).toBe('ICON');

    // 6. asserts endTransition(b) === true
    expect(endTransition(b)).toBe(true);

    // 7. asserts isTransitioning() === false
    expect(isTransitioning()).toBe(false);
  });
});
