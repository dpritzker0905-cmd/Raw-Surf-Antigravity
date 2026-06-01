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

// Copernicus Marine backend URL (FastAPI on Render)
const BACKEND_API_URL = process.env.BACKEND_API_URL || '';

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
 * Forward a marine request to the Copernicus Marine backend (FastAPI on Render).
 * The backend handles authentication, data fetching from CMEMS, and returns
 * Open-Meteo-shaped JSON directly — no transformation needed here.
 */
async function forwardToCopernicus(body) {
  if (!BACKEND_API_URL) {
    throw new Error('BACKEND_API_URL not configured for Copernicus Marine');
  }

  const targetUrl = `${BACKEND_API_URL}/api/copernicus-marine`;
  console.log(`[weather-proxy] Copernicus POST: ${(body.latitude || []).length} coords → ${targetUrl}`);

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Copernicus backend HTTP ${response.status}: ${errText.substring(0, 300)}`);
  }

  const results = await response.json();
  console.log(`[weather-proxy] Copernicus success: ${Array.isArray(results) ? results.length : '?'} points`);
  return results;
}

exports.handler = async function(event, context) {
  const startTime = Date.now();
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
    // Copernicus Marine routing for EURO marine data (replaces GribStream)
    // ========================================================================
    if (type === 'copernicus_marine' && event.httpMethod === 'POST' && body) {
      console.log(`[weather-proxy] Routing to Copernicus for EURO marine`);
      const cacheKeyCM = getCacheKey('copernicus_marine', body, event);
      const cachedCM = cache.get(cacheKeyCM);
      if (cachedCM && Date.now() - cachedCM.timestamp < CACHE_TTL) {
        console.log(`[weather-proxy] Copernicus cache HIT`);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'X-Cache-Age': String(Math.round((Date.now() - cachedCM.timestamp) / 1000)),
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(cachedCM.data)
        };
      }

      try {
        const cmData = await forwardToCopernicus(body);
        cache.set(cacheKeyCM, { data: cmData, timestamp: Date.now() });
        if (cache.size > 100) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
        }
        console.log(`[weather-proxy] Copernicus success: ${Array.isArray(cmData) ? cmData.length : '?'} points`);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'MISS',
            'X-Source': 'Copernicus',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(cmData)
        };
      } catch (cmErr) {
        console.error(`[weather-proxy] Copernicus error:`, cmErr.message);
        const cmElapsedMs = Date.now() - startTime;
        return {
          statusCode: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Proxy-Type': 'copernicus_marine',
            'X-Upstream-Provider': 'copernicus',
            'X-Model': 'ecmwf_wam025',
            'X-Point-Count': String(body ? (body.latitude ? body.latitude.length : 0) : 0),
            'X-Hourly-Var-Count': String(body ? (body.hourly ? body.hourly.length : 0) : 0),
            'X-Forecast-Days': String(body ? body.forecast_days : 0),
            'X-Fallback-Used': 'false',
            'X-Cache-Hit': 'false',
            'X-Elapsed-Ms': String(cmElapsedMs),
            'X-Failure-Phase': 'copernicus_forward'
          },
          body: JSON.stringify({
            error: 'Copernicus Marine error',
            message: cmErr.message,
            proxyType: 'copernicus_marine',
            upstreamProvider: 'copernicus',
            'upstream provider': 'copernicus',
            model: 'ecmwf_wam025',
            pointCount: body ? (body.latitude ? body.latitude.length : 0) : 0,
            hourlyVarCount: body ? (body.hourly ? body.hourly.length : 0) : 0,
            forecastDays: body ? body.forecast_days : 0,
            fallbackUsed: false,
            cacheHit: false,
            elapsedMs: cmElapsedMs,
            failurePhase: 'copernicus_forward'
          })
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

      const startTime = Date.now();
      let fallbackUsed = false;
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
        fallbackUsed = true;
        console.log(`[weather-proxy] Falling back to chunked GET for ${type}`);
        const result = await chunkedGetFallback(targetUrl, body);
        if (result.status === 429) {
          // v7.6: Return clean 429 — frontend has adaptive cooldown + auto-retry
          // (Removed v7.5 reduced-grid retry that caused 120-vs-729 mismatch)
          const elapsedMs = Date.now() - startTime;
          console.log(`[weather-proxy-diag] 429 final | model=${body.models?.[0] || 'unknown'} pts=${numPoints} elapsed=${elapsedMs}ms`);
          return {
            statusCode: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-Rate-Limited': 'true',
              'X-Points-Attempted': String(numPoints),
              'X-Proxy-Type': type,
              'X-Upstream-Provider': 'open-meteo',
              'X-Model': body.models?.[0] || 'unknown',
              'X-Point-Count': String(numPoints),
              'X-Hourly-Var-Count': String(body.hourly ? body.hourly.length : 0),
              'X-Forecast-Days': String(body.forecast_days),
              'X-Fallback-Used': 'true',
              'X-Cache-Hit': 'false',
              'X-Elapsed-Ms': String(elapsedMs),
              'X-Failure-Phase': 'chunked_get'
            },
            body: JSON.stringify({
              error: 'Rate limit exceeded',
              statusCode: 429,
              isRateLimit: true,
              pointsAttempted: numPoints,
              elapsedMs,
              proxyType: type,
              upstreamProvider: 'open-meteo',
              'upstream provider': 'open-meteo',
              model: body.models?.[0] || 'unknown',
              pointCount: numPoints,
              hourlyVarCount: body.hourly ? body.hourly.length : 0,
              forecastDays: body.forecast_days,
              fallbackUsed: true,
              cacheHit: false,
              failurePhase: 'chunked_get'
            })
          };
        }
        if (result.status !== 200 || !result.data) {
          const elapsedMs = Date.now() - startTime;
          const failStatus = result.status || 502;
          return {
            statusCode: failStatus,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-Proxy-Type': type,
              'X-Upstream-Provider': 'open-meteo',
              'X-Model': body.models?.[0] || 'unknown',
              'X-Point-Count': String(numPoints),
              'X-Hourly-Var-Count': String(body.hourly ? body.hourly.length : 0),
              'X-Forecast-Days': String(body.forecast_days),
              'X-Fallback-Used': 'true',
              'X-Cache-Hit': 'false',
              'X-Elapsed-Ms': String(elapsedMs),
              'X-Failure-Phase': 'chunked_get'
            },
            body: JSON.stringify({
              error: result.error || 'Chunked GET failed',
              statusCode: failStatus,
              proxyType: type,
              upstreamProvider: 'open-meteo',
              'upstream provider': 'open-meteo',
              model: body.models?.[0] || 'unknown',
              pointCount: numPoints,
              hourlyVarCount: body.hourly ? body.hourly.length : 0,
              forecastDays: body.forecast_days,
              fallbackUsed: true,
              cacheHit: false,
              elapsedMs,
              failurePhase: 'chunked_get'
            })
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

      const elapsedMs = Date.now() - startTime;
      console.log(`[weather-proxy-diag] model=${body.models?.[0] || 'unknown'} pointCount=${numPoints} forecastDays=${body.forecast_days || 'unknown'} hourlyVarCount=${body.hourly?.length || 0} upstreamStatus=${apiRes?.status || 'unknown'} fallbackUsed=${fallbackUsed} elapsedMs=${elapsedMs} finalStatus=200`);

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

      const elapsedMs = Date.now() - startTime;
      const ptsCount = event.queryStringParameters?.latitude ? event.queryStringParameters.latitude.split(',').length : 1;
      const hourlyCount = event.queryStringParameters?.hourly ? event.queryStringParameters.hourly.split(',').length : 0;
      const fDays = parseFloat(event.queryStringParameters?.forecast_days || 16);

      const resHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Type': type || 'unknown',
        'X-Upstream-Provider': 'open-meteo',
        'X-Model': event.queryStringParameters?.models || 'unknown',
        'X-Point-Count': String(ptsCount),
        'X-Hourly-Var-Count': String(hourlyCount),
        'X-Forecast-Days': String(fDays),
        'X-Fallback-Used': 'false',
        'X-Cache-Hit': 'false',
        'X-Elapsed-Ms': String(elapsedMs),
        'X-Failure-Phase': 'upstream_get'
      };

      const resBody = {
        error: status === 429 ? 'Rate limit exceeded' : 'Open-Meteo Gateway Error',
        statusCode: status,
        isRateLimit: status === 429,
        isGatewayError: status !== 429,
        attempts: attempt,
        detail: errorText.substring(0, 500),
        proxyType: type || 'unknown',
        upstreamProvider: 'open-meteo',
        'upstream provider': 'open-meteo',
        model: event.queryStringParameters?.models || 'unknown',
        pointCount: ptsCount,
        hourlyVarCount: hourlyCount,
        forecastDays: fDays,
        fallbackUsed: false,
        cacheHit: false,
        elapsedMs,
        failurePhase: 'upstream_get'
      };

      return {
        statusCode: status,
        headers: resHeaders,
        body: JSON.stringify(resBody)
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
    const elapsedMs = Date.now() - startTime;
    const isCopernicus = type === 'copernicus_marine' || (event.body && event.body.includes('copernicus_marine'));
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Type': type || 'unknown',
        'X-Upstream-Provider': isCopernicus ? 'copernicus' : 'open-meteo',
        'X-Model': 'unknown',
        'X-Point-Count': '0',
        'X-Hourly-Var-Count': '0',
        'X-Forecast-Days': '0',
        'X-Fallback-Used': 'false',
        'X-Cache-Hit': 'false',
        'X-Elapsed-Ms': String(elapsedMs),
        'X-Failure-Phase': 'unhandled_exception'
      },
      body: JSON.stringify({
        error: 'Proxy error',
        message: err.message,
        statusCode: 500,
        proxyType: type || 'unknown',
        upstreamProvider: isCopernicus ? 'copernicus' : 'open-meteo',
        'upstream provider': isCopernicus ? 'copernicus' : 'open-meteo',
        model: 'unknown',
        pointCount: 0,
        hourlyVarCount: 0,
        forecastDays: 0,
        fallbackUsed: false,
        cacheHit: false,
        elapsedMs,
        failurePhase: 'unhandled_exception'
      })
    };
  }
};
