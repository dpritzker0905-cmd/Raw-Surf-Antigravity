import fs from 'fs';
import path from 'path';
import {
  classifyMapInitError,
  describeWebglFailure,
  isMapStartupFailure,
  WEBGL_UNSUPPORTED_REASONS,
} from './mapWebglSupport';

/**
 * These tests cover a failure that was INVISIBLE in production (a map that could not start
 * rendered an empty rectangle in silence) and a second one that was WORSE and self-inflicted
 * (a WebGL probe that made Chrome block the page). The last test bans the second by shape.
 */

describe('isMapStartupFailure', () => {
  // The regression this guards: @vis.gl routes the map's ongoing `error` event to the same
  // `onError` prop as init rejection, so one failed tile must NOT raise the startup panel
  // over a map that is drawing fine.
  it('treats a null-target event on an unmounted map as a startup failure', () => {
    expect(isMapStartupFailure({ type: 'error', target: null, error: new Error('no webgl') }, false)).toBe(true);
  });

  it('treats an event carrying the map as a runtime error, not a startup failure', () => {
    expect(isMapStartupFailure({ type: 'error', target: { getCanvas: () => null } }, false)).toBe(false);
  });

  it('refuses to call anything a startup failure once the map has mounted', () => {
    expect(isMapStartupFailure({ type: 'error', target: null, error: new Error('tile 404') }, true)).toBe(false);
  });

  it('handles a missing or malformed event without claiming the map is fine', () => {
    expect(isMapStartupFailure(undefined, false)).toBe(true);
    expect(isMapStartupFailure(null, false)).toBe(true);
    expect(isMapStartupFailure({}, false)).toBe(true);
  });
});

describe('classifyMapInitError', () => {
  it('separates a BLOCKED page from ordinary unavailable WebGL', () => {
    // These need different advice. "Turn on hardware acceleration" is useless when the
    // hardware is fine and the browser has blocked this one tab -- the real live case.
    const blocked = {
      type: 'webglcontextcreationerror',
      statusMessage: 'Web page caused context loss and was blocked',
      message: 'Failed to initialize WebGL',
    };
    expect(classifyMapInitError(blocked)).toBe(WEBGL_UNSUPPORTED_REASONS.CONTEXT_BLOCKED);
    expect(describeWebglFailure(classifyMapInitError(blocked))).toMatch(/new one|restart the browser/i);
    expect(describeWebglFailure(classifyMapInitError(blocked))).not.toMatch(/graphics acceleration/i);
  });

  it('classifies a plain WebGL initialisation failure as unavailable', () => {
    const err = { type: 'webglcontextcreationerror', message: 'Failed to initialize WebGL' };
    expect(classifyMapInitError(err)).toBe(WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE);
    expect(describeWebglFailure(classifyMapInitError(err))).toMatch(/graphics acceleration/i);
  });

  it('falls through to INIT_FAILED rather than guessing at WebGL', () => {
    expect(classifyMapInitError(new Error('style 404'))).toBe(WEBGL_UNSUPPORTED_REASONS.INIT_FAILED);
    expect(classifyMapInitError(null)).toBe(WEBGL_UNSUPPORTED_REASONS.INIT_FAILED);
    expect(classifyMapInitError({})).toBe(WEBGL_UNSUPPORTED_REASONS.INIT_FAILED);
  });

  it('survives an error whose own fields throw', () => {
    const hostile = { get statusMessage() { throw new Error('nope'); } };
    expect(() => classifyMapInitError(hostile)).not.toThrow();
  });

  it('accepts a bare string', () => {
    expect(classifyMapInitError('Failed to initialize WebGL')).toBe(WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE);
  });
});

describe('describeWebglFailure', () => {
  it('gives an actionable message for every reason and the unknown case', () => {
    for (const reason of [...Object.values(WEBGL_UNSUPPORTED_REASONS), 'nonsense', undefined]) {
      const copy = describeWebglFailure(reason);
      expect(typeof copy).toBe('string');
      expect(copy.length).toBeGreaterThan(40);
    }
  });
});

describe('the map surface never causes WebGL context loss', () => {
  /**
   * ⛔ THE BAN. The first version of this feature probed for WebGL by creating a context and
   * calling `WEBGL_lose_context.loseContext()` to release it politely. Chrome counts
   * deliberate losses against the PAGE and then refuses every further context with
   * "Web page caused context loss and was blocked". Live on a deploy preview the map drew for
   * ~a minute, froze, and could not restart -- on hardware where WebGL was demonstrably fine.
   *
   * A fix applied only at the site of an incident is not a fix applied to the class (this
   * repo's own recorded lesson). So this bans the SHAPE across the whole map surface, not
   * just the module that did it.
   */
  const MAP_DIR = __dirname;

  /**
   * ⚠️ Scan CODE, not prose. A bare substring scan matches the very comments that explain the
   * ban — this test failed exactly that way on its first run, naming the two files that
   * document it. The repo has been bitten by this before: see the backend's
   * test_event_loop_offload_guard.py, "`x` in src matches comments, docstrings and unrelated
   * prose". Block comments and comment-only lines are stripped before matching; a trailing
   * comment after real code is left in, which can only make this stricter, never blind.
   */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');

  const codeOf = (file) => stripComments(fs.readFileSync(path.join(MAP_DIR, file), 'utf8'));
  const sourceFiles = () => fs.readdirSync(MAP_DIR)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  it('no map source file calls loseContext()', () => {
    const offenders = sourceFiles().filter((f) => /\bloseContext\s*\(/.test(codeOf(f)));

    expect(offenders).toEqual([]);
  });

  it('no map source file creates a throwaway probe context', () => {
    // getContext on a canvas the app never mounts is the probe shape. Real renderers call
    // getContext on a canvas they own; a probe calls it on a freshly created element.
    const offenders = sourceFiles().filter(
      (f) => /createElement\(\s*['"]canvas['"]\s*\)[\s\S]{0,200}?getContext\(\s*['"]webgl/.test(codeOf(f)),
    );

    expect(offenders).toEqual([]);
  });

  it('the scanner discriminates — it is not silently matching nothing', () => {
    // Verified to discriminate BEFORE being relied on, the way the backend's AST guard proves
    // its signature. Without this, a scanner broken into matching nothing would pass forever
    // for precisely the wrong reason.
    expect(/\bloseContext\s*\(/.test(stripComments('// loseContext() is banned\nconst x = 1;\n'))).toBe(false);
    expect(/\bloseContext\s*\(/.test(stripComments('const e = gl.getExtension("X");\ne.loseContext();\n'))).toBe(true);
  });
});
