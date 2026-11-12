import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getAllowedModels, getUserTier, resolveForecastWindow } from './LayerAccessResolver';
import { forecastSelectionMs } from './forecastReadout';
import { mapWeatherRouteMemory } from './mapWeatherRouteMemoryStore';
export { clearMapWeatherRouteMemory } from './mapWeatherRouteMemoryStore';

// UI intent only: no forecasts, coordinates, credentials, or persistent storage.
const { entries } = mapWeatherRouteMemory;
const MAX_ENTRIES = 8;
const HOUR_MS = 3600000;
const LAYERS = new Set(['rain', 'radar', 'satellite', 'wind', 'waves', 'swell_1', 'swell_2',
  'wind_waves', 'fog', 'pressure', 'temperature', 'water_temp']);

export default function useMapWeatherRouteMemory({ user, activeModel, activeLayers, timeOffsetHours,
  setActiveLayers, setTimeOffsetHours, setIsPlayingTimeline }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const owner = user?.id == null ? null
    : `${user.id}:${getUserTier(user)}:${getAllowedModels(user).slice().sort().join(',')}`;
  const inputs = useRef(null);
  inputs.current = { user, activeModel, setActiveLayers, setTimeOffsetHours, setIsPlayingTimeline };
  const latest = useRef(null);
  const layer = activeLayers?.[0] || null;
  const hour = Number(timeOffsetHours);
  latest.current = owner && Number.isFinite(hour) && (!layer || LAYERS.has(layer))
    ? { owner, model: activeModel, layer, isNow: hour === 0, selectedMs: forecastSelectionMs(hour) }
    : null;

  useEffect(() => {
    if (mapWeatherRouteMemory.owner !== owner) { entries.clear(); mapWeatherRouteMemory.owner = owner; }
    if (!owner) return undefined;
    const { key, pathname, search } = location;
    const saved = entries.get(key);
    const input = inputs.current;
    if (navigationType === 'POP' && saved?.owner === owner
      && saved.pathname === pathname && saved.search === search
      && saved.model === input.activeModel && getAllowedModels(input.user).includes(saved.model)) {
      const anchor = forecastSelectionMs(0);
      const cap = Number(resolveForecastWindow(input.user, saved.model, saved.layer)) * 24;
      const requested = saved.isNow ? 0 : (saved.selectedMs - anchor) / HOUR_MS;
      if (Number.isFinite(requested) && Number.isFinite(cap)) {
        const restoredHour = Math.max(0, Math.min(requested, cap));
        // A fresh radar/satellite catalog owns its frame index; never revive old frames.
        const hourToApply = ['radar', 'satellite'].includes(saved.layer) ? 0 : restoredHour;
        latest.current = { ...saved, isNow: hourToApply === 0, selectedMs: forecastSelectionMs(hourToApply) };
        input.setIsPlayingTimeline(false);
        input.setActiveLayers(saved.layer ? [saved.layer] : []);
        input.setTimeOffsetHours(hourToApply);
      }
    }
    return () => {
      const value = latest.current;
      if (mapWeatherRouteMemory.owner !== owner) return;
      entries.delete(key);
      if (value?.owner !== owner) return;
      entries.set(key, { ...value, pathname, search });
      if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    };
  }, [owner, location, navigationType]);
}
