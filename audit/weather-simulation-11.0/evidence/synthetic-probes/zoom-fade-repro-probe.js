// ZOOM-OUT HEATMAP FADE — reproduction probe
// Paste into the DevTools console on /map, with the Waves layer ON, IMMEDIATELY after a fresh
// page load. Then do your normal wheel zoom-out. Then run  __FADE_REPORT__()
//
// WHY THIS PROBE EXISTS
// The lead auditor could not reproduce the fade in an automated session: by the time the harness
// zoomed out, the engine held a RETAINED GLOBAL grid (measured 360 deg wide on both GFS and EURO),
// and the suspect branch is gated on `gridWidth < 340.0`. The user reproduces it from a cold map.
// This probe captures the deciding inputs during the real gesture.
//
// THE SUSPECT — frontend/src/components/map/WebGLMarineCustomLayer.js:311-317
//     if (currentZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM /* 7.0 */ && isGlobalSupported && gridWidth < 340.0) {
//       if (!isZoomingOrMoving) { this._wasActive = false; return; }
//       opacityMultiplier = clamp((currentZoom - 5.5) / (6.5 - 5.5));
//     }
// At z5.66 that is (5.66-5.5)/1.0 = 0.16 -> the band is drawn at 16% alpha, i.e. "cleared".
// It reaches 1.0 only at z>=6.5 and 0.0 at z<=5.5.
//
// WHY IT DOES NOT HAPPEN THE SECOND TIME (the user's own observation, and the strongest clue):
// once a GLOBAL grid (360 deg) is resident, `gridWidth < 340.0` is FALSE and the whole branch is
// skipped. A cold map holds a REGIONAL grid (measured 8-10 deg wide), so the branch engages.
//
// ⚠️ A sibling branch at :283-289 has a "COARSE-BASE BRIDGE" added 2026-07-04 for exactly this
// class of zoom-out blank. The branch above has NO such bridge. That asymmetry is the prime
// suspect — but it is a HYPOTHESIS until this probe returns a sub-1.0 alpha.

(() => {
  const m = window.__MAP_INSTANCE__;
  const eng = window.__MARINE_ENGINE__;
  if (!m || !eng) { console.error('[FADE PROBE] map or marine engine not ready — turn Waves on first'); return; }

  const orig = eng.render.bind(eng);
  const samples = [];

  // engine.render(gl, matrix, w, h, zoom, theme, viewportBounds, opacityMultiplier)
  eng.render = function (...a) {
    const g = eng._waveData && eng._waveData.waveGrid;
    const b = g && g.bounds;
    samples.push({
      z: +Number(a[4]).toFixed(2),
      alpha: a[7] == null ? 1 : +Number(a[7]).toFixed(3),
      gridDeg: b ? +(b.east - b.west).toFixed(1) : null,
      zooming: m.isZooming(),
      moving: m.isMoving(),
    });
    return orig(...a);
  };

  window.__FADE_RESTORE__ = () => { eng.render = orig; console.log('[FADE PROBE] restored'); };

  window.__FADE_REPORT__ = () => {
    if (!samples.length) { console.warn('[FADE PROBE] no render samples — the layer never drew'); return null; }
    const byZ = new Map();
    for (const s of samples) {
      const k = Math.round(s.z * 10) / 10;
      const cur = byZ.get(k);
      if (!cur || s.alpha < cur.alpha) byZ.set(k, s);
    }
    const rows = [...byZ.values()].sort((x, y) => y.z - x.z)
      .map(s => ({ zoom: s.z, minAlpha: s.alpha, gridDeg: s.gridDeg, zooming: s.zooming }));
    const faded = rows.filter(r => r.minAlpha < 0.95);
    console.table(rows);
    const out = {
      samples: samples.length,
      minAlphaOverall: Math.min(...samples.map(s => s.alpha)),
      gridWidthsSeen: [...new Set(samples.map(s => s.gridDeg))],
      regionalGridPresent: samples.some(s => s.gridDeg != null && s.gridDeg < 340),
      fadedZooms: faded,
      VERDICT: faded.length
        ? `REPRODUCED: alpha < 1.0 at zoom(s) ${faded.map(f => f.zoom).join(', ')}; min ${Math.min(...samples.map(s => s.alpha))}`
        : 'NOT reproduced — alpha stayed 1.0. Check `regionalGridPresent`: if false, the branch was skipped because a GLOBAL grid was resident.',
    };
    console.log('[FADE PROBE]', out);
    return out;
  };

  console.log('[FADE PROBE] armed. Now wheel-zoom out through z7 -> z5.4, then run __FADE_REPORT__()');
})();
