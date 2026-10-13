import { updateWebGLMarineLayerDiag } from './WebGLMarineLayerDiag';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const time = '2026-10-09T00:00:00.000Z';
const cycle = '2026-10-05T00:00:00.000Z';
const receipt = {
  model: 'GFS', layer: 'waves', provider: 'open-meteo', sourceDataset: 'ncep_gfswave025',
  servedValidTime: time, modelRunTime: cycle, modelRunTimeStatus: 'known',
  storedProductId: 'gfs-world.json', isEstimated: false,
};
const grid = {
  __sourceModel: 'GFS', __componentLayer: 'waves', __gridProvider: 'open-meteo',
  __sourceDataset: 'ncep_gfswave025', served_valid_time: time,
  model_run_time: cycle, model_run_time_status: 'known', productId: 'gfs-world.json',
  hourOffset: 98, is_estimated: false, vectors: [{ speed: 5.79 }],
};
function drive(resident = grid, point = receipt) {
  window.__MARINE_POINT_DIAG__ = {
    activeModel: 'GFS', activeLayer: 'waves', provider: 'open-meteo',
    timeOffsetHours: 98, frameReceipt: point,
  };
  updateWebGLMarineLayerDiag({ particleRes: 2, _waveData: { waveGrid: resident } },
    'GFS', ['waves'], 98, { gridProvider: 'open-meteo', vectorsLength: 1 });
  return window.__WebGLMarineLayer_DIAG__;
}
afterEach(() => {
  delete window.__MARINE_POINT_DIAG__;
  delete window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__;
});
test('matching selected controls cannot conceal a previous resident absolute frame', () => {
  const diag = drive({ ...grid, served_valid_time: '2026-10-08T00:00:00Z' });
  expect(diag.infoboxHeatmapParity).toBe(false);
  expect(diag.frameParity.status).toBe('mismatch');
  expect(diag.frameParity.mismatches).toContain('servedValidTime');
});
test('matching requested hour with no actual time is unverified, never a pass', () => {
  const diag = drive({ ...grid, served_valid_time: null, valid_time: time }, null);
  expect(diag.infoboxHeatmapParity).toBe(false);
  expect(diag.frameParity.status).toBe('unverified');
});
test('actual matching frame and cycle qualify parity', () => {
  const diag = drive();
  expect(diag.infoboxHeatmapParity).toBe(true);
  expect(diag.residentFrame.servedValidTime).toBe(time);
  expect(diag.frameParity.status).toBe('match');
});
test('different regional and world object IDs alone are not a physical mismatch', () => {
  const diag = drive(grid, { ...receipt, storedProductId: 'gfs-regional.json' });
  expect(diag.frameParity.status).toBe('match');
  expect(diag.frameParity.productRelation).toBe('different');
});
test('a missing resident cannot pass because the selected controls agree', () => {
  expect(drive(null).infoboxHeatmapParity).toBe(false);
});
test('the native grid mapper retains verified cycle metadata for the renderer', () => {
  const data = mapNormalizedGridToWebGL({
    model: 'GFS', provider: 'open-meteo', served_valid_time: time,
    model_run_time: cycle, model_run_time_status: 'known',
    grid: { cols: 2, rows: 1, vectors: [{ speed: 5.79 }, { speed: 5.79 }] },
  }, { west: -88, south: 28, east: -86, north: 30 }, 98);
  expect(data.grid.frameReceipt.modelRunTime).toBe(cycle);
  expect(data.grid.frameReceipt.modelRunTimeStatus).toBe('known');
  // Carrying cycle fields in the legacy slot would change base-hold selection (D-001).
  expect(data.grid.model_run_time).toBeUndefined();
});
