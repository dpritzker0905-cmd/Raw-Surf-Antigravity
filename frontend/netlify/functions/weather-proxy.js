/**
 * Netlify serverless proxy for Open-Meteo API.
 * 
 * Routes wind/marine grid POST requests through Netlify's IP,
 * bypassing client-side 429 rate limits. Caches responses for 30 min.
 * 
 * Usage from frontend:
 *   POST /.netlify/functions/weather-proxy
 *   Body: { type: "wind"|"marine", body: <original POST body> }
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
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
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
      const urls = {
        wind: 'https://api.open-meteo.com/v1/forecast',
        marine: 'https://marine-api.open-meteo.com/v1/marine',
      };
      const base = urls[type];
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

    // Forward to Open-Meteo
    console.log(`[weather-proxy] Forwarding ${type} ${event.httpMethod} to ${targetUrl}`);
    const fetchOptions = {
      method: event.httpMethod,
    };
    if (event.httpMethod === 'POST') {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify(body);
    }
    const apiRes = await fetch(targetUrl, fetchOptions);

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      console.error(`[weather-proxy] Open-Meteo error: ${apiRes.status} ${errorText}`);
      return {
        statusCode: apiRes.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: `Open-Meteo ${apiRes.status}`, detail: errorText })
      };
    }

    const data = await apiRes.json();

    // Cache the response
    cache.set(cacheKey, { data, timestamp: Date.now() });
    // Evict old entries (keep cache bounded)
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Proxy error', message: err.message })
    };
  }
};
