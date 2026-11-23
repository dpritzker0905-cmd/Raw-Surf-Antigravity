// Local proxy: /api/weather/* -> synthetic backend (Authorization stripped); every other /api/* -> empty 200.
const http = require('http');
const up = parseInt(process.argv[2] || '4100', 10), port = parseInt(process.argv[3] || '4200', 10);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/api/weather/') || req.url.startsWith('/api/health')) {
    const h = { ...req.headers }; delete h.authorization; h.host = '127.0.0.1:' + up;
    const p = http.request({ host: '127.0.0.1', port: up, path: req.url, method: req.method, headers: h }, (r) => {
      res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res);
    });
    p.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
    req.pipe(p); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
  res.end(req.url.includes('spots') || req.url.includes('list') ? '[]' : '{}');
}).listen(port, () => console.log('proxy on', port, '->', up));
