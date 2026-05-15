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
    // Adaptive GRID based on device (Mobile 12x12, Desktop 24x24)
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const GRID = isMobile ? 12 : 24;
    const latStep = (north - south) / GRID;
    const lngStep = (east - west) / GRID;
    const safe = [];
    for (let yi = 0; yi <= GRID; yi++) {
      for (let xi = 0; xi <= GRID; xi++) {
        let lng = west + xi * lngStep;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;
        safe.push({ lat: +(south + yi * latStep).toFixed(2), lng: +lng.toFixed(2) });
      }
    }
    
    // Chunk requests into max 100 points per call for Open-Meteo API limits if needed, 
    // actually OM handles many points, but URL max length is an issue.
    // Let's cap at 100 max points per URL for stability.
    // 24x24 = 576 points which exceeds URL limits. We need a fallback or smaller grid if fetch fails,
    // Or actually Open-Meteo allows up to 100 coordinates per request?
    // Let's use 9x9 (100 points) to be safe for a single GET request.
    const SAFE_GRID = 9; // 100 points
    const safeLatStep = (north - south) / SAFE_GRID;
    const safeLngStep = (east - west) / SAFE_GRID;
    const finalSafe = [];
    for (let yi = 0; yi <= SAFE_GRID; yi++) {
      for (let xi = 0; xi <= SAFE_GRID; xi++) {
        let lng = west + xi * safeLngStep;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;
        finalSafe.push({ lat: +(south + yi * safeLatStep).toFixed(2), lng: +lng.toFixed(2) });
      }
    }

    const lats = finalSafe.map(p => p.lat).join(',');
    const lons = finalSafe.map(p => p.lng).join(',');
    
    console.trace("[Marine Controller] Fetching Wind Data");
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1&wind_speed_unit=knots`
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
    finalSafe.forEach((pt, i) => {
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
      const data = { vectors, bounds: { west, south, east, north }, cols: SAFE_GRID + 1, rows: SAFE_GRID + 1 };
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

  // Adaptive Snapping Algorithm:
  // Dynamically scales the cache block size based on zoom level.
  // This provides higher resolution wave grids when zoomed in,
  // while ensuring cache stability against continuous map panning to prevent HTTP 429.
  const snap = zoom > 8 ? 2 : zoom > 5 ? 5 : 10;
  const padding = zoom > 8 ? 1 : zoom > 5 ? 3 : 5;
  
  const latMin = Math.max(-80, Math.floor((bounds.south - padding) / snap) * snap);
  const latMax = Math.min(80, Math.ceil((bounds.north + padding) / snap) * snap);
  const lngMin = Math.floor((bounds.west - padding) / snap) * snap;
  const lngMax = Math.ceil((bounds.east + padding) / snap) * snap;
  
  if (latMax <= latMin || lngMax <= lngMin) return null;

  const cacheKey = `${latMin}|${latMax}|${lngMin}|${lngMax}|${snap}`;

  const now = Date.now();
  if (MARINE_CACHE.has(cacheKey)) {
    const cached = MARINE_CACHE.get(cacheKey);
    // 5-minute TTL
    if (now - cached.timestamp < 5 * 60 * 1000) {
      if (cached.payload) return cached.payload;
      return { type: 'FeatureCollection', features: cached.features };
    }
  }

  marineRequestInFlight = true;

  try {
    // Adaptive GRID based on device (Mobile 12x12, Desktop 24x24)
    // But Open-Meteo URL length limits constrain us to ~100 points
    const SAFE_GRID = 9; // 10x10 = 100 points
    const latStep = (latMax - latMin) / SAFE_GRID;
    const lngStep = (lngMax - lngMin) / SAFE_GRID;
    
    const cappedPoints = [];
    for (let yi = 0; yi <= SAFE_GRID; yi++) {
      for (let xi = 0; xi <= SAFE_GRID; xi++) {
        let lat = latMin + yi * latStep;
        let lng = lngMin + xi * lngStep;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;
        cappedPoints.push({ lat: +lat.toFixed(2), lng: +lng.toFixed(2) });
      }
    }
    const lats = cappedPoints.map(p => p.lat).join(',');
    const lons = cappedPoints.map(p => p.lng).join(',');

    console.trace("[Marine Controller] Fetching Marine Data");
    const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // v246: Open-Meteo marine API returns flat object for multi-lat/lng queries,
    // NOT an array. Normalize to always be per-point array.
    let allResults;
    if (Array.isArray(data)) {
      allResults = data;
    } else if (data?.current) {
      // Single aggregated response — replicate for all grid points
      allResults = cappedPoints.map(() => data);
    } else {
      console.warn('[Marine Trace] Unexpected API response shape:', Object.keys(data));
      return null;
    }

    const safeNum = (v, fallback = 0) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const gridVectors = [];
    const features = [];

    cappedPoints.forEach((pt, i) => {
      const r = allResults[i];
      if (!r?.current || !Number.isFinite(pt.lng) || !Number.isFinite(pt.lat)) {
        // Missing data or land, push zero vector to maintain grid topology
        gridVectors.push({ lat: pt.lat, lng: pt.lng, waves: {u:0,v:0,speed:0}, swell_1: {u:0,v:0,speed:0}, swell_2: {u:0,v:0,speed:0}, wind_waves: {u:0,v:0,speed:0} });
        return;
      }
      const c = r.current;
      const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
      const s1_h = safeNum(c.swell_wave_height), s1_d = safeNum(c.swell_wave_direction);
      const s2_h = safeNum(c.secondary_swell_wave_height), s2_d = safeNum(c.secondary_swell_wave_direction);
      const ww_h = safeNum(c.wind_wave_height), ww_d = safeNum(c.wind_wave_direction);

      if (w_h === 0 && s1_h === 0 && ww_h === 0) {
        gridVectors.push({ lat: pt.lat, lng: pt.lng, waves: {u:0,v:0,speed:0}, swell_1: {u:0,v:0,speed:0}, swell_2: {u:0,v:0,speed:0}, wind_waves: {u:0,v:0,speed:0} });
        return; // Land
      }

      const getUV = (speed, dir) => {
        if (speed === 0) return { u: 0, v: 0, speed: 0 };
        const rad = dir * (Math.PI / 180);
        return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
      };

      gridVectors.push({
        lat: pt.lat, lng: pt.lng,
        waves: getUV(w_h, w_d),
        swell_1: getUV(s1_h, s1_d),
        swell_2: getUV(s2_h, s2_d),
        wind_waves: getUV(ww_h, ww_d)
      });

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
        properties: {
          wave_height: w_h, wave_period: safeNum(c.wave_period), wave_direction: w_d,
          swell_wave_height: s1_h, swell_wave_period: safeNum(c.swell_wave_period), swell_wave_direction: s1_d,
          secondary_swell_wave_height: s2_h, secondary_swell_wave_period: safeNum(c.secondary_swell_wave_period), secondary_swell_wave_direction: s2_d,
          wind_wave_height: ww_h, wind_wave_period: safeNum(c.wind_wave_period), wind_wave_direction: ww_d,
        },
      });
    });

    console.log(`[Marine Trace] Network Success: ${allResults.length} raw results -> ${features.length} valid features.`);

    if (features.length > 0) {
      const marinePayload = { 
        type: 'FeatureCollection', 
        features, 
        grid: {
          vectors: gridVectors,
          bounds: { west: lngMin, south: latMin, east: lngMax, north: latMax },
          cols: SAFE_GRID + 1,
          rows: SAFE_GRID + 1
        }
      };
      MARINE_CACHE.set(cacheKey, { payload: marinePayload, timestamp: Date.now() });
      return marinePayload;
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
