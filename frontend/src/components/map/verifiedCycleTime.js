// Forecast lead is valid time minus verified initialization, never receipt or slider time.
export function verifiedCycleTime(data) {
  const qualified = value => typeof value === 'string'
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
  let status = data.model_run_time_status || 'missing';
  if (status === 'known' && !qualified(data.model_run_time)) status = 'invalid';
  const cycle = status === 'known' ? data.model_run_time : null;
  return {
    model_run_time: cycle,
    model_run_time_status: status,
    ingested_at: data.ingested_at ?? null,
    forecastLeadHours: cycle && qualified(data.valid_time || data.validTime)
      ? (Date.parse(data.valid_time || data.validTime) - Date.parse(cycle)) / 3600000 : null,
  };
}
