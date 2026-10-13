import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import maplibregl from 'maplibre-gl';
import { useLayerTruthDiff as before } from './truth-cadence-bundle/before';
import { useLayerTruthDiff as after } from '../../../frontend/src/components/map/useLayerTruthDiff';

const report = document.getElementById('report');
const run = document.getElementById('run');
function Inspector({ inspect, map }) {
  inspect({ mapInstance: map, activeLayers: ['waves'], activeRenderType: 'marine',
    windData: null, marineData: { grid: { vectors: [{ speed: 1 }] } } });
  return null;
}

async function measure(label, inspect) {
  const container = document.createElement('div');
  container.style.cssText = 'width:512px;height:256px;position:relative';
  document.getElementById('maps').appendChild(container);
  const map = new maplibregl.Map({ container, interactive: false, attributionControl: false,
    fadeDuration: 0, style: { version: 8, sources: {}, layers: Array.from({ length: 100 }, (_, i) => ({
      id: 'background-' + i, type: 'background', paint: { 'background-color': '#102832' },
    })) } });
  const host = document.createElement('div');
  container.appendChild(host);
  const root = createRoot(host);
  let timeout = null, frames = 0, idles = 0, reads = 0, cpuMs = 0, customCalls = 0;
  const cadence = []; let last = null;
  let onRender = null, onIdle = null;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Map load deadline')), 10000);
      map.once('load', () => { clearTimeout(timer); resolve(); });
    });
    const facade = { on: map.on.bind(map), off: map.off.bind(map),
      getLayoutProperty: map.getLayoutProperty.bind(map), getStyle: () => {
        const start = performance.now();
        try { reads++; return map.getStyle(); }
        finally { cpuMs += performance.now() - start; }
      } };
    flushSync(() => root.render(<Inspector inspect={inspect} map={facade} />));
    await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Frame deadline: frames=${frames}, idle=${idles}, reads=${reads}, custom=${customCalls}`)), 10000);
      onIdle = () => { idles++; };
      onRender = () => {
        const now = performance.now();
        if (last !== null) cadence.push(now - last);
        last = now;
        if (++frames >= 120) resolve();
      };
      map.on('idle', onIdle); map.on('render', onRender);
      map.addLayer({ id: 'animated-offline', type: 'custom', renderingMode: '2d',
        render() { customCalls++; if (frames < 120) map.triggerRepaint(); } });
    });
    clearTimeout(timeout);
    await new Promise(resolve => setTimeout(resolve, 300)); // bounded final idle delivery
    const median = [...cadence].sort((a, b) => a - b)[Math.floor(cadence.length / 2)];
    return { label, frames, idleEvents: idles, styleReads: reads,
      styleCpuCallMs: +cpuMs.toFixed(3), cadenceMedianMs: +median.toFixed(3),
      cadenceMaxMs: +Math.max(...cadence).toFixed(3) };
  } finally {
    clearTimeout(timeout);
    root.unmount();
    if (onRender) map.off('render', onRender);
    if (onIdle) map.off('idle', onIdle);
    map.remove(); container.remove();
  }
}

run.addEventListener('click', async () => {
  run.disabled = true; report.textContent = 'Running actual offline MapLibre + React hook…';
  const result = { liveBackendRequests: 0, physicalForecast: false, fullWeatherApp: false,
    gpuCompletion: 'unmeasured', framesPerCase: 120, basemapLayers: 100, cases: [] };
  try {
    const order = document.getElementById('reverse').checked
      ? [['after', after], ['before', before]] : [['before', before], ['after', after]];
    for (const [label, inspect] of order) result.cases.push(await measure(label, inspect));
    result.completed = true;
  } catch (error) { result.completed = false; result.error = error.message; }
  finally { report.textContent = JSON.stringify(result, null, 2); run.disabled = false; }
});
