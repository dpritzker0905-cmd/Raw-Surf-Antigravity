import { verifiedCycleTime } from './verifiedCycleTime';

// Scalar evidence only: never compute a forecast or borrow the selected controls/receipt clock.
const stringOrNull = value => typeof value === 'string' && value.trim() ? value : null;
const qualifiedTime = value => typeof value === 'string'
  && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

export function residentFrameDiagnosticsEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__ === true);
}

export function readMarineFrameReceipt(source) {
  if (!source || !residentFrameDiagnosticsEnabled()) return null;
  if (source.frameReceipt) return source.frameReceipt;
  const cycle = verifiedCycleTime(source);
  // Series product_id is a truth-chain key. Only its separate served ID names a stored object.
  const storedId = source.__servedProductId || source.served_product_id
    || (!source.__fromSeries && (source.productId || source.product_id));
  const dataset = Object.prototype.hasOwnProperty.call(source, 'source_dataset')
    ? source.source_dataset : source.__sourceDataset;
  return {
    model: stringOrNull(source.__sourceModel || source.model),
    layer: stringOrNull(source.__componentLayer || source.layer),
    provider: stringOrNull(source.__gridProvider || source.provider),
    sourceDataset: stringOrNull(dataset),
    requestedValidTime: qualifiedTime(source.valid_time || source.validTime),
    servedValidTime: qualifiedTime(source.served_valid_time),
    modelRunTime: qualifiedTime(cycle.model_run_time),
    modelRunTimeStatus: cycle.model_run_time_status,
    storedProductId: stringOrNull(storedId),
    isEstimated: typeof source.is_estimated === 'boolean' ? source.is_estimated : null,
    frameOffsetHours: Number.isFinite(source.frame_offset_hours) ? source.frame_offset_hours : null,
    frameSubstituted: typeof source.frame_substituted === 'boolean' ? source.frame_substituted : null,
  };
}

// This certifies comparable provenance, not equal pixels/values or spatial resolution.
export function compareMarineFrameReceipts(resident, point) {
  const required = ['model', 'layer', 'provider', 'sourceDataset', 'servedValidTime', 'modelRunTime', 'isEstimated'];
  const missing = [], mismatches = [];
  for (const key of required) {
    if (resident?.[key] == null || point?.[key] == null
      || (key === 'modelRunTime' && (resident.modelRunTimeStatus !== 'known' || point.modelRunTimeStatus !== 'known'))) missing.push(key);
    else if (resident[key] !== point[key]) mismatches.push(key);
  }
  // A regional product and a world product can describe the same physical forecast cycle/time.
  const productRelation = resident?.storedProductId && point?.storedProductId
    ? (resident.storedProductId === point.storedProductId ? 'same' : 'different') : 'unverified';
  return {
    status: mismatches.length ? 'mismatch' : missing.length ? 'unverified' : 'match',
    mismatches, missing, productRelation,
  };
}

// Keep pasted console captures self-contained; never serialize a grid/texture or console Object.
export function marineForensicFrameEvidence(grid, pointDiag = typeof window !== 'undefined' ? window.__MARINE_POINT_DIAG__ : null) {
  if (!residentFrameDiagnosticsEnabled()) return {};
  return {
    frameReceipt: readMarineFrameReceipt(grid),
    pointFrameReceipt: pointDiag?.frameReceipt || null,
    pointLat: Number.isFinite(pointDiag?.point?.lat) ? pointDiag.point.lat : null,
    pointLng: Number.isFinite(pointDiag?.point?.lng) ? pointDiag.point.lng : null,
    pointWaveHeightM: Number.isFinite(pointDiag?.exactPointValues?.wave_height) ? pointDiag.exactPointValues.wave_height : null,
  };
}
