import fs from 'fs';
import path from 'path';
import { _noteInputForTest, _resetQuietFramesForTest, QUIET_MS, quietFrame, seedConsumeAllowed } from './marineQuietFrames';

// QUIET SEED (2026-10-23): the staged coarse-base seed is consumed on a frame with no input in the last second and no zoom change.
describe('marineQuietFrames', () => {
  let clock;
  beforeEach(() => {
    _resetQuietFramesForTest();
    clock = 10000;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => { delete window.__RAW_DISABLE_QUIET_SEED__; jest.restoreAllMocks(); });

  it('quiet with no input; a key, a drag or a wheel holds it for a second', () => {
    expect(quietFrame(4)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    clock += QUIET_MS - 1;
    expect(quietFrame(4)).toBe(false);
    clock += 1;
    expect(quietFrame(4)).toBe(true);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 }));   // a hover is not a gesture
    expect(quietFrame(4)).toBe(true);
    window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 }));
    expect(quietFrame(4)).toBe(false);
    clock += QUIET_MS;
    window.dispatchEvent(new Event('wheel'));
    expect(quietFrame(4)).toBe(false);
  });

  it('a zoom change between frames counts as activity (a programmatic ease has no input events)', () => {
    expect(quietFrame(4)).toBe(true);
    expect(quietFrame(3.9)).toBe(false);
    clock += QUIET_MS;
    expect(quietFrame(3.9)).toBe(true);
  });

  it('the seed waits for a quiet frame; the kill switch consumes on any frame', () => {
    _noteInputForTest(clock);
    expect(seedConsumeAllowed(4)).toBe(false);
    window.__RAW_DISABLE_QUIET_SEED__ = true;
    expect(seedConsumeAllowed(4)).toBe(true);
  });

  it('the input clock is live from module load: a key before any seed was ever pending still holds the next frame', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));   // no quietFrame() call before this key
    expect(seedConsumeAllowed(4)).toBe(false);
  });

  it('wiring: the render callback asks every frame, then consumes the seed only when seedConsumeAllowed says so', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(src).toMatch(/if \(seedConsumeAllowed\(zoom\) && this\._pendingCoarseBaseGrid\) \{/);
  });
});
