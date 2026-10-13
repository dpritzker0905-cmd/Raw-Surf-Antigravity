import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '../../frontend/src/contexts/ThemeContext';
import { PhotoMatchingUnavailableDialog } from '../../frontend/src/components/gallery/PhotoMatchingUnavailableDialog';
import WebGLMarineEngine from '../../frontend/src/components/map/WebGLMarineEngine';
import { withTextureState } from '../../frontend/src/components/map/WebGLMarineTextureEncoder';

function gpuChecks() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { supported: false };
  const foreign = gl.createTexture(), water = gl.createTexture(), fbo = gl.createFramebuffer(), drawFbo = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, foreign);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  let stateRestored, throwRestored;
  try {
    withTextureState(gl, () => {
      gl.bindTexture(gl.TEXTURE_2D, water);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(128 * 64 * 4).fill(255));
    });
    stateRestored = gl.getParameter(gl.TEXTURE_BINDING_2D) === foreign && !gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    try { withTextureState(gl, () => { gl.bindTexture(gl.TEXTURE_2D, water); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); throw new Error('injected'); }); } catch (_) { /* expected failure control */ }
    throwRestored = gl.getParameter(gl.TEXTURE_BINDING_2D) === foreign && !gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFbo);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    const reads = [0.2, 2, 12, 40].map(span => {
      const engine = { _overlayMaskTex: water, _overlayMaskBounds: { west: -span / 2, east: span / 2, south: -1, north: 1 },
        _overlayMaskTexDims: { w:128, h:64 }, _probeState: { overlayOn:true, replace:true } };
      const point = [{ lng:span * 0.45, lat:-0.9 }];
      const known = WebGLMarineEngine.prototype.probeMaskGPU.call(engine, point, gl)[0].effective;
      delete engine._overlayMaskTexDims;
      const unknown = WebGLMarineEngine.prototype.probeMaskGPU.call(engine, point, gl)[0].effective;
      return { span, known, unknown };
    });
    const framebufferRestored = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === fbo && gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === drawFbo, error = gl.getError();
    return { supported:true, stateRestored, throwRestored, reads,
      framebufferRestored, error, version:gl.getParameter(gl.VERSION),
      passed:stateRestored && throwRestored && framebufferRestored && error === gl.NO_ERROR && reads.every(r => r.known === 255 && r.unknown === null) };
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo); gl.deleteFramebuffer(drawFbo); gl.deleteTexture(foreign); gl.deleteTexture(water); }
}

function Preview() {
  const { toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [gpu, setGpu] = useState(null);
  return <main className="p-8 bg-background text-foreground min-h-screen">
    <h1 className="text-xl mb-4">Local repair preview</h1>
    {['light', 'dark', 'beach'].map(theme => <button className="p-4 border m-2 rounded" key={theme}
      onClick={() => { toggleTheme(theme); setOpen(true); }}>{theme}</button>)}
    <button className="p-4 border m-2 rounded" onClick={() => setGpu(gpuChecks())}>Run GPU checks</button>
    {gpu && <pre>{JSON.stringify(gpu, null, 2)}</pre>}
    <PhotoMatchingUnavailableDialog open={open} onClose={() => setOpen(false)} />
  </main>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><Preview /></ThemeProvider>);
