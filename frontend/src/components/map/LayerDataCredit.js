import React, { useSyncExternalStore } from 'react';
import { getEngaged, subscribeEngaged } from './ownRasterFrames';

// The data credit beside a raster layer's legend (2026-10-22). The map's attribution control is off (MapWebGL
// attributionControl={false}), so nothing on screen credited the raster layers' sources:
//  - Open-Meteo's spatial .om data (rain, satellite, pressure, temperature, water temp, fog) is CC-BY-4.0 and asks for credit
//    with a licence link next to where the data is displayed (open-meteo.com/en/licence; weather-map-layer's own tile
//    attribution names the same link);
//  - RainViewer asks for "Rain Viewer" with a link (radar's observed frames and the nowcast built from them).
// One small link, in the legend's own muted text colour (theme-aware: light, dark and beach), a real <a> with an accessible
// name, opening in a new tab. Kill: window.__RAW_DISABLE_LAYER_DATA_CREDIT__ = true.
export const LAYER_CREDITS = {
  rain: 'open-meteo', satellite: 'open-meteo', pressure: 'open-meteo', temperature: 'open-meteo', water_temp: 'open-meteo',
  fog: 'open-meteo', radar: 'rainviewer',
};
const SOURCES = {
  'open-meteo': { text: '© Open-Meteo · CC BY 4.0', href: 'https://open-meteo.com/en/licence#maps', label: 'Data source: Open-Meteo, licence CC BY 4.0 (opens in a new tab)' },
  rainviewer: { text: '© RainViewer', href: 'https://www.rainviewer.com/', label: 'Radar data source: RainViewer (opens in a new tab)' },
  // A layer drawn from our own frames (ownRasterFrames.js, free NOAA GRIB): public domain, credited as a courtesy.
  noaa: { text: 'NOAA GFS', href: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast', label: 'Data source: NOAA NCEP Global Forecast System, public domain (opens in a new tab)' },
};

export function creditFor(layer, engaged = getEngaged()) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_LAYER_DATA_CREDIT__ === true) return null;
  if (engaged && engaged[layer]) return SOURCES.noaa;
  return SOURCES[LAYER_CREDITS[layer]] || null;
}

export default function LayerDataCredit({ layer }) {
  const engaged = useSyncExternalStore(subscribeEngaged, getEngaged, getEngaged);
  const c = creditFor(layer, engaged);
  if (!c) return null;
  return (
    <a href={c.href} target="_blank" rel="noopener noreferrer" aria-label={c.label} data-testid="layer-data-credit"
      className="ml-2 shrink-0 normal-case tracking-normal font-normal underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded-sm">
      {c.text}
    </a>
  );
}
