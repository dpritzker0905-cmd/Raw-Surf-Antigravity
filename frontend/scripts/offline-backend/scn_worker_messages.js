// scn_worker_messages.js: which map-library worker messages flow when a weather layer turns on, and what each costs the main thread.
// Offline only. For every main->worker request: type, source, an estimate of the bytes (the walk stops at 200,000 nodes, so a big
// GeoJSON object is under-counted) and the duration of its postMessage; for every reply: bytes, decode time and handler time.
// Usage: AB_BASE=http://127.0.0.1:<spa> RR_DIR=<cache> [VP=phone] [LAYER=waves|none] node scripts/offline-backend/scn_worker_messages.js "$PWD"
const R = process.argv[2]; const LAYER = process.env.LAYER || 'waves';
const L = require(R + '/scripts/offline-backend/ab_lib.js'); const { RR } = require(R + '/scripts/raster-lab/rr.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPY = () => {
  const T = (window.__WT__ = { on: false, out: [], back: [], calls: [] });
  const size = (v) => {
    let bytes = 0; let nodes = 0; const seen = new Set(); const st = [v];
    while (st.length && nodes < 200000) {
      const x = st.pop(); nodes += 1;
      if (x == null) continue;
      if (typeof x === 'string') { bytes += x.length * 2; continue; }
      if (typeof x !== 'object') { bytes += 8; continue; }
      if (seen.has(x)) continue; seen.add(x);
      if (x instanceof ArrayBuffer) { bytes += x.byteLength; continue; }
      if (ArrayBuffer.isView(x)) { if (!seen.has(x.buffer)) { seen.add(x.buffer); bytes += x.buffer.byteLength; } continue; }
      if (typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap) { bytes += x.width * x.height * 4; continue; }
      if (Array.isArray(x)) { for (let i = 0; i < x.length && i < 5000; i += 1) st.push(x[i]); if (x.length > 5000) bytes += (x.length - 5000) * 8; continue; }
      for (const k in x) st.push(x[k]);
    }
    return { bytes, nodes };
  };
  const OW = window.Worker;
  let wn = 0;
  window.Worker = class extends OW {
    constructor(...a) {
      super(...a); const id = (wn += 1);
      let late = false; let cur = null;
      super.addEventListener('message', (e) => {
        if (!late) { late = true; super.addEventListener('message', () => { if (cur) { cur.ms = performance.now() - cur.t1; cur = null; } }); }
        if (!T.on) return; const c0 = performance.now(); const d = e.data || {}; const clone = performance.now() - c0; const s = size(d);
        cur = { w: id, t: performance.now(), id: d.id, type: d.type, bytes: s.bytes, nodes: s.nodes, err: !!d.error, ms: null, clone };
        T.back.push(cur); cur.t1 = performance.now();
      });
      const pm = this.postMessage.bind(this);
      this.postMessage = (d, ...r) => {
        if (T.on && d) {
          const dd = d.data || {}; const s = size(d);
          T.out.push({ w: id, t: performance.now(), id: d.id, type: d.type, src: dd.source || dd.sourceLayer || (dd.type === 'geojson' && dd.source) || null,
            layer: Array.isArray(dd.layers) ? dd.layers.length + ' layers' : (Array.isArray(dd.removedIds) ? 'upd ' + (dd.layers || []).length + '/' + dd.removedIds.length : null),
            tile: dd.tileID && dd.tileID.canonical ? [dd.tileID.canonical.z, dd.tileID.canonical.x, dd.tileID.canonical.y].join('/') : null,
            keys: Object.keys(dd).slice(0, 12).join(','), bytes: s.bytes });
        }
        const p0 = performance.now(); const rv = pm(d, ...r); if (T.on && T.out.length) T.out[T.out.length - 1].post = performance.now() - p0; return rv;
      };
    }
  };
};
(async () => {
  const rr = new RR(process.env.RR_DIR, { mode: 'auto' });
  const phone = process.env.VP === 'phone';
  const { browser, page } = await L.launch(phone
    ? { port: 4198, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
    : { port: 4198, width: 1280, height: 800, dpr: 1 });
  await rr.install(page);
  await page.addInitScript(SPY);
  await page.addInitScript(() => { window.__RAW_STATIC_FRAMES_BASE__ = 'http://127.0.0.1:4293/'; });
  const cdp = await page.context().newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await L.openMap(page); await L.jump(page, -55, 38, 3.2); await sleep(5000);
  const t0 = await page.evaluate(() => { window.__WT__.on = true; return performance.now(); });
  if (LAYER !== 'none') await page.evaluate((l) => window.toggleLayer(l), LAYER);
  await sleep(phone ? 16000 : 9000);
  const T = await page.evaluate(() => window.__WT__);
  const byId = new Map(); for (const o of T.out) byId.set(o.w + ':' + o.id, o);
  const agg = {};
  for (const o of T.out) { const k = o.type + ' | ' + (o.src || '-') + (o.layer ? ' | ' + o.layer : ''); const a = (agg[k] = agg[k] || { n: 0, out: 0, back: 0, first: 1e9, last: 0, keys: o.keys }); a.n += 1; a.out += o.bytes; a.post = (a.post || 0) + (o.post || 0); a.first = Math.min(a.first, o.t - t0); a.last = Math.max(a.last, o.t - t0); }
  let unmatched = { n: 0, bytes: 0, types: {} };
  for (const b of T.back) { const o = byId.get(b.w + ':' + b.id); if (o && b.type === '<response>') { const k = o.type + ' | ' + (o.src || '-') + (o.layer ? ' | ' + o.layer : ''); agg[k].back += b.bytes; agg[k].ms = (agg[k].ms || 0) + (b.ms || 0); agg[k].clone = (agg[k].clone || 0) + (b.clone || 0); agg[k].nodes = (agg[k].nodes || 0) + b.nodes; agg[k].mx = Math.max(agg[k].mx || 0, b.ms || 0); } else { unmatched.n += 1; unmatched.bytes += b.bytes; unmatched.types[b.type] = (unmatched.types[b.type] || 0) + 1; } }
  console.log(LAYER, process.env.VP || 'desktop', 'requests', T.out.length, 'messages back', T.back.length);
  for (const [k, a] of Object.entries(agg).sort((x, y) => (y[1].back + y[1].out) - (x[1].back + x[1].out)).slice(0, 25)) {
    console.log(String(a.n).padStart(5), 'x', k.padEnd(52), 'out', (a.out / 1e6).toFixed(2).padStart(7), 'MB post ' + Math.round(a.post || 0) + ' ms  back', (a.back / 1e6).toFixed(2).padStart(7), 'MB  nodes ' + (a.nodes || 0) + ' clone ' + Math.round(a.clone || 0) + ' ms, handler ' + Math.round(a.ms || 0) + ' ms (max ' + Math.round(a.mx || 0) + ')  +' + Math.round(a.first) + '..' + Math.round(a.last) + ' ms', '[' + a.keys + ']');
  }
  console.log('unmatched back', JSON.stringify(unmatched));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
