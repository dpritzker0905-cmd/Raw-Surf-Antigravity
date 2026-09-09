const test = require('node:test');
const assert = require('node:assert/strict');
const { measureMarinePasses } = require('./marine-render-profiler.cjs');

// Controls for the measurement instrument, not a substitute for real GPU validation.
async function fixture(options, run) {
  const previousWindow = global.window, previousRaf = global.requestAnimationFrame;
  const previousCrypto = Object.getOwnPropertyDescriptor(global, 'crypto');
  let program, active = null, nextQuery = 0, queued = false;
  const deleted = [], listeners = new Set(), queries = [];
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    CURRENT_PROGRAM: 3, CURRENT_QUERY: 4, QUERY_RESULT_AVAILABLE: 5, QUERY_RESULT: 6,
    getExtension: () => options.unsupported ? null : ext,
    getParameter: token => token === gl.CURRENT_PROGRAM ? program : !!(options.disjoint && queries.length),
    getError: () => options.gpuError && queries.length ? 1282 : 0,
    getQuery: () => active,
    createQuery: () => { const q = { id: ++nextQuery }; queries.push(q); return q; },
    beginQuery: (target, query) => { assert.equal(active, null); active = query; },
    endQuery: () => { assert(active); active = null; },
    deleteQuery: query => deleted.push(query),
    getQueryParameter: (query, token) => token === gl.QUERY_RESULT_AVAILABLE ? !options.unavailable : options.invalidTime ? -1 : 2000000,
    useProgram: value => { program = value; }, getUniformLocation: () => ({}), uniform1f() {},
    drawArrays() {}, drawElements() {}, drawArraysInstanced() {}, drawElementsInstanced() {}, drawRangeElements() {},
  };
  const engine = {
    heatmapProgram: {}, drawProgram: {}, advectProgram: {}, _waveData: { waveGrid: { vectors: [1, 2] } },
    _drawCoarseBasePass() {
      gl.useProgram(this.heatmapProgram);
      for (const offset of [0, -360, 360]) {
        gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset'), offset); gl.drawElements();
      }
    },
    render() {
      if (options.noMarine) return;
      this._drawCoarseBasePass();
      gl.useProgram(options.unknown ? {} : this.heatmapProgram);
      gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset'), 0); gl.drawElements();
      gl.useProgram(this.drawProgram); gl.drawArrays();
      gl.useProgram(this.advectProgram); gl.drawArrays();
    },
  };
  const map = { painter: { context: { gl } },
    on: (name, fn) => listeners.add(fn), off: (name, fn) => listeners.delete(fn),
    triggerRepaint() {
      if (queued || options.noEvents) return; queued = true;
      setImmediate(() => {
        queued = false; if (!listeners.size) return;
        gl.useProgram({}); gl.drawArraysInstanced(); gl.drawElementsInstanced(); gl.drawRangeElements();
        engine.render();
        if (options.identityDrift) engine._waveData = { ...engine._waveData };
        if (options.fieldDrift) engine._waveData.waveGrid.vectors[0]++;
        for (const fn of [...listeners]) fn();
      });
    },
  };
  const originalMethods = { ...gl }, originalRender = engine.render, originalCoarse = engine._drawCoarseBasePass;
  global.window = { map, __MARINE_ENGINE__: engine };
  global.requestAnimationFrame = fn => setImmediate(fn);
  // This function normally executes in a secure browser. Node 18 has no ambient Web Crypto
  // in this CI job, so provide the browser dependency explicitly and restore it afterward.
  Object.defineProperty(global, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
  try { await run(); }
  finally {
    assert.equal(engine.render, originalRender); assert.equal(engine._drawCoarseBasePass, originalCoarse);
    for (const key of Object.keys(originalMethods)) assert.equal(gl[key], originalMethods[key], key + ' restored');
    assert.equal(active, null); assert.deepEqual(deleted, queries); assert.equal(listeners.size, 0);
    global.window = previousWindow; global.requestAnimationFrame = previousRaf;
    if (previousCrypto) Object.defineProperty(global, 'crypto', previousCrypto); else delete global.crypto;
  }
}

test('attributes real draw entry points, offsets and nanoseconds; observes ABBA and cleans up', async () => {
  await fixture({}, async () => {
    const result = await measureMarinePasses({ framesPerBlock: 2 });
    assert.deepEqual(result.blocks.map(b => b.mode), ['observe', 'query', 'query', 'observe']);
    assert.equal(result.gridSha256, result.afterHash);
    for (const block of result.blocks) {
      assert.equal(block.frames.length, 2); assert.equal(block.draws.length, 18);
      assert(block.frames.every(f => f.drawCount === 9));
      assert.equal(block.draws.filter(d => d.pass === 'map-other').length, 6);
      assert.deepEqual(block.draws.filter(d => d.phase === 'coarse').map(d => d.offset), [0, -360, 360, 0, -360, 360]);
      assert(block.draws.every(d => block.mode === 'query' ? d.gpuMs === 2 : d.gpuMs === undefined));
    }
  });
});

for (const [options, message] of [
  [{ unsupported: true }, /unavailable/], [{ disjoint: true }, /Disjoint/],
  [{ gpuError: true }, /GPU error/], [{ unavailable: true }, /results unavailable/],
  [{ invalidTime: true }, /Invalid GPU duration/], [{ noMarine: true }, /not drawn/],
  [{ unknown: true }, /Unclassified/], [{ noEvents: true }, /Too few/],
  [{ identityDrift: true }, /Data or mask changed/], [{ fieldDrift: true }, /Input drift/],
]) {
  test('refuses invalid evidence and restores state: ' + Object.keys(options)[0], async () => {
    await fixture(options, async () => assert.rejects(measureMarinePasses({ framesPerBlock: 2, timeoutMs: 100 }), message));
  });
}
