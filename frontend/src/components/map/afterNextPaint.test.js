// afterNextPaint (2026-10-25): work moved out of the wind toggle's click task runs after the next frame, can be cancelled, and
// still runs in a hidden tab (no frames) through the 100 ms floor.
import { afterNextPaint, afterNextPaintCb } from './afterNextPaint';

describe('afterNextPaint', () => {
  let rafCbs;
  beforeEach(() => {
    jest.useFakeTimers();
    rafCbs = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { rafCbs.push(cb); return rafCbs.length; });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('nothing runs in the current task; it runs after the frame (rAF, then a message after the paint)', () => {
    const posted = [];
    const RealMC = global.MessageChannel;
    global.MessageChannel = class { constructor() { this.port1 = { close() {} }; const p1 = this.port1; this.port2 = { postMessage: () => posted.push(p1) }; } };
    try {
      const fn = jest.fn();
      afterNextPaintCb(fn);
      expect(fn).not.toHaveBeenCalled();
      expect(rafCbs).toHaveLength(1);
      rafCbs[0]();                                                   // the frame: still not run (the paint is next)
      expect(fn).not.toHaveBeenCalled();
      expect(posted).toHaveLength(1);
      posted[0].onmessage();                                         // the message, delivered after the paint
      expect(fn).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(200);                                 // the floor does not run it again
      expect(fn).toHaveBeenCalledTimes(1);
    } finally { global.MessageChannel = RealMC; }
  });

  test('a hidden tab never paints: the 100 ms floor runs it once', () => {
    const fn = jest.fn();
    afterNextPaintCb(fn);
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    rafCbs[0]();                                                     // a late frame does not run it twice
    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('cancel: nothing runs', () => {
    const fn = jest.fn();
    const cancel = afterNextPaintCb(fn);
    cancel();
    rafCbs[0]();
    jest.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  test('the promise form resolves', async () => {
    const p = afterNextPaint();
    jest.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
  });
});
