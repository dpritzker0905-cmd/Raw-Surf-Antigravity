// Executed in the real app's map. This isolates the delivered-grid/render boundary; it does
// not validate resolver/network timing or React's data-publication lifecycle.
async function replayCoastalHandoff({ targets, blend = false }) {
  const engine = window.__MARINE_ENGINE__, map = window.map, gl = map?.painter?.context?.gl;
  if (!engine || !gl || !engine._landGeoJSON?.features?.length) throw Error('Real coastal geometry/context unavailable');
  const originalSet = engine.setWaveData, originalRender = engine.render;
  const previousBlend = window.__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__, originalRandom = Math.random;
  const ids = new WeakMap(); let nextId = 0, insideRender = false, replayWrite = false, seed = 12345;
  const id = value => { if (!value) return null; if (!ids.has(value)) ids.set(value, ++nextId); return ids.get(value); };
  const blocked = [], frames = [], samples = [], commits = [], pixelHashes = [];
  let phase = 'setup', index = 0, renderMs = 0;
  const startsBefore = engine._bridgeHandoffStarts || 0, inputBefore = JSON.stringify(targets);
  const canvas = map.getCanvas(), small = document.createElement('canvas');
  small.width = 160; small.height = Math.round(160 * canvas.height / canvas.width);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const fields = () => ({ resident: id(engine._waveData), grid: id(engine._waveData?.waveGrid),
    tag: engine._waveData?.waveGrid?.__replayTag, base: id(engine._coarseBaseData),
    mask: id(engine._cachedMaskTex), maskBounds: engine._cachedMaskBounds, maskDims: engine._cachedMaskTexDims,
    overlay: id(engine._overlayMaskTex), overlayBounds: engine._overlayMaskBounds });
  engine.setWaveData = function(...args) {
    if (!replayWrite && !insideRender) { blocked.push({ t: performance.now(), product: args[1]?.productId ?? null }); return; }
    return originalSet.apply(this, args);
  };
  engine.render = function(...args) {
    insideRender = true; const t = performance.now();
    try { return originalRender.apply(this, args); }
    finally { renderMs = performance.now() - t; insideRender = false; }
  };
  const commit = grid => {
    replayWrite = true;
    try { originalSet.call(engine, gl, grid, null); commits.push({ tag: grid.__replayTag, ...fields() }); }
    finally { replayWrite = false; }
  };
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { map.off('render', onRender); reject(Error('Missing coastal render event')); }, 30000);
    const onRender = () => {
      clearTimeout(timer); map.off('render', onRender);
      try {
        const start = performance.now(), g = window.__RAW_GPU__ || {};
        ctx.drawImage(canvas, 0, 0, small.width, small.height);
        const bytes = ctx.getImageData(0, 0, small.width, small.height).data;
        let sum = 0; for (let i = 0; i < bytes.length; i += 4) sum += .2126*bytes[i] + .7152*bytes[i+1] + .0722*bytes[i+2];
        const row = { phase, index: index++, t: start, z: map.getZoom(), L: sum/(bytes.length/4),
          renderMs, captureMs: performance.now()-start, mult: g.opacity?.mult, heatmap: g.opacity?.heatmap,
          wash: g.washEff, bridge: g.coarseBridgeActive, handoff: JSON.parse(JSON.stringify(g.bridgeHandoff || null)),
          coverage: g.ratingBandFade?.covFrac, drawCalls: g.drawCallsPerFrame, ...fields(), glError: gl.getError() };
        pixelHashes.push(sha(new Uint8Array(bytes)).then(hash => { row.pixelSha256 = hash; }));
        frames.push(row); resolve(row);
      } catch (error) { reject(error); }
    };
    map.on('render', onRender); map.triggerRepaint();
  });
  const block = async (name, n) => { phase = name; for (let i = 0; i < n; i++) await next(); };
  const probe = async name => {
    const points = Array.from({ length: 200 }, (_, i) => {
      const p = map.unproject([(Math.floor(i/5)+.5)/40*map.getContainer().clientWidth,
        [.15,.3,.5,.7,.85][i%5]*map.getContainer().clientHeight]);
      return { lng: p.lng, lat: p.lat };
    });
    const values = engine.probeMaskGPU(points, gl);
    samples.push({ phase: name, count: values.length, known: values.filter(v => v.effective != null).length,
      water: values.filter(v => v.effective >= 128).length, values,
      valuesSha256: await sha(new TextEncoder().encode(JSON.stringify(values))),
      ...fields(), glError: gl.getError() });
  };
  window.__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__ = blend;
  Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed/4294967296; };
  try {
    // Explicitly reset the resident at setup, retaining normal coastal/GL resource management.
    engine.clearBuffers(gl); engine._pendingDowngrade = null;
    map.jumpTo({ center: [-80.2, 28.33], zoom: 8 });
    commit(targets.coarse); await block('coarse', 3);
    commit(targets.resident); await block('resident', 8);
    map.jumpTo({ center: [-80.2, 28.33], zoom: 6.862 });
    await block('hidden', 4); await probe('hidden');
    // Capture one further draw after the synchronous mask probe, before changing the resident.
    await block('hidden', 1);
    if (!frames.slice(-3).every(f => f.tag === 'resident' && f.mult === 0 && f.bridge && f.wash > 0)) {
      throw Error('Hidden-regional handoff precondition was not reproduced');
    }
    commit(targets.incoming); await block('arrival', 10);
    const arrivalStart = frames.find(f => f.phase === 'arrival').t;
    while (frames.at(-1).t - arrivalStart < 1000) await next();
    await probe('arrival');
    await Promise.all(pixelHashes);
    return { blend, diagnosticOnly: true, commits, frames, samples, blockedWrites: blocked,
      starts: (engine._bridgeHandoffStarts || 0)-startsBefore,
      canvas: { width: canvas.width, height: canvas.height },
      inputHashes: targets.hashes, inputsUnchanged: inputBefore === JSON.stringify(targets), schemaVersion: 1,
      scope: 'Real app map/coastal renderer; delivered-grid replay with external publications blocked. Real clock and normal guards. Not resolver/React lifecycle or scientific validation.' };
  } catch (error) {
    await Promise.all(pixelHashes);
    window.__COASTAL_REPLAY_PARTIAL__ = { blend, frames, samples, commits, blockedWrites: blocked, error: error.message };
    throw error;
  } finally {
    engine.setWaveData = originalSet; engine.render = originalRender;
    window.__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__ = previousBlend; Math.random = originalRandom;
  }
}
module.exports = { replayCoastalHandoff };
