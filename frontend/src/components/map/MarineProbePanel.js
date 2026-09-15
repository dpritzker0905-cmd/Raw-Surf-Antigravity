import React, { useState } from 'react';

export function captureMarineProbe(win) {
  const map = win?.map, engine = win?.__MARINE_ENGINE__;
  if (!map || typeof engine?.probeMaskGPU !== 'function') return { error: 'Marine probe unavailable' };
  try {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!(width > 0 && height > 0)) return { error: 'Map has no visible dimensions' };
    const points = [0.2, 0.5, 0.8].flatMap(y => [0.2, 0.5, 0.8].map(x => {
      const p = map.unproject([width * x, height * y]);
      return { lng: p.lng, lat: p.lat, x: width * x, y: height * y };
    }));
    const readings = engine.probeMaskGPU(points);
    if (!Array.isArray(readings) || readings.length !== points.length) return { error: 'Incomplete probe result' };
    return {
      at: new Date().toISOString(), zoom: map.getZoom(), width, height,
      overlayBounds: engine._overlayMaskBounds || null,
      overlayDimensions: engine._overlayMaskTexDims || null,
      samples: points.map((p, i) => ({ ...p, base: readings[i].base ?? null,
        overlay: readings[i].overlay ?? null, effective: readings[i].effective ?? null,
        source: readings[i].src ?? null })),
    };
  } catch (e) { return { error: String(e?.message || e) }; }
}

export function MarineProbePanel() {
  const [result, setResult] = useState(null);
  const [failures, setFailures] = useState(null);
  return <div>
    <button type="button" onClick={() => setResult(captureMarineProbe(window))}
      style={{ color: '#fff', background: '#164e63', border: '1px solid #22d3ee', borderRadius: 6, padding: 6 }}>
      Sample 9 mask points
    </button>
    <button type="button" onClick={() => setFailures(window.__MARINE_ENGINE__
      ? (window.__MARINE_ENGINE__._maskRefreshFailures || { count: 0 }) : { error: 'Marine engine unavailable' })}
      style={{ color: '#fff', background: '#164e63', border: '1px solid #22d3ee', borderRadius: 6, padding: 6 }}>
      Read refresh failures
    </button>
    {failures && <pre aria-label="Mask refresh failures" style={{ fontSize: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#fff' }}>
      {JSON.stringify(failures, null, 2)}
    </pre>}
    <div style={{ fontSize: 10, color: '#cbd5e1' }}>Snapshot only. Map canvas positions; 0=masked, 255=water, null=unknown. Not forecast accuracy.</div>
    {result && <pre aria-label="Mask probe snapshot" style={{ fontSize: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#fff' }}>
      {JSON.stringify(result, null, 2)}
    </pre>}
  </div>;
}
