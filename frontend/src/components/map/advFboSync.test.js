import fs from 'fs';
import path from 'path';
import { cachedFramebufferStatus, fboStatusCacheDisabled, advTeardownNeeded, fboSyncDiag } from './advFboSync';

const COMPLETE = 0x8CD5;
const INCOMPLETE_ATTACHMENT = 0x8CD6;

function mockGl(statusFor) {
  const gl = { FRAMEBUFFER: 0x8D40, FRAMEBUFFER_COMPLETE: COMPLETE, calls: 0, attached: null };
  gl.checkFramebufferStatus = (target) => {
    expect(target).toBe(gl.FRAMEBUFFER);
    gl.calls++;
    return statusFor ? statusFor(gl.attached) : COMPLETE;
  };
  return gl;
}

// One advection frame as the engine runs it: attach the write texture, ask, then swap.
function frame(gl, eng, fbo, win) {
  gl.attached = eng.B;
  const s = cachedFramebufferStatus(gl, eng, fbo, eng.B, 16, 16, win);
  if (s === COMPLETE) { const t = eng.A; eng.A = eng.B; eng.B = t; }
  return s;
}

describe('cachedFramebufferStatus', () => {
  it('asks the driver once per (FBO, texture) and then answers COMPLETE from the cache through the ping-pong', () => {
    const gl = mockGl(); const eng = { A: { id: 'A' }, B: { id: 'B' } }; const fbo = { id: 'fbo' }; const win = { __RAW_GPU__: {} };
    for (let i = 0; i < 100; i++) expect(frame(gl, eng, fbo, win)).toBe(COMPLETE);
    expect(gl.calls).toBe(2);   // B, then A after the first swap
    expect(win.__RAW_GPU__.fboStatusCache).toEqual({ on: true, diag: false, hits: 98, checks: 2 });
  });

  it('re-asks for a new texture object (reinitParticles makes new ones)', () => {
    const gl = mockGl(); const eng = { A: {}, B: {} }; const fbo = {};
    frame(gl, eng, fbo, null); frame(gl, eng, fbo, null); frame(gl, eng, fbo, null);
    expect(gl.calls).toBe(2);
    eng.A = {}; eng.B = {};
    frame(gl, eng, fbo, null); frame(gl, eng, fbo, null); frame(gl, eng, fbo, null);
    expect(gl.calls).toBe(4);
  });

  it('drops the cache for a new FBO object and for a new GL context', () => {
    const gl = mockGl(); const eng = { A: {}, B: {} };
    const tex = eng.B; const fbo1 = {}; const fbo2 = {};
    cachedFramebufferStatus(gl, eng, fbo1, tex, 16, 16, null);
    cachedFramebufferStatus(gl, eng, fbo1, tex, 16, 16, null);
    expect(gl.calls).toBe(1);
    cachedFramebufferStatus(gl, eng, fbo2, tex, 16, 16, null);
    expect(gl.calls).toBe(2);
    const gl2 = mockGl();
    cachedFramebufferStatus(gl2, eng, fbo2, tex, 16, 16, null);
    expect(gl2.calls).toBe(1);
  });

  it('never caches a status other than COMPLETE, and forgets a texture that stops being complete', () => {
    let status = INCOMPLETE_ATTACHMENT;
    const gl = mockGl(() => status); const eng = {}; const fbo = {}; const tex = {};
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, null)).toBe(INCOMPLETE_ATTACHMENT);
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, null)).toBe(INCOMPLETE_ATTACHMENT);
    expect(gl.calls).toBe(2);
    status = COMPLETE;
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, null)).toBe(COMPLETE);
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, null)).toBe(COMPLETE);
    expect(gl.calls).toBe(3);
    // With the kill set the driver is asked; an incomplete answer then evicts the texture.
    status = INCOMPLETE_ATTACHMENT;
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, { __RAW_DISABLE_FBO_STATUS_CACHE__: true })).toBe(INCOMPLETE_ATTACHMENT);
    expect(cachedFramebufferStatus(gl, eng, fbo, tex, 16, 16, null)).toBe(INCOMPLETE_ATTACHMENT);
    expect(gl.calls).toBe(5);
  });

  it('kill switch: asks the driver every frame and reports on: false', () => {
    const gl = mockGl(); const eng = { A: {}, B: {} }; const fbo = {};
    const win = { __RAW_DISABLE_FBO_STATUS_CACHE__: true, __RAW_GPU__: {} };
    for (let i = 0; i < 10; i++) frame(gl, eng, fbo, win);
    expect(gl.calls).toBe(10);
    expect(win.__RAW_GPU__.fboStatusCache).toEqual({ on: false, diag: false, hits: 0, checks: 10 });
    expect(fboStatusCacheDisabled(win)).toBe(true);
    expect(fboStatusCacheDisabled({ __RAW_DISABLE_FBO_STATUS_CACHE__: 1 })).toBe(false);   // strict true only
    expect(fboStatusCacheDisabled(null)).toBe(false);
    // Clearing the kill takes effect on the next frame with no reload.
    delete win.__RAW_DISABLE_FBO_STATUS_CACHE__;
    frame(gl, eng, fbo, win); frame(gl, eng, fbo, win);
    expect(gl.calls).toBe(10);
    expect(win.__RAW_GPU__.fboStatusCache.on).toBe(true);
  });

  it('writes no telemetry without __RAW_GPU__, and a null texture is never cached', () => {
    const gl = mockGl(); const eng = {}; const fbo = {}; const win = {};
    cachedFramebufferStatus(gl, eng, fbo, null, 16, 16, win); cachedFramebufferStatus(gl, eng, fbo, null, 16, 16, win);
    expect(gl.calls).toBe(2);
    expect(win.__RAW_GPU__).toBeUndefined();
  });
});

describe('advTeardownNeeded', () => {
  it('runs the teardown only while a texture is recorded as attached', () => {
    const eng = {}; const win = { __RAW_GPU__: {} };
    expect(advTeardownNeeded(eng, win)).toBe(false);          // the pass never ran: nothing attached
    eng._advAttached = true;
    expect(advTeardownNeeded(eng, win)).toBe(true);           // an exception escaped between attach and detach
    eng._advAttached = false;
    expect(advTeardownNeeded(eng, win)).toBe(false);          // the normal frame: the pass detached itself
    expect(win.__RAW_GPU__.advTeardown).toEqual({ on: true, diag: false, ran: 1, skipped: 2 });
  });

  it('kill switch: runs it every frame (legacy), and clearing the kill takes effect on the next frame', () => {
    const eng = { _advAttached: false }; const win = { __RAW_DISABLE_ADV_TEARDOWN_SKIP__: true, __RAW_GPU__: {} };
    expect(advTeardownNeeded(eng, win)).toBe(true);
    expect(win.__RAW_GPU__.advTeardown).toEqual({ on: false, diag: false, ran: 1, skipped: 0 });
    delete win.__RAW_DISABLE_ADV_TEARDOWN_SKIP__;
    expect(advTeardownNeeded(eng, win)).toBe(false);
    expect(advTeardownNeeded(eng, { __RAW_DISABLE_ADV_TEARDOWN_SKIP__: 'yes' })).toBe(false);   // strict true only
    expect(advTeardownNeeded({ _advAttached: 1 }, null)).toBe(false);                            // strict true only
  });
});

// The engine's advection pass, reduced to its attach/detach/teardown skeleton with the SAME calls in the
// same order, against a GL mock that tracks the real attachment: whatever path a frame takes (complete,
// incomplete, a throw between attach and detach, a throw before attach), the FBO ends the frame with
// nothing attached, and isFramebuffer is called only on the frames that need the teardown.
describe('attach / detach / teardown skeleton', () => {
  function glWithFbo() {
    const gl = { FRAMEBUFFER: 1, COLOR_ATTACHMENT0: 2, TEXTURE_2D: 3, FRAMEBUFFER_COMPLETE: COMPLETE, bound: null, att: new Map(), isFbCalls: 0, status: COMPLETE };
    gl.bindFramebuffer = (t, f) => { gl.bound = f; };
    gl.framebufferTexture2D = (t, a, tt, tex) => { if (gl.bound) gl.att.set(gl.bound, tex); };
    gl.checkFramebufferStatus = () => gl.status;
    gl.isFramebuffer = () => { gl.isFbCalls++; return true; };
    return gl;
  }
  function frame(gl, eng, win, { throwAfterAttach = false, throwBefore = false } = {}) {
    try {
      if (throwBefore) throw new Error('before');
      gl.bindFramebuffer(gl.FRAMEBUFFER, eng.advFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, eng.B, 0); eng._advAttached = true;
      if (throwAfterAttach) throw new Error('mid-pass');
      const s = cachedFramebufferStatus(gl, eng, eng.advFBO, eng.B, 16, 16, win);
      if (s !== COMPLETE) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); eng._advAttached = false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); eng._advAttached = false;
        const t = eng.A; eng.A = eng.B; eng.B = t;
      }
    } catch (e) { /* the layer's error path */ } finally {
      if (eng.advFBO && advTeardownNeeded(eng, win) && gl.isFramebuffer(eng.advFBO)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, eng.advFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); eng._advAttached = false;
      }
    }
    return gl.att.get(eng.advFBO) || null;
  }
  it('leaves nothing attached on every path, and syncs only when needed', () => {
    const gl = glWithFbo(); const eng = { advFBO: { fbo: 1 }, A: { t: 'A' }, B: { t: 'B' } }; const win = {};
    const paths = ['ok', 'ok', 'mid', 'ok', 'before', 'ok', 'mid', 'mid', 'ok', 'incomplete', 'ok'];
    let expectFb = 0;
    for (const p of paths) {
      gl.status = p === 'incomplete' ? INCOMPLETE_ATTACHMENT : COMPLETE;
      expect(frame(gl, eng, win, { throwAfterAttach: p === 'mid', throwBefore: p === 'before' })).toBeNull();
      if (p === 'mid') expectFb++;
      expect(gl.isFbCalls).toBe(expectFb);
    }
    // Under the kill switch every frame syncs, as before.
    const gl2 = glWithFbo(); const eng2 = { advFBO: {}, A: {}, B: {} }; const k = { __RAW_DISABLE_ADV_TEARDOWN_SKIP__: true };
    for (let i = 0; i < 5; i++) expect(frame(gl2, eng2, k)).toBeNull();
    expect(gl2.isFbCalls).toBe(5);
  });
});

describe('size key and the ?diag=1 debug path', () => {
  it('a texture verified at one size re-asks at another', () => {
    const gl = mockGl(); const eng = {}; const fbo = {}; const tex = {};
    cachedFramebufferStatus(gl, eng, fbo, tex, 256, 256, null);
    cachedFramebufferStatus(gl, eng, fbo, tex, 256, 256, null);
    expect(gl.calls).toBe(1);
    cachedFramebufferStatus(gl, eng, fbo, tex, 512, 512, null);
    expect(gl.calls).toBe(2);
    cachedFramebufferStatus(gl, eng, fbo, tex, 512, 512, null);
    expect(gl.calls).toBe(2);
  });

  it('?diag=1 in the URL asks the driver and tears down every frame; other diag signals do not', () => {
    const diag = { location: { search: '?diag=1' }, __RAW_GPU__: {} };
    expect(fboSyncDiag(diag)).toBe(true);
    const gl = mockGl(); const eng = { A: {}, B: {}, _advAttached: false }; const fbo = {};
    for (let i = 0; i < 6; i++) frame(gl, eng, fbo, diag);
    expect(gl.calls).toBe(6);
    expect(diag.__RAW_GPU__.fboStatusCache).toEqual({ on: false, diag: true, hits: 0, checks: 6 });
    expect(advTeardownNeeded(eng, diag)).toBe(true);
    expect(advTeardownNeeded(eng, diag, 'windAdvTeardown')).toBe(true);
    expect(diag.__RAW_GPU__.windAdvTeardown).toMatchObject({ on: false, diag: true });
    // The HUD's localhost default and localStorage '1' are NOT this switch (offline runs and local dev stay on the fast path).
    const local = { location: { search: '', hostname: '127.0.0.1' }, localStorage: { getItem: () => '1' } };
    expect(fboSyncDiag(local)).toBe(false);
    expect(fboSyncDiag({ location: { search: '?diag=0' } })).toBe(false);
    expect(fboSyncDiag({ location: { search: '?x=1&diag=1' } })).toBe(true);
    expect(fboSyncDiag({})).toBe(false);
    expect(fboSyncDiag(null)).toBe(false);
  });
});

describe('the wind engine uses the same teardown rule (source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  it('records the attachment and asks before its finally teardown', () => {
    const lines = src.split('\n');
    const attach = lines.filter((l) => /framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0, gl\.TEXTURE_2D, this\.particleStateB, 0\)/.test(l));
    expect(attach).toHaveLength(1);
    expect(attach[0]).toMatch(/this\._advAttached = true;/);
    const detach = lines.filter((l) => /framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0, gl\.TEXTURE_2D, null, 0\)/.test(l) && !/sb\.fbo|screen/.test(l));
    expect(detach.length).toBeGreaterThanOrEqual(2);
    expect(detach.filter((l) => /this\._advAttached = false;/.test(l))).toHaveLength(2);
    expect(src).toContain("if (this.advFBO && advTeardownNeeded(this, undefined, 'windAdvTeardown') && gl.isFramebuffer(this.advFBO)) {");
    expect(src.split('gl.isFramebuffer(').length - 1).toBe(1);
    expect(src).not.toMatch(/gl\.checkFramebufferStatus\(/);
  });
});

describe('the marine advection pass uses it (source pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
  it('asks through the cache for the texture it just attached, and nowhere asks the driver directly in render', () => {
    const attach = src.indexOf('gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);');
    const write = src.indexOf('const writeTex = this.particleStateB;');
    const call = src.indexOf('const fboStatus = cachedFramebufferStatus(gl, this, this.advFBO, writeTex, this.particleRes, this.particleRes);');
    expect(attach).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(attach);
    expect(call).toBeGreaterThan(write);
    const render = src.slice(src.indexOf('WebGLMarineEngine.prototype.renderHeatmapAndParticles = function'),
      src.indexOf('WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles'));
    expect(render.length).toBeGreaterThan(1000);
    expect(render).not.toMatch(/gl\.checkFramebufferStatus\(/);
    // The diagnostics strings the HUD reads are unchanged.
    expect(render).toContain("if (fboStatus === gl.FRAMEBUFFER_COMPLETE) fboStatusStr = 'FRAMEBUFFER_COMPLETE';");
    expect(render).toContain('window.__RAW_GPU__.advFboStatus = fboStatusStr;');
  });
  it('records the attachment on the attach line and clears it on every detach; the teardown asks first', () => {
    const render = src.slice(src.indexOf('WebGLMarineEngine.prototype.renderHeatmapAndParticles = function'),
      src.indexOf('WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles'));
    const attaches = render.split('\n').filter((l) => /framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0, gl\.TEXTURE_2D, this\.particleStateB, 0\)/.test(l));
    expect(attaches).toHaveLength(1);
    expect(attaches[0]).toMatch(/this\._advAttached = true;/);
    const detaches = render.split('\n').filter((l) => /framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0, gl\.TEXTURE_2D, null, 0\)/.test(l));
    expect(detaches).toHaveLength(3);   // incomplete branch, complete branch, finally teardown
    for (const l of detaches) expect(l).toMatch(/this\._advAttached = false;/);
    expect(render).toContain('if (this.advFBO && advTeardownNeeded(this) && gl.isFramebuffer(this.advFBO)) {');
    expect(render.split('gl.isFramebuffer(').length - 1).toBe(1);
  });
});
