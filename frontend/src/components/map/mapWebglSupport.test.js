import {
  detectWebglSupport,
  describeWebglFailure,
  isMapStartupFailure,
  WEBGL_UNSUPPORTED_REASONS,
} from './mapWebglSupport';

/**
 * These tests exist because the failure they cover was INVISIBLE in production for months:
 * the map rendered an empty rectangle and reported nothing. Each case below is a way the
 * probe could silently go wrong and hand us back that same blank.
 */

const makeGl = ({ renderer = 'ANGLE (Intel)', debugExt = true, loseContext } = {}) => {
  const lose = { loseContext: loseContext || jest.fn() };
  return {
    RENDERER: 'RENDERER_ENUM',
    getExtension: jest.fn((name) => {
      if (name === 'WEBGL_debug_renderer_info') return debugExt ? { UNMASKED_RENDERER_WEBGL: 'UNMASKED' } : null;
      if (name === 'WEBGL_lose_context') return lose;
      return null;
    }),
    getParameter: jest.fn(() => renderer),
    __lose: lose,
  };
};

const makeDoc = (getContext) => ({ createElement: () => ({ getContext }) });

describe('detectWebglSupport', () => {
  it('reports supported and the renderer when a webgl2 context is returned', () => {
    const gl = makeGl({ renderer: 'ANGLE (Intel UHD)' });
    const res = detectWebglSupport(makeDoc(jest.fn(() => gl)));

    expect(res.supported).toBe(true);
    expect(res.reason).toBeNull();
    expect(res.renderer).toBe('ANGLE (Intel UHD)');
  });

  it('falls back to webgl when webgl2 is unavailable', () => {
    // maplibre itself accepts either. A probe that demanded webgl2 would refuse a browser
    // the map would actually have run on, turning a working map into a blocked one.
    const gl = makeGl();
    const getContext = jest.fn((type) => (type === 'webgl2' ? null : gl));
    const res = detectWebglSupport(makeDoc(getContext));

    expect(res.supported).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(getContext).toHaveBeenCalledWith('webgl');
  });

  it('reports CONTEXT_UNAVAILABLE when both context types return null', () => {
    const res = detectWebglSupport(makeDoc(jest.fn(() => null)));

    expect(res.supported).toBe(false);
    expect(res.reason).toBe(WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE);
    expect(res.renderer).toBeNull();
  });

  it('reports CONTEXT_THREW when getContext throws instead of returning null', () => {
    // Hardened and privacy-patched browsers throw here. An unguarded probe would take the
    // whole map component down with it — a strictly worse outcome than the blank it fixes.
    const res = detectWebglSupport(makeDoc(jest.fn(() => { throw new Error('blocked'); })));

    expect(res.supported).toBe(false);
    expect(res.reason).toBe(WEBGL_UNSUPPORTED_REASONS.CONTEXT_THREW);
  });

  it('reports NO_CANVAS when the element cannot provide getContext', () => {
    const res = detectWebglSupport({ createElement: () => ({}) });

    expect(res.supported).toBe(false);
    expect(res.reason).toBe(WEBGL_UNSUPPORTED_REASONS.NO_CANVAS);
  });

  it('reports NO_DOCUMENT when there is no usable document', () => {
    expect(detectWebglSupport(null).supported).toBe(false);
    expect(detectWebglSupport({}).reason).toBe(WEBGL_UNSUPPORTED_REASONS.NO_DOCUMENT);
  });

  it('releases the probe context so it cannot evict the map own context', () => {
    // Browsers cap live WebGL contexts and evict the oldest. A leaking probe would spend a
    // slot on every mount, and on a remount loop could evict the map it is protecting.
    const gl = makeGl();
    detectWebglSupport(makeDoc(jest.fn(() => gl)));

    expect(gl.__lose.loseContext).toHaveBeenCalledTimes(1);
  });

  it('still reports supported when the context cannot be released', () => {
    const gl = makeGl({ loseContext: () => { throw new Error('no release'); } });
    const res = detectWebglSupport(makeDoc(jest.fn(() => gl)));

    expect(res.supported).toBe(true);
  });

  it('still reports supported when the renderer string cannot be read', () => {
    const gl = makeGl();
    gl.getParameter = jest.fn(() => { throw new Error('blocked'); });
    const res = detectWebglSupport(makeDoc(jest.fn(() => gl)));

    expect(res.supported).toBe(true);
    expect(res.renderer).toBeNull();
  });
});

describe('describeWebglFailure', () => {
  it('names the hardware-acceleration setting for blocked-WebGL reasons', () => {
    for (const reason of [WEBGL_UNSUPPORTED_REASONS.CONTEXT_THREW, WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE]) {
      expect(describeWebglFailure(reason)).toMatch(/graphics acceleration/i);
    }
  });

  it('gives an actionable message for every known reason and the unknown case', () => {
    // The point of the panel is a NEXT STEP. A branch that returns a bare diagnosis would
    // leave the user exactly as stuck as the blank rectangle did.
    const all = [...Object.values(WEBGL_UNSUPPORTED_REASONS), 'init-failed', undefined];
    for (const reason of all) {
      const copy = describeWebglFailure(reason);
      expect(typeof copy).toBe('string');
      expect(copy.length).toBeGreaterThan(40);
    }
  });
});

describe('isMapStartupFailure', () => {
  // The regression this guards is specific: @vis.gl routes the map's ongoing `error` event
  // to the same `onError` prop as init rejection, so a single failed tile must NOT raise the
  // full-surface startup panel over a map that is drawing fine.
  it('treats a null-target event on an unmounted map as a startup failure', () => {
    expect(isMapStartupFailure({ type: 'error', target: null, error: new Error('no webgl') }, false)).toBe(true);
  });

  it('treats an event carrying the map as a runtime error, not a startup failure', () => {
    const mapLike = { getCanvas: () => null };
    expect(isMapStartupFailure({ type: 'error', target: mapLike, error: new Error('tile 404') }, false)).toBe(false);
  });

  it('refuses to call anything a startup failure once the map has mounted', () => {
    // The independent signal. If a future library version starts populating `target` on the
    // init event -- or stops populating it on runtime events -- this check still holds.
    expect(isMapStartupFailure({ type: 'error', target: null, error: new Error('tile 404') }, true)).toBe(false);
  });

  it('handles a missing or malformed event without claiming the map is fine', () => {
    expect(isMapStartupFailure(undefined, false)).toBe(true);
    expect(isMapStartupFailure(null, false)).toBe(true);
    expect(isMapStartupFailure({}, false)).toBe(true);
  });
});
