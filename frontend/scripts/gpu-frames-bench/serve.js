// GPU FRAMES BENCH: the local server. Serves the bench page, its worker and a directory of gzipped RSWF v1 frames, and
// collects results the page POSTs back, so ANY browser (desktop Chrome / Edge / Firefox, or a phone on the same Wi-Fi)
// can run the bench by opening one URL. No dependencies. Never touches the live backend.
//
//   node frontend/scripts/gpu-frames-bench/serve.js --frames <dir> [--port 4290] [--out <dir>] [--latency 0] [--host 127.0.0.1]
//
// Headers: frames are served exactly as the weather-frames bucket serves them (gzipped bytes, NO Content-Encoding, so
// the page must check the 1f 8b magic itself) with Cache-Control immutable; the page is cross-origin isolated
// (COOP same-origin + COEP require-corp) so performance.measureUserAgentSpecificMemory() works where the browser has it.
// --latency N delays every frame response by N ms (a CDN round trip); ?lat=N on one request overrides it.
// --host 0.0.0.0 exposes the bench on the LAN for a phone: open http://<this PC's LAN IP>:<port>/ there. A LAN page is
// not a secure context, so navigator.deviceMemory and the memory API are missing there (the report says so).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};
const PORT = +arg('port', 4290);
const HOST = arg('host', '127.0.0.1');
const FRAMES = path.resolve(arg('frames', path.join(__dirname, 'frames')));
const OUT = path.resolve(arg('out', path.join(__dirname, 'out')));
const LATENCY = +arg('latency', 0);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.bin': 'application/octet-stream' };

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && u.pathname === '/results') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(OUT, { recursive: true });
      let label = 'run';
      try { label = (JSON.parse(Buffer.concat(chunks).toString('utf8')).label || 'run').replace(/[^A-Za-z0-9_.-]/g, '_'); } catch (e) { /* keep */ }
      const file = path.join(OUT, `${label}-${Date.now()}.json`);
      fs.writeFileSync(file, Buffer.concat(chunks));
      console.log('results ->', file);
      send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    });
    return;
  }
  if (u.pathname.startsWith('/frames/')) {
    const name = path.basename(decodeURIComponent(u.pathname.slice('/frames/'.length)));
    const file = path.join(FRAMES, name);
    if (!file.startsWith(FRAMES) || !fs.existsSync(file)) return send(res, 404, 'no frame', { 'Content-Type': 'text/plain' });
    const body = fs.readFileSync(file);
    const lat = u.searchParams.has('lat') ? +u.searchParams.get('lat') : LATENCY;
    const go = () => send(res, 200, body, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': name.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Length': body.length,
    });
    return lat > 0 ? setTimeout(go, lat) : go();
  }
  const rel = u.pathname === '/' ? 'bench.html' : u.pathname.slice(1);
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
  send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
});

server.listen(PORT, HOST, () => console.log(`gpu-frames-bench on http://${HOST}:${PORT}/  frames=${FRAMES}  out=${OUT}`));
module.exports = server;
