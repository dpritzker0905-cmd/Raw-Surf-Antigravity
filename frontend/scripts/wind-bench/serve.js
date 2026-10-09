/**
 * Wind bench: the static server and the Chromium GPU flags shared by run.js and eye-run.js.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

function serveDir(root, port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
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
