// served_wave_decode.mjs — run the CLIENT's own frame decoder, unchanged, for the served-wave archive (gate served-wave-verify-v1
// section 4: "the sampler runs the client's own decoder in Node, importing ownRasterDecode.js unchanged").
//
// The decoder file's exact bytes are imported as an ES module (a data: URL, so the import works whatever the frontend's
// package.json declares and on any Node that has ESM), and `decodeFieldCore` is called as the map's worker calls it.
//
//   node served_wave_decode.mjs <path to ownRasterDecode.js>   < job.json   > result.json
//
// job.json: {"items": [{"file": "<gzipped RSWF frame>", "fields": [0, 1, 2], "nodes": [k, ...], "mask": false}]}
// result:   {"items": [{"header": {cols, rows, bounds, validMs, runMs}, "values": {"0": [v|null, ...], ...},
//                       "present": {"0": true, ...}, "mask": "<base64 packbits of Hs-not-missing, big-endian>"|null}]}
// A value is the Float32 the client draws, as a JS number; null = the decoder's missing value (no data at that node).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const MISSING = -9999;
const MISSING_F32 = Math.fround(MISSING);

const decoderPath = process.argv[2];
if (!decoderPath) { process.stderr.write('usage: node served_wave_decode.mjs <ownRasterDecode.js>\n'); process.exit(2); }
const src = readFileSync(decoderPath);
const { decodeFieldCore } = await import('data:text/javascript;base64,' + src.toString('base64'));
if (typeof decodeFieldCore !== 'function') { process.stderr.write('decodeFieldCore not exported\n'); process.exit(3); }

const job = JSON.parse(readFileSync(0, 'utf8'));
const items = [];
for (const it of job.items) {
  const raw = gunzipSync(readFileSync(it.file));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
  const out = { header: null, values: {}, present: {}, mask: null };
  for (const fid of it.fields) {
    const d = decodeFieldCore(buf, fid, MISSING);
    if (!d) { out.present[fid] = false; out.values[fid] = null; continue; }
    out.present[fid] = true;
    if (!out.header) out.header = { cols: d.cols, rows: d.rows, bounds: d.bounds, validMs: d.validMs, runMs: d.runMs };
    out.values[fid] = (it.nodes || []).map((k) => (d.values[k] === MISSING_F32 ? null : d.values[k]));
    if (it.mask && fid === 0) {
      const n = d.values.length;
      const bytes = new Uint8Array(Math.ceil(n / 8));
      for (let k = 0; k < n; k++) if (d.values[k] !== MISSING_F32) bytes[k >> 3] |= 0x80 >> (k & 7);
      out.mask = Buffer.from(bytes).toString('base64');
    }
  }
  items.push(out);
}
process.stdout.write(JSON.stringify({ items }));
