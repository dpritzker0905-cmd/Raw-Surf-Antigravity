/**
 * gustWindow.js: WHICH gust each model serves, in words (2026-11-22, the gust time-window label).
 *
 * The three gust fields are different quantities (frame_set_raster.py `gust`, `gust_euro`, `gust_icon`):
 *  - GFS `GUST`: the instantaneous gust at the valid time;
 *  - ECMWF open data `10fg` / `10fg3`: the strongest 10 m gust over the hours BEFORE the step, decoded per message on 2026-11-15
 *    (gust_verify_collect.euro_window): the past 1 h to 90 h, 3 h to 144 h, 6 h to 240 h;
 *  - DWD ICON `VMAX_10M`: the strongest gust since the previous output (gust_verify_collect.icon_window): hourly output to 78 h,
 *    3-hourly after.
 * A period maximum reads higher than a one-instant gust (the gust verification, #1063: most of ECMWF/ICON's apparent high bias
 * was this window, not the model), so the window is said wherever a gust value is read: the status line under the timeline
 * (rasterDrawnFrame.describeRasterFrame) and the legend credit (LayerDataCredit). Text, never colour; the lead is the DRAWN
 * frame's own (the run and valid time its published path names), so a held or nearest frame is labelled by what is on screen.
 * Words only; no colour and no served number moves. Kill: window.__RAW_DISABLE_GUST_WINDOW_LABEL__ = true.
 */
const W = () => (typeof window !== 'undefined' ? window : {});
export const gustWindowLabelOn = () => W().__RAW_DISABLE_GUST_WINDOW_LABEL__ !== true;

const NAME = { GFS: 'GFS', EURO: 'ECMWF', ICON: 'ICON' };

/** Hours in the gust window ending at lead `leadH` for a model: 0 = instantaneous; null = unknown (no lead, unknown model). */
export function gustWindowHours(model, leadH) {
  const m = String(model || '').toUpperCase();
  if (m === 'GFS') return 0;
  if (!Number.isFinite(leadH) || leadH < 0) return null;
  if (m === 'EURO') return leadH <= 90 ? 1 : (leadH <= 144 ? 3 : 6);
  if (m === 'ICON') return leadH <= 78 ? 1 : 3;
  return null;
}

/** A stamp 20261122T000000Z (frame_set.stamp) as epoch ms, or NaN. */
const stampMs = (st) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(st || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};
/** The run and valid instants a published frame's path names: `<set>/<run stamp>/<valid stamp>-<sha>.bin`
 *  (frame_set_raster.py, the frame path), or null for any other path. */
export function frameTimesOfPath(url) {
  const m = typeof url === 'string' ? /\/(\d{8}T\d{6}Z)\/(\d{8}T\d{6}Z)-[0-9a-f]+\.bin(?:$|[?#])/.exec(url) : null;
  if (!m) return null;
  const runMs = stampMs(m[1]); const validMs = stampMs(m[2]);
  return Number.isFinite(runMs) && Number.isFinite(validMs) ? { runMs, validMs } : null;
}
/** The drawn frame's lead in whole hours: (valid - run), from the record's own run time or else its path; NaN when unknown. */
export function gustLeadHours(rec) {
  if (!rec) return NaN;
  if (Number.isFinite(rec.dataMs) && Number.isFinite(rec.runMs)) return Math.round((rec.dataMs - rec.runMs) / 3600000);
  const t = frameTimesOfPath(rec.url);
  return t ? Math.round((t.validMs - t.runMs) / 3600000) : NaN;
}

const over = (h) => (h === 1 ? 'the last hour' : `the last ${h} h`);

/** The full words: "Peak gust, instantaneous (GFS)" / "Peak gust, max over the last 3 h (ECMWF)"; null when not known or killed. */
export function gustWindowLabel(model, leadH) {
  if (!gustWindowLabelOn()) return null;
  const h = gustWindowHours(model, leadH);
  if (h === null) return null;
  const name = NAME[String(model).toUpperCase()];
  return h === 0 ? `Peak gust, instantaneous (${name})` : `Peak gust, max over ${over(h)} (${name})`;
}

/** The legend's short form after the credit: " · instantaneous" / " · max over last 3 h"; null when not known or killed. */
export function gustWindowShort(model, leadH) {
  if (!gustWindowLabelOn()) return null;
  const h = gustWindowHours(model, leadH);
  if (h === null) return null;
  return h === 0 ? ' · instantaneous' : ` · max over last ${h === 1 ? 'hour' : `${h} h`}`;
}
