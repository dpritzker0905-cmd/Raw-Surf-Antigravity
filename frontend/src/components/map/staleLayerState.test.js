import { readRatedRunState, readWindStaleState } from './staleLayerState';
import { formatRunLocal } from './readoutDateFormat';
import { _resetMarineDrawnForTest } from './marineDrawnFrame';

// The ONE reader a header chip and the status line share (David approved the chip 2026-11-16 08:54 EST, via the advisor).
describe('readRatedRunState: the painted band run age, the same source and words as the status line', () => {
  const RUN = '2026-11-16T06:00:00Z';
  const paint = (ratedRun, extra = {}) => {
    window.__RAW_GPU__ = { ratingBand: { active: true }, ...extra };
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: { ratingMode: true, ratedRun } } };
  };
  afterEach(() => { delete window.__RAW_GPU__; delete window.__MARINE_ENGINE__; delete window.__RAW_DISABLE_RATED_RUN_LABEL__; });
  test('one run behind: the full sentence and the chip words', () => {
    paint({ lagH: 6, runTime: RUN });
    expect(readRatedRunState()).toEqual({ lagH: 6, runTime: RUN, short: 'Ratings 6 h old',
      text: `Surf ratings from the ${formatRunLocal(Date.parse(RUN))} run, 6 h older than the wave heights (a newer rating run is not published yet).` });
  });
  test('nothing to say: no lag, band not painted, band held, not a rating grid, or killed', () => {
    paint({ lagH: 0, runTime: RUN }); expect(readRatedRunState()).toBe(null);
    paint({ lagH: 6, runTime: RUN }); window.__RAW_GPU__.ratingBand.active = false; expect(readRatedRunState()).toBe(null);
    paint({ lagH: 6, runTime: RUN }, { ratingBandFade: { heldBy: 'edge' } }); expect(readRatedRunState()).toBe(null);
    paint({ lagH: 6, runTime: RUN }); window.__MARINE_ENGINE__._waveData.waveGrid.ratingMode = false; expect(readRatedRunState()).toBe(null);
    paint({ lagH: 6, runTime: RUN }); window.__RAW_DISABLE_RATED_RUN_LABEL__ = true; expect(readRatedRunState()).toBe(null);
  });
});

describe('readWindStaleState', () => {
  beforeEach(() => _resetMarineDrawnForTest());
  test('no wind drawn: nothing to say', () => {
    expect(readWindStaleState({ model: 'GFS', hour: 1 })).toBe(null);
  });
});
