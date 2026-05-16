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

function getCacheKey(type, body) {
  // Simple hash based on type + sorted body keys
  const str = type + JSON.stringify(body);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `${type}_${hash}`;
}

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { type, body } = await req.json();

    if (!type || !body) {
      return new Response(JSON.stringify({ error: 'Missing type or body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine target URL
    const urls = {
      wind: 'https://api.open-meteo.com/v1/forecast',
      marine: 'https://marine-api.open-meteo.com/v1/marine',
    };
    const targetUrl = urls[type];
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check cache
    const cacheKey = getCacheKey(type, body);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[weather-proxy] Cache HIT for ${type} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Age': String(Math.round((Date.now() - cached.timestamp) / 1000)),
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Forward to Open-Meteo
    console.log(`[weather-proxy] Forwarding ${type} POST to ${targetUrl}`);
    const apiRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      console.error(`[weather-proxy] Open-Meteo error: ${apiRes.status} ${errorText}`);
      return new Response(JSON.stringify({ error: `Open-Meteo ${apiRes.status}`, detail: errorText }), {
        status: apiRes.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const data = await apiRes.json();

    // Cache the response
    cache.set(cacheKey, { data, timestamp: Date.now() });
    // Evict old entries (keep cache bounded)
    if (cache.size > 50) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 10; i++) cache.delete(oldest[i][0]);
    }

    console.log(`[weather-proxy] Success: ${type}, cached as ${cacheKey}`);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error(`[weather-proxy] Error:`, err);
    return new Response(JSON.stringify({ error: 'Proxy error', message: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};

export const config = {
  path: '/api/weather-proxy',
};
