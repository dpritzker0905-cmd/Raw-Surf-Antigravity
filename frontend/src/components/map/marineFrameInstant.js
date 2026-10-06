// Only the actual served clock identifies the resident's physical frame. The requested echo,
// hour label, receipt time and diagnostic envelope cannot certify it across an anchor rollover.
export function marineFrameInstant(grid) {
  const value = grid?.served_valid_time;
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

export function sameMarineFrameInstant(resident, incoming) {
  const r = marineFrameInstant(resident), i = marineFrameInstant(incoming);
  return r !== null && i !== null && r === i;
}
