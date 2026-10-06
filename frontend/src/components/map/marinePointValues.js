// Served-value semantics are dark under D-001; this runtime switch can only disable them.
export function marineValueValidityEnabled() {
  return process.env.REACT_APP_MARINE_VALUE_VALIDITY === 'true'
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_VALUE_VALIDITY__ === true);
}

export function marinePointValues(point) {
  const unavailable = !point || point.interpolation_method === 'unavailable' || point.is_valid === false;
  return {
    height: unavailable || !Number.isFinite(point.speed) || point.speed < 0 ? null : point.speed,
    direction: unavailable || !Number.isFinite(point.direction) ? null : ((point.direction % 360) + 360) % 360,
    period: unavailable || !Number.isFinite(point.period) || point.period <= 0 ? null : point.period,
  };
}
