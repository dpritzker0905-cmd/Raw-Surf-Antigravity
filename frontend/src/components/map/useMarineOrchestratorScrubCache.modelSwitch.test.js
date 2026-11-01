/**
 * INSTANT MODEL TOGGLE seam (Stage A, 2026-10-22): at a model switch the orchestrator asks the frame store for the new model's stored
 * frame. It must ask for the model the fetch will draw (past a model's horizon, or ICON past 168 h with its backend flag off, that is
 * GFS) and only on a backend lane, as the scrub step does; then the prefetch follows the model it showed.
 */
import { showStoredFrameOnModelSwitch } from './useMarineOrchestratorScrubCache';
import { tryShowStoredFrameForSwitch, noteStep } from './marineFrameStoreRuntime';
import { getSharedValidTime } from './backendWeatherServiceClient';

const mockFlags = { gfs: true, icon: true, euro: true };
jest.mock('./marineFrameStoreRuntime', () => ({ tryShowStoredFrame: jest.fn(), tryShowStoredFrameForSwitch: jest.fn(() => true), noteStep: jest.fn() }));
jest.mock('./marineController', () => ({ getMarineHourlyCache: jest.fn(), getModelSafeMarine: jest.fn(), extractMarineAtOffset: jest.fn() }));
jest.mock('./marineGridSeries', () => ({ getMarineSeriesFrame: jest.fn(), ensureMarineSeries: jest.fn() }));
jest.mock('./backendWeatherServiceClient', () => ({
  getBackendWeatherFlag: () => mockFlags.gfs, getBackendIconMarineFlag: () => mockFlags.icon, getBackendCopernicusFlag: () => mockFlags.euro,
  getSharedValidTime: jest.fn((hour, layer, model) => `${model}@${hour}`),
}));

beforeEach(() => {                         // CRA's resetMocks clears implementations before each test: set them here
  jest.clearAllMocks(); Object.assign(mockFlags, { gfs: true, icon: true, euro: true });
  tryShowStoredFrameForSwitch.mockReturnValue(true);
  getSharedValidTime.mockImplementation((hour, layer, model) => `${model}@${hour}`);
});
const shownAs = () => tryShowStoredFrameForSwitch.mock.calls.map((c) => c[0].model);

describe('showStoredFrameOnModelSwitch', () => {
  it('asks for the new model at the current hour, then moves the prefetch to it', () => {
    expect(showStoredFrameOnModelSwitch({ model: 'ICON', layer: 'waves', hour: 24 })).toBe(true);
    expect(tryShowStoredFrameForSwitch).toHaveBeenCalledWith({ model: 'ICON', layer: 'waves', hourOffset: 24, requestedValidTime: 'ICON@24' });
    expect(getSharedValidTime).toHaveBeenCalledWith(24, 'waves', 'ICON', { readOnly: true });
    expect(noteStep).toHaveBeenCalledWith({ model: 'ICON', layer: 'waves', requestedValidTime: 'ICON@24' });
  });

  it.each([
    ['EURO past its 336 h horizon draws GFS', { model: 'EURO', hour: 340 }, {}, 'GFS'],
    ['ICON past 168 h with its backend flag off draws GFS', { model: 'ICON', hour: 200 }, { icon: false }, 'GFS'],
    ['ICON past 168 h with its backend flag on stays ICON', { model: 'ICON', hour: 200 }, {}, 'ICON'],
    ['ICON past its 336 h horizon draws GFS', { model: 'ICON', hour: 339 }, {}, 'GFS'],
  ])('mirrors the fetcher: %s', (_, sel, flags, want) => {
    Object.assign(mockFlags, flags);
    showStoredFrameOnModelSwitch({ ...sel, layer: 'waves' });
    expect(shownAs()).toEqual([want]);
  });

  it('never shows a stored frame for a model whose backend lane is off (the fetch would draw another product)', () => {
    mockFlags.euro = false;
    expect(showStoredFrameOnModelSwitch({ model: 'EURO', layer: 'waves', hour: 12 })).toBe(false);
    expect(tryShowStoredFrameForSwitch).not.toHaveBeenCalled();
    expect(noteStep).not.toHaveBeenCalled();
  });

  it('a runtime error is swallowed: the coalesced fetch serves the switch', () => {
    tryShowStoredFrameForSwitch.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(showStoredFrameOnModelSwitch({ model: 'ICON', layer: 'waves', hour: 0 })).toBe(false);
  });
});
