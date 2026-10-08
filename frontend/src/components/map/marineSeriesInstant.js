import { seriesAnchorTag } from './seriesAnchor';

const HOUR_MS = 3600000;

// Changes the selected forecast frame, so this repair stays dark pending owner arming.
export function seriesInstantTarget(hourOffset) {
  if (process.env.REACT_APP_MARINE_SERIES_INSTANT_MATCH !== 'true'
      || (typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_SERIES_INSTANT_MATCH__ === true)) return null;
  const anchor = Date.parse(seriesAnchorTag().slice(1));
  const hour = Number(hourOffset);
  return Number.isFinite(anchor) && Number.isFinite(hour) ? anchor + hour * HOUR_MS : NaN;
}

export function seriesFrameDistance(frame, legacyHour, hourOffset, targetMs) {
  if (targetMs === null) return Math.abs(legacyHour - hourOffset);
  // valid_time identifies the requested frame; served_valid_time remains the separate
  // substitution receipt. Never replace that receipt or invent an absent instant.
  const valid = Date.parse(frame?.valid_time ?? frame?.grid?.valid_time);
  return Number.isFinite(valid) && Number.isFinite(targetMs) ? Math.abs(valid - targetMs) / HOUR_MS : Infinity;
}

export function rebaseSeriesFrame(frame, hourOffset, targetMs) {
  if (targetMs === null) return frame;
  const anchor = targetMs - Number(hourOffset) * HOUR_MS;
  const valid = Date.parse(frame.valid_time ?? frame.grid?.valid_time);
  const offset = (valid - anchor) / HOUR_MS;
  if (offset === frame.hourOffset && offset === frame.grid?.hourOffset) return frame;
  const truthTag = frame.truthTag ? { ...frame.truthTag, timeOffsetHours: offset } : null;
  return { ...frame, hourOffset: offset, ...(truthTag ? { truthTag } : {}),
    ...(frame.grid ? { grid: { ...frame.grid, hourOffset: offset, ...(truthTag ? { truthTag } : {}) } } : {}) };
}
