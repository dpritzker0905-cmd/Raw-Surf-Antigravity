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

// In-memory cache and circuit breakers (persists across warm container invocations)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const RESPONSE_SIZE_LIMIT = 6.5 * 1024 * 1024; // 6.5 MB budget

function estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays) {
  if (type === 'tiles') return 50000;
  const timeBytes = forecastDays * 24 * 25;
  const varBytes = hourlyVarCount * forecastDays * 24 * 8;
  const metadataBytes = 1500;
  return pointCount * (timeBytes + varBytes + metadataBytes);
}

function makeResponseTooLargeResponse(estimatedBytes, actualBytes, pointCount, hourlyVarCount, forecastDays) {
  console.warn(`[weather-proxy] Response payload size ${actualBytes} bytes exceeds 4.5MB budget! Preventing return.`);
  return {
    statusCode: 413,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Failure-Phase': 'response_too_large_prevented',
      'X-Estimated-Response-Bytes': String(estimatedBytes),
      'X-Actual-Response-Bytes': String(actualBytes)
    },
    body: JSON.stringify({
      error: 'Response size too large prevented',
      estimatedBytes,
      actualBytes,
      pointCount,
      hourlyVarCount,
      forecastDays,
      failurePhase: 'response_too_large_prevented'
    })
  };
}

const openMeteoCircuitUntil = new Map();
const copernicusCircuitUntil = new Map();

function getPointCountBucket(pointCount) {
  if (pointCount === 1) return 'exact';
  if (pointCount <= 60) return 'small';
  return 'large';
}

function getLayerFamily(hourly, type) {
  if (type === 'wind') return 'wind';
  if (type === 'pressure') return 'pressure';
  if (!hourly) return 'generic';
  const hourlyStr = Array.isArray(hourly) ? hourly.join(',') : String(hourly);
  if (hourlyStr.includes('secondary_swell_wave_height')) return 'swell_2';
  if (hourlyStr.includes('swell_wave_height')) return 'swell_1';
  if (hourlyStr.includes('wind_wave_height')) return 'wind_waves';
  if (hourlyStr.includes('wave_height')) return 'waves';
  return 'combined';
}

function getCircuitKey(provider, type, model, pointCount, hourly) {
  const gridOrExact = pointCount > 1 ? 'grid' : 'exact';
  const pointCountBucket = getPointCountBucket(pointCount);
  const layerFamily = getLayerFamily(hourly, type);
  return `${provider}_${type}_${model}_${gridOrExact}_${layerFamily}_${pointCountBucket}`;
}

function isCircuitOpen(provider, type, model, pointCount, hourly) {
  // Grid/batch requests (pointCount > 1) bypass the circuit breaker to allow backend backoff/retry/delay logic
  if (pointCount > 1) return false;
  const circuitKey = getCircuitKey(provider, type, model, pointCount, hourly);
  const circuitUntilMap = provider === 'copernicus' ? copernicusCircuitUntil : openMeteoCircuitUntil;
  const until = circuitUntilMap.get(circuitKey) || 0;
  return until > Date.now();
}

function openCircuit(provider, type, model, pointCount, hourly, status) {
  const circuitKey = getCircuitKey(provider, type, model, pointCount, hourly);
  const circuitUntilMap = provider === 'copernicus' ? copernicusCircuitUntil : openMeteoCircuitUntil;
  
  let duration = 45000; // default 45s for Open-Meteo 502/503/504
  if (status === 429) {
    duration = 90000; // 90s for Open-Meteo 429
  } else if (provider === 'copernicus') {
    duration = 120000; // 120s for Copernicus 502/504
  }
  
  circuitUntilMap.set(circuitKey, Date.now() + duration);
  console.warn(`[weather-proxy] Circuit OPENED for key=${circuitKey} duration=${duration}ms status=${status}`);
}

function getCircuitRemainingMs(provider, type, model, pointCount, hourly) {
  const circuitKey = getCircuitKey(provider, type, model, pointCount, hourly);
  const circuitUntilMap = provider === 'copernicus' ? copernicusCircuitUntil : openMeteoCircuitUntil;
  const until = circuitUntilMap.get(circuitKey) || 0;
  return Math.max(0, until - Date.now());
}

function validateCacheShape(cachedData) {
  if (!cachedData) return null;
  const item = Array.isArray(cachedData) ? cachedData[0] : cachedData;
  if (!item) return null;
  
  if (item.hourly && Object.keys(item.hourly).length > 0) {
    const firstKey = Object.keys(item.hourly)[0];
    if (Array.isArray(item.hourly[firstKey]) && item.hourly[firstKey].length > 0) {
      return 'hourly';
    }
  }
  if (item.vectors && Array.isArray(item.vectors) && item.vectors.length > 0) {
    return 'grid';
  }
  if (item.results) {
    return 'results';
  }
  if (Object.keys(item).length > 0) {
    return 'unknown';
  }
  return null;
}

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
    const ptCount = body.latitude ? body.latitude.length : 1;
    const maxAttempts = ptCount > 1 ? 1 : 3; // Grid requests get only 1 attempt
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

  let type = 'unknown';
  try {
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
    // Unified Request Parameter Extraction
    // ========================================================================
    const cacheKey = getCacheKey(type, body, event);
    const isCopernicus = type === 'copernicus_marine' || (event.body && event.body.includes('copernicus_marine'));
    const provider = isCopernicus ? 'copernicus' : 'open-meteo';

    let pointCount = 1;
    if (body) {
      if (Array.isArray(body.latitude)) {
        pointCount = body.latitude.length;
      }
    } else if (event.queryStringParameters?.latitude) {
      pointCount = event.queryStringParameters.latitude.split(',').length;
    }

    let model = 'unknown';
    if (body) {
      model = (body.models && body.models[0]) || 'unknown';
    } else if (event.queryStringParameters?.models) {
      model = event.queryStringParameters.models;
    }

    let hourly = null;
    if (body) {
      hourly = body.hourly || null;
    } else if (event.queryStringParameters?.hourly) {
      hourly = event.queryStringParameters.hourly;
    }

    let forecastDays = 7;
    if (body) {
      forecastDays = body.forecast_days || body.forecastDays || 7;
    } else if (event.queryStringParameters) {
      const qDays = event.queryStringParameters.forecast_days || event.queryStringParameters.forecastDays;
      if (qDays) forecastDays = parseInt(qDays, 10);
    }

    let hourlyVarCount = 0;
    if (hourly) {
      if (Array.isArray(hourly)) {
        hourlyVarCount = hourly.length;
      } else if (typeof hourly === 'string') {
        hourlyVarCount = hourly.split(',').filter(Boolean).length;
      }
    }

    const estimatedBytes = estimateRequestCost(type, model, pointCount, hourlyVarCount, forecastDays);

    const cached = cache.get(cacheKey);

    // ========================================================================
    // Unified Failure and Stale Cache Response Handler
    // ========================================================================
    const handleFailure = async (errStatus, failurePhase, errDetail = '') => {
      openCircuit(provider, type, model, pointCount, hourly, errStatus);
      const remainingMs = getCircuitRemainingMs(provider, type, model, pointCount, hourly);

      // Stale cache structural recovery
      const staleShape = cached ? validateCacheShape(cached.data) : null;
      if (cached && staleShape) {
        const ageMs = Date.now() - cached.timestamp;
        const actualBytes = JSON.stringify(cached.data).length;

        if (actualBytes > RESPONSE_SIZE_LIMIT) {
          console.warn(`[weather-proxy] Stale cache payload size ${actualBytes} bytes exceeds 4.5MB budget! Preventing return.`);
          return {
            statusCode: 413,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-Failure-Phase': 'stale_cache_too_large',
              'X-Estimated-Response-Bytes': String(estimatedBytes),
              'X-Actual-Response-Bytes': String(actualBytes),
              'X-Circuit-Open': 'true',
              'X-Circuit-Remaining-Ms': String(remainingMs)
            },
            body: JSON.stringify({
              error: 'Stale cache size limit exceeded',
              estimatedBytes,
              actualBytes,
              pointCount,
              hourlyVarCount,
              forecastDays,
              failurePhase: 'stale_cache_too_large'
            })
          };
        }

        console.log(`[weather-proxy] Upstream failed (${errStatus}): serving recovered STALE cache for key=${cacheKey} (est: ${estimatedBytes}B, actual: ${actualBytes}B)`);

        const isArray = Array.isArray(cached.data);
        const payloadBody = isArray
          ? JSON.stringify(cached.data)
          : JSON.stringify({
              ...cached.data,
              __stale_telemetry: {
                stale: true,
                staleReason: 'upstream_fetch_failed',
                ageMs,
                originalCacheKey: cacheKey,
                shape: staleShape,
                failurePhase,
                errorDetail: errDetail.substring(0, 150),
                circuitRemainingMs: remainingMs
              }
            });

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'STALE',
            'X-Stale-Reason': 'upstream_fetch_failed',
            'X-Stale-Age-Ms': String(ageMs),
            'X-Stale-Original-Cache-Key': cacheKey,
            'X-Stale-Shape': staleShape,
            'X-Failure-Phase': failurePhase,
            'X-Circuit-Open': 'true',
            'X-Circuit-Remaining-Ms': String(remainingMs),
            'X-Estimated-Response-Bytes': String(estimatedBytes),
            'X-Actual-Response-Bytes': String(actualBytes),
            'Access-Control-Allow-Origin': '*',
          },
          body: payloadBody
        };
      }

      console.warn(`[weather-proxy] Upstream failed (${errStatus}): no cache to serve for key=${cacheKey}`);
      const elapsedMs = Date.now() - startTime;
      return {
        statusCode: errStatus,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Proxy-Type': type || 'unknown',
          'X-Upstream-Provider': provider,
          'X-Model': model,
          'X-Point-Count': String(pointCount),
          'X-Hourly-Var-Count': String(hourly ? (Array.isArray(hourly) ? hourly.length : hourly.split(',').length) : 0),
          'X-Forecast-Days': String(body ? body.forecast_days : 0),
          'X-Fallback-Used': 'false',
          'X-Cache-Hit': 'false',
          'X-Elapsed-Ms': String(elapsedMs),
          'X-Failure-Phase': failurePhase,
          'X-Circuit-Open': 'true',
          'X-Circuit-Remaining-Ms': String(remainingMs)
        },
        body: JSON.stringify({
          error: errStatus === 429 ? 'Rate limit exceeded' : 'Upstream gateway error',
          statusCode: errStatus,
          isRateLimit: errStatus === 429,
          detail: errDetail.substring(0, 500),
          proxyType: type || 'unknown',
          upstreamProvider: provider,
          'upstream provider': provider,
          model,
          pointCount,
          hourlyVarCount: hourly ? (Array.isArray(hourly) ? hourly.length : hourly.split(',').length) : 0,
          forecastDays: body ? body.forecast_days : 0,
          fallbackUsed: false,
          cacheHit: false,
          elapsedMs,
          failurePhase,
          circuitRemainingMs: remainingMs
        })
      };
    };

    // ========================================================================
    // Response Size Preflight Budget Guard
    // ========================================================================
    if (estimatedBytes > RESPONSE_SIZE_LIMIT) {
      console.warn(`[weather-proxy] Preflight rejected: estimated cost ${estimatedBytes} bytes exceeds ${RESPONSE_SIZE_LIMIT} limit.`);
      return {
        statusCode: 413,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Failure-Phase': 'response_too_large_prevented',
          'X-Estimated-Response-Bytes': String(estimatedBytes)
        },
        body: JSON.stringify({
          error: "Response size too large prevented",
          estimatedBytes,
          pointCount,
          hourlyVarCount,
          forecastDays,
          failurePhase: "response_too_large_prevented"
        })
      };
    }

    // ========================================================================
    // 1. Check Fresh Cache (HIT)
    // ========================================================================
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[weather-proxy] Fresh Cache HIT for key=${cacheKey}`);
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
    // 2. Check Circuit-Open State
    // ========================================================================
    if (isCircuitOpen(provider, type, model, pointCount, hourly)) {
      const remainingMs = getCircuitRemainingMs(provider, type, model, pointCount, hourly);
      const staleShape = cached ? validateCacheShape(cached.data) : null;
      if (cached && staleShape) {
        const ageMs = Date.now() - cached.timestamp;
        const actualBytes = JSON.stringify(cached.data).length;

        if (actualBytes > RESPONSE_SIZE_LIMIT) {
          console.warn(`[weather-proxy] Stale cache payload size ${actualBytes} bytes exceeds 4.5MB budget! Preventing return.`);
          return {
            statusCode: 413,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-Failure-Phase': 'stale_cache_too_large',
              'X-Estimated-Response-Bytes': String(estimatedBytes),
              'X-Actual-Response-Bytes': String(actualBytes),
              'X-Circuit-Open': 'true',
              'X-Circuit-Remaining-Ms': String(remainingMs)
            },
            body: JSON.stringify({
              error: 'Stale cache size limit exceeded',
              estimatedBytes,
              actualBytes,
              pointCount,
              hourlyVarCount,
              forecastDays,
              failurePhase: 'stale_cache_too_large'
            })
          };
        }

        console.log(`[weather-proxy] Circuit OPEN: serving STALE cache for key=${cacheKey} (est: ${estimatedBytes}B, actual: ${actualBytes}B)`);
        
        const isArray = Array.isArray(cached.data);
        const payloadBody = isArray
          ? JSON.stringify(cached.data)
          : JSON.stringify({
              ...cached.data,
              __stale_telemetry: {
                stale: true,
                staleReason: 'upstream_circuit_open',
                ageMs,
                originalCacheKey: cacheKey,
                shape: staleShape,
                circuitRemainingMs: remainingMs
              }
            });

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'STALE',
            'X-Stale-Reason': 'upstream_circuit_open',
            'X-Circuit-Open': 'true',
            'X-Circuit-Remaining-Ms': String(remainingMs),
            'X-Stale-Age-Ms': String(ageMs),
            'X-Stale-Original-Cache-Key': cacheKey,
            'X-Stale-Shape': staleShape,
            'X-Estimated-Response-Bytes': String(estimatedBytes),
            'X-Actual-Response-Bytes': String(actualBytes),
            'Access-Control-Allow-Origin': '*',
          },
          body: payloadBody
        };
      }

      console.warn(`[weather-proxy] Circuit OPEN: blocking upstream and no cache for key=${cacheKey}`);
      const errStatus = provider === 'copernicus' ? 502 : 429;
      return {
        statusCode: errStatus,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Circuit-Open': 'true',
          'X-Circuit-Remaining-Ms': String(remainingMs),
          'X-Failure-Phase': 'circuit_open'
        },
        body: JSON.stringify({
          error: provider === 'copernicus' ? 'Copernicus Circuit Open' : 'Open-Meteo Circuit Open',
          statusCode: errStatus,
          isCircuitOpen: true,
          circuitRemainingMs: remainingMs,
          failurePhase: 'circuit_open'
        })
      };
    }

    // ========================================================================
    // 3. Routing and Upstream Execution
    // ========================================================================

    // A. Copernicus Marine route (EURO marine)
    if (type === 'copernicus_marine' && event.httpMethod === 'POST' && body) {
      console.log(`[weather-proxy] Routing to Copernicus for EURO marine`);
      try {
        const cmData = await forwardToCopernicus(body);
        const actualBytes = JSON.stringify(cmData).length;
        console.log(`[weather-proxy] Copernicus success: ${Array.isArray(cmData) ? cmData.length : '?'} points (est: ${estimatedBytes}B, actual: ${actualBytes}B)`);
        
        if (actualBytes > RESPONSE_SIZE_LIMIT) {
          return makeResponseTooLargeResponse(estimatedBytes, actualBytes, pointCount, hourlyVarCount, forecastDays);
        }

        cache.set(cacheKey, { data: cmData, timestamp: Date.now() });
        if (cache.size > 100) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < 20; i++) cache.delete(oldest[i][0]);
        }
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'MISS',
            'X-Source': 'Copernicus',
            'X-Estimated-Response-Bytes': String(estimatedBytes),
            'X-Actual-Response-Bytes': String(actualBytes),
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(cmData)
        };
      } catch (cmErr) {
        console.error(`[weather-proxy] Copernicus error:`, cmErr.message);
        return await handleFailure(502, 'copernicus_forward', cmErr.message);
      }
    }

    // Determine target URL for Open-Meteo
    let targetUrl;
    if (type === 'tiles') {
      const tileModel = event.queryStringParameters?.model;
      if (!tileModel) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Missing model for tiles' })
        };
      }
      targetUrl = `https://map-tiles.open-meteo.com/data_spatial/${tileModel}/latest.json`;
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

    // B. POST with coordinate arrays → use upstream POST (no GET translation!)
    if (event.httpMethod === 'POST' && body && Array.isArray(body.latitude) && Array.isArray(body.longitude)) {
      const numPoints = body.latitude.length;
      console.log(`[weather-proxy] POST ${type}: ${numPoints} points, trying upstream POST`);

      let data;
      let apiRes;

      try {
        apiRes = await forwardAsUpstreamPost(targetUrl, body);

        if (apiRes.status === 429) {
          console.warn(`[weather-proxy] Upstream POST 429 for ${type}, returning clean 429 immediately`);
          return await handleFailure(429, 'upstream_post_429_no_fallback', 'Rate limit exceeded on upstream POST');
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

      // Strategy 2: Chunked GET fallback (if POST failed and was not a 429)
      if (!data) {
        console.log(`[weather-proxy] Falling back to chunked GET for ${type}`);
        const result = await chunkedGetFallback(targetUrl, body);
        if (result.status === 429) {
          return await handleFailure(429, 'chunked_get', result.error || 'Rate limit exceeded on chunked GET');
        }
        if (result.status !== 200 || !result.data) {
          return await handleFailure(result.status || 502, 'chunked_get', result.error || 'Chunked GET failed');
        }
        data = result.data;
      }

      // Cache and return success
      const actualBytes = JSON.stringify(data).length;
      console.log(`[weather-proxy] Upstream success for ${type}: (est: ${estimatedBytes}B, actual: ${actualBytes}B)`);

      if (actualBytes > RESPONSE_SIZE_LIMIT) {
        return makeResponseTooLargeResponse(estimatedBytes, actualBytes, pointCount, hourlyVarCount, forecastDays);
      }

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
          'X-Estimated-Response-Bytes': String(estimatedBytes),
          'X-Actual-Response-Bytes': String(actualBytes),
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(data)
      };
    }

    // C. Simple GET passthrough (single-point requests, tile metadata, etc.)
    let apiRes;
    let attempt = 0;
    const maxAttempts = pointCount > 1 ? 1 : 3; // Grid requests get only 1 attempt
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

        if (apiRes.ok || (apiRes.status !== 502 && apiRes.status !== 503 && apiRes.status !== 504 && apiRes.status !== 429)) {
          break;
        }

        console.warn(`[weather-proxy] Attempt ${attempt} failed with status ${apiRes.status}.`);
      } catch (fetchErr) {
        if (attempt >= maxAttempts) {
          return await handleFailure(502, 'upstream_get', fetchErr.message);
        }
        console.warn(`[weather-proxy] Attempt ${attempt} threw error: ${fetchErr.message}.`);
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

      return await handleFailure(status, 'upstream_get', errorText);
    }

    const data = await apiRes.json();
    const actualBytes = JSON.stringify(data).length;
    console.log(`[weather-proxy] Success: ${type}, cached as ${cacheKey} (est: ${estimatedBytes}B, actual: ${actualBytes}B)`);

    if (actualBytes > RESPONSE_SIZE_LIMIT) {
      return makeResponseTooLargeResponse(estimatedBytes, actualBytes, pointCount, hourlyVarCount, forecastDays);
    }

    // Cache the response
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
        'X-Estimated-Response-Bytes': String(estimatedBytes),
        'X-Actual-Response-Bytes': String(actualBytes),
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
