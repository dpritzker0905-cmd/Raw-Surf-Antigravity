function qualifiedInstant(value) {
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.slice(1, 6).map(Number);
  const second = Number(parts[6] || 0);
  // Date.parse normalizes impossible dates such as February30. Those are missing evidence.
  const days = new Date(Date.UTC(year + 400, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// Only the actual served clock identifies the resident's physical frame. The requested echo,
// hour label, receipt time and diagnostic envelope cannot certify it across an anchor rollover.
export function marineFrameInstant(grid) {
  return qualifiedInstant(grid?.served_valid_time);
}

export function sameMarineFrameInstant(resident, incoming) {
  const r = marineFrameInstant(resident), i = marineFrameInstant(incoming);
  return r !== null && i !== null && r === i;
}

// The REQUESTED instant (`valid_time`: the ask's echo on /grid, the frame's own time on /grid_series). It does not certify the
// physical frame (above), but it is what an hour LABEL stands for, and it survives an anchor rollover that the label does not.
// Used ONLY by the label-mode comparisons (2026-10-08, the paused-heatmap churn): at 3-hourly range several labels ask for one
// product, so the selected hour 16 (13:00Z, snapped to 12:00Z) and a series page's hour 15 (12:00Z) are ONE forecast time, and
// "16 !== 15" read as an hour change let a 2-degree clip replace the 0.25-degree tile the no-downgrade guard exists to keep.
export function marineRequestedInstant(grid) {
  return qualifiedInstant(grid?.valid_time);
}

// Kill switch for both halves of that fix (this one and marineHourInstant.js): window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true.
export function sameMarineRequestedInstant(resident, incoming, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_HOUR_BY_INSTANT__ === true) return false;
  const r = marineRequestedInstant(resident), i = marineRequestedInstant(incoming);
  return r !== null && i !== null && r === i;
}

// The label-mode guards' "same hour": equal labels, or two labels that asked for the same instant. Only ever WIDENS the old test.
export function sameMarineLabelledHour(resident, incoming, win) {
  const labelled = incoming.hourOffset !== undefined && resident.hourOffset !== undefined;
  return (labelled && incoming.hourOffset === resident.hourOffset) || sameMarineRequestedInstant(resident, incoming, win);
}
