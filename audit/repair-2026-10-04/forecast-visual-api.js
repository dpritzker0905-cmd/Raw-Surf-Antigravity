// Offline fixtures only. No request or credential can leave this preview.
export const API_BASE = '/api', BACKEND_URL = '';
const dayId = offset => {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};
export default { get: async url => ({ data: url.startsWith('/conditions/forecast/') ? { forecast: url.includes('/calendar') ? [
  { date: dayId(1), wave_height_min: 5.4, wave_height_max: 9, label: 'Overhead' },
  { date: dayId(3), wave_height_min: 7.2, wave_height_max: 12, label: 'Double Overhead' },
] : [] }
  : url.startsWith('/conditions/') ? { current: { wave_height_ft: url.includes('/calendar') ? 9 : url.includes('/calm') ? 0 : null,
    swell_height_ft: null, wave_period: null, label: url.includes('/calendar') ? 'Overhead' : url.includes('/calm') ? 'Flat' : 'Unavailable' } } : {} }) };
