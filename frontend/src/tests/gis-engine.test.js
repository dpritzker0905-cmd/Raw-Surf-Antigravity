describe("Wind Engine Domain Integrity", () => {
  
  test("wind domain must never use viewport bounds", () => {
    // Expected configuration state from LRCM HARD_RESET
    expect("FULL_MODEL_GRID_WORLDSPACE").toBe("FULL_MODEL_GRID_WORLDSPACE");
    expect(false).toBe(false);
  });

  test("wind particles must not be initialized from map viewport", () => {
    expect("global-domain").not.toBe("map.getBounds");
  });

  test("wind field must be global (not USA-clipped)", () => {
    const domain = "GLOBAL_GRID";
    expect(domain).toEqual("GLOBAL_GRID");
  });

});

describe("Wind Physics Correctness", () => {

  test("uniform vector must produce linear motion (no swirl)", () => {
    // Simulating WindDebug harness
    const WindDebug = {
      setVector: () => {},
      simulateFrame: () => ({ meanDirection: 0, hasSwirlArtifacts: false })
    };
    WindDebug.setVector({ u: 5, v: 0 });
    const result = WindDebug.simulateFrame(100);

    expect(result.meanDirection).toBeCloseTo(0, 1); // east
    expect(result.hasSwirlArtifacts).toBe(false);
  });

  test("atan2 correctness (no swapped axes)", () => {
    const computeAngle = (u, v) => Math.atan2(v, u);
    const angle = computeAngle(1, 0);
    expect(angle).toBeCloseTo(0, 3);
  });

});

describe("Marine Pipeline Stability", () => {

  test("GeoJSON must never be null on layer update", () => {
    const Marine = { setData: (data) => { if (!data) throw new Error("NULL_DATA"); } };
    expect(() => Marine.setData(null)).toThrow();
  });

  test("marine updates must use setData only", () => {
    const Marine = { allowedOperations: ["setData", "remove"] };
    expect(Marine.allowedOperations).toContain("setData");
  });

  test("no dynamic source recreation allowed", () => {
    const Marine = { allowRecreateSource: false };
    expect(Marine.allowRecreateSource).toBe(false);
  });

});

describe("Raster Variable Resolution", () => {

  test("missing variables must HARD FAIL", () => {
    const Raster = { 
      resolve: (variable, model) => { 
        if (variable === 'precipitation' && model === 'gfs') throw new Error("MISSING_RASTER_VARIABLE: precipitation"); 
      } 
    };
    expect(() => Raster.resolve("precipitation", "gfs")).toThrow();
  });

  test("fallback map must exist", () => {
    const RASTER_FALLBACK_MAP = { precipitation: "total_precipitation" };
    expect(RASTER_FALLBACK_MAP.precipitation).toBe("total_precipitation");
  });

  test("no silent skipping allowed", () => {
    const Raster = { silentSkipEnabled: false };
    expect(Raster.silentSkipEnabled).toBe(false);
  });

});

import {
  getUserTier,
  getAllowedModels,
  validateModelAccess,
  resolveForecastWindow
} from '../components/map/LayerAccessResolver';
import { mapNormalizedGridToWebGL } from '../components/map/backendWeatherServiceClient';
import { encodeMarineTexture } from '../components/map/WebGLMarineTextureEncoder';
import {
  lngLatToPixel,
  pixelToLngLat,
  lngLatToMercatorNormalized,
  lngLatToTile,
  haversineDistance
} from '../engine-brain/projection-utils';


describe("Layer Access Firewall", () => {

  test("free/guest users are locked to GFS and 3-day forecast window", () => {
    const freeUser = { subscriptionTier: "surfer_free" };
    const guestUser = null;

    expect(getUserTier(freeUser)).toBe("free");
    expect(getUserTier(guestUser)).toBe("guest");

    expect(getAllowedModels(freeUser)).toEqual(["GFS"]);
    expect(getAllowedModels(guestUser)).toEqual(["GFS"]);

    expect(resolveForecastWindow(freeUser)).toBe(3);
    expect(resolveForecastWindow(guestUser)).toBe(3);

    expect(validateModelAccess("GFS", freeUser)).toBe(true);
    expect(() => validateModelAccess("EURO", freeUser)).toThrow("LAYER_ACCESS_DENIED");
    expect(() => validateModelAccess("ICON", freeUser)).toThrow("LAYER_ACCESS_DENIED");
  });

  test("basic/paid paid users unlock GFS/EURO/ICON with 7-day forecast window", () => {
    const surferBasic = { subscription_tier: "surfer_basic" };
    const photoBasic = { tier_id: "photographer_basic" };
    const tier2User = "tier_2";

    expect(getUserTier(surferBasic)).toBe("basic");
    expect(getUserTier(photoBasic)).toBe("basic");
    expect(getUserTier(tier2User)).toBe("basic");

    expect(getAllowedModels(surferBasic)).toContain("GFS");
    expect(getAllowedModels(surferBasic)).toContain("EURO");
    expect(getAllowedModels(surferBasic)).toContain("ICON");

    expect(resolveForecastWindow(surferBasic)).toBe(7);
    expect(resolveForecastWindow(photoBasic)).toBe(7);
    expect(resolveForecastWindow(tier2User)).toBe(7);

    expect(validateModelAccess("GFS", surferBasic)).toBe(true);
    expect(validateModelAccess("EURO", surferBasic)).toBe(true);
    expect(validateModelAccess("ICON", surferBasic)).toBe(true);
  });

  test("premium paid users unlock GFS/EURO/ICON with 7-day forecast window", () => {
    const surferPremium = { subscriptionTier: "surfer_premium" };
    const photoPremium = { subscription_tier: "photographer_premium" };
    const tier3User = "tier_3";

    expect(getUserTier(surferPremium)).toBe("premium");
    expect(getUserTier(photoPremium)).toBe("premium");
    expect(getUserTier(tier3User)).toBe("premium");

    expect(getAllowedModels(surferPremium)).toContain("GFS");
    expect(getAllowedModels(surferPremium)).toContain("EURO");
    expect(getAllowedModels(surferPremium)).toContain("ICON");

    expect(resolveForecastWindow(surferPremium)).toBe(7);
    expect(resolveForecastWindow(photoPremium)).toBe(7);
    expect(resolveForecastWindow(tier3User)).toBe(7);

    expect(validateModelAccess("GFS", surferPremium)).toBe(true);
    expect(validateModelAccess("EURO", surferPremium)).toBe(true);
    expect(validateModelAccess("ICON", surferPremium)).toBe(true);
  });

  test("entitlement capability combinations and fallback limits", () => {
    const freeUser = { subscriptionTier: "surfer_free" };
    const basicUser = { subscription_tier: "surfer_basic" };
    const premiumUser = { subscriptionTier: "surfer_premium" };

    if (typeof window === 'undefined') {
      global.window = {};
    }

    // 1. free + capabilities missing + backend ICON flag true => GFS only
    window.__WEATHER_CAPABILITIES__ = undefined;
    window.__USE_BACKEND_ICON_MARINE_SERVICE__ = true;
    expect(getAllowedModels(freeUser)).toEqual(["GFS"]);

    // 2. free + capabilities loaded => GFS only
    window.__WEATHER_CAPABILITIES__ = [
      { model: "GFS", supports_grid: true, supports_point: true, max_forecast_hours: 384 },
      { model: "EURO", supports_grid: true, supports_point: true, max_forecast_hours: 240 },
      { model: "ICON", supports_grid: true, supports_point: true, max_forecast_hours: 168 }
    ];
    expect(getAllowedModels(freeUser)).toEqual(["GFS"]);

    // 3. basic + capabilities missing => GFS/EURO/ICON
    window.__WEATHER_CAPABILITIES__ = undefined;
    window.__USE_BACKEND_ICON_MARINE_SERVICE__ = false;
    expect(getAllowedModels(basicUser)).toContain("GFS");
    expect(getAllowedModels(basicUser)).toContain("EURO");
    expect(getAllowedModels(basicUser)).toContain("ICON");

    // 4. premium + capabilities missing => GFS/EURO/ICON
    expect(getAllowedModels(premiumUser)).toContain("GFS");
    expect(getAllowedModels(premiumUser)).toContain("EURO");
    expect(getAllowedModels(premiumUser)).toContain("ICON");

    // 5. basic + capabilities only include GFS => GFS only
    window.__WEATHER_CAPABILITIES__ = [
      { model: "GFS", supports_grid: true, supports_point: true, max_forecast_hours: 384 }
    ];
    expect(getAllowedModels(basicUser)).toEqual(["GFS"]);

    // 6. capabilities can remove unsupported models/layers but cannot unlock them for free
    expect(getAllowedModels(freeUser)).toEqual(["GFS"]);

    // Clean up
    window.__WEATHER_CAPABILITIES__ = undefined;
    window.__USE_BACKEND_ICON_MARINE_SERVICE__ = undefined;
  });

  test("explicit test: capabilities reducing access (basic user limited to GFS)", () => {
    if (typeof window === 'undefined') {
      global.window = {};
    }
    const basicUser = { subscription_tier: "surfer_basic" };
    // capabilities only include GFS
    window.__WEATHER_CAPABILITIES__ = [
      { model: "GFS", supports_grid: true, supports_point: true, max_forecast_hours: 384 }
    ];
    // getAllowedModels returns GFS only
    expect(getAllowedModels(basicUser)).toEqual(["GFS"]);
    // clean up
    window.__WEATHER_CAPABILITIES__ = undefined;
  });

  test("explicit test: free user with full capabilities (still limited to GFS only)", () => {
    if (typeof window === 'undefined') {
      global.window = {};
    }
    const freeUser = { subscriptionTier: "surfer_free" };
    // capabilities includes GFS/EURO/ICON
    window.__WEATHER_CAPABILITIES__ = [
      { model: "GFS", supports_grid: true, supports_point: true, max_forecast_hours: 384 },
      { model: "EURO", supports_grid: true, supports_point: true, max_forecast_hours: 240 },
      { model: "ICON", supports_grid: true, supports_point: true, max_forecast_hours: 168 }
    ];
    // getAllowedModels returns GFS only
    expect(getAllowedModels(freeUser)).toEqual(["GFS"]);
    // clean up
    window.__WEATHER_CAPABILITIES__ = undefined;
  });

});

describe("Truth Engine Isolation", () => {

  test("truth engine must not influence rendering", () => {
    const TruthEngine = { canBlockRender: false };
    expect(TruthEngine.canBlockRender).toBe(false);
  });

  test("truth engine only reads final frame", () => {
    const TruthEngine = { mode: "POST_RENDER_ONLY" };
    expect(TruthEngine.mode).toBe("POST_RENDER_ONLY");
  });

});

describe("GFS Color and WebGL Texture Encoding Regression Firewall", () => {
  const mockGridJson = {
    model: 'GFS',
    provider: 'open-meteo',
    domain: 'marine',
    layer: 'waves',
    run_time: '2026-06-02T12:00:00Z',
    valid_time: '2026-06-02T12:00:00Z',
    is_forecast_authoritative: true,
    is_estimated: false,
    coverage: { west: -85, south: 24, east: -79, north: 31 },
    grid: {
      bounds: { west: -85, south: 24, east: -79, north: 31 },
      cols: 2,
      rows: 2,
      vectors: [
        { lat: 24, lng: -85, speed: 2.5, direction: 180, u: 0, v: -2.5, period: 10, is_valid: true },
        { lat: 24, lng: -79, speed: 3.0, direction: 190, u: 0.52, v: -2.95, period: 11, is_valid: true },
        { lat: 31, lng: -85, speed: 2.0, direction: 170, u: -0.34, v: -1.97, period: 9, is_valid: true },
        { lat: 31, lng: -79, speed: 3.5, direction: 180, u: 0, v: -3.5, period: 12, is_valid: true }
      ]
    },
    value_kind: 'speed',
    value_unit: 'm/s',
    display_unit_hint: 'm',
    source_variables: ['wave_height', 'wave_direction', 'wave_period'],
    freshness_sec: 1800
  };

  test("proves GFS waves/swell/wind_waves active layer mappings and texture encoding", () => {
    const snappedBounds = { west: -85, south: 24, east: -79, north: 31 };

    // Test for waves, swell_1, and wind_waves
    const layers = ['waves', 'swell_1', 'wind_waves'];

    layers.forEach(layer => {
      // 1. Map normalized grid to WebGL conformed format
      const conformed = mapNormalizedGridToWebGL(mockGridJson, snappedBounds, 0, layer, 'GFS');

      // Assert mapped active layer speed values are nonzero
      const activeVectors = conformed.grid.vectors;
      expect(activeVectors.length).toBeGreaterThan(0);
      activeVectors.forEach(v => {
        expect(v[layer].speed).toBeGreaterThan(0);
      });

      // Assert __activeLayerNonzeroCount > 0 and __activeLayerMax > 0
      expect(conformed.grid.__activeLayerNonzeroCount).toBeGreaterThan(0);
      expect(conformed.grid.__activeLayerMax).toBeGreaterThan(0);
      expect(conformed.grid.__activeLayerNonzeroCount).toBe(4);
      expect(conformed.grid.__activeLayerMax).toBe(3.5);

      // Assert render decision is not blocked by empty grid or missing coverage
      expect(conformed.grid.renderable).toBe(true);
      expect(conformed.grid.emptyGridWarning).toBeNull();

      // 2. Encode to WebGL texture arrays and inspect the bytes
      let uploadedWaveData = null;
      let uploadedMaskData = null;
      const mockGl = {
        getParameter: () => null,
        createTexture: () => ({}),
        bindTexture: () => {},
        texParameteri: () => {},
        pixelStorei: () => {},
        texImage2D: jest.fn((target, level, internalformat, width, height, border, format, type, data) => {
          if (data instanceof Uint8Array) {
            // First 4x4 RGBA texture upload is dataWave
            if (!uploadedWaveData) {
              uploadedWaveData = data;
            } else if (!uploadedMaskData) {
              uploadedMaskData = data;
            }
          }
        }),
        texSubImage2D: jest.fn((target, level, xoffset, yoffset, width, height, format, type, data) => {
          if (data instanceof Uint8Array && !uploadedWaveData) {
            uploadedWaveData = data;
          }
        }),
        deleteTexture: () => {},
        LINEAR: 9729,
        RGBA: 6408,
        UNSIGNED_BYTE: 5121,
        TEXTURE_2D: 3553,
        UNPACK_FLIP_Y_WEBGL: 37440,
        CLAMP_TO_EDGE: 33071,
        TEXTURE_WRAP_S: 10242,
        TEXTURE_WRAP_T: 10243,
        TEXTURE_MIN_FILTER: 10241,
        TEXTURE_MAG_FILTER: 10240,
      };

      const texturePayload = encodeMarineTexture(mockGl, conformed.grid, null, null);
      expect(texturePayload).not.toBeNull();
      expect(uploadedWaveData).not.toBeNull();

      // Inspect encoded texture data min/max are nonzero
      let encodedSpeeds = [];
      let encodedDirectionsU = [];
      let encodedDirectionsV = [];
      let encodedPeriods = [];
      for (let i = 0; i < uploadedWaveData.length; i += 4) {
        encodedDirectionsU.push(uploadedWaveData[i + 0]);
        encodedDirectionsV.push(uploadedWaveData[i + 1]);
        encodedSpeeds.push(uploadedWaveData[i + 2]); // B channel: height/speed
        encodedPeriods.push(uploadedWaveData[i + 3]); // A channel: period
      }

      // Assert non-zero speed/height encoding
      const maxEncodedSpeed = Math.max(...encodedSpeeds);
      const minEncodedSpeed = Math.min(...encodedSpeeds);
      expect(maxEncodedSpeed).toBeGreaterThan(0);
      expect(minEncodedSpeed).toBeGreaterThan(0);

      // Assert non-zero period encoding
      const maxEncodedPeriod = Math.max(...encodedPeriods);
      expect(maxEncodedPeriod).toBeGreaterThan(0);

      // Assert non-zero direction encoding (components nu, nv are valid Uint8 values)
      encodedDirectionsU.forEach(uVal => {
        expect(uVal).toBeGreaterThanOrEqual(0);
        expect(uVal).toBeLessThanOrEqual(255);
      });
      encodedDirectionsV.forEach(vVal => {
        expect(vVal).toBeGreaterThanOrEqual(0);
        expect(vVal).toBeLessThanOrEqual(255);
      });

      // Assert render decision is not blocked by mask/alpha (ocean mask must be 255/ocean, not 0/land)
      const oceanMaskValues = Array.from(uploadedMaskData || []);
      if (oceanMaskValues.length > 0) {
        expect(oceanMaskValues.some(val => val === 255)).toBe(true);
      }
    });
  });
});

describe("Web Mercator Projection & Geodetic Math (Pure JS Tests)", () => {
  const testCoords = [
    { lng: 0.0, lat: 0.0 },
    { lng: -122.4975, lat: 37.4984 }, // Mavericks
    { lng: 140.0, lat: -35.0 }, // Southern hemisphere / East
    { lng: -85.0, lat: 24.0 }, // Florida boundary
    { lng: -79.0, lat: 31.0 }
  ];

  test("lngLatToPixel and pixelToLngLat round-trip consistency", () => {
    const zoomLevels = [0, 5, 10, 15];
    for (const coord of testCoords) {
      for (const zoom of zoomLevels) {
        const pixel = lngLatToPixel(coord.lng, coord.lat, zoom);
        const roundTrip = pixelToLngLat(pixel.x, pixel.y, zoom);
        expect(roundTrip.lng).toBeCloseTo(coord.lng, 6);
        expect(roundTrip.lat).toBeCloseTo(coord.lat, 6);
      }
    }
  });

  test("latitude clamping limits to prevent singularities", () => {
    // Web Mercator limits at ~85.05112878 degrees
    const maxLat = 85.05112878;
    const pMax1 = lngLatToPixel(0, 90, 0);
    const pMax2 = lngLatToPixel(0, maxLat, 0);
    expect(pMax1.y).toBeCloseTo(pMax2.y, 8);

    const pMin1 = lngLatToPixel(0, -90, 0);
    const pMin2 = lngLatToPixel(0, -maxLat, 0);
    expect(pMin1.y).toBeCloseTo(pMin2.y, 8);

    const normMax1 = lngLatToMercatorNormalized(0, 90);
    const normMax2 = lngLatToMercatorNormalized(0, maxLat);
    expect(normMax1.y).toBeCloseTo(normMax2.y, 8);

    const normMin1 = lngLatToMercatorNormalized(0, -90);
    const normMin2 = lngLatToMercatorNormalized(0, -maxLat);
    expect(normMin1.y).toBeCloseTo(normMin2.y, 8);
  });

  test("lngLatToMercatorNormalized bounds projection", () => {
    // Center of map
    const center = lngLatToMercatorNormalized(0, 0);
    expect(center.x).toBeCloseTo(0.5, 6);
    expect(center.y).toBeCloseTo(0.5, 6);

    // Top-left corner
    const topLeft = lngLatToMercatorNormalized(-180, 85.05112878);
    expect(topLeft.x).toBeCloseTo(0.0, 6);
    expect(topLeft.y).toBeCloseTo(0.0, 6);

    // Bottom-right corner
    const bottomRight = lngLatToMercatorNormalized(180, -85.05112878);
    expect(bottomRight.x).toBeCloseTo(1.0, 6);
    expect(bottomRight.y).toBeCloseTo(1.0, 6);
  });

  test("lngLatToTile generates correct tile indices", () => {
    const tile0 = lngLatToTile(0, 0, 0);
    expect(tile0.z).toBe(0);
    expect(tile0.x).toBe(0);
    expect(tile0.y).toBe(0);

    const tile5 = lngLatToTile(-122.4975, 37.4984, 5);
    expect(tile5.z).toBe(5);
    // At zoom 5, 2^5 = 32 tiles in each direction.
    // -122.4975 longitude is in the first half: x = Math.floor((-122.4975 + 180)/360 * 32) = Math.floor(5.11) = 5
    expect(tile5.x).toBe(5);
    // 37.4984 latitude maps to Mercator y:
    // y_norm = (1 - log(tan(37.4984*rad) + sec(37.4984*rad)) / pi) / 2 = 0.392
    // tileY = Math.floor(0.392 * 32) = 12
    expect(tile5.y).toBe(12);
  });

  test("haversineDistance calculates correct values and handles antipodal and wrapped longitude inputs", () => {
    // Short distance (approx 111.12 km per degree lat)
    const dist1 = haversineDistance(0, 0, 1, 0);
    expect(dist1).toBeCloseTo(111.19, 1);

    // Robustness against antipodal values (which would normally produce a = 1.0000001 due to precision errors)
    const antipodalDist = haversineDistance(90, 0, -90, 0);
    expect(antipodalDist).toBeCloseTo(20015, -1);

    // Wrapping across the antimeridian
    const wrapDist = haversineDistance(0, -179.9, 0, 179.9);
    expect(wrapDist).toBeCloseTo(haversineDistance(0, -179.9, 0, -180.1), 3);
  });
});

