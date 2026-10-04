// Offline fixtures only. No request or credential can leave this preview.
export const API_BASE = '/api', BACKEND_URL = '';
export default { get: async url => ({ data: url.startsWith('/conditions/forecast/') ? { forecast: [] }
  : url.startsWith('/conditions/') ? { current: { wave_height_ft: url.includes('/calm') ? 0 : null,
    swell_height_ft: null, wave_period: null, label: url.includes('/calm') ? 'Flat' : 'Unavailable' } } : {} }) };
