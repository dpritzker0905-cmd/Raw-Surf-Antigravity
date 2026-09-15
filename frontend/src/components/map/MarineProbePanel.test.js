import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { captureMarineProbe, MarineProbePanel } from './MarineProbePanel';

function fixture() {
  return { map: { getCanvas: () => ({ clientWidth: 100, clientHeight: 200 }),
    unproject: ([x, y]) => ({ lng: x / 10, lat: y / 10 }), getZoom: () => 9 },
  __MARINE_ENGINE__: { _overlayMaskTexDims: { w: 2048, h: 1024 },
    probeMaskGPU: jest.fn(points => points.map((p, i) => ({ base: 0, overlay: null,
      effective: i ? 255 : null, src: 'base' }))) } };
}
it('samples exactly nine canvas-relative points and preserves unknown versus zero', () => {
  const f = fixture(), r = captureMarineProbe(f);
  expect(f.__MARINE_ENGINE__.probeMaskGPU).toHaveBeenCalledTimes(1);
  expect(r.samples).toHaveLength(9);
  expect(r.samples[0]).toMatchObject({ x: 20, y: 40, lng: 2, lat: 4, base: 0, effective: null });
  expect(r.samples[8]).toMatchObject({ x: 80, y: 160, effective: 255 });
  expect(r.overlayDimensions).toEqual({ w: 2048, h: 1024 });
});
it('reports unavailable, incomplete and thrown reads without manufacturing measurements', () => {
  expect(captureMarineProbe({}).error).toBeTruthy();
  const f = fixture(); f.__MARINE_ENGINE__.probeMaskGPU.mockReturnValue([]);
  expect(captureMarineProbe(f)).toEqual({ error: 'Incomplete probe result' });
  f.__MARINE_ENGINE__.probeMaskGPU.mockImplementation(() => { throw Error('read failed'); });
  expect(captureMarineProbe(f)).toEqual({ error: 'read failed' });
});
it('performs no automatic read and takes one snapshot per click', () => {
  const f = fixture(), oldMap = window.map, oldEngine = window.__MARINE_ENGINE__;
  Object.assign(window, f); const host = document.createElement('div'), root = createRoot(host);
  try {
    act(() => root.render(<MarineProbePanel />));
    expect(f.__MARINE_ENGINE__.probeMaskGPU).not.toHaveBeenCalled();
    act(() => host.querySelector('button').click());
    expect(f.__MARINE_ENGINE__.probeMaskGPU).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="Mask probe snapshot"]').textContent).toContain('2048');
  } finally {
    act(() => root.unmount());
    window.map = oldMap; window.__MARINE_ENGINE__ = oldEngine;
  }
});
