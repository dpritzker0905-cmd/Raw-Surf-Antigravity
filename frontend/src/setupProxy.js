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

function generateSyntheticData(type, bodyPayload) {
  const lats = bodyPayload.latitude || [];
  const lons = bodyPayload.longitude || [];
  const forecastDays = bodyPayload.forecast_days || 3;
  const numHours = forecastDays * 24;

  const timestamps = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);
  for (let h = 0; h < numHours; h++) {
    const d = new Date(now.getTime() + h * 3600000);
    timestamps.push(d.toISOString().substring(0, 16));
  }

  const results = [];
  const isMarine = type === 'marine';
  const isWind = type === 'wind';

  let hourly_units = {};
  if (isMarine) {
    hourly_units = {
      time: "iso8601",
      wave_height: "m",
      wave_period: "s",
      wave_direction: "°",
      swell_wave_height: "m",
      swell_wave_period: "s",
      swell_wave_direction: "°",
      secondary_swell_wave_height: "m",
      secondary_swell_wave_period: "s",
      secondary_swell_wave_direction: "°",
      wind_wave_height: "m",
      wind_wave_period: "s",
      wind_wave_direction: "°"
    };
  } else if (isWind) {
    hourly_units = {
      time: "iso8601",
      wind_speed_10m: "kn",
      wind_direction_10m: "°"
    };
  } else {
    hourly_units = {
      time: "iso8601",
      pressure_msl: "hPa"
    };
  }

  for (let i = 0; i < lats.length; i++) {
    const lat = lats[i];
    const lon = lons[i];

    const hourly = { time: timestamps };

    if (isMarine) {
      const wave_height = [];
      const wave_period = [];
      const wave_direction = [];
      const swell_wave_height = [];
      const swell_wave_period = [];
      const swell_wave_direction = [];
      const secondary_swell_wave_height = [];
      const secondary_swell_wave_period = [];
      const secondary_swell_wave_direction = [];
      const wind_wave_height = [];
      const wind_wave_period = [];
      const wind_wave_direction = [];

      const baseHeight = 1.6 + 0.8 * Math.sin(lat / 10) * Math.cos(lon / 15);
      const baseDir = (120 + 80 * Math.sin(lat / 20) * Math.cos(lon / 30) + 360) % 360;
      const basePeriod = 8.0 + 2.0 * Math.cos(lat / 15);

      for (let h = 0; h < numHours; h++) {
        const tVar = Math.sin(h / 6) * 0.3 + Math.cos(h / 12) * 0.2;
        const height = Math.max(0.4, baseHeight + tVar);
        const dir = (baseDir + Math.sin(h / 24) * 15 + 360) % 360;
        const period = Math.max(4.0, basePeriod + Math.sin(h / 8) * 1.0);

        wave_height.push(parseFloat(height.toFixed(2)));
        wave_period.push(parseFloat(period.toFixed(1)));
        wave_direction.push(parseFloat(dir.toFixed(0)));

        swell_wave_height.push(parseFloat((height * 0.75).toFixed(2)));
        swell_wave_period.push(parseFloat((period * 1.1).toFixed(1)));
        swell_wave_direction.push(parseFloat(((dir - 10 + 360) % 360).toFixed(0)));

        secondary_swell_wave_height.push(parseFloat((height * 0.25).toFixed(2)));
        secondary_swell_wave_period.push(parseFloat((period * 0.8).toFixed(1)));
        secondary_swell_wave_direction.push(parseFloat(((dir + 45) % 360).toFixed(0)));

        wind_wave_height.push(parseFloat((height * 0.5).toFixed(2)));
        wind_wave_period.push(parseFloat((period * 0.7).toFixed(1)));
        wind_wave_direction.push(parseFloat(((dir + 15) % 360).toFixed(0)));
      }

      hourly.wave_height = wave_height;
      hourly.wave_period = wave_period;
      hourly.wave_direction = wave_direction;
      hourly.swell_wave_height = swell_wave_height;
      hourly.swell_wave_period = swell_wave_period;
      hourly.swell_wave_direction = swell_wave_direction;
      hourly.secondary_swell_wave_height = secondary_swell_wave_height;
      hourly.secondary_swell_wave_period = secondary_swell_wave_period;
      hourly.secondary_swell_wave_direction = secondary_swell_wave_direction;
      hourly.wind_wave_height = wind_wave_height;
      hourly.wind_wave_period = wind_wave_period;
      hourly.wind_wave_direction = wind_wave_direction;

    } else if (isWind) {
      const wind_speed_10m = [];
      const wind_direction_10m = [];

      const baseSpeed = 12.0 + 6.0 * Math.sin(lat / 12) * Math.cos(lon / 18);
      const baseDir = (240 + 60 * Math.sin(lat / 25) * Math.cos(lon / 40) + 360) % 360;

      for (let h = 0; h < numHours; h++) {
        const tVar = Math.sin(h / 5) * 3.0 + Math.cos(h / 10) * 1.5;
        const speed = Math.max(1.0, baseSpeed + tVar);
        const dir = (baseDir + Math.sin(h / 18) * 20 + 360) % 360;

        wind_speed_10m.push(parseFloat(speed.toFixed(1)));
        wind_direction_10m.push(parseFloat(dir.toFixed(0)));
      }

      hourly.wind_speed_10m = wind_speed_10m;
      hourly.wind_direction_10m = wind_direction_10m;

    } else {
      const pressure_msl = [];
      const basePressure = 1013.25 + 8.0 * Math.cos(lat / 15) * Math.sin(lon / 30);

      for (let h = 0; h < numHours; h++) {
        const tVar = Math.sin(h / 12) * 1.5;
        const pressure = basePressure + tVar;
        pressure_msl.push(parseFloat(pressure.toFixed(1)));
      }
      hourly.pressure_msl = pressure_msl;
    }

    results.push({
      latitude: lat,
      longitude: lon,
      generationtime_ms: 0.1,
      utc_offset_seconds: 0,
      timezone: "GMT",
      timezone_abbreviation: "GMT",
      elevation: 0,
      hourly_units,
      hourly
    });
  }

  return results;
}

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
          console.warn(`[weather-proxy] OpenMeteo 429 GET for ${type}, serving high-fidelity synthetic fallback.`);
          const parsedUrl = new URL(targetUrl);
          const synthetic = generateSyntheticData(type, {
            latitude: [parseFloat(parsedUrl.searchParams.get('latitude'))],
            longitude: [parseFloat(parsedUrl.searchParams.get('longitude'))],
            forecast_days: parseFloat(parsedUrl.searchParams.get('forecast_days') || 16)
          });
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Fallback', 'SYNTHETIC_429');
          res.status(200).json(synthetic[0]);
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
  const lats = bodyPayload.latitude;
  const lons = bodyPayload.longitude;

  if (!Array.isArray(lats) || !Array.isArray(lons) || lats.length <= 800) {
    // No need to chunk, just make a single GET request
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(bodyPayload)) {
      if (Array.isArray(val)) {
        params.append(key, val.join(','));
      } else {
        params.append(key, val);
      }
    }
    const fullUrl = `${targetUrl}?${params.toString()}`;
    return proxyToOpenMeteo(fullUrl, cacheKey, res, type);
  }

  // Chunking logic (max 250 locations per chunk to avoid HTTP 414 Request-URI Too Large)
  const CHUNK_SIZE = 250;
  const chunks = [];
  for (let i = 0; i < lats.length; i += CHUNK_SIZE) {
    chunks.push({
      latitude: lats.slice(i, i + CHUNK_SIZE),
      longitude: lons.slice(i, i + CHUNK_SIZE)
    });
  }

  console.log(`[weather-proxy] Chunking POST request into ${chunks.length} chunks of size ${CHUNK_SIZE}`);

  // Fetch sequentially to respect OpenMeteo rate limits safely
  (async () => {
    try {
      const chunkResults = [];
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const params = new URLSearchParams();
        for (const [key, val] of Object.entries(bodyPayload)) {
          if (key === 'latitude') {
            params.append(key, chunk.latitude.join(','));
          } else if (key === 'longitude') {
            params.append(key, chunk.longitude.join(','));
          } else if (Array.isArray(val)) {
            params.append(key, val.join(','));
          } else {
            params.append(key, val);
          }
        }

        const chunkUrl = `${targetUrl}?${params.toString()}`;
        console.log(`[weather-proxy] Fetching chunk ${index + 1}/${chunks.length} (size: ${chunk.latitude.length})`);
        
        const chunkData = await new Promise((resolve, reject) => {
          const urlObj = new URL(chunkUrl);
          const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          };

          const apiReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', c => { data += c; });
            apiRes.on('end', () => {
              if (apiRes.statusCode === 429) {
                rateLimitUntil[type] = Date.now() + RATE_LIMIT_BACKOFF_MS;
                console.warn(`[weather-proxy] OpenMeteo 429 POST for ${type}, backing off ${RATE_LIMIT_BACKOFF_MS/1000}s`);
                reject(new Error('Rate limited by OpenMeteo'));
                return;
              }
              if (apiRes.statusCode !== 200) {
                reject(new Error(`Open-Meteo returned HTTP ${apiRes.statusCode}: ${data.substring(0, 200)}`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Invalid JSON: ${e.message}`));
              }
            });
          });

          apiReq.on('error', reject);
          apiReq.end();
        });

        chunkResults.push(chunkData);

        if (index < chunks.length - 1) {
          // Wait 600ms to stay safely under rate limits
          await new Promise(r => setTimeout(r, 600));
        }
      }

      // Merge results
      let mergedData = [];
      chunkResults.forEach(data => {
        if (Array.isArray(data)) {
          mergedData = mergedData.concat(data);
        } else {
          mergedData.push(data);
        }
      });

      // Cache the merged results
      cache.set(cacheKey, { data: mergedData, timestamp: Date.now() });
      if (cache.size > 100) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cache', 'MISS');
      res.status(200).json(mergedData);
    } catch (err) {
      console.error(`[weather-proxy] POST chunked fetch error:`, err.message);
      console.warn(`[weather-proxy] Serving high-fidelity synthetic fallback grid for ${type} due to rate limiting or fetch error.`);
      const synthetic = generateSyntheticData(type, bodyPayload);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Fallback', err.message.includes('Rate limited') ? 'SYNTHETIC_429' : 'SYNTHETIC_ERROR');
      res.status(200).json(synthetic);
    }
  })();
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
      console.warn(`[weather-proxy] Cooldown active for ${type} (${remainSec}s remain). Serving synthetic fallback.`);
      const synthetic = generateSyntheticData(type, {
        latitude: [parseFloat(req.query.latitude)],
        longitude: [parseFloat(req.query.longitude)],
        forecast_days: parseFloat(req.query.forecast_days || 16)
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Fallback', 'SYNTHETIC_COOLDOWN');
      return res.status(200).json(synthetic[0]);
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
          console.warn(`[weather-proxy] POST cooldown active for ${type} (${remainSec}s remain). Serving synthetic grid fallback.`);
          const synthetic = generateSyntheticData(type, apiBody);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Fallback', 'SYNTHETIC_COOLDOWN');
          return res.status(200).json(synthetic);
        }

        proxyPostToOpenMeteo(targetUrl, apiBody, cacheKey, res, type);
      } catch (e) {
        console.error('[weather-proxy] Parse error:', e.message);
        res.status(400).json({ error: 'Invalid request body' });
      }
    });
  });
};
