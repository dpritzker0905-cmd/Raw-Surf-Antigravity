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

function generateMockMarine(bounds) {
  const { west, south, east, north } = bounds || { west: -120, south: -60, east: 60, north: 60 };
  const GRID = 7;
  const latStep = (north - south) / GRID;
  const lngStep = (east - west) / GRID;
  const gridVectors = [];
  const features = [];

  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      let lat = south + yi * latStep;
      let lng = west + xi * lngStep;
      
      const wh = 0.5 + Math.random() * 3;
      const sh = 0.2 + Math.random() * 2;
      const wwh = 0.1 + Math.random() * 1.5;
      
      const w_d = 60 + Math.random() * 120;
      const s1_d = 40 + Math.random() * 80;
      const ww_d = 90 + Math.random() * 100;

      const getUV = (speed, dir) => {
        const rad = dir * (Math.PI / 180);
        return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
      };

      gridVectors.push({
        lat, lng,
        waves: getUV(wh, w_d),
        swell_1: getUV(sh, s1_d),
        swell_2: getUV(sh * 0.5, s1_d + 30),
        wind_waves: getUV(wwh, ww_d)
      });

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          wave_height: wh, wave_period: 5 + Math.random() * 8, wave_direction: w_d,
          swell_wave_height: sh, swell_wave_period: 8 + Math.random() * 8, swell_wave_direction: s1_d,
          secondary_swell_wave_height: sh * 0.5, secondary_swell_wave_period: 6, secondary_swell_wave_direction: s1_d + 30,
          wind_wave_height: wwh, wind_wave_period: 3 + Math.random() * 5, wind_wave_direction: ww_d,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
    grid: {
      vectors: gridVectors,
      bounds: { west, south, east, north },
      cols: GRID + 1,
      rows: GRID + 1
    }
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
    
    // Open-Meteo URL length limits constrain us. Let's use 7x7 grid (64 points)
    const SAFE_GRID = 7; 
    const safeLatStep = (north - south) / SAFE_GRID;
    const safeLngStep = (east - west) / SAFE_GRID;
    const finalSafe = [];
    for (let yi = 0; yi <= SAFE_GRID; yi++) {
      for (let xi = 0; xi <= SAFE_GRID; xi++) {
        let lng = west + xi * safeLngStep;
        let reqLng = lng;
        while (reqLng > 180) reqLng -= 360;
        while (reqLng < -180) reqLng += 360;
        finalSafe.push({ lat: +(south + yi * safeLatStep).toFixed(2), reqLng: +reqLng.toFixed(2), monotonicLng: +lng.toFixed(2) });
      }
    }

    const lats = finalSafe.map(p => p.lat).join(',');
    const lons = finalSafe.map(p => p.reqLng).join(',');
    
    console.trace("[Marine Controller] Fetching Wind Data");
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1&wind_speed_unit=kn`
    );
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[Wind Trace] API Quota Exceeded (429). Falling back to dynamic mock generator to prevent empty renders.`);
        return generateMockWind({ west, south, east, north });
      }
      throw new Error(`HTTP ${res.status}`);
    }

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
        lat: pt.lat, lng: pt.monotonicLng, speed, direction: dir,
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
    // Final safety net fallback
    return generateMockWind(bounds);
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
  // Dynamically scales the cache block size. 
  // We use massive 30-degree blocks to prevent HTTP 429 Too Many Requests when panning.
  const snap = 30;
  const padding = 15;
  
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
    // Open-Meteo URL length limits constrain us to 64 points
    const SAFE_GRID = 7; 
    const latStep = (latMax - latMin) / SAFE_GRID;
    const lngStep = (lngMax - lngMin) / SAFE_GRID;
    
    const cappedPoints = [];
    for (let yi = 0; yi <= SAFE_GRID; yi++) {
      for (let xi = 0; xi <= SAFE_GRID; xi++) {
        let lat = latMin + yi * latStep;
        let lng = lngMin + xi * lngStep;
        let reqLng = lng;
        while (reqLng > 180) reqLng -= 360;
        while (reqLng < -180) reqLng += 360;
        cappedPoints.push({ lat: +lat.toFixed(2), reqLng: +reqLng.toFixed(2), monotonicLng: +lng.toFixed(2) });
      }
    }
    const lats = cappedPoints.map(p => p.lat).join(',');
    const lons = cappedPoints.map(p => p.reqLng).join(',');

    console.trace("[Marine Controller] Fetching Marine Data");
    const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period`);
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[Marine Trace] API Quota Exceeded (429). Falling back to dynamic mock generator to prevent empty renders.`);
        return generateMockMarine({ west: lngMin, south: latMin, east: lngMax, north: latMax });
      }
      throw new Error(`HTTP ${res.status}`);
    }

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
      if (!r?.current || !Number.isFinite(pt.reqLng) || !Number.isFinite(pt.lat)) {
        // Missing data or land, push zero vector to maintain grid topology
        gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng, waves: {u:0,v:0,speed:0}, swell_1: {u:0,v:0,speed:0}, swell_2: {u:0,v:0,speed:0}, wind_waves: {u:0,v:0,speed:0} });
        return;
      }
      const c = r.current;
      const w_h = safeNum(c.wave_height), w_d = safeNum(c.wave_direction);
      const s1_h = safeNum(c.swell_wave_height), s1_d = safeNum(c.swell_wave_direction);
      const s2_h = safeNum(c.secondary_swell_wave_height), s2_d = safeNum(c.secondary_swell_wave_direction);
      const ww_h = safeNum(c.wind_wave_height), ww_d = safeNum(c.wind_wave_direction);

      if (w_h === 0 && s1_h === 0 && ww_h === 0) {
        gridVectors.push({ lat: pt.lat, lng: pt.monotonicLng, waves: {u:0,v:0,speed:0}, swell_1: {u:0,v:0,speed:0}, swell_2: {u:0,v:0,speed:0}, wind_waves: {u:0,v:0,speed:0} });
        return; // Land
      }

      const getUV = (speed, dir) => {
        if (speed === 0) return { u: 0, v: 0, speed: 0 };
        const rad = dir * (Math.PI / 180);
        return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
      };

      gridVectors.push({
        lat: pt.lat, lng: pt.monotonicLng,
        waves: getUV(w_h, w_d),
        swell_1: getUV(s1_h, s1_d),
        swell_2: getUV(s2_h, s2_d),
        wind_waves: getUV(ww_h, ww_d)
      });

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pt.monotonicLng, pt.lat] },
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
    // Final safety net fallback for marine
    if (bounds) {
      return generateMockMarine({ west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north });
    }
    return null;
  } finally {
    marineRequestInFlight = false;
  }
}

// For initial instant mock loading
export const getInstantMockMarine = generateMockMarine;
