// GPU FRAMES BENCH: the decode worker. One message = one frame:
//   { id, url, mode: 'rgba8' | 'rgba16f' | 'none' }  ->  { id, packed: ArrayBuffer, cols, rows, validEpoch, t: {...} }
// fetch -> check the gzip magic (1f 8b: the frames bucket stores gzipped bytes WITHOUT Content-Encoding; if a host ever adds
// that header, fetch has already inflated the body and the magic is absent) -> DecompressionStream('gzip') -> parse the
// RSWF v1 header and byte-shuffled planes -> pack straight into the bytes the GPU texture layer takes, with NO per-node JS
// objects (the vector path builds ~15k objects per world frame; that is what this bench compares against).
// The packed buffer is TRANSFERRED (zero copy). Abort: { abort: id }.
'use strict';

const HEADER_FIXED = 72;
const DESCRIPTOR = 24;
const NO_MISSING = 0xFFFFFFFF;
const ctl = new Map();

// Height byte: the bench's stand-in for the engine's height channel (WebGLMarineTextureEncoder); a 16 m ceiling in 255 steps.
// Phase 2 replaces this with the engine encoder's own byte function so a layer is byte-identical to today's texture.
const H_MAX = 16;
const P_MAX = 25;

// float32 -> IEEE half (round to nearest even), for RGBA16F layers uploaded as Uint16Array.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xFF) - 127 + 15;
  let m = x & 0x7FFFFF;
  if (((x >>> 23) & 0xFF) === 0xFF) return sign | 0x7C00 | (m ? 0x200 : 0); // Inf / NaN
  if (e >= 0x1F) return sign | 0x7C00;
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000;
    const shift = 14 - e;
    let h = m >>> shift;
    const rem = m & ((1 << shift) - 1); const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (h & 1))) h += 1;
    return sign | h;
  }
  let h = sign | (e << 10) | (m >>> 13);
  const rem = m & 0x1FFF;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h += 1;
  return h;
}

function parseAndPack(buf, mode) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x52 || bytes[1] !== 0x53 || bytes[2] !== 0x57 || bytes[3] !== 0x46) throw new Error('bad magic');
  const dv = new DataView(buf);
  if (dv.getUint16(4, true) !== 1 || dv.getUint16(6, true) !== 1) throw new Error('unsupported version');
  const cols = dv.getUint16(8, true); const rows = dv.getUint16(10, true);
  const fieldCount = dv.getUint8(18); const headerBytes = dv.getUint32(20, true);
  const validEpoch = dv.getFloat64(56, true);
  const n = cols * rows;
  const planes = {};
  let pos = headerBytes;
  for (let f = 0; f < fieldCount; f++) {
    const d = HEADER_FIXED + f * DESCRIPTOR;
    const id = dv.getUint8(d); const dtype = dv.getUint8(d + 1); const layout = dv.getUint8(d + 2);
    const missing = dv.getUint32(d + 4, true); const scale = dv.getFloat64(d + 8, true); const offset = dv.getFloat64(d + 16, true);
    if (pos + n * dtype > bytes.length) throw new Error('truncated');
    planes[id] = { pos, dtype, layout, missing, scale, offset };
    pos += n * dtype;
  }
  const code = (p, k) => (p.dtype === 1 ? bytes[p.pos + k]
    : (p.layout === 1 ? bytes[p.pos + k] | (bytes[p.pos + n + k] << 8) : bytes[p.pos + 2 * k] | (bytes[p.pos + 2 * k + 1] << 8)));
  const H = planes[0]; const D = planes[1]; const P = planes[2];
  if (!H) throw new Error('no height');
  if (mode === 'none') return { packed: null, cols, rows, validEpoch };
  const DEG = Math.PI / 180;
  if (mode === 'rgba16f') {
    // [height m (-1 = no data), dir x, dir y (unit vector of the FROM direction), period s (-1 = none)]
    const out = new Uint16Array(n * 4);
    const NEG1 = toHalf(-1);
    for (let k = 0; k < n; k++) {
      const hc = code(H, k);
      const o = k * 4;
      if (hc === H.missing) { out[o] = NEG1; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = NEG1; continue; }
      const h = hc * H.scale + H.offset;
      const d = D ? code(D, k) * D.scale * DEG : 0;
      const pc = P ? code(P, k) : 0xFFFF;
      out[o] = toHalf(h); out[o + 1] = toHalf(Math.sin(d)); out[o + 2] = toHalf(Math.cos(d));
      out[o + 3] = (P && pc !== P.missing) ? toHalf(pc * P.scale + P.offset) : NEG1;
    }
    return { packed: out.buffer, cols, rows, validEpoch };
  }
  // rgba8: R = height byte (0 = no data, 1..255 = 0..H_MAX m), G/B = unit vector bytes, A = period byte (0..P_MAX s).
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const hc = code(H, k);
    const o = k * 4;
    if (hc === H.missing) continue; // all zero = no data
    const h = hc * H.scale + H.offset;
    const d = D ? code(D, k) * D.scale * DEG : 0;
    const pc = P ? code(P, k) : 0xFFFF;
    out[o] = 1 + Math.min(254, Math.round((h / H_MAX) * 254));
    out[o + 1] = Math.round((Math.sin(d) * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((Math.cos(d) * 0.5 + 0.5) * 255);
    out[o + 3] = (P && pc !== P.missing) ? Math.min(255, Math.round(((pc * P.scale + P.offset) / P_MAX) * 255)) : 0;
  }
  return { packed: out.buffer, cols, rows, validEpoch };
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.abort) { const c = ctl.get(m.abort); if (c) c.abort(); return; }
  const c = new AbortController();
  ctl.set(m.id, c);
  const t0 = performance.now();
  try {
    const res = await fetch(m.url, { signal: c.signal, credentials: 'omit' });
    if (!res.ok) { self.postMessage({ id: m.id, error: `http_${res.status}` }); return; }
    let buf = await res.arrayBuffer();
    const wire = buf.byteLength; const t1 = performance.now();
    const head = new Uint8Array(buf, 0, Math.min(2, wire));
    const gz = head[0] === 0x1f && head[1] === 0x8b;
    if (gz) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const t2 = performance.now();
    const r = parseAndPack(buf, m.mode || 'rgba8');
    const t3 = performance.now();
    const msg = { id: m.id, cols: r.cols, rows: r.rows, validEpoch: r.validEpoch, wire, inflated: buf.byteLength, gz,
      packed: r.packed, t: { fetch: t1 - t0, inflate: t2 - t1, pack: t3 - t2, total: t3 - t0 } };
    self.postMessage(msg, r.packed ? [r.packed] : []);
  } catch (err) {
    self.postMessage({ id: m.id, error: (err && err.name === 'AbortError') ? 'aborted' : String((err && err.message) || err) });
  } finally { ctl.delete(m.id); }
};
