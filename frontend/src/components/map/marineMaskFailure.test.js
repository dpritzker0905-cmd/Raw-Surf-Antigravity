import { recordMaskRefreshFailure } from './marineMaskFailure';

afterEach(() => jest.restoreAllMocks());
it('keeps the first exception and latest exception across a bounded failure storm', () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = {};
  for (let i = 0; i < 1000; i++) recordMaskRefreshFailure(engine, 'basemap-water', Error(`fault-${i}`));
  expect(engine._maskRefreshFailures.count).toBe(1000);
  expect(engine._maskRefreshFailures.first.message).toBe('fault-0');
  expect(engine._maskRefreshFailures.latest.message).toBe('fault-999');
  expect(Object.keys(engine._maskRefreshFailures)).toEqual(['count', 'first', 'latest']);
  expect(engine._maskRefreshFailures.latest.stack.split('\n').length).toBeLessThanOrEqual(8);
});
it('preserves evidence even when exception formatting and console reporting throw', () => {
  jest.spyOn(console, 'warn').mockImplementation(() => { throw Error('logger'); });
  const error = { get message() { throw Error('getter'); }, stack: 'x'.repeat(10000) };
  const engine = {};
  expect(() => recordMaskRefreshFailure(engine, 'viewport overlay', error)).not.toThrow();
  expect(engine._maskRefreshFailures.first.message).toBe('[unreadable exception]');
  expect(engine._maskRefreshFailures.first.stack).toHaveLength(4096);
});
