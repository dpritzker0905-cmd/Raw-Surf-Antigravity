const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('GridParserWorker.js - Unit Tests for BFS Clustering & Pressure Extrema', () => {
  let workerContext;

  beforeAll(() => {
    // Locate and load GridParserWorker.js
    const workerFilePath = path.resolve(__dirname, '../components/map/GridParserWorker.js');
    const code = fs.readFileSync(workerFilePath, 'utf8');

    // Create a mock global self/worker context
    workerContext = {
      self: {},
      Math: Math,
      Array: Array,
      Object: Object,
      console: console,
    };
    workerContext.self.postMessage = jest.fn();

    // Execute worker code in VM context to extract its private/global scope functions
    vm.createContext(workerContext);
    vm.runInContext(code, workerContext);
  });

  test('calculatePressureExtrema returns empty arrays for empty/invalid inputs', () => {
    const calculatePressureExtrema = workerContext.calculatePressureExtrema;
    
    expect(calculatePressureExtrema(null, 0, 0, {})).toEqual({ lowSystems: [], highSystems: [] });
    expect(calculatePressureExtrema([], 0, 0, {})).toEqual({ lowSystems: [], highSystems: [] });
  });

  test('getBasin maps coordinates to correct basins', () => {
    const getBasin = workerContext.getBasin;

    // Northern hemisphere
    expect(getBasin(10, 0)).toBe('Eurasia');
    expect(getBasin(10, -50)).toBe('North Atlantic');
    expect(getBasin(10, -120)).toBe('North Pacific');
    expect(getBasin(10, 160)).toBe('North Pacific');

    // Southern hemisphere
    expect(getBasin(-10, -50)).toBe('South Atlantic');
    expect(getBasin(-10, 80)).toBe('Indian Ocean');
    expect(getBasin(-10, -120)).toBe('South Pacific');
  });

  test('getHaversineDistance computes correct geodetic distances', () => {
    const getHaversineDistance = workerContext.getHaversineDistance;
    
    // Distance between (0, 0) and (0, 0) is 0
    expect(getHaversineDistance(0, 0, 0, 0)).toBe(0);

    // Distance between (0, 0) and (0, 1) is roughly 111.19 km
    const dist = getHaversineDistance(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(111);
    expect(dist).toBeLessThan(112);

    // Antipodal / identical coordinates test cases to ensure no NaN
    const antipodalDist = getHaversineDistance(90, 0, -90, 180);
    expect(antipodalDist).toBeCloseTo(20015, 0);
    expect(isNaN(antipodalDist)).toBe(false);
    expect(getHaversineDistance(45, 45, 45, 45)).toBe(0);
  });

  test('calculatePressureExtrema clusters contiguous low pressure points (BFS)', () => {
    const calculatePressureExtrema = workerContext.calculatePressureExtrema;

    // Create a 5x5 coarse grid with a local low pressure area in the center
    const coarseRows = 5;
    const coarseCols = 5;
    const bounds = { south: 20, north: 24, west: -80, east: -76 };
    const pressures = [];

    for (let r = 0; r < coarseRows; r++) {
      const lat = bounds.south + (r / (coarseRows - 1)) * (bounds.north - bounds.south);
      for (let c = 0; c < coarseCols; c++) {
        const lng = bounds.west + (c / (coarseCols - 1)) * (bounds.east - bounds.west);
        // Default pressure is 1013.0 (normal)
        let pressure = 1013.0;
        // Make the center point (row 2, col 2) and its immediate neighbors a low pressure cell
        if (r === 2 && c === 2) {
          pressure = 990.0;
        } else if (Math.abs(r - 2) <= 1 && Math.abs(c - 2) <= 1) {
          pressure = 1000.0;
        }
        pressures.push({ lat, lng, pressure });
      }
    }

    // Call calculation function
    const result = calculatePressureExtrema(pressures, coarseRows, coarseCols, bounds, 0, 'GFS');

    // Should detect at least one low system 'L'
    expect(result.lowSystems.length).toBeGreaterThanOrEqual(1);
    const low = result.lowSystems[0];
    expect(low.type).toBe('L');
    expect(low.pressure).toBe(990); // extremum (min) of the cluster
    expect(low.size).toBeGreaterThan(1); // clustered multiple cells
  });

  test('calculatePressureExtrema clusters contiguous high pressure points (BFS)', () => {
    const calculatePressureExtrema = workerContext.calculatePressureExtrema;

    const coarseRows = 5;
    const coarseCols = 5;
    const bounds = { south: 20, north: 24, west: -80, east: -76 };
    const pressures = [];

    for (let r = 0; r < coarseRows; r++) {
      const lat = bounds.south + (r / (coarseRows - 1)) * (bounds.north - bounds.south);
      for (let c = 0; c < coarseCols; c++) {
        const lng = bounds.west + (c / (coarseCols - 1)) * (bounds.east - bounds.west);
        let pressure = 1013.0;
        // Center has high pressure
        if (r === 2 && c === 2) {
          pressure = 1035.0;
        } else if (Math.abs(r - 2) <= 1 && Math.abs(c - 2) <= 1) {
          pressure = 1025.0;
        }
        pressures.push({ lat, lng, pressure });
      }
    }

    const result = calculatePressureExtrema(pressures, coarseRows, coarseCols, bounds, 0, 'GFS');

    expect(result.highSystems.length).toBeGreaterThanOrEqual(1);
    const high = result.highSystems[0];
    expect(high.type).toBe('H');
    expect(high.pressure).toBe(1035); // extremum (max) of the cluster
  });

  test('calculatePressureExtrema handles global longitude wrap-around correctly', () => {
    const calculatePressureExtrema = workerContext.calculatePressureExtrema;

    // A global longitude bounds configuration: west -180 to east 180
    const coarseRows = 5;
    const coarseCols = 5;
    const bounds = { south: 20, north: 24, west: -180, east: 180 };
    const pressures = [];

    for (let r = 0; r < coarseRows; r++) {
      const lat = bounds.south + (r / (coarseRows - 1)) * (bounds.north - bounds.south);
      for (let c = 0; c < coarseCols; c++) {
        const lng = bounds.west + (c / (coarseCols - 1)) * (bounds.east - bounds.west);
        let pressure = 1013.0;
        // Place low pressure on the extreme left (col 0) and right (col 4) edges
        // Under global wrap-around, these form a single contiguous low-pressure cluster.
        if (r === 2 && (c === 0 || c === coarseCols - 1)) {
          pressure = 990.0;
        }
        pressures.push({ lat, lng, pressure });
      }
    }

    const result = calculatePressureExtrema(pressures, coarseRows, coarseCols, bounds, 0, 'GFS');

    // Because of the global wrap-around and subsequent greedy 750km deduplication,
    // they should be grouped/deduplicated into a single system near the antimeridian.
    // We filter for primary lows (size > 1) near the antimeridian to ignore secondary systems and other basins.
    const antimeridianLows = result.lowSystems.filter(sys => sys.size > 1 && Math.abs(sys.lng) > 170);
    expect(antimeridianLows.length).toBe(1);
  });
});
