/**
 * staleLayerState.js — ONE reader for "the layer on screen is older than it looks" (2026-11-16; David approved a collapsed-header
 * chip for stale ratings, 08:54 EST, via the advisor; the advisor's gate: the chip must read the SAME painted-grid source and words
 * as the status line, so the two can never disagree).
 *
 * readRatedRunState(): the Surf Rating band's run age, from the grid the ENGINE is painting (never the last fetch), only while the band
 * is painted. Null when there is nothing to say (no lag, unknown lag, band not painted or held, or killed). Fields:
 *   lagH, runTime     from the painted grid's `ratedRun` (staticRatedMosaic RUN AGE)
 *   text              the full sentence the status line shows (marineRatingBandRes.ratedRunText; the hour in the reader's local time)
 *   short             the chip's words, e.g. "Ratings 6 h old"
 * ForecastTimeStatus reads it; a header chip must read it too. Kills: __RAW_DISABLE_RATED_RUN_LABEL__ (no text anywhere).
 */
import { ratedRunText } from './marineRatingBandRes';
import { getWindDrawn } from './marineDrawnFrame';
import { windReadout } from './WindTimeStatus';

function paintedGrid() {
  if (typeof window === 'undefined') return null;
  const gpu = window.__RAW_GPU__;
  if (!gpu || !gpu.ratingBand || !gpu.ratingBand.active) return null;                 // band not painted: nothing to label
  if (gpu.ratingBandFade && gpu.ratingBandFade.heldBy && gpu.ratingBandFade.heldBy !== 'off') return null;   // held: its own words
  const e = window.__MARINE_ENGINE__;
  const g = e && e._waveData && e._waveData.waveGrid;
  return g && g.ratingMode ? g : null;
}

export function readRatedRunState() {
  const g = paintedGrid();
  if (!g || !g.ratedRun) return null;
  const text = ratedRunText(g.ratedRun);
  if (!text) return null;
  const lagH = Math.round(Number(g.ratedRun.lagH));
  return { lagH, runTime: g.ratedRun.runTime || null, text, short: `Ratings ${lagH} h old` };
}

/**
 * readWindStaleState({ model, hour }): the wind layer's caveat in the SAME words WindTimeStatus shows (windReadout over the published
 * wind drawn record), for a chip. Only the states that mean "what you see is not exactly the hour you picked": 'nearest' (the nearest
 * stored forecast) and 'held' (a frame held from an older run or clock). Null otherwise (exact, loading, or no wind drawn).
 */
export function readWindStaleState({ model, hour }) {
  const r = windReadout({ model, hour }, getWindDrawn());
  if (!r || (r.state !== 'nearest' && r.state !== 'held')) return null;
  return { state: r.state, text: r.text, short: r.state === 'nearest' ? 'Wind: nearest stored time' : 'Wind: older frame' };
}