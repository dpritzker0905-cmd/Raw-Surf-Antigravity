/**
 * maskCanvasUpload.js — upload the land / ocean mask canvas to its texture without stalling the frame (2026-11-13).
 *
 * WHY. The mask is painted on a 2D canvas that several steps open for pixel reads (`willReadFrequently`: the coast distance
 * field, the shelter and inland-water passes), which makes it CPU-backed. Uploading a CPU-backed 4096 x 2048 canvas with
 * texImage2D blocks the main thread while the browser converts and copies it: measured when the wave layer turns on, two such
 * uploads of 133 and 79 ms on desktop and 434 and 345 ms on a 4x-throttled phone, each inside one frame
 * (docs/weather-program/log/2026-11-13-fable-gpu-cost-and-mask-upload.md). The same canvas drawn onto a default (GPU-backed)
 * canvas first, and uploaded from there, cost 26 ms and 117 ms in the same benchmark: the copy is handed to the GPU process
 * instead of being converted on the main thread.
 *
 * WHAT IT DOES. `uploadMaskCanvas(gl, canvas)` is the one texImage2D call the encoder made, with the source swapped for that
 * copy. Same target, format and type; the caller's bound texture and its UNPACK_FLIP_Y stay the caller's. The copy uses the
 * 'copy' composite (no blending with what the scratch held) and is released at once (a 4096 x 2048 canvas is 32 MB).
 * Anything unexpected (no document, no 2D context, a throw) uploads the mask canvas itself, as before.
 * Kill: window.__RAW_DISABLE_MASK_UPLOAD_COPY__ = true (the direct upload). Telemetry: window.__RAW_MASK_UPLOAD__.
 */
const W = () => (typeof window !== 'undefined' ? window : {});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const maskUploadCopyOn = () => W().__RAW_DISABLE_MASK_UPLOAD_COPY__ !== true;

function tel() {
  const w = W();
  if (!w.__RAW_MASK_UPLOAD__) w.__RAW_MASK_UPLOAD__ = { uploads: 0, copied: 0, direct: 0, fellBack: 0, lastMs: null, maxMs: 0 };
  return w.__RAW_MASK_UPLOAD__;
}

/** A default (GPU-backed) canvas holding `canvas`'s pixels, or null when one cannot be made. */
export function gpuBackedCopy(canvas, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !canvas || !(canvas.width > 0) || !(canvas.height > 0)) return null;
  const copy = doc.createElement('canvas');
  copy.width = canvas.width; copy.height = canvas.height;
  const ctx = copy.getContext('2d');            // no willReadFrequently: this one is only ever a texture source
  if (!ctx) return null;
  ctx.globalCompositeOperation = 'copy';        // the mask's pixels as they are, never blended over the scratch
  ctx.drawImage(canvas, 0, 0);
  return copy;
}

/** The encoder's `gl.texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, canvas)`, through a GPU-backed copy when allowed. */
export function uploadMaskCanvas(gl, canvas, doc) {
  const t = tel(); const t0 = now();
  let copy = null;
  if (maskUploadCopyOn()) {
    try { copy = gpuBackedCopy(canvas, doc); } catch (e) { copy = null; }
    if (!copy) t.fellBack += 1;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, copy || canvas);
  if (copy) { copy.width = 0; copy.height = 0; t.copied += 1; } else t.direct += 1;
  t.uploads += 1; t.lastMs = now() - t0; if (t.lastMs > t.maxMs) t.maxMs = t.lastMs;
}
