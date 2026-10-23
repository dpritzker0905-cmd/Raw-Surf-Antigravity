// Record / replay for the RASTER layers' external hosts (raster-lab, 2026-10-22).
//
// The seven raster layers never touch our Render box: Open-Meteo layers read `.om` files from Open-Meteo's public S3 bucket
// (HTTP range requests, 64 KB blocks) and radar reads RainViewer tiles, IEM HRRR and DWD WMS tiles and nowCOAST lightning.
// To measure them repeatably without loading those third-party servers, every request to these hosts goes through here:
//   - a HIT is answered from disk after the latency it took when recorded (or RR_LAT=0 / RR_LAT=x<f> to scale it), holding
//     one of the host's connection slots meanwhile (HTTP/1.1 hosts: 6 per host, as a browser does);
//   - a MISS is fetched live ONCE (politely: at most RR_LIVE_CONC per host at a time) and stored; RR_MODE=replay refuses
//     misses (504) so a replay can never touch the network.
// Keys are method + URL (cache-buster params dropped) + Range header. Bodies live in <dir>/b/<sha1>.bin; the index is the
// append-only <dir>/index.jsonl. Every served request is logged with its wall-clock time, bytes and hit/miss for the driver.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RASTER_HOSTS = /(^|\.)(openmeteo\.s3\.amazonaws\.com|rainviewer\.com|mesonet\.agron\.iastate\.edu|maps\.dwd\.de|nowcoast\.noaa\.gov)$/;
// HTTP/1.1 hosts get six connections per host in Chrome; RainViewer's CDN speaks h2 (no per-host queue).
const H1 = /(openmeteo\.s3\.amazonaws\.com|mesonet\.agron\.iastate\.edu|maps\.dwd\.de|nowcoast\.noaa\.gov)$/;
const DROP_PARAMS = ['_cb', 'skip_intercept', 'wtlm'];
const KEEP_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'];

class Sem {
  constructor(n) { this.n = n; this.q = []; }
  async take() { if (this.n > 0) { this.n -= 1; return; } await new Promise((r) => this.q.push(r)); }
  give() { const r = this.q.shift(); if (r) r(); else this.n += 1; }
}

function normalizeUrl(u) {
  const x = new URL(u);
  for (const k of DROP_PARAMS) x.searchParams.delete(k);
  return x.toString();
}

class RR {
  constructor(dir, { mode = process.env.RR_MODE || 'auto', lat = process.env.RR_LAT || '1', liveConc = +(process.env.RR_LIVE_CONC || 3) } = {}) {
    this.dir = dir;
    this.mode = mode;
    this.latScale = lat === '0' ? 0 : lat.startsWith('x') ? +lat.slice(1) : +lat;
    fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
    this.index = new Map();
    const idx = path.join(dir, 'index.jsonl');
    if (fs.existsSync(idx)) {
      for (const line of fs.readFileSync(idx, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); this.index.set(e.key, e); } catch (e) { /* a torn last line */ }
      }
    }
    this.indexFd = fs.openSync(idx, 'a');
    this.hostSem = new Map();
    this.liveSem = new Map();
    this.liveConc = liveConc;
    this.liveNext = new Map();   // host -> earliest next live start (politeness spacing for the small public tile servers)
    this.log = [];
    this.axes = {};      // Open-Meteo model -> valid_times, read off every served latest.json
    this.inflight = new Map();
  }

  sem(map, host, n) { if (!map.has(host)) map.set(host, new Sem(n)); return map.get(host); }

  key(method, url, range) { return crypto.createHash('sha1').update(`${method} ${normalizeUrl(url)} ${range || ''}`).digest('hex'); }

  noteAxes(url, body) {
    try {
      const u = new URL(url);
      // Only the manifest the app and the decoder read (no time_step query: the app's old preloader pings carry one, and a
      // ping recorded later can hold a NEWER run's manifest); the first one seen per model wins, as the app's own cache does.
      if (!u.hostname.includes('openmeteo') || !u.pathname.endsWith('/latest.json') || u.searchParams.has('time_step')) return;
      const model = u.pathname.split('/')[2];
      const j = JSON.parse(Buffer.from(body).toString('utf8'));
      if (Array.isArray(j.valid_times) && !this.axes[model]) this.axes[model] = j.valid_times;
    } catch (e) { /* not a manifest */ }
  }

  async record(route, req, key, url, range) {
    // Collapse concurrent misses for the same key into one live fetch.
    if (this.inflight.has(key)) return this.inflight.get(key);
    const host = new URL(url).hostname;
    const p = (async () => {
      // S3 gets a browser's six connections; RainViewer, IEM, DWD and nowCOAST get two and >= 150 ms between starts.
      const isS3 = /amazonaws\.com$/.test(host);
      const s = this.sem(this.liveSem, host, isS3 ? Math.max(this.liveConc, 6) : Math.min(this.liveConc, 2));
      await s.take();
      if (!isS3) {
        const wait = (this.liveNext.get(host) || 0) - Date.now();
        this.liveNext.set(host, Math.max(Date.now(), this.liveNext.get(host) || 0) + 150);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      const t0 = Date.now();
      try {
        const resp = await route.fetch({ timeout: 60000 });
        const body = await resp.body();
        const ms = Date.now() - t0;
        const headers = {};
        const h = resp.headers();
        for (const k of KEEP_HEADERS) if (h[k] != null) headers[k] = h[k];
        const e = { key, method: req.method(), url: normalizeUrl(url), range: range || null, status: resp.status(), headers, bytes: body.length, ms, at: new Date().toISOString() };
        fs.writeFileSync(path.join(this.dir, 'b', key + '.bin'), body);
        fs.writeSync(this.indexFd, JSON.stringify(e) + '\n');
        this.index.set(key, e);
        return e;
      } finally { s.give(); }
    })();
    this.inflight.set(key, p);
    try { return await p; } finally { this.inflight.delete(key); }
  }

  // Install on a page or context AFTER ab_lib's catch-all route (Playwright runs the newest matching route first).
  async install(target) {
    await target.route((u) => RASTER_HOSTS.test(u.hostname), async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,OPTIONS' } });
      }
      const range = req.headers().range || null;
      const key = this.key(method, url, range);
      const host = new URL(url).hostname;
      const tReq = Date.now();
      let e = this.index.get(key);
      let hit = !!e;
      if (!e) {
        if (this.mode === 'replay') {
          this.log.push({ t: tReq, host, url: normalizeUrl(url), range, bytes: 0, hit: false, refused: true, ms: 0 });
          return route.fulfill({ status: 504, headers: { 'access-control-allow-origin': '*' }, body: 'raster-lab replay miss' });
        }
        try { e = await this.record(route, req, key, url, range); } catch (err) {
          this.log.push({ t: tReq, host, url: normalizeUrl(url), range, bytes: 0, hit: false, error: String(err).slice(0, 120), ms: Date.now() - tReq });
          return route.abort('failed').catch(() => {});
        }
      }
      let body;
      try { body = fs.readFileSync(path.join(this.dir, 'b', e.key + '.bin')); } catch (err) { return route.abort('failed').catch(() => {}); }
      this.noteAxes(url, body);
      if (hit) {
        const slots = this.sem(this.hostSem, host, H1.test(host) ? 6 : 64);
        await slots.take();
        try { if (this.latScale > 0 && e.ms > 0) await new Promise((r) => setTimeout(r, Math.round(e.ms * this.latScale))); } finally { slots.give(); }
      }
      this.log.push({ t: tReq, done: Date.now(), host, url: e.url, range, bytes: e.bytes, hit, ms: Date.now() - tReq, status: e.status });
      const headers = { ...e.headers, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range, Content-Length, ETag, Accept-Ranges, Last-Modified' };
      // A GET's length comes from its body; a HEAD has none, and the .om reader sizes the file from the HEAD's Content-Length.
      if (method !== 'HEAD') delete headers['content-length'];
      return route.fulfill({ status: e.status, headers, body: method === 'HEAD' ? '' : body }).catch(() => {});
    });
  }

  // Requests whose start falls in [a, b) (wall clock).
  window(a, b) {
    const rows = this.log.filter((r) => r.t >= a && r.t < b);
    const byHost = {};
    for (const r of rows) {
      const h = (byHost[r.host] = byHost[r.host] || { n: 0, bytes: 0, live: 0 });
      h.n += 1; h.bytes += r.bytes || 0; if (!r.hit) h.live += 1;
    }
    return { n: rows.length, bytes: rows.reduce((s, r) => s + (r.bytes || 0), 0), live: rows.filter((r) => !r.hit).length, refused: rows.filter((r) => r.refused).length, byHost };
  }
}

module.exports = { RR, RASTER_HOSTS, normalizeUrl };
