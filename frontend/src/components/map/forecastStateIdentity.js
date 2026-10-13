export function forecastStateIdentityEnabled(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  return process.env.REACT_APP_FORECAST_STATE_IDENTITY === 'true' &&
    !(w && w.__RAW_DISABLE_FORECAST_STATE_IDENTITY__ === true);
}

// Rating payloads are small JSON records. Compare all fields, including nested explanations,
// without treating object insertion order as a new reading or dropping future wire fields.
export function sameForecastReading(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameForecastReading(a[k], b[k]));
}
