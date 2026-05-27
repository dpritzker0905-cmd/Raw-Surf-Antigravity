/**
 * CRA Development Proxy — replaces the Netlify Functions weather-proxy.
 * 
 * Routes /api/weather-proxy requests (GET and POST) to OpenMeteo APIs server-side,
 * avoiding client-side IP rate limiting. In production, the Netlify function
 * handles this route; this file is only used in `npm start` / `craco start`.
 *
 * v3.13.1: Handles both GET (useOpenMeteoForecast single-point) and POST (marineController grid) requests.
 */
const https = require('https');

// Simple in-memory cache (mirrors Netlify function behavior)
const cache = new Map();
const CACHE_TTL_MS = 600_000; // 10 minutes — aggressive caching to stay within rate limits

// Server-side 429 tracking: prevent repeated upstream requests during rate limit window
const rateLimitUntil = {};  // { wind: timestamp, marine: timestamp }
const RATE_LIMIT_BACKOFF_MS = 300_000; // 5 min backoff after a 429

// Route to correct Open-Meteo API
const API_MAP = {
  wind:     'https://api.open-meteo.com/v1/forecast',
  marine:   'https://marine-api.open-meteo.com/v1/marine',
  pressure: 'https://api.open-meteo.com/v1/forecast'
};

function proxyToOpenMeteo(targetUrl, cacheKey, res, type) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        if (apiRes.statusCode === 429) {
          rateLimitUntil[type] = Date.now() + RATE_LIMIT_BACKOFF_MS;
          console.warn(`[weather-proxy] OpenMeteo 429 for ${type}, backing off ${RATE_LIMIT_BACKOFF_MS/1000}s`);
          res.status(429).json({ error: 'Rate limited by OpenMeteo' });
          return;
        }
        if (apiRes.statusCode !== 200) {
          console.error(`[weather-proxy] OpenMeteo ${apiRes.statusCode}: ${data.substring(0, 200)}`);
          res.status(apiRes.statusCode).send(data);
          return;
        }
        try {
          const jsonData = JSON.parse(data);
          cache.set(cacheKey, { data: jsonData, timestamp: Date.now() });
          // Evict old entries
          if (cache.size > 100) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
            for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
          }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'MISS');
          res.status(200).json(jsonData);
        } catch (e) {
          console.error(`[weather-proxy] JSON parse error:`, e.message);
          res.status(502).json({ error: 'Invalid JSON from OpenMeteo' });
        }
      });
    });

    apiReq.on('error', (err) => {
      console.error(`[weather-proxy] Request error:`, err.message);
      res.status(502).json({ error: err.message });
    });

    apiReq.end();
  });
}

function proxyPostToOpenMeteo(targetUrl, bodyPayload, cacheKey, res, type) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const apiPayload = JSON.stringify(bodyPayload);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(apiPayload),
        'Accept': 'application/json'
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        if (apiRes.statusCode === 429) {
          rateLimitUntil[type] = Date.now() + RATE_LIMIT_BACKOFF_MS;
          console.warn(`[weather-proxy] OpenMeteo 429 POST for ${type}, backing off ${RATE_LIMIT_BACKOFF_MS/1000}s`);
          res.status(429).json({ error: 'Rate limited by OpenMeteo' });
          return;
        }
        if (apiRes.statusCode !== 200) {
          console.error(`[weather-proxy] OpenMeteo ${apiRes.statusCode}: ${data.substring(0, 200)}`);
          res.status(apiRes.statusCode).send(data);
          return;
        }
        try {
          const jsonData = JSON.parse(data);
          cache.set(cacheKey, { data: jsonData, timestamp: Date.now() });
          if (cache.size > 100) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
            for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
          }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'MISS');
          res.status(200).json(jsonData);
        } catch (e) {
          console.error(`[weather-proxy] JSON parse error:`, e.message);
          res.status(502).json({ error: 'Invalid JSON from OpenMeteo' });
        }
      });
    });

    apiReq.on('error', (err) => {
      console.error(`[weather-proxy] POST error:`, err.message);
      res.status(502).json({ error: err.message });
    });

    apiReq.write(apiPayload);
    apiReq.end();
  });
}

module.exports = function(app) {
  // GET handler: useOpenMeteoForecast single-point requests
  // e.g., /api/weather-proxy?type=wind&latitude=28.4&longitude=-80.6&hourly=...
  app.get('/api/weather-proxy', (req, res) => {
    const type = req.query.type;
    if (!type || !API_MAP[type]) {
      return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    // Build the target URL by forwarding all query params except 'type'
    const params = new URLSearchParams(req.query);
    params.delete('type');
    const targetUrl = `${API_MAP[type]}?${params.toString()}`;

    const cacheKey = `GET_${type}_${params.toString().substring(0, 200)}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', Math.round((Date.now() - cached.timestamp) / 1000).toString());
      return res.status(200).json(cached.data);
    }

    // Server-side 429 backoff: don't hit upstream if we're in cooldown
    if (rateLimitUntil[type] && Date.now() < rateLimitUntil[type]) {
      const remainSec = Math.round((rateLimitUntil[type] - Date.now()) / 1000);
      return res.status(429).json({ error: `Server-side backoff: ${remainSec}s remaining` });
    }

    proxyToOpenMeteo(targetUrl, cacheKey, res, type);
  });

  // POST handler: marineController grid requests
  // Body: { type: 'marine'|'wind', body: { latitude: [...], longitude: [...], ... } }
  app.post('/api/weather-proxy', (req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const type = parsed.type;
        const apiBody = parsed.body;

        if (!type || !apiBody || !API_MAP[type]) {
          return res.status(400).json({ error: `Missing/unknown type: ${type}` });
        }

        const targetUrl = API_MAP[type];
        const cacheKey = `POST_${type}_${JSON.stringify(apiBody).substring(0, 200)}`;
        const cached = cache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age', Math.round((Date.now() - cached.timestamp) / 1000).toString());
          return res.status(200).json(cached.data);
        }

        // Server-side 429 backoff
        if (rateLimitUntil[type] && Date.now() < rateLimitUntil[type]) {
          const remainSec = Math.round((rateLimitUntil[type] - Date.now()) / 1000);
          return res.status(429).json({ error: `Server-side backoff: ${remainSec}s remaining` });
        }

        proxyPostToOpenMeteo(targetUrl, apiBody, cacheKey, res, type);
      } catch (e) {
        console.error('[weather-proxy] Parse error:', e.message);
        res.status(400).json({ error: 'Invalid request body' });
      }
    });
  });
};
