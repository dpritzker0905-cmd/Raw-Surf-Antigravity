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
  // Per-model pressure (2026-10-24): ECMWF open data is CC BY 4.0 (attribution required); DWD asks for "Deutscher Wetterdienst".
  ecmwf: { text: 'EURO (ECMWF) · CC BY 4.0', href: 'https://www.ecmwf.int/en/forecasts/datasets/open-data', label: 'Data source: ECMWF open data, licence CC BY 4.0 (opens in a new tab)' },
  dwd: { text: 'ICON (Deutscher Wetterdienst)', href: 'https://opendata.dwd.de/', label: 'Data source: Deutscher Wetterdienst, ICON model (opens in a new tab)' },
};
const OWN_SOURCE = { GFS: 'noaa', EURO: 'ecmwf', ICON: 'dwd' };
// What a layer drawn from our own frames IS, where a reader could take it for something else (2026-10-25). Our cloud cover
// (the satellite layer) is GFS's INSTANTANEOUS field at the valid time. Open-Meteo's, on the .om path, is an hourly backward
// mean, and the two differ by definition: 7.0 points of percentage on average, 1.5 on the same definition (the a/b/c read,
// log 2026-10-24-claude-raster-cloud-cover). The note rides on the credit, which every layout of the legend shows.
const OWN_NOTE = {
  satellite: { text: ' · instantaneous', label: 'Cloud cover at the valid time, instantaneous (not an hourly mean).' },
};

export function creditFor(layer, engaged = getEngaged()) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_LAYER_DATA_CREDIT__ === true) return null;
  if (engaged && engaged[layer]) {
    const s = SOURCES[OWN_SOURCE[engaged[layer]] || 'noaa'];   // the model of the frame on screen
    const n = OWN_NOTE[layer];
    return n ? { ...s, text: s.text + n.text, label: `${n.label} ${s.label}`, title: n.label } : s;
  }
  return SOURCES[LAYER_CREDITS[layer]] || null;
}

export default function LayerDataCredit({ layer }) {
  const engaged = useSyncExternalStore(subscribeEngaged, getEngaged, getEngaged);
  const c = creditFor(layer, engaged);
  if (!c) return null;
  return (
    <a href={c.href} target="_blank" rel="noopener noreferrer" aria-label={c.label} title={c.title} data-testid="layer-data-credit"
      className="ml-2 shrink-0 normal-case tracking-normal font-normal underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded-sm">
      {c.text}
    </a>
  );
}
