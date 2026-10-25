// Minimal static SPA server (no deps). Serves a CRA build with history fallback.
// Usage: node serve_spa.js <buildDir> <port>
// Content-Length is always set from the file size (a Python http.server run truncated transfers earlier).
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'build');
const port = parseInt(process.argv[3] || '3100', 10);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function send(res, file) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file);
    // /api/* is never a static file: answer 404 so the app's own failure paths run
    if (urlPath.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no local api'); }
    return send(res, path.join(root, 'index.html'));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
