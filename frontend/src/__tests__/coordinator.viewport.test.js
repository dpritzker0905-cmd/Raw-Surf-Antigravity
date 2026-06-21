import {
  beginTransition,
  getGeneration,
  getTarget,
  __resetForTests,
} from '../components/map/marineTransitionCoordinator';

beforeEach(() => {
  __resetForTests();
});

describe('Coordinator: viewport key is captured', () => {
  test('captures viewportKey and maintains generation if model+layer is same', () => {
    // 1. calls beginTransition({ model:'GFS', layer:'waves', hour:0, viewportKey:'vp-1' })
    const gen1 = beginTransition({ model: 'GFS', layer: 'waves', hour: 0, viewportKey: 'vp-1' });

    // 2. asserts getTarget().viewportKey === 'vp-1'
    expect(getTarget().viewportKey).toBe('vp-1');

    // 3. calls beginTransition({ model:'GFS', layer:'waves', hour:0, viewportKey:'vp-2' }) (same model+layer)
    const gen2 = beginTransition({ model: 'GFS', layer: 'waves', hour: 0, viewportKey: 'vp-2' });

    // 4. asserts getTarget().viewportKey === 'vp-2' and getGeneration() === 1 (generation did NOT change).
    expect(getTarget().viewportKey).toBe('vp-2');
    expect(getGeneration()).toBe(1);
    expect(gen2).toBe(gen1);
  });
});
