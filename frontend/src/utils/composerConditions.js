export const composerConditionsEnabled = () => process.env.REACT_APP_COMPOSER_CONDITIONS === 'true'
  && !globalThis.__RAW_DISABLE_COMPOSER_CONDITIONS__;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function conditionFields(data = {}) {
  const degrees = finite(data.wave_direction_degrees) && data.wave_direction_degrees >= 0 && data.wave_direction_degrees <= 360
    ? data.wave_direction_degrees : null;
  const number = name => finite(data[name]) ? String(data[name]) : '';
  const fields = {
    waveHeightFt: number('wave_height_ft'), wavePeriodSec: number('wave_period_sec'),
    windSpeedMph: number('wind_speed_mph'), tideHeightFt: number('tide_height_ft'),
    waveDirectionDegrees: degrees,
    waveDirection: degrees === null ? (directions.includes(data.wave_direction) ? data.wave_direction : '') : directions[Math.round(degrees / 45) % 8],
    windDirection: directions.includes(data.wind_direction) ? data.wind_direction : '',
    tideStatus: typeof data.tide_status === 'string' ? data.tide_status : '',
  };
  return { fields, available: ['waveHeightFt', 'wavePeriodSec', 'windSpeedMph', 'tideHeightFt'].some(k => fields[k] !== '') };
}
export function historicalSession(day, now = new Date()) {
  if (!day) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return day < today;
}
export function applyConditionFields(data, setters) {
  const result = conditionFields(data);
  for (const [name, value] of Object.entries(result.fields)) setters[name](value);
  return result.available;
}
