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

const {
  cache,
  openMeteoCircuitUntil,
  copernicusCircuitUntil,
  CACHE_TTL,
  RESPONSE_SIZE_LIMIT,
  API_URLS,
  BACKEND_API_URL,
  estimateRequestCost,
  makeResponseTooLargeResponse,
  isCircuitOpen,
  openCircuit,
  getCircuitRemainingMs,
  validateCacheShape,
  getCacheKey,
  forwardAsUpstreamPost,
  chunkedGetFallback,
  forwardToCopernicus
} = require('./weather-proxy-helpers.js');

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
