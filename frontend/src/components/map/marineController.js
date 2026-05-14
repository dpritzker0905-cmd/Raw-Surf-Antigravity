import { debounce } from './mapUtils';

// --- GLOBAL CACHES AND LOCKS ---
const MARINE_CACHE = new Map();
const WIND_CACHE = new Map();

let marineRequestInFlight = false;
let windRequestInFlight = false;

// Mock data generators
function generateMockWind(bounds) {
  const { west, south, east, north } = bounds;
  const GRID = 6;
  const vectors = [];
  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      const lat = south + (yi / GRID) * (north - south);
      const lng = west + (xi / GRID) * (east - west);
      const speed = 10 + Math.sin(lat * 0.5) * 5 + Math.cos(lng * 0.3) * 3;
      const dir = 130 + Math.sin(lng * 0.2) * 20;
      const rad = dir * (Math.PI / 180);
      vectors.push({
        lat: +lat.toFixed(2), lng: +lng.toFixed(2), speed, direction: dir,
        u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
      });
    }
  }
  return { vectors, bounds, grid: GRID };
}

function generateMockMarine() {
  const oceanPts = [
    // Atlantic Coast
    [28.39, -80.10], [28.5, -79.5], [27.5, -79.2], [26.5, -79.0], [29.5, -79.8],
    [30.5, -79.5], [31.5, -79.0], [32.5, -78.5], [25.5, -79.0], [24.5, -79.5],
    // Gulf Stream
    [28.0, -78.0], [27.0, -77.0], [29.0, -77.5], [26.0, -77.5], [30.0, -78.0],
    [28.0, -76.0], [27.0, -76.0], [25.0, -77.0], [31.0, -77.5], [29.0, -76.5],
    // Gulf of Mexico
    [27.0, -83.0], [26.5, -84.0], [28.0, -85.0], [27.5, -86.0], [26.0, -85.5],
    [29.0, -87.0], [28.5, -88.0], [27.0, -89.0], [26.0, -87.0], [25.5, -84.5],
    // Caribbean
    [24.0, -77.5], [23.0, -78.0], [22.5, -79.5], [24.5, -76.0], [23.5, -75.5],
    // Deep Atlantic
    [28.0, -73.0], [26.0, -72.0], [30.0, -74.0], [25.0, -74.0], [27.0, -71.0],
  ];
  return {
    type: 'FeatureCollection',
    features: oceanPts.map(([lat, lng]) => {
      const wh = 0.3 + Math.random() * 3;
      const sh = 0.2 + Math.random() * 2;
      const wwh = 0.1 + Math.random() * 1.2;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          wave_height: wh, wave_period: 5 + Math.random() * 8,
          wave_direction: 60 + Math.random() * 120,
          swell_wave_height: sh, swell_wave_period: 8 + Math.random() * 8,
          swell_wave_direction: 40 + Math.random() * 80,
          wind_wave_height: wwh, wind_wave_period: 3 + Math.random() * 5,
          wind_wave_direction: 90 + Math.random() * 100,
        },
      };
    })
  };
}

const USE_MOCK_WIND = false;
const USE_MOCK_MARINE = false;

/**
 * Single Authority for fetching wind data.
 */
export async function fetchWindData(bounds) {
  if (!bounds || windRequestInFlight) return null;
  
  if (USE_MOCK_WIND) {
    const mockBounds = bounds || { west: -82, south: 24, east: -76, north: 32 };
    return generateMockWind(mockBounds);
  }

  const { west, south, east, north } = bounds;
  if (north <= south || east === west) return null;

  // Cache key grouping 0.5 degree viewports
  const cacheKey = [
    Math.round(south * 2), Math.round(north * 2),
    Math.round(west * 2), Math.round(east * 2)
  ].join('|');

  if (WIND_CACHE.has(cacheKey)) {
    return WIND_CACHE.get(cacheKey);
  }

  windRequestInFlight = true;

  try {
    const GRID = 8;
    const latStep = (north - south) / GRID;
    const lngStep = (east - west) / GRID;
    const points = [];
    for (let yi = 0; yi <= GRID; yi++) {
      for (let xi = 0; xi <= GRID; xi++) {
        let lng = west + xi * lngStep;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;
        points.push({ lat: +(south + yi * latStep).toFixed(2), lng: +lng.toFixed(2) });
      }
    }
    
    // Cap at 25 points to prevent Open-Meteo 429 errors
    const safe = points.slice(0, 25);
    const lats = safe.map(p => p.lat).join(',');
    const lons = safe.map(p => p.lng).join(',');
    
    console.trace("[Marine Controller] Fetching Wind Data");
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    // v245: Open-Meteo returns flat object for single lat/lng, array for multiple.
    // Normalize to always be an array of per-point results.
    let results;
    if (Array.isArray(json)) {
      results = json;
    } else if (json?.current) {
      // Single-point response — wrap in array for each grid point
      // (API returns aggregated current for all points in one response)
      results = safe.map(() => json);
    } else {
      console.warn('[Wind Trace] Unexpected API response shape:', Object.keys(json));
      return null;
    }

    const vectors = [];
    safe.forEach((pt, i) => {
      const r = results[i];
      if (!r?.current) return;
      const speed = r.current.wind_speed_10m;
      const dir = r.current.wind_direction_10m;
      if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;
      const rad = dir * (Math.PI / 180);
      vectors.push({
        lat: pt.lat, lng: pt.lng, speed, direction: dir,
        u: -speed * Math.sin(rad), v: -speed * Math.cos(rad)
      });
    });

    console.log(`[Wind Trace] Network Success: ${results.length} raw results -> ${vectors.length} valid vectors.`);

    if (vectors.length > 0) {
      const data = { vectors, bounds: { west, south, east, north }, grid: GRID };
      WIND_CACHE.set(cacheKey, data);
      return data;
    } else {
      console.warn('[Wind Trace] Zero valid wind vectors');
      return null;
    }
  } catch (err) {
    console.error(`[Wind Trace] API fetch failed: ${err.message}`);
    return null;
  } finally {
    windRequestInFlight = false;
  }
}

/**
 * Single Authority for fetching marine (wave/swell) data.
 */
export async function fetchMarineData(bounds, zoom) {
  if (!bounds || marineRequestInFlight) return null;

  if (USE_MOCK_MARINE) {
    return generateMockMarine();
  }

  const latMin = Math.max(-80, bounds.south - 5);
  const latMax = Math.min(80, bounds.north + 5);
  const lngMin = bounds.west - 5;
  const lngMax = bounds.east + 5;
  
  if (latMax <= latMin || lngMax <= lngMin) return null;

  const cacheKey = [
    Math.round(latMin * 2), Math.round(latMax * 2),
    Math.round(lngMin * 2), Math.round(lngMax * 2),
    Math.round(zoom)
  ].join('|');

  const now = Date.now();
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    // 5-minute TTL
    if (now - cached.timestamp < 5 * 60 * 1000) {
      return { type: 'FeatureCollection', features: cached.features };
    }
  }

  marineRequestInFlight = true;

  try {
    const latStep = Math.max(1.0, (latMax - latMin) / 5);
    const lngStep = Math.max(1.0, (lngMax - lngMin) / 5);
    
    const safePoints = [];
    for (let lat = latMax; lat >= latMin; lat -= latStep) {
      for (let lng = lngMin; lng <= lngMax; lng += lngStep) {
        let n = lng;
        while (n > 180) n -= 360;
        while (n < -180) n += 360;
        safePoints.push({ lat: +lat.toFixed(2), lng: +n.toFixed(2) });
      }
    }
    
    // Cap at 25 points
    const cappedPoints = safePoints.slice(0, 25);
    const lats = cappedPoints.map(p => p.lat).join(',');
    const lons = cappedPoints.map(p => p.lng).join(',');

    console.trace("[Marine Controller] Fetching Marine Data");
    const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const allResults = Array.isArray(data) ? data : [data];

    const safe = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
    const features = cappedPoints.map((pt, i) => {
      const r = allResults[i];
      if (!r?.current) return null;
      const c = r.current;
      if (c.wave_height == null && c.swell_wave_height == null && c.wind_wave_height == null) {
        return null; // Land
      }
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
        properties: {
          wave_height: safe(c.wave_height), wave_period: safe(c.wave_period), wave_direction: safe(c.wave_direction),
          swell_wave_height: safe(c.swell_wave_height), swell_wave_period: safe(c.swell_wave_period), swell_wave_direction: safe(c.swell_wave_direction),
          secondary_swell_wave_height: safe(c.secondary_swell_wave_height), secondary_swell_wave_period: safe(c.secondary_swell_wave_period), secondary_swell_wave_direction: safe(c.secondary_swell_wave_direction),
          wind_wave_height: safe(c.wind_wave_height), wind_wave_period: safe(c.wind_wave_period), wind_wave_direction: safe(c.wind_wave_direction),
        },
      };
    }).filter(Boolean);

    console.log(`[Marine Trace] Network Success: ${allResults.length} raw results -> ${features.length} valid features.`);

    if (features.length > 0) {
      MARINE_CACHE.set(cacheKey, { features, timestamp: Date.now() });
      return { type: 'FeatureCollection', features };
    } else {
      console.warn('[Marine Trace] Zero valid points returned from API, returning null');
      return null;
    }
  } catch (err) {
    console.error(`[Marine Trace] API fetch failed: ${err.message}`);
    return null;
  } finally {
    marineRequestInFlight = false;
  }
}

// For initial instant mock loading
export const getInstantMockMarine = generateMockMarine;
