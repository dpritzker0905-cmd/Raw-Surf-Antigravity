/**
 * maskCanvasUpload: the mask canvas reaches its texture through a GPU-backed copy (2026-11-13), and falls back to the direct
 * upload whenever the copy cannot be made. The timings are in the log; these pin the contract.
 */
import fs from 'fs';
import path from 'path';
import { gpuBackedCopy, maskUploadCopyOn, uploadMaskCanvas } from './maskCanvasUpload';

const fakeGl = () => {
  const calls = [];
  return { calls, TEXTURE_2D: 'T2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UB', texImage2D: (...a) => calls.push(a) };
};
// A document whose canvases record what was drawn on them.
const fakeDoc = (opts = {}) => {
  const made = [];
  return {
    made,
    createElement: (tag) => {
      if (opts.throwOnCreate) throw new Error('no canvas');
      const c = { tag, width: 0, height: 0, drawn: [], ctxOpts: 'unset', op: null };
      c.getContext = (type, o) => {
        c.ctxOpts = o;
        if (opts.noContext) return null;
        return { set globalCompositeOperation(v) { c.op = v; }, drawImage: (src, x, y) => c.drawn.push([src, x, y, c.op]) };
      };
      made.push(c);
      return c;
    },
  };
};
const mask = { width: 4096, height: 2048, id: 'mask' };

beforeEach(() => { delete window.__RAW_DISABLE_MASK_UPLOAD_COPY__; delete window.__RAW_MASK_UPLOAD__; });

describe('the mask canvas uploads through a GPU-backed copy', () => {
  test('the copy is a default 2D canvas of the same size holding the mask as it is', () => {
    const doc = fakeDoc();
    const copy = gpuBackedCopy(mask, doc);
    expect(copy).toBe(doc.made[0]);
    expect([copy.width, copy.height]).toEqual([4096, 2048]);
    expect(copy.ctxOpts).toBeUndefined();                         // never willReadFrequently: that is what made the mask slow
    expect(copy.drawn).toEqual([[mask, 0, 0, 'copy']]);           // 'copy' was set BEFORE the draw: no blending
  });

  test('the upload is the same call with the copy as its source, and the copy is released at once', () => {
    const gl = fakeGl(); const doc = fakeDoc();
    uploadMaskCanvas(gl, mask, doc);
    expect(gl.calls).toHaveLength(1);
    expect(gl.calls[0].slice(0, 5)).toEqual(['T2D', 0, 'RGBA', 'RGBA', 'UB']);
    expect(gl.calls[0][5]).toBe(doc.made[0]);
    expect([doc.made[0].width, doc.made[0].height]).toEqual([0, 0]);     // 32 MB handed back
    expect([mask.width, mask.height]).toEqual([4096, 2048]);             // the mask itself is untouched
    expect(window.__RAW_MASK_UPLOAD__).toMatchObject({ uploads: 1, copied: 1, direct: 0, fellBack: 0 });
  });

  test('OFF PATH: the kill uploads the mask canvas itself, as before, and makes no canvas', () => {
    window.__RAW_DISABLE_MASK_UPLOAD_COPY__ = true;
    expect(maskUploadCopyOn()).toBe(false);
    const gl = fakeGl(); const doc = fakeDoc();
    uploadMaskCanvas(gl, mask, doc);
    expect(gl.calls[0][5]).toBe(mask);
    expect(doc.made).toHaveLength(0);
    expect(window.__RAW_MASK_UPLOAD__).toMatchObject({ uploads: 1, copied: 0, direct: 1, fellBack: 0 });
  });

  test.each([
    ['no document (a worker, a test)', () => null],
    ['a canvas with no 2D context', () => fakeDoc({ noContext: true })],
    ['createElement throws', () => fakeDoc({ throwOnCreate: true })],
  ])('%s: the direct upload, never a missing mask', (_name, mk) => {
    const gl = fakeGl();
    uploadMaskCanvas(gl, mask, mk());
    expect(gl.calls).toHaveLength(1);
    expect(gl.calls[0][5]).toBe(mask);
    expect(window.__RAW_MASK_UPLOAD__).toMatchObject({ uploads: 1, copied: 0, direct: 1, fellBack: 1 });
  });

  test('an empty canvas is never copied', () => {
    expect(gpuBackedCopy({ width: 0, height: 0 }, fakeDoc())).toBeNull();
    expect(gpuBackedCopy(null, fakeDoc())).toBeNull();
  });

  test('the encoder uploads both world masks through it, and nowhere else by hand', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineTextureEncoder.js'), 'utf8');
    expect(src.split('uploadMaskCanvas(gl, maskCanvas);')).toHaveLength(3);                        // the two sites
    expect(src).not.toMatch(/gl\.texImage2D\([^)]*UNSIGNED_BYTE,\s*maskCanvas\)/);
    expect(src).toMatch(/import \{ uploadMaskCanvas \} from '\.\/maskCanvasUpload';/);
  });
});
