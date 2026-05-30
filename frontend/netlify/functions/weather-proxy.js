/**
 * Netlify serverless proxy for Open-Meteo API.
 * 
 * Routes wind/marine/pressure grid POST requests through Netlify's IP,
 * bypassing client-side 429 rate limits. Caches responses for 30 min.
 * 
 * v4.2: Uses upstream POST (native Open-Meteo JSON body) instead of
 * converting to GET URLs, which caused 414 Request-URI Too Large with
 * large coordinate arrays (961+ points).
 * 
 * Usage from frontend:
 *   POST /api/weather-proxy
 *   Body: { type: "wind"|"marine"|"pressure", body: <original POST body> }
 */

// In-memory cache (persists across warm invocations)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCacheKey(type, body, event) {
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const sortedKeys = Object.keys(params).sort();
    const str = type + '_GET_' + sortedKeys.map(k => `${k}=${params[k]}`).join('&');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return `${type}_${hash}`;
  } else {
    const str = type + JSON.stringify(body);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return `${type}_${hash}`;
  }
}

// Target API URLs
const API_URLS = {
  wind: 'https://api.open-meteo.com/v1/forecast',
  pressure: 'https://api.open-meteo.com/v1/forecast',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
};

// GribStream IFS Wave API for EURO marine data
const GRIBSTREAM_URL = 'https://gribstream.com/api/v2/ifswave/timeseries';
const GRIBSTREAM_API_TOKEN = process.env.GRIBSTREAM_API_TOKEN || '';

// Map Open-Meteo variable names → GribStream variable selectors
const OM_TO_GRIBSTREAM_VARS = {
  wave_height: { name: 'swh', level: 'sfc', info: '' },
  wave_direction: { name: 'mwd', level: 'sfc', info: '' },
  wave_period: { name: 'mwp', level: 'sfc', info: '' },
  wave_peak_period: { name: 'pp1d', level: 'sfc', info: '' },
};

// Reverse map: GribStream response key → Open-Meteo variable name
const GRIBSTREAM_KEY_TO_OM = {
  'swh|sfc|': 'wave_height',
  'mwd|sfc|': 'wave_direction',
  'mwp|sfc|': 'wave_period',
  'pp1d|sfc|': 'wave_peak_period',
};

/**
 * Forward a POST request with JSON body directly to Open-Meteo.
 * This avoids the 414 Request-URI Too Large error that occurs when
 * large coordinate arrays are converted to GET query parameters.
 */
async function forwardAsUpstreamPost(targetUrl, body) {
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response;
}

/**
 * Fallback: chunk large requests into small GET requests.
 * Chunk size = 60 to keep URLs safely under 8KB.
 * Used only if upstream POST fails.
 */
async function chunkedGetFallback(targetUrl, body) {
  const lats = body.latitude;
  const lons = body.longitude;
  const CHUNK_SIZE = 60; // Safe for URL length limits (~60 coords * ~8 chars * 2 = ~960 bytes)
  const chunks = [];
  for (let i = 0; i < lats.length; i += CHUNK_SIZE) {
    chunks.push({
      latitude: lats.slice(i, i + CHUNK_SIZE),
      longitude: lons.slice(i, i + CHUNK_SIZE)
    });
  }

  console.log(`[weather-proxy] GET chunking fallback: ${chunks.length} chunks of ${CHUNK_SIZE}`);

  const chunkResults = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(body)) {
      if (key === 'latitude') {
        params.append(key, chunk.latitude.join(','));
      } else if (key === 'longitude') {
        params.append(key, chunk.longitude.join(','));
      } else if (Array.isArray(val)) {
        params.append(key, val.join(','));
      } else {
        params.append(key, String(val));
      }
    }

    const chunkUrl = `${targetUrl}?${params.toString()}`;
    console.log(`[weather-proxy] GET chunk ${index + 1}/${chunks.length} (${chunk.latitude.length} pts, URL ${chunkUrl.length} bytes)`);

    let chunkRes;
    let attempt = 0;
    const maxAttempts = 3;
    let delay = 200;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        chunkRes = await fetch(chunkUrl, { method: 'GET' });
        if (chunkRes.status === 429) {
          console.warn(`[weather-proxy] GET chunk ${index + 1} hit 429, aborting`);
          return { status: 429, data: null, error: 'Rate limit exceeded on GET chunk' };
        }
        if (chunkRes.ok || (chunkRes.status !== 502 && chunkRes.status !== 503 && chunkRes.status !== 504)) {
          break;
        }
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (!chunkRes || !chunkRes.ok) {
      const failStatus = chunkRes ? chunkRes.status : 502;
      return { status: failStatus, data: null, error: `Chunk ${index + 1} failed with ${failStatus}` };
    }

    const chunkData = await chunkRes.json();
    chunkResults.push(chunkData);

    // Rate limit buffer between chunks
    if (index < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 800));
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

  return { status: 200, data: mergedData, error: null };
}

/**
 * Forward a marine request to GribStream IFS Wave API.
 * Transforms Open-Meteo-shaped input into GribStream format,
 * then normalizes the response back to Open-Meteo shape.
 */
async function forwardToGribStream(body) {
  if (!GRIBSTREAM_API_TOKEN) {
    throw new Error('GRIBSTREAM_API_TOKEN not configured');
  }

  const lats = body.latitude || [];
  const lons = body.longitude || [];
  const forecastDays = body.forecast_days || 3;

  // Build coordinate array
  const coordinates = lats.map((lat, i) => ({
    lat: +lat,
    lon: +lons[i],
  }));

  // Time range
  const now = new Date();
  const fromTime = now.toISOString();
  const untilTime = new Date(now.getTime() + forecastDays * 24 * 3600000).toISOString();

  // Variable selectors
  const variables = Object.values(OM_TO_GRIBSTREAM_VARS);

  const gribBody = { fromTime, untilTime, coordinates, variables };

  console.log(`[weather-proxy] GribStream POST: ${coordinates.length} coords, ${forecastDays}d`);

  const response = await fetch(GRIBSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${GRIBSTREAM_API_TOKEN}`,
    },
    body: JSON.stringify(gribBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`GribStream HTTP ${response.status}: ${errText.substring(0, 200)}`);
  }

  const rows = await response.json();
  console.log(`[weather-proxy] GribStream response: ${rows.length} rows`);

  // Normalize: group rows by (lat, lon), build Open-Meteo shape
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.lat},${row.lon}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const results = [];
  for (const [key, coordRows] of grouped) {
    // Sort by forecasted_time ascending
    coordRows.sort((a, b) => a.forecasted_time.localeCompare(b.forecasted_time));

    const [lat, lon] = key.split(',').map(Number);
    const hourly = { time: [] };

    // Initialize arrays for each variable
    for (const omVar of Object.values(GRIBSTREAM_KEY_TO_OM)) {
      hourly[omVar] = [];
    }

    for (const row of coordRows) {
      // GribStream returns ISO timestamps like "2026-05-31T00:00:00Z"
      // Open-Meteo uses "2026-05-31T00:00" (no Z, no seconds)
      const t = row.forecasted_time;
      hourly.time.push(t ? t.replace(':00Z', '').replace('Z', '') : '');

      for (const [gsKey, omVar] of Object.entries(GRIBSTREAM_KEY_TO_OM)) {
        const val = row[gsKey];
        hourly[omVar].push(val != null ? val : null);
      }
    }

    results.push({
      latitude: lat,
      longitude: lon,
      generationtime_ms: 0,
      utc_offset_seconds: 0,
      timezone: 'GMT',
      timezone_abbreviation: 'GMT',
      elevation: 0,
      hourly_units: {
        time: 'iso8601',
        wave_height: 'm',
        wave_direction: '°',
        wave_period: 's',
        wave_peak_period: 's',
      },
      hourly,
    });
  }

  return results;
}

exports.handler = async function(event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'GET or POST only' })
    };
  }

  try {
    let type;
    let body = null;
    let queryParamsString = '';

    if (event.httpMethod === 'GET') {
      type = event.queryStringParameters?.type;
      if (!type) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing type parameter' })
        };
      }
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(event.queryStringParameters)) {
        if (key !== 'type') {
          params.append(key, val);
        }
      }
      queryParamsString = params.toString();
    } else {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing body' })
        };
      }
      const parsed = JSON.parse(event.body);
      type = parsed.type;
      body = parsed.body;
      if (!type || !body) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing type or body' })
        };
      }
    }

    // ========================================================================
    // GribStream routing for EURO marine data (must be before API_URLS check)
    // ========================================================================
    if (type === 'gribstream_marine' && event.httpMethod === 'POST' && body) {
      console.log(`[weather-proxy] Routing to GribStream for EURO marine`);
      const cacheKeyGS = getCacheKey('gribstream_marine', body, event);
      const cachedGS = cache.get(cacheKeyGS);
      if (cachedGS && Date.now() - cachedGS.timestamp < CACHE_TTL) {
        console.log(`[weather-proxy] GribStream cache HIT`);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'X-Cache-Age': String(Math.round((Date.now() - cachedGS.timestamp) / 1000)),
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(cachedGS.data)
        };
      }

      try {
        const gsData = await forwardToGribStream(body);
        cache.set(cacheKeyGS, { data: gsData, timestamp: Date.now() });
        if (cache.size > 100) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
        }
        console.log(`[weather-proxy] GribStream success: ${gsData.length} points`);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'MISS',
            'X-Source': 'GribStream',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(gsData)
        };
      } catch (gsErr) {
        console.error(`[weather-proxy] GribStream error:`, gsErr.message);
        return {
          statusCode: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'GribStream error', message: gsErr.message })
        };
      }
    }

    // Determine target URL
    let targetUrl;
    if (type === 'tiles') {
      const model = event.queryStringParameters?.model;
      if (!model) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing model for tiles' })
        };
      }
      targetUrl = `https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json`;
    } else {
      const base = API_URLS[type];
      if (!base) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: `Unknown type: ${type}` })
        };
      }
      targetUrl = base + (queryParamsString ? '?' + queryParamsString : '');
    }

    // Check cache
    const cacheKey = getCacheKey(type, body, event);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[weather-proxy] Cache HIT for ${type} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Age': String(Math.round((Date.now() - cached.timestamp) / 1000)),
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(cached.data)
      };
    }

    // ========================================================================
    // POST with coordinate arrays → use upstream POST (not GET translation!)
    // This is the critical fix for 414 Request-URI Too Large.
    // ========================================================================
    if (event.httpMethod === 'POST' && body && Array.isArray(body.latitude) && Array.isArray(body.longitude)) {
      const numPoints = body.latitude.length;
      console.log(`[weather-proxy] POST ${type}: ${numPoints} points, trying upstream POST first`);

      let apiRes;
      let data;

      // Strategy 1: Forward as upstream POST (no URL length issue)
      try {
        apiRes = await forwardAsUpstreamPost(targetUrl, body);

        if (apiRes.status === 429) {
          console.warn(`[weather-proxy] Upstream POST 429 for ${type}, will try chunked GET fallback`);
          // Fall through to chunked GET — don't return 429 immediately.
          // The chunked GET has 800ms inter-chunk delay designed for rate limit avoidance.
        }

        if (apiRes.ok) {
          data = await apiRes.json();
          console.log(`[weather-proxy] Upstream POST success for ${type}: ${numPoints} points`);
        } else {
          const errText = await apiRes.text().catch(() => 'unknown');
          console.warn(`[weather-proxy] Upstream POST failed (${apiRes.status}): ${errText.substring(0, 200)}`);
          // Fall through to GET chunking fallback
        }
      } catch (postErr) {
        console.warn(`[weather-proxy] Upstream POST error: ${postErr.message}`);
        // Fall through to GET chunking fallback
      }

      // Strategy 2: Chunked GET fallback (if POST failed)
      if (!data) {
        console.log(`[weather-proxy] Falling back to chunked GET for ${type}`);
        const result = await chunkedGetFallback(targetUrl, body);
        if (result.status === 429) {
          return {
            statusCode: 429,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Rate limit exceeded', statusCode: 429, isRateLimit: true })
          };
        }
        if (result.status !== 200 || !result.data) {
          return {
            statusCode: result.status || 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: result.error || 'Chunked GET failed', statusCode: result.status })
          };
        }
        data = result.data;
      }

      // Cache and return
      cache.set(cacheKey, { data, timestamp: Date.now() });
      if (cache.size > 100) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'MISS',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(data)
      };
    }

    // ========================================================================
    // Simple GET passthrough (single-point requests, tile metadata, etc.)
    // ========================================================================
    let apiRes;
    let attempt = 0;
    const maxAttempts = 3;
    let delay = 100;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        console.log(`[weather-proxy] Forwarding ${type} ${event.httpMethod} to ${targetUrl.substring(0, 120)}... (attempt ${attempt}/${maxAttempts})`);
        const fetchOptions = { method: event.httpMethod };
        if (event.httpMethod === 'POST' && body) {
          fetchOptions.headers = { 'Content-Type': 'application/json' };
          fetchOptions.body = JSON.stringify(body);
        }
        apiRes = await fetch(targetUrl, fetchOptions);

        if (apiRes.ok || (apiRes.status !== 502 && apiRes.status !== 503 && apiRes.status !== 504)) {
          break;
        }

        console.warn(`[weather-proxy] Attempt ${attempt} failed with status ${apiRes.status}. Retrying in ${delay}ms...`);
      } catch (fetchErr) {
        if (attempt >= maxAttempts) throw fetchErr;
        console.warn(`[weather-proxy] Attempt ${attempt} threw error: ${fetchErr.message}. Retrying in ${delay}ms...`);
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (!apiRes || !apiRes.ok) {
      const status = apiRes ? apiRes.status : 502;
      let errorText = 'Gateway Timeout / Connection Refused';
      try {
        if (apiRes) errorText = await apiRes.text();
      } catch (e) { /* ignore */ }

      console.error(`[weather-proxy] Open-Meteo error after ${attempt} attempts: ${status} ${errorText.substring(0, 200)}`);

      // Check if this is a wrapped rate limit
      if (status === 429) {
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Rate limit exceeded', statusCode: 429, isRateLimit: true })
        };
      }

      return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Open-Meteo Gateway Error',
          statusCode: status,
          isGatewayError: true,
          attempts: attempt,
          detail: errorText.substring(0, 500)
        })
      };
    }

    const data = await apiRes.json();

    // Cache the response
    cache.set(cacheKey, { data, timestamp: Date.now() });
    if (cache.size > 100) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
    }

    console.log(`[weather-proxy] Success: ${type}, cached as ${cacheKey}`);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error(`[weather-proxy] Error:`, err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Proxy error', message: err.message })
    };
  }
};
