/**
 * A /api/weather/spot-series response shaped exactly as spot_series_serve.trim_spot builds one, for tests
 * and the offline screenshot harness (never a live backend). Deterministic in its arguments.
 */
const H = 3600 * 1000;

export function makeSeriesBody({ nowMs = Date.parse('2026-11-04T16:20:00Z'), hours = 72, off = -8, model = 'GFS',
  tier = 'free', tideHours = 72, premiumDays = 14 } = {}) {
  const base = Math.floor(nowMs / (3 * H)) * 3 * H - 3 * H;
  const times = [];
  for (let t = base; t <= base + 72 * H; t += 3 * H) times.push(t);
  // Day-parts beyond +72 h: local 06/12/18 snapped to the 3-hourly UTC grid, as frame_plan does.
  for (let d = 0; d < 16; d += 1) {
    [6, 12, 18].forEach((lh) => {
      const dayStart = Math.floor((base + off * H) / (24 * H)) * 24 * H - off * H;
      const raw = dayStart + d * 24 * H + lh * H;
      const snapped = Math.round(raw / (3 * H)) * 3 * H;
      if (snapped > base + 72 * H && snapped <= base + 336 * H && !times.includes(snapped)) times.push(snapped);
    });
  }
  times.sort((a, b) => a - b);
  let first = 0;
  times.forEach((t, i) => { if (t <= nowMs) first = i; });
  const end = nowMs + hours * H;
  const keep = times.filter((t, i) => i >= first && t <= end);
  const frames = { t: [], h: [], s: [], l: [], lo: [], hi: [], w: [], wd: [], sw: [], td: [] };
  keep.forEach((t, i) => {
    const k = (t - base) / H;
    const s = 300 + Math.round(450 * Math.sin(i / 3.2) ** 2);       // score x10: 30..75
    const l = s < 140 ? 0 : s < 280 ? 1 : s < 420 ? 2 : s < 560 ? 3 : s < 700 ? 4 : 5;
    frames.t.push(k);
    frames.h.push(Math.round(80 + 70 * Math.sin(i / 4) ** 2 + (i % 5) * 6));
    frames.s.push(s);
    frames.l.push(l);
    frames.lo.push(i % 7 === 3 ? Math.max(0, l - 1) : l);
    frames.hi.push(l);
    frames.w.push(4 + ((i * 5) % 14));
    frames.wd.push(i % 3);
    frames.sw.push(110);
    frames.td.push(k <= tideHours ? Math.round(60 * Math.sin(k / 2)) : null);
  });
  const localDay = (ms) => new Date(ms + off * H).toISOString().slice(0, 10);
  const today = Date.parse(`${localDay(nowMs)}T00:00:00Z`);
  const days = Math.max(1, Math.floor(hours / 24));
  const dates = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, d) =>
    new Date(today + (from + d) * 24 * H).toISOString().slice(0, 10));
  const tideIdx = frames.td.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  return {
    status: 'ok', schema: 'raw-surf/spot-series-serve/1', spot_id: 'spot-1', model, requested_model: model,
    model_allowed: true, tier, base_time: iso(base), generated_at: iso(base + H),
    levels: ['very_poor', 'poor', 'poor_fair', 'fair', 'fair_good', 'good', 'epic'],
    wind_words: ['offshore', 'cross-shore', 'onshore'],
    horizon_hours: hours, days_allowed: days, premium_days: premiumDays,
    utc_offset_hours: off, frames, valid_times: keep.map(iso),
    daily_dates: dates(0, days), locked_dates: dates(days, Math.max(days, premiumDays)),
    window_end: iso(end), tide_until: tideIdx.length ? iso(keep[tideIdx[tideIdx.length - 1]]) : null,
  };
}
