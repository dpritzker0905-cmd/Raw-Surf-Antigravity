import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '../../frontend/src/contexts/ThemeContext';
import SpotConditions from '../../frontend/src/components/SpotConditions';
import { MapWeatherControls } from '../../frontend/src/components/map/MapWeatherControls';
import { useWeatherState } from '../../frontend/src/hooks/useWeatherState';
import { _cacheMarineResult } from '../../frontend/src/components/map/marineControllerCache';
import { getSharedValidTime, setCachedManifest } from '../../frontend/src/components/map/backendWeatherServiceClient';
import { getThemeTokens } from '../../frontend/src/utils/themeTokens';

window.__USE_BACKEND_WEATHER_SERVICE__ = true;
window.__MARINE_SIBLING_PREWARM__ = false;
window.map = { getBounds: () => ({ getWest: () => -130, getEast: () => -10, getSouth: () => 0, getNorth: () => 60 }) };
window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
const now = new Date(); now.setUTCMinutes(0, 0, 0);
setCachedManifest({ products: Array.from({ length: 113 }, (_, i) => ({ model: 'GFS', domain: 'marine', layer: 'waves',
  valid_time_start: new Date(now.getTime() + i * 3 * 3600000).toISOString() })) });
function deliver(hour) {
  _cacheMarineResult('GFS', hour, { grid: {
    bounds: { west: -180, east: 180, south: -80, north: 85 }, cols: 181, rows: 82,
    vectors: [{ speed: 2, lat: 28, lng: -80 }], __sourceModel: 'GFS', __componentLayer: 'waves',
    valid_time: getSharedValidTime(hour, 'waves', 'GFS', { readOnly: true }),
    __decimatedStride: 1, __gridProvider: 'open-meteo', hourOffset: hour,
  } }, 'waves', true);
}
deliver(0);
const fixtureUser = { subscription_tier: 'premium' };
function Preview() {
  const { toggleTheme, theme } = useTheme();
  const tokens = getThemeTokens(theme);
  const weather = useWeatherState({ user: fixtureUser });
  const [mobile, setMobile] = useState(false);
  return <main className={`p-4 ${tokens.pageBg} ${tokens.textPrimary} min-h-screen`}>
    <h1 className="text-xl font-bold">Forecast repair preview</h1>
    <p className="text-sm my-2">Offline component fixture; frame delivery is simulated. This does not measure map pixels or backend speed.</p>
    <div className="flex flex-wrap gap-2 my-4">
      {['light', 'dark', 'beach'].map(theme => <button className="p-2 border rounded" key={theme} onClick={() => toggleTheme(theme)}>{theme}</button>)}
      <button className="p-2 border rounded" onClick={() => setMobile(!mobile)}>{mobile ? 'Desktop layout' : 'Phone layout'}</button>
      <button className="p-2 border rounded" onClick={() => weather.setActiveLayers(['waves'])}>Show wave timeline</button>
      <button className="p-2 border rounded" onClick={() => deliver(weather.timeOffsetHours + 6 > weather.maxHoursForUser ? 0 : weather.timeOffsetHours + 6)}>Deliver next exact frame</button>
    </div>
    <p className="my-2" data-testid="fixture-hour">Selected +{weather.timeOffsetHours}h; {weather.isForecastBuffering ? 'Buffering' : 'Ready'}</p>
    <section className="my-4" style={{ maxWidth: mobile ? 360 : 480 }}>
      <MapWeatherControls isDesktop={!mobile} activeModel={weather.activeModel} activeLayers={weather.activeLayers}
        onModelChange={weather.setActiveModel} onLayerToggle={weather.toggleLayer} userTier="premium"
        currentTimeOffset={weather.timeOffsetHours} onTimeChange={weather.setTimeOffsetHours}
        isPlaying={weather.isPlayingTimeline} isBuffering={weather.isForecastBuffering}
        onTogglePlay={() => weather.setIsPlayingTimeline(!weather.isPlayingTimeline)} />
    </section>
    <section className="my-4" style={{ maxWidth: mobile ? 360 : 480 }}>
      <h2 className="my-2">Missing sea</h2><SpotConditions spotId="missing" compact />
      <div className="my-2"><SpotConditions spotId="missing" /></div>
      <h2 className="my-2">Measured calm</h2><SpotConditions spotId="calm" compact />
    </section>
    <section className="my-4" data-testid="calendar-fixture" style={{ maxWidth: mobile ? 360 : 480 }}>
      <h2 className="my-2">Calendar and canonical size labels</h2>
      <SpotConditions spotId="calendar" compact />
      <div className="my-2"><SpotConditions spotId="calendar" /></div>
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><Preview /></ThemeProvider>);
