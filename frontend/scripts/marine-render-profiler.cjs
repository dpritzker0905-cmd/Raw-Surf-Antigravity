// Browser-side diagnostic, serialized by Playwright. It times submitted draw commands only:
// uploads, JavaScript, browser compositing and presentation are outside these GPU queries.
async function measureMarinePasses({ framesPerBlock = 8, timeoutMs = 60000 } = {}) {
  if (!Number.isInteger(framesPerBlock) || framesPerBlock < 2 || framesPerBlock > 30) throw Error('Invalid frame count');
  const engine = window.__MARINE_ENGINE__, map = window.map, gl = map?.painter?.context?.gl;
  if (!engine || !gl || !gl.createQuery) throw Error('Marine WebGL2 context unavailable');
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) throw Error('GPU timer queries unavailable: pass cost is unmeasured');
  if (gl.getParameter(ext.GPU_DISJOINT_EXT) || gl.getError()) throw Error('Invalid initial GPU state');
  if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw Error('GPU timer already active');

  const ids = new WeakMap(); let nextId = 0;
  const id = value => { if (!value) return null; if (!ids.has(value)) ids.set(value, ++nextId); return ids.get(value); };
  const identity = () => ({ resident: id(engine._waveData), grid: id(engine._waveData?.waveGrid),
    coarse: id(engine._coarseBaseData), mask: id(engine._cachedMaskTex), overlay: id(engine._overlayMaskTex),
    bounds: engine._waveData?.bounds, maskBounds: engine._cachedMaskBounds, maskDims: engine._cachedMaskTexDims,
    overlayBounds: engine._overlayMaskBounds, basemapPaintAt: window.__RAW_GPU__?.basemapWaterMask?.at });
  const digest = async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(engine._waveData?.waveGrid));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  };
  const before = JSON.stringify(identity()), beforeHash = await digest();
  const programs = new Map([[engine.heatmapProgram, 'heatmap'], [engine.drawProgram, 'crests'], [engine.advectProgram, 'advection']]);
  const originals = {}, locations = new Map(), values = new Map(), queries = [], blocks = [];
  const render = engine.render, coarse = engine._drawCoarseBasePass;
  let currentProgram = gl.getParameter(gl.CURRENT_PROGRAM), insideMarine = false, insideCoarse = false;
  let mode = 'observe', rows = [], frameIndex = 0, activeQuery = null;
  const setMethod = (name, method) => { originals[name] = gl[name]; gl[name] = method; };
  setMethod('useProgram', function(program) { currentProgram = program; return originals.useProgram.call(this, program); });
  setMethod('getUniformLocation', function(program, name) {
    const location = originals.getUniformLocation.call(this, program, name);
    if (location) locations.set(location, { program, name }); return location;
  });
  setMethod('uniform1f', function(location, value) {
    const uniform = locations.get(location);
    if (uniform) { if (!values.has(uniform.program)) values.set(uniform.program, {}); values.get(uniform.program)[uniform.name] = value; }
    return originals.uniform1f.call(this, location, value);
  });
  engine.render = function(...args) {
    insideMarine = true; try { return render.apply(this, args); } finally { insideMarine = false; }
  };
  engine._drawCoarseBasePass = function(...args) {
    insideCoarse = true; try { return coarse.apply(this, args); } finally { insideCoarse = false; }
  };
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    if (typeof gl[name] !== 'function') continue;
    setMethod(name, function(...args) {
      const pass = insideMarine ? programs.get(currentProgram) || 'unknown-marine' : 'map-other';
      const entry = { frameIndex, pass, phase: insideCoarse ? 'coarse' : insideMarine ? 'resident' : 'map', name,
        offset: pass === 'heatmap' ? values.get(currentProgram)?.u_lng_offset ?? null : null };
      if (mode === 'query') {
        activeQuery = gl.createQuery(); if (!activeQuery) throw Error('Cannot allocate GPU query');
        queries.push({ query: activeQuery, entry }); gl.beginQuery(ext.TIME_ELAPSED_EXT, activeQuery);
      }
      const start = performance.now();
      try { return originals[name].apply(this, args); }
      finally {
        entry.wallMs = performance.now() - start;
        if (activeQuery) { gl.endQuery(ext.TIME_ELAPSED_EXT); activeQuery = null; }
        rows.push(entry);
      }
    });
  }
  try {
    for (const blockMode of ['observe', 'query', 'query', 'observe']) {
      mode = blockMode; rows = []; frameIndex = 0;
      const frames = await new Promise((resolve, reject) => {
        const result = []; let previous = performance.now(), previousDrawCount = 0;
        const finish = error => { clearTimeout(timer); map.off('render', onRender); error ? reject(error) : resolve(result); };
        const onRender = () => {
          try {
            const now = performance.now();
            if (JSON.stringify(identity()) !== before) throw Error('Data or mask changed during GPU profiling');
            if (gl.getError()) throw Error('GPU error during profiling');
            result.push({ intervalMs: now - previous, drawCount: rows.length - previousDrawCount });
            previous = now; previousDrawCount = rows.length;
            frameIndex++;
            if (result.length === framesPerBlock) finish(); else map.triggerRepaint();
          } catch (error) { finish(error); }
        };
        const timer = setTimeout(() => finish(Error('Too few map render events for profiling')), timeoutMs);
        map.on('render', onRender); map.triggerRepaint();
      });
      blocks.push({ mode, frames, draws: rows });
    }
    // Stop recording while waiting asynchronously for results; never read unavailable queries.
    mode = 'observe'; rows = [];
    const deadline = performance.now() + timeoutMs;
    while (queries.some(({ query }) => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) {
      if (performance.now() > deadline) throw Error('GPU timer results unavailable');
      await new Promise(requestAnimationFrame);
    }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('Disjoint GPU timers: measurements invalid');
    for (const { query, entry } of queries) {
      entry.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      if (!Number.isFinite(entry.gpuMs) || entry.gpuMs < 0) throw Error('Invalid GPU duration');
    }
    const afterHash = await digest();
    if (beforeHash !== afterHash || JSON.stringify(identity()) !== before) throw Error('Input drift invalidates GPU profile');
    if (gl.getError()) throw Error('GPU error invalidates profile');
    if (blocks.some(b => b.draws.some(d => d.pass === 'unknown-marine'))) throw Error('Unclassified marine draw');
    if (blocks.some(b => b.frames.some((_, i) => !b.draws.some(d => d.frameIndex === i && d.pass === 'heatmap')))) {
      throw Error('Marine heatmap was not drawn on every measured frame');
    }
    return { diagnosticOnly: true, timer: 'EXT_disjoint_timer_query_webgl2', framesPerBlock,
      identity: JSON.parse(before), gridSha256: beforeHash, afterHash, blocks,
      scope: 'Draw-command GPU time; excludes uploads, JavaScript, browser compositing and presentation.' };
  } finally {
    if (activeQuery) gl.endQuery(ext.TIME_ELAPSED_EXT);
    for (const [name, method] of Object.entries(originals)) gl[name] = method;
    engine.render = render; engine._drawCoarseBasePass = coarse;
    for (const { query } of queries) gl.deleteQuery(query);
  }
}

module.exports = { measureMarinePasses };
