/**
 * Per-screen blindness proof for the blind surf-quality question (gates/surf-tide-v1.md section 0).
 *
 * 1. THE BLIND SCREENS show no forecast, rating, tide read or best_tide text: CheckInModal and ConditionsModal (and the
 *    observation components they render) import no forecast, rating or tide module, fetch no forecast endpoint, and
 *    name no best_tide / tide factor / rating field. The server's own audit (backend observations.ENTRY_SCREENS) marks
 *    exactly these two screens forecast_shown_before = false; the spot page's form (SpotConditions) is marked true and
 *    never asks the question.
 * 2. EVERY OTHER SURFACE that renders a forecast records it (useNoteForecastShown), so the question is not asked later
 *    in that session: any file that imports a forecast, rating or tide module must call the hook, unless it is a pure
 *    (non-rendering) module listed below with its reason. A new forecast surface fails here until it is handled.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Forecast, rating and tide modules (the data and logic behind every forecast surface).
const FORECAST_MODULES = [
  'spotHubP1', 'spotHubP1Format', 'useSpotRatings', 'surfRating', 'pointRatingClient', 'usePointRating',
  'forecastCardCompiler', 'useSpotSeries', 'spotRatingsClient', 'spotSeriesModel', 'spotRatingsCdn', 'tideClient',
  'SpotChartPanel', 'SpotTideBlock', 'SpotHubTides', 'ForecastConditionRows', 'SpotQualityBadge', 'SpotConditions',
];
const importsOf = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const isForecastImport = (spec) => FORECAST_MODULES.some((m) => spec.endsWith(`/${m}`) || spec === `./${m}`);

// Pure modules: they compute or fetch but render nothing; whatever renders their output is itself checked here.
const PURE = {
  'components/map/forecastCardCompiler.js': 'builds card data; rendered by MapForecastOverlay / ForecastConditionRows',
  'components/map/pointRatingClient.js': 'fetch client; used by usePointRating',
  'components/map/usePointRating.js': 'data hook; its only renderers are map surfaces (MapForecastOverlay)',
  'components/map/spotRatingsClient.js': 'fetch client; used by useSpotRatings',
  'components/map/useSpotRatings.js': 'data hook; rendered as glyphs by MapWebGL',
  'components/map/spotRatingsCdn.js': 'fetch client',
  'components/map/tideClient.js': 'fetch client',
  'components/map/usePointTide.js': 'data hook; rendered by map surfaces that record exposure',
  'components/map/tideOverlayModel.js': 'tide overlay model; drawn only by TideOverlayLayer inside MapWebGL, which records map',
  'components/map/surfRating.js': 'rating helpers; no UI',
  'components/spot-hub/spotHubP1.js': 'window and tier helpers; no UI',
  'components/spot-hub/spotHubP1Format.js': 'formatting helpers; no UI',
  'components/spot-hub/charts/useSpotSeries.js': 'data hook; rendered by SpotChartPanel',
  'components/spot-hub/charts/spotSeriesModel.js': 'series model; no UI',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== '__mocks__') walk(p, out); }
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('blind screens show nothing the quality answer could anchor on', () => {
  const BLIND = [
    'components/feed/CheckInModal.js', 'components/ConditionsModal.js',
    'components/observations/BlindHeightInput.js', 'components/observations/BlindQualityInput.js',
    'components/observations/TrainingConsent.js', 'components/observations/blindQuality.js',
    'components/observations/postObservation.js', 'hooks/feed/useFeedCheckInActions.js',
  ];

  test.each(BLIND)('%s imports no forecast, rating or tide module', (rel) => {
    expect(importsOf(read(rel)).filter(isForecastImport)).toEqual([]);
    expect(importsOf(read(rel)).filter((s) => /\/(map|spot-hub)\//.test(s))).toEqual([]);
  });

  test.each(BLIND)('%s fetches no forecast endpoint and names no best_tide, tide factor or rating field', (rel) => {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // code, not comments
    expect(code).not.toMatch(/['"`]\/?(api\/)?(weather|spot-hub|spot-details|spot-ratings|surf-conditions)\b/);
    expect(code).not.toMatch(/best_?tide|bestTide|tide_fit|tide_norm|surf_rating|rating_score|\.rating\b/i);
  });

  test('check-in asks the blind questions before its "Conditions" words (Glassy ... Blown Out) can anchor them', () => {
    const code = read('components/feed/CheckInModal.js');
    const blind = code.indexOf('<BlindHeightInput');
    const conditions = code.search(/>\s*Conditions\s*</);
    expect(blind).toBeGreaterThan(-1);
    expect(conditions).toBeGreaterThan(blind);
  });

  test('both blind screens ask the question; the spot page form does not', () => {
    expect(read('components/feed/CheckInModal.js')).toMatch(/<BlindHeightInput[\s\S]*?askQuality[\s\S]*?\/>/);
    expect(read('components/ConditionsModal.js')).toMatch(/<BlindHeightInput[^>]*askQuality/);
    expect(read('components/SpotConditions.js')).not.toMatch(/askQuality/);
  });
});

describe('every forecast surface records that it was shown', () => {
  const files = walk(path.join(SRC, 'components')).map((p) => path.relative(SRC, p).split(path.sep).join('/'));
  const surfaces = files.filter((rel) => importsOf(read(rel)).some(isForecastImport)
    || FORECAST_MODULES.some((m) => rel.endsWith(`/${m}.js`)));

  test('the scan finds the known surfaces (null control: it is not vacuous)', () => {
    ['components/map/MapWebGL.js', 'components/SpotHub.js', 'components/ExploreSpotCard.js',
      'components/SpotConditions.js'].forEach((f) => expect(surfaces).toContain(f));
  });

  test('each one calls useNoteForecastShown, or is a listed pure module', () => {
    const missing = surfaces.filter((rel) => !PURE[rel] && !/useNoteForecastShown\(|noteForecastShown\(/.test(read(rel)));
    expect(missing).toEqual([]);
  });

  test('no listed pure module renders JSX (a renderer must record exposure instead)', () => {
    Object.keys(PURE).filter((rel) => fs.existsSync(path.join(SRC, rel))).forEach((rel) => {
      expect([rel, /return\s*\(\s*</.test(read(rel))]).toEqual([rel, false]);
    });
  });
});
