// Offline mock backend (127.0.0.1:8765) + static build server (127.0.0.1:3000). Never the live box.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeSeriesBody } from './fixture.mjs';
const BUILD = process.argv[2];
const LOG = process.argv[3];
const H = 3600e3;
const SPOT = { id: 'spot-1', name: 'Fixture Point', region: 'San Diego County', country: 'USA', latitude: 33.38, longitude: -117.59,
  wave_height_ft: 3.2, current_conditions: { label: 'Waist High', wave_height_ft: 3.2, wave_period: 12, wave_direction: 286 } };
const ROWS = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.now() + i * 24 * H).toISOString().slice(0, 10),
  wave_height_max: 3 + (i % 4), wave_height_min: 2, label: 'Waist High', wave_period: 12, wind_speed: 8, rating: 'fair' }));
const seen = new Map();
function body(p, q) {
  if (p.startsWith('/api/weather/spot-series/')) {
    const tier = q.get('subscription_tier') || 'free';
    const premium = !/^(free|guest|tier_1)$/.test(tier);
    return [200, makeSeriesBody({ nowMs: Date.now(), hours: premium ? 336 : 72, tier, model: q.get('model') || 'GFS' })];
  }
  if (p.startsWith('/api/explore/spot-details/')) return [200, { ...SPOT, forecast: ROWS }];
  if (p === '/api/surf-spots') return [200, [SPOT]];
  if (p.startsWith('/api/conditions/forecast/')) return [200, { forecast: ROWS, days: ROWS }];
  if (p.startsWith('/api/conditions/')) return [200, { spot_id: 'spot-1', wave_height_ft: 3.2, label: 'Waist High', wave_period: 12, wave_direction: 286, wind_speed: 6, wind_direction: 45 }];
  if (p.startsWith('/api/tides/')) return [200, { station: 'Fixture', predictions: [] }];
  if (p === '/api/weather/capabilities') return [200, ['GFS','EURO','ICON'].flatMap((m) => [['marine','waves'],['marine','swell'],['wind','wind'],['weather','temperature']].map(([d,l]) => ({ model: m, domain: d, layer: l, supports_grid: true, supports_point: true, max_forecast_hours: m === 'GFS' ? 384 : 336 })))];
  if (p.startsWith('/api/compliance/tos-status/')) return [200, { acknowledged: true }];
  if (/bookings/.test(p)) return [200, []];
  if (p === '/api/health') return [200, { status: 'ok' }];
  if (/s$|list|history|reports|feed|photographers|friends|alerts|notifications/.test(p)) return [200, []];
  return [200, {}];
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const [code, b] = body(u.pathname, u.searchParams);
  seen.set(u.pathname, (seen.get(u.pathname) || 0) + 1);
  fs.writeFileSync(LOG, JSON.stringify(Object.fromEntries(seen), null, 1));
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(b));
}).listen(8765, '127.0.0.1');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let f = path.join(BUILD, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(BUILD, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(3000, '127.0.0.1');
console.log('mock up');
