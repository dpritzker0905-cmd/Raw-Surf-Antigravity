import { beginMarineMainThreadTiming } from './marineMainThreadTiming';

function fixture(types = ['longtask', 'long-animation-frame']) {
  let callback;
  class Observer {
    static supportedEntryTypes = types;
    constructor(cb) { callback = cb; }
    observe = jest.fn();
    disconnect = jest.fn();
    takeRecords = jest.fn(() => []);
  }
  const constructor = jest.fn(cb => new Observer(cb));
  constructor.supportedEntryTypes = types;
  const timing = beginMarineMainThreadTiming(1000, constructor);
  return { timing, observer: constructor.mock.results[0]?.value,
    send: entries => callback({ getEntries: () => entries }) };
}
const task = (at, duration) => ({ entryType: 'longtask', startTime: at, duration });

test('measures delivered main-thread work separately from native call duration and overlapping long frames', () => {
  const f = fixture();
  f.send([task(1100, 800), { entryType: 'long-animation-frame', startTime: 1000, duration: 950, blockingDuration: 750 }]);
  expect(f.timing.finish(2000)).toMatchObject({ deliveryMayLagTrip: true, overlappingMetrics: true,
    longTasks: { count: 1, totalDurationMs: 800, maxDurationMs: 800 },
    longAnimationFrames: { count: 1, totalDurationMs: 950, totalBlockingDurationMs: 750 } });
  expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
});
test('does not ingest attribution or any entry object into a receipt', () => {
  const f = fixture(); const entry = task(1000, 60);
  for (const field of ['name','attribution','scripts','window','sourceURL']) Object.defineProperty(entry, field, {
    get() { throw new Error('private attribution must not be read'); },
  });
  f.send([entry]);
  const receipt = f.timing.finish(2000);
  expect(receipt.longTasks.count).toBe(1);
  expect(JSON.stringify(receipt)).not.toMatch(/attribution|sourceURL|scripts|window/);
});
test('includes queued complete entries but excludes work crossing the start or end boundary', () => {
  const f = fixture(); f.send([task(999, 200), task(1000, 0)]);
  f.observer.takeRecords.mockReturnValue([task(1800, 200), task(1900, 200)]);
  expect(f.timing.finish(2000).longTasks).toEqual({ count: 2, totalDurationMs: 200, maxDurationMs: 200 });
  expect(f.observer.observe).toHaveBeenCalledWith({ entryTypes: ['longtask','long-animation-frame'] });
});
test.each([undefined, null, class { static supportedEntryTypes = []; }])('unsupported observer %s means unknown, not zero', Observer => {
  expect(beginMarineMainThreadTiming(1000, Observer).finish(2000)).toMatchObject({ longTasks: null, longAnimationFrames: null });
});
test('construction or observe failure is contained and disconnects an allocated observer', () => {
  const disconnect = jest.fn();
  class Broken { static supportedEntryTypes = ['longtask']; observe() { throw new Error('blocked'); } disconnect = disconnect; }
  expect(beginMarineMainThreadTiming(0, Broken).finish(1000).longTasks).toBeNull();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
test('disposal drops late delivery and finish cannot report a disposed streak', () => {
  const f = fixture(); f.timing.dispose(); f.send([task(1100, 800)]);
  expect(f.timing.finish(2000)).toBeNull();
  expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
});
test('invalid entries and absent blocking durations are not coerced into measured values', () => {
  const f = fixture(); f.send([task(1000, NaN),task('1000', 100),task(1000,-1),
    { entryType: 'long-animation-frame', startTime: 1100, duration: 100 }]);
  const receipt = f.timing.finish(2000);
  expect(receipt.longTasks.count).toBe(0);
  expect(receipt.longAnimationFrames.totalBlockingDurationMs).toBeNull();
});
test('clock regression invalidates both metrics and repeated finish returns no stale evidence', () => {
  const f = fixture(); f.send([task(1000, 100)]);
  expect(f.timing.finish(999)).toMatchObject({ longTasks: null, longAnimationFrames: null });
  expect(f.timing.finish(2000)).toBeNull();
});

test('a broken record drain is explicitly incomplete evidence and still disconnects', () => {
  const f = fixture(); f.observer.takeRecords.mockImplementation(() => { throw new Error('failed'); });
  expect(f.timing.finish(2000).deliveryIncomplete).toBe(true);
  expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
});

test('an inaccessible blocking scalar cannot be reported as a measured zero', () => {
  const f = fixture();
  const entry = { entryType: 'long-animation-frame', startTime: 1100, duration: 100 };
  Object.defineProperty(entry, 'blockingDuration', { get() { throw new Error('unavailable'); } });
  f.send([entry]);
  expect(f.timing.finish(2000)).toMatchObject({ deliveryIncomplete: true,
    longAnimationFrames: { count: 1, blockingDurationKnown: false, totalBlockingDurationMs: null } });
});

test('a map that stops delivering callbacks cannot leave an observer running indefinitely', () => {
  jest.useFakeTimers();
  try {
    const f = fixture(); jest.advanceTimersByTime(30000);
    expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
    expect(f.timing.finish(31000)).toBeNull();
    f.timing.dispose();
    expect(f.observer.disconnect).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
