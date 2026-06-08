import fs from 'fs';
import path from 'path';

describe("Static Analysis - No Frontend Estimator Math Gate", () => {
  test("1. Verify euroExtendedEstimate.js has been deleted", () => {
    const filePath = path.resolve(__dirname, '../components/map/euroExtendedEstimate.js');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test("2. Verify forecastSamplers.js is clean of estimator references", () => {
    const filePath = path.resolve(__dirname, '../components/map/forecastSamplers.js');
    const content = fs.readFileSync(filePath, 'utf8');

    const forbidden = [
      'estimateEuroPoint',
      'estimateIconPoint',
      'EURO_LIMIT_WAVES',
      'EURO_LIMIT_COMPONENTS',
      'ICON_LIMIT',
      'euro_extended_estimate',
      'icon_extended_estimate'
    ];

    forbidden.forEach(token => {
      const hasToken = content.includes(token);
      expect(hasToken).toBe(false);
    });
  });

  test("3. Verify useMarineDataFetcher.js is clean of estimator references", () => {
    const filePath = path.resolve(__dirname, '../components/map/useMarineDataFetcher.js');
    const content = fs.readFileSync(filePath, 'utf8');

    const forbidden = [
      'estimateEuroGrid',
      'estimateIconGrid',
      'EURO_LIMIT_WAVES',
      'EURO_LIMIT_COMPONENTS',
      'ICON_LIMIT',
      'frontend_fallback',
      'gfs_estimated_backdrop',
      'gfs_estimated_fallback',
      '__isEstimated',
      "provider: 'estimated'",
      'provider: "estimated"',
      'pending_copernicus',
      'copernicus_unavailable',
      'copernicus_error'
    ];

    forbidden.forEach(token => {
      const hasToken = content.includes(token);
      expect(hasToken).toBe(false);
    });
  });

  test("4. Verify no other source files import from euroExtendedEstimate", () => {
    const mapDir = path.resolve(__dirname, '../components/map');
    const files = fs.readdirSync(mapDir).filter(f => f.endsWith('.js') || f.endsWith('.jsx'));

    files.forEach(file => {
      const content = fs.readFileSync(path.join(mapDir, file), 'utf8');
      const hasImport = content.includes('euroExtendedEstimate');
      expect(hasImport).toBe(false);
    });
  });
});
