/**
 * Helper functions and state storage for Netlify weather-proxy function.
 */

// In-memory cache and circuit breakers (persists across warm container invocations)
const cache = new Map();
const openMeteoCircuitUntil = new Map();
const copernicusCircuitUntil = new Map();

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const RESPONSE_SIZE_LIMIT = 6.5 * 1024 * 1024; // 6.5 MB budget

const API_URLS = {
  wind: 'https://api.open-meteo.com/v1/forecast',
  pressure: 'https://api.open-meteo.com/v1/forecast',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
};

const BACKEND_API_URL = process.env.BACKEND_API_URL || '';

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
  if (pointCount > 1) return false;
  const circuitKey = getCircuitKey(provider, type, model, pointCount, hourly);
  const circuitUntilMap = provider === 'copernicus' ? copernicusCircuitUntil : openMeteoCircuitUntil;
  const until = circuitUntilMap.get(circuitKey) || 0;
  return until > Date.now();
}

function openCircuit(provider, type, model, pointCount, hourly, status) {
  const circuitKey = getCircuitKey(provider, type, model, pointCount, hourly);
  const circuitUntilMap = provider === 'copernicus' ? copernicusCircuitUntil : openMeteoCircuitUntil;
  
  let duration = 45000;
  if (status === 429) {
    duration = 90000;
  } else if (provider === 'copernicus') {
    duration = 120000;
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

async function forwardAsUpstreamPost(targetUrl, body) {
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response;
}

async function chunkedGetFallback(targetUrl, body) {
  const lats = body.latitude;
  const lons = body.longitude;
  const CHUNK_SIZE = 60;
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
    const maxAttempts = ptCount > 1 ? 1 : 3;
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

    if (index < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

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

module.exports = {
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
};
