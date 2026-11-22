import React, { useSyncExternalStore } from 'react';
import { getEngaged, subscribeEngaged } from './ownRasterFrames';
import { getDownscaled, subscribeDownscaled } from './ownRasterDownscale';

// The data credit beside a raster layer's legend (2026-10-22). The map's attribution control is off (MapWebGL
// attributionControl={false}), so nothing on screen credited the raster layers' sources:
//  - Open-Meteo's spatial .om data (rain, satellite, pressure, temperature, water temp, fog) is CC-BY-4.0 and asks for credit
//    with a licence link next to where the data is displayed (open-meteo.com/en/licence; weather-map-layer's own tile
//    attribution names the same link);
//  - RainViewer asks for "Rain Viewer" with a link (radar's observed frames and the nowcast built from them).
// One small link, in the legend's own muted text colour (theme-aware: light, dark and beach), a real <a> with an accessible
// name, opening in a new tab. It WRAPS (min-w-0, break-words) rather than run past the legend panel's edge (the desktop
// legend cut "ICON · Datenbasis: Deutscher Wetterd…", 2026-11-22), and a gap-fill credit's tooltip carries the full sentence. Kill: window.__RAW_DISABLE_LAYER_DATA_CREDIT__ = true.
export const LAYER_CREDITS = {
  rain: 'open-meteo', satellite: 'open-meteo', pressure: 'open-meteo', temperature: 'open-meteo', water_temp: 'open-meteo',
  fog: 'open-meteo', radar: 'rainviewer',
  gusts: 'noaa',   // 2026-11-15: own frames only (NOAA GFS GUST, public domain), credited whether or not a frame is drawn yet
  currents: 'cmems',   // 2026-11-15: Copernicus Marine (its licence requires a visible credit with the product DOI)
};
const SOURCES = {
  'open-meteo': { text: '© Open-Meteo · CC BY 4.0', href: 'https://open-meteo.com/en/licence#maps', label: 'Data source: Open-Meteo, licence CC BY 4.0 (opens in a new tab)' },
  rainviewer: { text: '© RainViewer', href: 'https://www.rainviewer.com/', label: 'Radar data source: RainViewer (opens in a new tab)' },
  // A layer drawn from our own frames (ownRasterFrames.js, free NOAA GRIB): public domain, credited as a courtesy.
  noaa: { text: 'NOAA GFS', href: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast', label: 'Data source: NOAA NCEP Global Forecast System, public domain (opens in a new tab)' },
  // Per-model pressure (2026-10-24): ECMWF open data is CC BY 4.0 (attribution required); DWD asks for "Deutscher Wetterdienst".
  // 2026-11-18 (the Open-Meteo exit, the research lead's row 16): each agency's own attribution wording, linked to its licence.
  ecmwf: { text: 'EURO · © ECMWF · CC BY 4.0', href: 'https://www.ecmwf.int/en/forecasts/datasets/open-data', label: 'Data source: © ECMWF open data, licence CC BY 4.0 (opens in a new tab)' },
  dwd: { text: 'ICON · Datenbasis: Deutscher Wetterdienst', href: 'https://www.dwd.de/EN/service/copyright/copyright_node.html', label: 'Data source: Deutscher Wetterdienst (Datenbasis: Deutscher Wetterdienst), ICON model (opens in a new tab)' },
  // Ocean currents (2026-11-15): the Copernicus Marine licence (s. 2.4) asks for this credit, with the product's DOI.
  cmems: { text: '© Copernicus Marine', href: 'https://doi.org/10.48670/moi-00016', label: 'Generated using E.U. Copernicus Marine Service Information (opens in a new tab)' },
};
const OWN_SOURCE = { GFS: 'noaa', EURO: 'ecmwf', ICON: 'dwd', CMEMS: 'cmems' };
// What a layer drawn from our own frames IS, where a reader could take it for something else (2026-10-25). Our cloud cover
// (the satellite layer) is GFS's INSTANTANEOUS field at the valid time. Open-Meteo's, on the .om path, is an hourly backward
// mean, and the two differ by definition: 7.0 points of percentage on average, 1.5 on the same definition (the a/b/c read,
// log 2026-10-24-claude-raster-cloud-cover). The note rides on the credit, which every layout of the legend shows.
const withStormCaveat = (n) => ({ ...n, label: `${n.label} Thunderstorm gusts are not resolved by the models.` });
const OWN_NOTE = {
  satellite: { text: ' · instantaneous', label: 'Cloud cover at the valid time, instantaneous (not an hourly mean).' },
  // Gusts (2026-11-15): each model publishes its own definition, said on screen per model.
  // Every model's gust misses thunderstorm downbursts (NWS states it for its own gust grids): said in the accessible label.
  // Currents (2026-11-15, the advisor's red-team of #928): what the field is NOT, on screen. Copernicus' global model at -0.5 m
  // on 1/12 deg, 6-hourly, mapped to 0.25 deg; no tide, no surf-zone or rip current (the HF-radar check: direction off ~39 deg).
  currents: { text: ' · open-ocean current; no tides, not a nearshore / rip current', label: 'Open-ocean current from the Copernicus global model (half a metre down, every 6 hours, about 28 km cells): no tides, and not a nearshore or rip current.' },
  // Water temp from the Copernicus ocean model (G4, 2026-11-17): a bulk temperature of the top half metre, not a skin temperature.
  water_temp: (model) => (model === 'CMEMS'
    ? { text: ' · ocean model, top 0.5 m', label: 'Copernicus ocean model sea temperature: the top half metre, hourly mean, 1/6 degree cells (not a skin temperature). DWD ICON has no sea temperature of its own.' }
    : null),
  gusts: (model) => withStormCaveat(model === 'GFS'
    ? { text: ' · instantaneous', label: 'GFS surface wind gust at the valid time (instantaneous).' }
    : { text: ' · peak since last step', label: model === 'EURO'
      ? 'ECMWF 10fg / 10fg3: the strongest 10 m gust over the past 1 h (to 90 h), 3 h (to 144 h) or 6 h (to 240 h).'
      : 'ICON VMAX_10M: the strongest 10 m gust since the previous output (1 h to 78 h, then 3 h).' }),
  // ICON rain (2026-11-18, the advisor's suggestion on #1075, ordered by the director): our 0.125-degree set is an AREA MEAN of
  // DWD's model cells (G2: the median cell peak keeps 92-96 %, the sharpest ~10 % keep 74-85 %), so a local downpour can read
  // lower than the model's own cell. Said on screen; GFS and EURO rain carry no note.
  rain: (model) => (model === 'ICON'
    ? { text: ' · area-averaged; local peaks can read low', label: 'ICON rain averaged over each 0.125 degree box (about 14 km), so the heaviest local downpours can read lower than in the model\'s own cells.' }
    : null),
};
// GAP FILL (2026-11-22, ownRasterGapFill.js): a frame drawn where the picked model has none, '<MODEL(S)>:fill:<PICKED>'. Every
// source in the field is credited (an anchored prediction holds the picked model's own field: ECMWF's CC BY needs its credit), and
// the visible text says it is an estimate, so the source is never colour or position alone. The status line says why.
// SHORT LABELS (the director's call, 2026-11-22, David leaving it to him): the visible text leads with WHAT IS DRAWN, "ICON" for
// our own frames (the plain credit), "ICON → GFS" for the anchored blend, "GFS (stand-in)" for a pure GFS frame; the picked
// agency's own attribution follows where its data is in the field (DWD's "Datenbasis", ECMWF's CC BY). The full sentence is
// the accessible name and the tooltip; the status line under the timeline keeps the long words.
const ATTRIB = { dwd: 'Datenbasis: Deutscher Wetterdienst', ecmwf: '© ECMWF · CC BY 4.0' };
export function fillCredit(models, picked) {
  const srcs = models.map((m) => SOURCES[OWN_SOURCE[m] || 'noaa']);
  const anchored = models.length > 1;
  const why = anchored
    ? `${picked} prediction where ${picked}'s own frames end: NOAA GFS's trend, anchored to ${picked}'s last frame.`
    : `NOAA GFS shown where ${picked} has no frame of its own.`;
  const own = anchored ? ATTRIB[OWN_SOURCE[models[0]]] : null;
  const text = anchored ? `${models[0]} → GFS${own ? ` · ${own}` : ''}` : 'GFS (stand-in)';
  const label = `Estimated: ${why} ${srcs.map((x) => x.label).join(' ')}`;
  return { text, href: srcs[0].href, label, title: label };
}
// While air temperature is drawn terrain-adjusted (ownRasterDownscale.js): the elevation source is credited too.
const DOWNSCALE_NOTE = {
  temperature: { text: ' · terrain-adjusted', label: 'Adjusted to the real terrain height with NOAA ETOPO 2022 elevation (public domain), 6.5 C per km.' },
};

export function creditFor(layer, engaged = getEngaged(), downscaled = getDownscaled()) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_LAYER_DATA_CREDIT__ === true) return null;
  if (engaged && engaged[layer]) {
    // '<MODEL>:idle' (2026-11-18): an own-only model claimed with nothing drawn (killed, unpublished, pre-index). Its own source,
    // no note (nothing is drawn for a note to describe), and never "© Open-Meteo", which no longer draws it.
    const [models, state, picked] = String(engaged[layer]).split(':');
    const model = models.split('+')[0];
    const s = SOURCES[OWN_SOURCE[model] || 'noaa'];   // the model of the frame on screen
    if (state === 'idle') return s;
    if (state === 'fill') return fillCredit(models.split('+'), picked);
    const own = typeof OWN_NOTE[layer] === 'function' ? OWN_NOTE[layer](model) : OWN_NOTE[layer];
    const n = own || (downscaled && downscaled[layer] ? DOWNSCALE_NOTE[layer] : null);
    return n ? { ...s, text: s.text + n.text, label: `${n.label} ${s.label}`, title: n.label } : s;
  }
  const base = SOURCES[LAYER_CREDITS[layer]] || null;
  const always = base && ALWAYS_NOTE[layer];   // a caveat that holds whether or not a frame is drawn yet
  return always ? { ...base, text: base.text + always.text, label: `${always.label} ${base.label}`, title: always.label } : base;
}
const ALWAYS_NOTE = { currents: OWN_NOTE.currents };

export default function LayerDataCredit({ layer }) {
  const engaged = useSyncExternalStore(subscribeEngaged, getEngaged, getEngaged);
  const downscaled = useSyncExternalStore(subscribeDownscaled, getDownscaled, getDownscaled);
  const c = creditFor(layer, engaged, downscaled);
  if (!c) return null;
  return (
    <a href={c.href} target="_blank" rel="noopener noreferrer" aria-label={c.label} title={c.title} data-testid="layer-data-credit"
      className="ml-2 min-w-0 text-right break-words normal-case tracking-normal font-normal underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 rounded-sm">
      {c.text}
    </a>
  );
}
