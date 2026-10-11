/**
 * Wind bench: the static server and the Chromium GPU flags shared by run.js and eye-run.js.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

/**
 * `land`: what this run's server answers at /ne_50m_land.json, the file the engine's land mask fetches from the page's origin
 * (src/components/map/windLandMask.js). 'app' = the app's own Natural Earth file (the real basemaps); 'offline' = the offline basemap's
 * own coast (page/offline-coast.js); anything else, and the default, = 404: the fetch fails and every mark draws its land row.
 * It is answered by THIS server, never read from the shared out/ folder: a file left there by one runner would be served to the next
 * (independent review, 2026-10-11: the scanner's light and beach arms read a mask a map run had left behind).
 */
function serveDir(root, port, opts = {}) {
  const land = opts.land === 'app' || opts.land === 'offline' ? opts.land : 'none';
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'ne_50m_land.json') {
      if (land === 'none') { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      if (land === 'offline') res.end(JSON.stringify(require('./page/offline-coast').offlineLand()));
      else fs.createReadStream(path.join(__dirname, '..', '..', 'public', 'ne_50m_land.json')).pipe(res);
      return;
    }
    const file = path.resolve(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port || 0, '127.0.0.1', () => resolve(server)));
}

function gpuArgs(mode) {
  if (mode === 'swiftshader') return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const angle = { win32: 'd3d11', darwin: 'metal', linux: 'vulkan' }[process.platform] || 'default';
  return [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-gpu'];
}

module.exports = { serveDir, gpuArgs };
