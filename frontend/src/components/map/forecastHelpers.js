/**
 * forecastHelpers.js
 * Extracted helper utilities for weather forecasting and unit conversions.
 */

export var mToFt = (m) => m != null ? (m * 3.281).toFixed(1) : null;

export var degToCompass = (deg) => {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

export function findHourIndex(timeArray, timeOffsetHours) {
  if (!timeArray) return 0;
  const targetTime = new Date();
  targetTime.setHours(targetTime.getHours() + timeOffsetHours);
  const targetTs = targetTime.getTime();

  let closest = 0;
  let minDiff = Infinity;
  timeArray.forEach((t, i) => {
    const diff = Math.abs(new Date(t + 'Z').getTime() - targetTs);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  });
  return closest;
}

export function getClampedValue(array, index) {
  if (!array || !Array.isArray(array) || array.length === 0) return null;
  const clampedIndex = Math.max(0, Math.min(index, array.length - 1));
  for (let i = clampedIndex; i >= 0; i--) {
    if (array[i] !== null && array[i] !== undefined) return array[i];
  }
  for (let i = clampedIndex + 1; i < array.length; i++) {
    if (array[i] !== null && array[i] !== undefined) return array[i];
  }
  return null;
}

export function getBiasAdjusted(val, variableType, activeModel, timeOffsetHours) {
  if (val == null) return null;
  const isSwell2 = variableType === 'swell2';
  const isFallback = (activeModel === 'ICON' && (timeOffsetHours > 180 || isSwell2));
  if (!isFallback) return val;
  if (activeModel === 'ICON') {
    if (variableType === 'wind' || variableType === 'wind_gusts') return val * 0.97;
    if (variableType === 'wave' || variableType === 'swell1' || variableType === 'wind_wave') return val * 0.96;
  }
  return val;
}
