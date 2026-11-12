// Ephemeral UI intent only. Keep auth cleanup free of weather acquisition imports.
export const mapWeatherRouteMemory = { entries: new Map(), owner: null };
export function clearMapWeatherRouteMemory() {
  mapWeatherRouteMemory.entries.clear();
  mapWeatherRouteMemory.owner = null;
}
