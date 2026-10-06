// Daily rows are date-only identifiers sampled at noon UTC, not local-midnight instants.
// Keep their calendar intact in every viewer timezone. Hourly/tide formatting stays local.
export function forecastCalendar(dateId, nowMs = Date.now()) {
  const unknown = { weekday: 'Unavailable', dateNumber: '—', monthDay: '—', relative: 'Unavailable', shortRelative: '—' };
  if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return unknown;
  const date = new Date(`${dateId}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateId) return unknown;
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const now = new Date(nowMs);
  const today = Number.isFinite(now.getTime()) ? now.toISOString().slice(0, 10) : null;
  const tomorrow = today ? new Date(`${today}T12:00:00Z`) : null;
  tomorrow?.setUTCDate(tomorrow.getUTCDate() + 1);
  const relative = dateId === today ? 'Today' : dateId === tomorrow?.toISOString().slice(0, 10) ? 'Tomorrow' : weekday;
  return { weekday, dateNumber: date.getUTCDate(),
    monthDay: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    relative, shortRelative: relative === 'Tomorrow' ? 'Tom' : relative };
}
