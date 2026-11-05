/**
 * Spot-hub phase 4 wiring, source-read (the house pattern for MapForecastOverlay, see staleHour.proof.test.js):
 * the infobox draws the compact chart for a selected catalogued spot with the user's tier and the scrubber's
 * setter; the drawer's chart moves the map's scrubber; the chart's numbers come only from the series proxy.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the infobox draws the compact chart for a selected spot, with the tier and the scrubber setter', () => {
  const overlay = read('components/map/MapForecastOverlay.js');
  expect(overlay).toMatch(/import \{ InfoboxSpotChart \} from '\.\.\/spot-hub\/charts\/SpotChartPanel'/);
  expect(overlay).toMatch(/<InfoboxSpotChart spot=\{selectedSpot\} user=\{user\} model=\{activeModel\} hour=\{timeOffsetHours\} onTimeChange=\{onTimeChange\} isLight=\{isLight\} \/>/);
  const page = read('components/MapPage.js');
  const block = page.slice(page.indexOf('<MapForecastOverlay'), page.indexOf('/>', page.indexOf('<MapForecastOverlay')));
  expect(block).toMatch(/user=\{user\}/);
  expect(block).toMatch(/onTimeChange=\{setTimeOffsetHours\}/);
});

test('the drawer passes the map hour in and moves the scrubber out', () => {
  const src = read('components/spot-drawer/SpotReportContent.js');
  expect(src).toMatch(/<SpotConditions spotId=\{spot\?\.id\} spotName=\{spot\?\.name\} timeOffsetHours=\{timeOffsetHours\}/);
  expect(src).toMatch(/window\.setTimeOffsetHours\(h\)/);
});

test('the charts read only the backend proxy (never the private bucket, never Open-Meteo)', () => {
  const dir = path.join(__dirname, '..', 'components', 'spot-hub', 'charts');
  const prod = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !/\.test\.js$|\.fixture\.js$/.test(f));
  const all = prod.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  expect(all).toMatch(/\/weather\/spot-series\//);
  expect(all).not.toMatch(/supabase|storage\/v1|weather-products|open-meteo|openmeteo/i);
  expect(all).not.toMatch(/computeSurfRating|ratingScore\(/);   // ONE FORECAST COMPOSITION: no client re-rating
});
