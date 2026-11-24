// HEAP CENSUS (2026-11-23, the inspection's pass 5: the JS heap 106 MB -> 1.8-2.1 GB over a 21-layer scrub cycle).
// Reads a Chrome .heapsnapshot of ANY size (the integer arrays are scanned into typed arrays; JSON.parse never sees the file) and
// charges every object's self size to the NEAREST CLOSURE VARIABLE on its shortest path from the root (weak edges skipped). In an
// UNMINIFIED build a module-level cache is a closure variable, so the census names the cache that holds the bytes (`_seriesCache`).
// This is first-path attribution, not a dominator tree: an object reachable two ways is charged once, to the shorter path.
//   node --max-old-space-size=8192 heap_census.cjs <file.heapsnapshot> [top=40] [out.json]
// Prints: total self size, the top labels (bytes, objects), and for each top label one sample path (edge names from the root).
'use strict';
const fs = require('fs');

const file = process.argv[2];
const TOP = +(process.argv[3] || 40);
const OUT = process.argv[4] || null;
if (!file) { console.error('usage: heap_census.cjs <file.heapsnapshot> [top] [out.json]'); process.exit(2); }

const buf = fs.readFileSync(file);
const find = (s, from = 0) => { const i = buf.indexOf(s, from, 'latin1'); if (i < 0) throw Error(`no ${s}`); return i; };

// The header: everything before "nodes" is small JSON.
const nodesAt = find('"nodes":[');
const head = JSON.parse(buf.toString('utf8', 0, nodesAt).replace(/,\s*$/, '') + '}');
const meta = head.snapshot.meta;
const NF = meta.node_fields.length; const EF = meta.edge_fields.length;
const N = head.snapshot.node_count; const M = head.snapshot.edge_count;
const nodeTypes = meta.node_types[0]; const edgeTypes = meta.edge_types[0];
const iType = meta.node_fields.indexOf('type'); const iName = meta.node_fields.indexOf('name');
const iSelf = meta.node_fields.indexOf('self_size'); const iEdges = meta.node_fields.indexOf('edge_count');
const eType = meta.edge_fields.indexOf('type'); const eName = meta.edge_fields.indexOf('name_or_index'); const eTo = meta.edge_fields.indexOf('to_node');

// Integer arrays, scanned byte by byte (numbers are non-negative; self sizes fit a double, so use Float64 for nodes).
function scanInts(start, count, Arr) {
  const out = new Arr(count); let k = 0; let v = 0; let inNum = false; let i = start;
  for (; i < buf.length && k < count; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) { v = v * 10 + (c - 48); inNum = true; } else { if (inNum) { out[k++] = v; v = 0; inNum = false; } if (c === 93) break; }
  }
  if (inNum && k < count) out[k++] = v;
  if (k !== count) throw Error(`scanned ${k} of ${count}`);
  return { out, end: i };
}
const nodes = scanInts(nodesAt + 9, N * NF, Float64Array);
const edgesAt = find('"edges":[', nodes.end);
const edges = scanInts(edgesAt + 9, M * EF, Uint32Array);
const nd = nodes.out; const ed = edges.out;

// Strings: a manual scanner (escapes decoded with JSON.parse on that one string only).
const stringsAt = find('"strings":[', edges.end);
const strings = [];
{
  let i = stringsAt + 11;
  while (i < buf.length) {
    const c = buf[i];
    if (c === 93) break;
    if (c === 34) {
      let j = i + 1; let esc = false;
      while (j < buf.length) { const d = buf[j]; if (d === 92) { esc = true; j += 2; continue; } if (d === 34) break; j++; }
      const raw = buf.toString('utf8', i + 1, j);
      strings.push(esc ? JSON.parse('"' + raw + '"') : raw);
      i = j + 1;
    } else i++;
  }
}

// First edge per node, then a BFS from the root (node 0) over non-weak edges.
const firstEdge = new Uint32Array(N + 1);
for (let n = 0, e = 0; n < N; n++) { firstEdge[n] = e; e += nd[n * NF + iEdges] * EF; }
firstEdge[N] = M * EF;
const WEAK = edgeTypes.indexOf('weak'); const CONTEXT = edgeTypes.indexOf('context');
const ELEMENT = edgeTypes.indexOf('element'); const HIDDEN = edgeTypes.indexOf('hidden'); const PROPERTY = edgeTypes.indexOf('property');
const label = new Int32Array(N).fill(-1);       // index into labels[]
const parentEdge = new Int32Array(N).fill(-1);  // edge offset that discovered the node
const parentNode = new Int32Array(N).fill(-1);
const labels = ['(root)']; const labelId = new Map([['(root)', 0]]);
const lab = (s) => { let id = labelId.get(s); if (id === undefined) { id = labels.length; labels.push(s); labelId.set(s, id); } return id; };
const queue = new Uint32Array(N); let qh = 0; let qt = 0;
queue[qt++] = 0; label[0] = 0;
while (qh < qt) {
  const n = queue[qh++];
  for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) {
    const t = ed[e + eType];
    if (t === WEAK) continue;
    const c = ed[e + eTo] / NF;
    if (label[c] !== -1) continue;
    // A window global (`window.__DECODED_OM_TILES__`) has no closure variable on its path: it is named by its property instead.
    const winProp = t === PROPERTY && label[n] === 0 && String(strings[nd[n * NF + iName]]).startsWith('Window');
    label[c] = t === CONTEXT ? lab('ctx:' + strings[ed[e + eName]]) : (winProp ? lab('win:' + strings[ed[e + eName]]) : label[n]);
    parentEdge[c] = e; parentNode[c] = n;
    queue[qt++] = c;
  }
}

// Totals by label (and unreachable).
const bytes = new Float64Array(labels.length); const objs = new Float64Array(labels.length); const sample = new Int32Array(labels.length).fill(-1);
const sampleSize = new Float64Array(labels.length);
let total = 0; let unreachable = 0;
for (let n = 0; n < N; n++) {
  const s = nd[n * NF + iSelf]; total += s;
  const l = label[n];
  if (l < 0) { unreachable += s; continue; }
  bytes[l] += s; objs[l] += 1;
  if (s > sampleSize[l]) { sampleSize[l] = s; sample[l] = n; }
}
const edgeName = (e) => {
  const t = ed[e + eType]; const v = ed[e + eName];
  return (t === ELEMENT || t === HIDDEN) ? `[${v}]` : strings[v];
};
const pathOf = (n) => {
  const p = [];
  for (let k = n; k > 0 && parentEdge[k] >= 0 && p.length < 40; k = parentNode[k]) {
    p.push(`${edgeName(parentEdge[k])}:${nodeTypes[nd[parentNode[k] * NF + iType]]}/${String(strings[nd[parentNode[k] * NF + iName]]).slice(0, 40)}`);
  }
  return p.reverse().join(' > ');
};
const order = [...labels.keys()].sort((a, b) => bytes[b] - bytes[a]).slice(0, TOP);
const MB = (x) => +(x / 1048576).toFixed(1);
const rows = order.map((l) => ({ label: labels[l], mb: MB(bytes[l]), objects: objs[l],
  biggest: sample[l] >= 0 ? `${nodeTypes[nd[sample[l] * NF + iType]]}/${String(strings[nd[sample[l] * NF + iName]]).slice(0, 50)} ${MB(sampleSize[l])} MB` : null,
  path: sample[l] >= 0 ? pathOf(sample[l]) : null }));
console.log(`nodes ${N} edges ${M} | self total ${MB(total)} MB | unreachable ${MB(unreachable)} MB`);
for (const r of rows) console.log(`${String(r.mb).padStart(8)} MB  ${String(r.objects).padStart(9)} obj  ${r.label}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ file, nodes: N, edges: M, totalMB: MB(total), unreachableMB: MB(unreachable), rows }, null, 1));
