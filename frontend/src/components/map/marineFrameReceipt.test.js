import { readMarineFrameReceipt, compareMarineFrameReceipts, marineForensicFrameEvidence } from './marineFrameReceipt';
import { frameToMarineData } from './marineSeriesFrame';
const raw = {
  model: 'GFS', layer: 'waves', provider: 'open-meteo', source_dataset: 'ncep_gfswave025',
  served_valid_time: '2026-10-09T00:00:00Z', model_run_time: '2026-10-05T00:00:00Z',
  model_run_time_status: 'known', product_id: 'stored.json', is_estimated: false,
};
afterEach(() => { delete window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__; });
test.each(['invalid', '2026-10-09T00:00:00', '2026-10-09', 1791504000000, null])(
  'unqualified served timestamp %s cannot borrow valid_time or hourOffset', value => {
    expect(readMarineFrameReceipt({ ...raw, served_valid_time: value,
      valid_time: raw.served_valid_time, hourOffset: 98 }).servedValidTime).toBeNull();
  });
test('equivalent timezone-qualified timestamps compare equally', () => {
  const a = readMarineFrameReceipt(raw);
  const b = readMarineFrameReceipt({ ...raw, served_valid_time: '2026-10-08T20:00:00-04:00' });
  expect(compareMarineFrameReceipts(a, b).status).toBe('match');
});
test.each(['missing', 'legacy_unknown', 'invalid', undefined])('unverified cycle status %s never qualifies', status => {
  const a = readMarineFrameReceipt({ ...raw, model_run_time_status: status });
  expect(a.modelRunTime).toBeNull();
  expect(compareMarineFrameReceipts(a, a).status).toBe('unverified');
});
test('a claimed-known invalid cycle is invalid and not inferred from ingestion/run time', () => {
  const a = readMarineFrameReceipt({ ...raw, model_run_time: '2026-10-05',
    ingested_at: raw.model_run_time, run_time: raw.model_run_time });
  expect(a.modelRunTimeStatus).toBe('invalid'); expect(a.modelRunTime).toBeNull();
});
test.each([
  ['model', 'ICON'], ['layer', 'swell_1'], ['provider', 'copernicus'],
  ['sourceDataset', 'different'], ['modelRunTime', '2026-10-05T06:00:00.000Z'],
  ['servedValidTime', '2026-10-09T03:00:00.000Z'], ['isEstimated', true],
])('actual %s mismatch outranks incomplete metadata', (field, value) => {
  const a = readMarineFrameReceipt(raw), b = { ...a, [field]: value, storedProductId: null };
  expect(compareMarineFrameReceipts(a, b)).toMatchObject({ status: 'mismatch', mismatches: [field] });
});
test.each(['model', 'layer', 'provider', 'sourceDataset', 'servedValidTime', 'modelRunTime', 'isEstimated'])(
  'missing %s refuses certification', field => {
    const a = readMarineFrameReceipt(raw);
    expect(compareMarineFrameReceipts(a, { ...a, [field]: null }))
      .toMatchObject({ status: 'unverified', missing: [field] });
  });
test('series lineage ID never becomes a stored product ID', () => {
  const a = readMarineFrameReceipt({ ...raw, __fromSeries: true, product_id: 'series_GFS_waves_h98' });
  expect(a.storedProductId).toBeNull();
  expect(readMarineFrameReceipt({ ...raw, __fromSeries: true, __servedProductId: 'actual.json' })
    .storedProductId).toBe('actual.json');
});
test('series legacy display dataset guess is not certified as reported provenance', () => {
  const data = frameToMarineData({ ...raw, source_dataset: undefined, hour_offset: 98,
    vectors: [{ speed: 5.79 }], cols: 1, rows: 1 }, 'GFS', 'waves');
  expect(data.grid.__sourceDataset).toBe('ncep_gfswave025');
  expect(readMarineFrameReceipt(data.grid).sourceDataset).toBeNull();
  expect(data.product_id).toBe('series_GFS_waves_h98');
});
test('diagnostics never iterate cells or change their heights', () => {
  const vectors = new Proxy([], { get() { throw new Error('unexpected cell read'); } });
  const input = Object.freeze({ ...raw, vectors });
  expect(readMarineFrameReceipt(input).storedProductId).toBe('stored.json');
});
test('kill switch returns no newly certified evidence', () => {
  window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__ = true;
  expect(readMarineFrameReceipt(raw)).toBeNull();
});
test('pasted forensic JSON carries both actual receipts, coordinate and offshore reading', () => {
  const receipt = readMarineFrameReceipt(raw);
  const snap = JSON.parse(JSON.stringify(marineForensicFrameEvidence(raw, {
    frameReceipt: receipt, point: { lat: 30, lng: -87 }, exactPointValues: { wave_height: 5.79 },
  })));
  expect(snap.frameReceipt.servedValidTime).toBe(receipt.servedValidTime);
  expect(snap.pointFrameReceipt.modelRunTime).toBe(receipt.modelRunTime);
  expect(snap).toMatchObject({ pointLat: 30, pointLng: -87, pointWaveHeightM: 5.79 });
});
test('missing or non-finite point evidence stays null rather than manufacturing a reading', () => {
  const snap = marineForensicFrameEvidence(raw, { point: { lat: NaN, lng: Infinity }, exactPointValues: { wave_height: NaN } });
  expect(snap).toMatchObject({ pointFrameReceipt: null, pointLat: null, pointLng: null, pointWaveHeightM: null });
});
test('the forensic evidence kill switch restores the old snapshot shape', () => {
  window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__ = true;
  expect(marineForensicFrameEvidence(raw)).toEqual({});
});
