/**
 * THE TELEMETRY THE OOM FORENSICS READ MUST COME BACK DOWN.
 *
 * MEASURED 2026-08-04, live on the map over 32 zoom gestures: `__RAW_GPU__.textureCount` rose
 * 11 -> 95, **+2.63 per gesture, linearly, with no plateau**, and `gpuMemoryEstimate` with it
 * (+0.88 MB/gesture). That is the exact signature of a GPU texture leak.
 *
 * ⭐⭐ IT WAS NOT A LEAK — IT WAS THE ACCOUNTING. `safeDeleteTexture` freed the GL object correctly
 * and never decremented the counters; there were **18 call sites against 2 manual decrement sites**.
 * The textures were released and the telemetry never heard about it.
 *
 * ⛔ WORTH FIXING ANYWAY, AND ARGUABLY MORE URGENT THAN A SMALL LEAK: a counter that only rises
 * cannot tell a healthy session from a leaking one, so the next REAL leak is invisible. The same
 * class was fixed once before at ONE site (2026-07-05, "poisoning the very telemetry the OOM
 * forensics rely on") and recurred because the fix went where the bug was, not where the invariant
 * belongs. It now lives in the single function every deletion passes through.
 *
 * ★ THE CONTROL THAT MAKES THIS MEAN SOMETHING: an over-count and an under-count are equally bad —
 * one cries wolf forever, the other hides a real leak. So these tests pin BOTH directions, and
 * assert the counters return EXACTLY to baseline rather than merely "not growing".
 */
import { safeDeleteTexture, noteTextureCreated } from './WebGLWindUtils';

const W = 256, H = 128, BYTES = W * H * 4;

function fakeGl() {
  const deleted = [];
  return {
    deleted,
    deleteTexture(t) { deleted.push(t); },
  };
}

beforeEach(() => {
  global.window = global.window || {};
  window.__RAW_GPU__ = { textureCount: 0, gpuMemoryEstimate: 0, textureUploadCount: 0 };
});

function makeTex(gl, w = W, h = H) {
  const tex = { id: Math.random() };            // stand-in for a WebGLTexture object
  window.__RAW_GPU__.textureCount++;
  window.__RAW_GPU__.gpuMemoryEstimate += w * h * 4;
  noteTextureCreated(tex, w, h);
  return tex;
}

test('a create/delete pair returns the counters EXACTLY to baseline', () => {
  const gl = fakeGl();
  const t = makeTex(gl);
  expect(window.__RAW_GPU__.textureCount).toBe(1);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(BYTES);

  safeDeleteTexture(gl, t, null);

  expect(gl.deleted).toEqual([t]);              // the GL object is still actually freed
  expect(window.__RAW_GPU__.textureCount).toBe(0);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(0);
});

test('THE REGRESSION: many create/delete cycles do not drift — this is what grew 11 -> 95 live', () => {
  const gl = fakeGl();
  for (let cycle = 0; cycle < 40; cycle++) {
    const a = makeTex(gl);
    const b = makeTex(gl);
    const c = makeTex(gl);
    safeDeleteTexture(gl, a, null);
    safeDeleteTexture(gl, b, null);
    safeDeleteTexture(gl, c, null);
  }
  expect(window.__RAW_GPU__.textureCount).toBe(0);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(0);
  expect(gl.deleted).toHaveLength(120);
});

test('the estimate subtracts the texture\'s OWN size, not a hardcoded one', () => {
  const gl = fakeGl();
  const small = makeTex(gl, 1024, 512);
  const big = makeTex(gl, 4096, 2048);         // the tier that leaked +31.5MB in the 07-05 incident
  const total = 1024 * 512 * 4 + 4096 * 2048 * 4;
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(total);

  safeDeleteTexture(gl, big, null);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(1024 * 512 * 4);
  safeDeleteTexture(gl, small, null);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(0);
});

test('a DOUBLE delete cannot drive the counters negative', () => {
  const gl = fakeGl();
  const t = makeTex(gl);
  safeDeleteTexture(gl, t, null);
  safeDeleteTexture(gl, t, null);
  expect(window.__RAW_GPU__.textureCount).toBe(0);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(0);
});

test('a texture this module never saw created is not accounted for', () => {
  const gl = fakeGl();
  window.__RAW_GPU__.textureCount = 5;
  window.__RAW_GPU__.gpuMemoryEstimate = 999;
  safeDeleteTexture(gl, { id: 'foreign' }, null);
  expect(gl.deleted).toHaveLength(1);           // still deleted
  expect(window.__RAW_GPU__.textureCount).toBe(5);   // but not double-subtracted
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(999);
});

test('the particle-state safeguard still wins, and does NOT account for a texture it kept', () => {
  const gl = fakeGl();
  const engine = {};
  const t = makeTex(gl);
  engine.particleStateA = t;
  const before = { ...window.__RAW_GPU__ };

  safeDeleteTexture(gl, t, engine);

  expect(gl.deleted).toHaveLength(0);           // refused to delete
  expect(window.__RAW_GPU__.textureCount).toBe(before.textureCount);
  expect(window.__RAW_GPU__.gpuMemoryEstimate).toBe(before.gpuMemoryEstimate);
});

test('missing telemetry is not an error — the map must render without __RAW_GPU__', () => {
  const gl = fakeGl();
  const t = { id: 'x' };
  noteTextureCreated(t, W, H);
  window.__RAW_GPU__ = undefined;
  expect(() => safeDeleteTexture(gl, t, null)).not.toThrow();
  expect(gl.deleted).toEqual([t]);
});
