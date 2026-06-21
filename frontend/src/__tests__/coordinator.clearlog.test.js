import {
  beginTransition,
  markDisplayed,
  recordClear,
  __resetForTests,
} from '../components/map/marineTransitionCoordinator';

beforeEach(() => {
  __resetForTests();
  window.__MARINE_CLEAR_LOG__ = [];
});

describe('Coordinator: clear log records the reason', () => {
  test('recordClear details are logged correctly', () => {
    // 1. calls beginTransition({ model:'EURO', layer:'swell_1', hour:12 })
    beginTransition({ model: 'EURO', layer: 'swell_1', hour: 12 });

    // 2. calls markDisplayed({ model:'GFS', layer:'waves', hour:9 })
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 9 });

    // 3. calls recordClear('model_mismatch')
    recordClear('model_mismatch');

    // 4. asserts window.__MARINE_CLEAR_LOG__.length === 1
    expect(window.__MARINE_CLEAR_LOG__.length).toBe(1);

    // 5. asserts the entry .reason === 'model_mismatch', .transitioning === true, .displayed.model === 'GFS', .requested.model === 'EURO'
    const entry = window.__MARINE_CLEAR_LOG__[0];
    expect(entry.reason).toBe('model_mismatch');
    expect(entry.transitioning).toBe(true);
    expect(entry.displayed.model).toBe('GFS');
    expect(entry.requested.model).toBe('EURO');
  });
});
