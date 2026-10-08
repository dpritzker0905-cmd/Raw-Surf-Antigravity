/**
 * marineHourInstant.js — is the drawn frame already the forecast for the selected hour? (2026-10-08, the paused-heatmap churn)
 *
 * THE DEFECT (owner's recording + console, dev 3b7ca954). Paused at offset 16, GFS Waves at z7.26 off Florida, the heat map changed
 * every few seconds. The scrub-settle check re-committed the same warmed series frame on every trigger ("Series hit for hour=16",
 * 20+ times while paused; each commit is a new revision, so the engine re-uploads it), and when the series missed it fetched /grid
 * for hour 16, which served the 2-degree mid clip over the 0.25-degree series tile; the clamp detector sharpened back; round again.
 * Every frame in that loop was valid 2026-10-09 12:00Z. GFS waves are 3-hourly there: the series page labels its frame with its own
 * hour (15), offset 16 asks for 13:00Z, and the manifest snaps that to the same 12:00Z product. "Label 15 != selected 16" is not a
 * stale frame. The label is the identity of a REQUEST; the valid time is the identity of the data (the F-19 lesson,
 * marineExactUpgrade.js, which fixed the same misreading for thinned world frames only).
 *
 * THE RULE. The drawn frame serves the selected hour when it was made for the instant a fetch for that hour would ask for NOW
 * (getSharedValidTime, read-only: the one hour -> instant mapping every marine request uses), for the same model and layer. A refetch
 * would then ask for exactly what is drawn. This only ever turns a label mismatch into a match: an unknown time, another model or
 * layer, or no manifest (the mapping then falls back to anchor + offset, which differs whenever the labels do) keep the label test.
 * The no-downgrade guard's half of the same fix is marineFrameInstant.sameMarineLabelledHour.
 * Kill switch (both halves): window.__RAW_DISABLE_HOUR_BY_INSTANT__ = true.
 */
import { getSharedValidTime } from './backendWeatherServiceClient';
import { marineRequestedInstant } from './marineFrameInstant';

export function frameServesSelectedHour(marineData, hourOffset, model, layer, win) {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (w && w.__RAW_DISABLE_HOUR_BY_INSTANT__ === true) return false;
    const g = marineData && marineData.grid;
    if (!g || hourOffset === null || hourOffset === undefined || !Number.isFinite(Number(hourOffset))) return false;
    const m = model || 'GFS';
    const l = layer || 'waves';
    if ((g.__sourceModel || marineData.__sourceModel || 'GFS') !== m) return false;
    if ((g.__componentLayer || 'waves') !== l) return false;
    const drawn = marineRequestedInstant(g) ?? marineRequestedInstant(marineData);
    if (drawn === null) return false;
    const wanted = Date.parse(getSharedValidTime(hourOffset, l, m, { readOnly: true }));
    return Number.isFinite(wanted) && drawn === wanted;
  } catch (e) {
    return false;                      // best effort: the settle check keeps its label test
  }
}
