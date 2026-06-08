import React from 'react';

// Track calls manually to bypass any Jest mock-resetting behavior
const mockNativeFetchCalls = [];
const mockNativeFetch = (input, init) => {
  mockNativeFetchCalls.push({ input, init });
  return Promise.resolve({
    status: 200,
    ok: true,
    json: () => Promise.resolve({ data: "allowed_success" })
  });
};

// Set global fetch at the absolute top before loading index.js
global.fetch = mockNativeFetch;
if (typeof window !== 'undefined') {
  window.fetch = mockNativeFetch;
  
  // Mock ResizeObserver so index.js doesn't crash when extending it
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock ReactDOM so that importing index.js doesn't actually render the App or crash
jest.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: jest.fn()
  })
}));

// Mock App.js and other files to avoid resolving react-router-dom and other dependencies
jest.mock('../App', () => () => <div />);
jest.mock('../i18n', () => ({}));
jest.mock('../reportWebVitals', () => ({
  __esModule: true,
  default: jest.fn(),
  logWebVitals: jest.fn()
}));

// Load index.js to apply the fetch wrappers (index.js as outer, bootstrap.js as inner)
require('../index');

describe("Weather Legacy Quarantine Firewall", () => {
  beforeEach(() => {
    // Clear manual calls tracker
    mockNativeFetchCalls.length = 0;
    // Force quarantine behavior
    window.__WEATHER_FORCE_QUARANTINE__ = true;
    window.__WEATHER_LEGACY_QUARANTINE_DIAG__ = undefined;
  });

  test("1. direct marine-api.open-meteo.com fetch => 403", async () => {
    const url = "https://marine-api.open-meteo.com/v1/marine?latitude=26.35&longitude=-80.08&hourly=wave_height&models=gfs";
    const response = await window.fetch(url);
    
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Blocked by weather legacy quarantine");
    expect(body.code).toBe("QUARANTINE_BLOCKED");
    
    // Native fetch must NOT have been called
    expect(mockNativeFetchCalls.length).toBe(0);

    // Verify diagnostic object
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__).toBeDefined();
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__.blockedInProduction).toBe(true);
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__.url).toBe(url);
  });

  test("2. direct api.open-meteo.com forecast fetch => 403", async () => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=26.35&longitude=-80.08&hourly=temperature_2m";
    const response = await window.fetch(url);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Blocked by weather legacy quarantine");
    
    // Native fetch must NOT have been called
    expect(mockNativeFetchCalls.length).toBe(0);
  });

  test("3. /api/weather/grid backend fetch => allowed", async () => {
    const url = "/api/weather/grid?model=GFS&layer=waves";
    const response = await window.fetch(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBe("allowed_success");

    // Native fetch must have been called
    expect(mockNativeFetchCalls.length).toBe(1);
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__).toBeUndefined();
  });

  test("4. /api/weather/point backend fetch => allowed", async () => {
    const url = "/api/weather/point?model=GFS&layer=waves";
    const response = await window.fetch(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBe("allowed_success");

    // Native fetch must have been called
    expect(mockNativeFetchCalls.length).toBe(1);
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__).toBeUndefined();
  });

  test("5. map-tiles.open-meteo.com metadata/tile fetch => allowed", async () => {
    const url = "https://map-tiles.open-meteo.com/v1/map/waves?latitude=26.35&longitude=-80.08";
    const response = await window.fetch(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBe("allowed_success");

    // Native fetch must have been called
    expect(mockNativeFetchCalls.length).toBe(1);
    expect(window.__WEATHER_LEGACY_QUARANTINE_DIAG__).toBeUndefined();
  });
});
