/**
 * SpotForecastChart.js: spot-hub phase 4 (2026-11-04). Raw Surf's own forecast chart, in the rating
 * colours, for the full hub, the drawer and (compact) the map infobox. It replaces the hubs' old daily
 * cards when the series is available; anything else falls back to them (see useSpotSeries).
 *
 *  - Hourly chart: one bar per CI-rated frame at its true time (3-hourly to +72 h, then local
 *    06/12/18 day-parts), height = breaking surf height, fill = RATING_COLOR[level]. The level word,
 *    height and wind are the text equivalent (accessibility: never colour alone): the chart is ONE
 *    role="slider" over frames (ForecastWheel's pattern: arrows, PgUp/PgDn, Home/End, visible focus),
 *    and each step announces "Tue 13:00, 4.1 ft, Fair to Good, 8 kt offshore".
 *  - Wind row: a shore-relative arrow (up = offshore, out to sea; down = onshore; sideways = cross)
 *    plus the speed; the word is in the description, so the arrow is not the only carrier.
 *  - Tide strip where the series has one (+72 h today), labelled "no tide forecast" beyond.
 *  - Daily row: today + (days - 1) local days, each a button that selects its best frame; locked days
 *    beyond the tier with one upgrade prompt.
 *  - The selected bar is the map's hour; choosing a bar moves it (`onSelectOffset`).
 *
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true (the caller renders its previous rows).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Lock } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
import { getThemeTokens } from '../../../utils/themeTokens';
import { formatHeightFromMeters, getHeightUnit } from '../../map/heightUnits';
import { getSeriesAnchorMs } from '../../map/backendWeatherServiceClient';
import { modelDisplayName } from '../../map/modelDisplayName';
import {
  barOutline, chartTheme, dayLabel, decodeSeries, frameDescription, frameIndexForOffset, levelColor, levelWord,
  offsetForFrame, offsetLabel, windArrowDeg,
} from './spotSeriesModel';

const HOUR_MS = 3600 * 1000;

function useHeightUnit() {
  const [unit, setUnit] = useState(() => getHeightUnit());
  useEffect(() => {
    const on = () => setUnit(getHeightUnit());
    window.addEventListener('rawsurf:height-unit', on);
    return () => window.removeEventListener('rawsurf:height-unit', on);
  }, []);
  return unit;
}

function Arrow({ x, y, deg, color, size = 7 }) {
  if (deg == null) return null;
  const s = size;
  return (
    <path d={`M ${x} ${y - s / 2} L ${x + s / 2.4} ${y + s / 2} L ${x} ${y + s / 5} L ${x - s / 2.4} ${y + s / 2} Z`}
      fill={color} transform={`rotate(${deg} ${x} ${y})`} />
  );
}

/** The hourly bars as one keyboard slider. Shared by the full and the compact chart. */
export function HourlyBars({ series, selected, onSelect, theme, unit, compact = false, label }) {
  const pal = chartTheme(theme);
  const ref = useRef(null);
  const frames = series.frames;
  const pxH = compact ? 2.2 : 6;
  const barW = compact ? 5 : 14;
  const top = compact ? 4 : 18;
  const barArea = compact ? 34 : 86;
  const windRow = compact ? 0 : 26;
  const tideRow = !compact && series.hasTide ? 30 : 0;
  const t0 = frames[0].ms;
  const span = (frames[frames.length - 1].ms - t0) / HOUR_MS;
  const width = Math.max(compact ? 160 : 280, Math.ceil(span * pxH + barW + 8));
  const height = top + barArea + windRow + tideRow + (compact ? 2 : 4);
  const maxM = Math.max(1, ...frames.map((f) => f.heightM || 0));
  const xOf = (f) => 4 + ((f.ms - t0) / HOUR_MS) * pxH;
  const fmt = (m) => formatHeightFromMeters(m, unit, { withUnit: true });
  const cur = frames[selected] || frames[0];

  useEffect(() => {
    // Keep the selected bar in view inside the scroller (the hub's old day scroll did the same).
    const el = ref.current && ref.current.parentElement;
    if (el && el.scrollTo && cur) {
      const x = xOf(cur);
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 20) el.scrollTo({ left: Math.max(0, x - 40) });
    }
  }, [selected]);

  const onKeyDown = (e) => {
    const n = frames.length;
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 8, PageDown: -8 }[e.key];
    let next = null;
    if (step != null) next = Math.max(0, Math.min(n - 1, selected + step));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    onSelect(next);
  };

  // Local midnights inside the span: the day separators.
  const separators = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].date !== frames[i - 1].date) separators.push(frames[i]);
  }
  const tidePts = frames.filter((f) => f.tideM != null);
  const tMin = tidePts.length ? Math.min(...tidePts.map((f) => f.tideM)) : 0;
  const tMax = tidePts.length ? Math.max(...tidePts.map((f) => f.tideM)) : 1;
  const tideY = (m) => top + barArea + windRow + tideRow - 6 - ((m - tMin) / Math.max(0.1, tMax - tMin)) * (tideRow - 12);
  const lastTide = tidePts[tidePts.length - 1];

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={frames.length - 1}
      aria-valuenow={selected}
      aria-valuetext={frameDescription(cur, fmt)}
      onKeyDown={onKeyDown}
      data-testid={compact ? 'spot-mini-chart-slider' : 'spot-chart-slider'}
      className="inline-block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-1"
      style={{ width }}
    >
      <svg width={width} height={height} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
        {separators.map((f) => (
          <g key={`sep-${f.ms}`}>
            <line x1={xOf(f) - 2} x2={xOf(f) - 2} y1={top - (compact ? 2 : 14)} y2={height} stroke={pal.grid} strokeWidth="1" />
            {!compact && (
              <text x={xOf(f) + 1} y={10} fontSize="9" fill={pal.muted}>{dayLabel(f.date).weekday}</text>
            )}
          </g>
        ))}
        {frames.map((f, i) => {
          const h = f.heightM == null ? 0 : Math.max(2, (f.heightM / maxM) * (barArea - (compact ? 2 : 12)));
          const x = xOf(f);
          const y = top + barArea - h;
          const outline = barOutline(f.level, theme);
          const isSel = i === selected;
          return (
            <g key={f.ms} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }} data-testid="spot-chart-bar"
              data-level={f.level}>
              {/* a taller hit area than the bar, so a 1 ft bar is still easy to tap */}
              <rect x={x - 1} y={top} width={barW + 2} height={barArea + windRow} fill="transparent" />
              {f.heightM == null ? (
                <rect x={x} y={top + barArea - 3} width={barW} height={3} fill="none" stroke={pal.grid} strokeDasharray="2 2" />
              ) : (
                <rect x={x} y={y} width={barW} height={h} rx={compact ? 1 : 2} fill={levelColor(f.level)}
                  stroke={outline || 'none'} strokeWidth={outline ? 1 : 0} />
              )}
              {!compact && f.levelLo && f.levelHi && f.levelLo !== f.levelHi && f.heightM != null && (
                // the cross-model spread: a small bracket above the bar
                <path d={`M ${x + 2} ${y - 3} L ${x + 2} ${y - 6} L ${x + barW - 2} ${y - 6} L ${x + barW - 2} ${y - 3}`}
                  fill="none" stroke={pal.muted} strokeWidth="1" />
              )}
              {!compact && f.heightM != null && (
                <text x={x + barW / 2} y={Math.max(top - 2, y - 8)} fontSize="8" textAnchor="middle" fill={pal.text}>
                  {formatHeightFromMeters(f.heightM, unit)}
                </text>
              )}
              {!compact && (
                <g>
                  <Arrow x={x + barW / 2} y={top + barArea + 8} deg={windArrowDeg(f.windWord)} color={pal.text} />
                  <text x={x + barW / 2} y={top + barArea + 22} fontSize="8" textAnchor="middle" fill={pal.muted}>
                    {f.windKt == null ? '—' : f.windKt}
                  </text>
                </g>
              )}
              {isSel && (
                <rect x={x - 2} y={top - (compact ? 3 : 12)} width={barW + 4} height={barArea + windRow + (compact ? 4 : 13)}
                  fill="none" stroke={pal.select} strokeWidth={compact ? 1.2 : 1.5} rx="3" data-testid="spot-chart-selected" />
              )}
            </g>
          );
        })}
        {tideRow > 0 && tidePts.length > 1 && (
          <polyline fill="none" stroke={pal.tide} strokeWidth="1.5"
            points={tidePts.map((f) => `${xOf(f) + barW / 2},${tideY(f.tideM)}`).join(' ')} />
        )}
        {tideRow > 0 && lastTide && lastTide.ms < frames[frames.length - 1].ms && width - (xOf(lastTide) + barW + 6) >= 130 && (
          <text x={xOf(lastTide) + barW + 6} y={top + barArea + windRow + tideRow / 2 + 3} fontSize="9" fill={pal.muted}
            data-testid="spot-chart-no-tide">No tide forecast beyond here</text>
        )}
      </svg>
    </div>
  );
}

function DailyRow({ series, selectedDate, onPickDay, onUpgrade, t, theme, unit, isPremium }) {
  const pal = chartTheme(theme);
  const fmt = (m) => formatHeightFromMeters(m, unit);
  return (
    <div>
      <ul className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" aria-label="Daily forecast, local days">
        {series.daily.map((d) => {
          const { weekday, day } = dayLabel(d.date);
          const range = d.maxM == null ? '—' : `${fmt(d.minM)}–${fmt(d.maxM)} ${unit}`;
          const wind = d.best && d.best.windKt != null ? `${d.best.windKt} kt ${d.best.windWord || ''}`.trim() : '—';
          const sel = d.date === selectedDate;
          return (
            <li key={d.date} className="shrink-0">
              <button type="button" onClick={() => onPickDay(d)} aria-pressed={sel}
                aria-label={`${weekday} ${day}: ${range}, best ${levelWord(d.level)}${d.best ? ` at ${d.best.label.split(' ')[1]}` : ''}, wind ${wind}`}
                data-testid="spot-chart-day"
                className={`w-[86px] text-left rounded-lg border px-2 py-1.5 ${t.rowBg} ${t.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${sel ? 'ring-2 ring-cyan-500' : ''}`}>
                <span className={`block text-[10px] ${t.textSecondary}`}>{weekday} {day}</span>
                <span className={`block text-xs font-semibold ${t.textPrimary}`}>{range}</span>
                <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold">
                  <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: levelColor(d.level), outline: barOutline(d.level, theme) ? `1px solid ${pal.outline}` : 'none' }} />
                  <span className={t.textPrimary}>{levelWord(d.level)}</span>
                </span>
                <span className={`block text-[10px] ${t.textSecondary}`}>{wind}</span>
              </button>
            </li>
          );
        })}
        {series.lockedDates.map((date) => {
          const { weekday, day } = dayLabel(date);
          return (
            <li key={date} className="shrink-0" aria-label={`${weekday} ${day}: locked on your plan`} data-testid="spot-chart-locked-day">
              <div className={`w-[64px] h-full rounded-lg border px-2 py-1.5 opacity-70 ${t.rowBg} ${t.border}`}>
                <span className={`block text-[10px] ${t.textSecondary}`}>{weekday} {day}</span>
                <Lock aria-hidden="true" className={`w-3.5 h-3.5 mt-1 ${t.textSecondary}`} />
              </div>
            </li>
          );
        })}
      </ul>
      {!isPremium && series.lockedDates.length > 0 && onUpgrade && (
        <button type="button" onClick={onUpgrade} data-testid="spot-chart-upgrade"
          className={`mt-1.5 text-[11px] font-medium inline-flex items-center gap-1 px-2 py-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            t.isLight ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' : t.isBeach ? 'bg-purple-200 text-purple-900 hover:bg-purple-300'
              : 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25'}`}>
          <Crown aria-hidden="true" className="w-3 h-3" />
          Unlock {series.premiumDays} days of the forecast
        </button>
      )}
    </div>
  );
}

/** Pick the selected frame: the map's hour when given, else "now". */
function useSelection(series, selectedOffsetHours, onSelectOffset) {
  const anchor = getSeriesAnchorMs();
  const fromProp = series ? frameIndexForOffset(series.frames, selectedOffsetHours || 0, anchor) : -1;
  const [local, setLocal] = useState(fromProp);
  useEffect(() => { setLocal(fromProp); }, [fromProp]);
  const select = (i) => {
    setLocal(i);
    if (onSelectOffset && series) onSelectOffset(offsetForFrame(series.frames[i], anchor));
  };
  return [Math.max(0, local), select];
}

/**
 * The full chart (hub + drawer). Props: `body` (the /spot-series response), `resolverHours`,
 * `selectedOffsetHours` / `onSelectOffset` (the map's hour, two-way), `onUpgrade`, `isPremium`.
 */
export default function SpotForecastChart({ body, resolverHours, selectedOffsetHours = 0, onSelectOffset, onUpgrade, isPremium = false }) {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const unit = useHeightUnit();
  const series = useMemo(() => decodeSeries(body, { resolverHours }), [body, resolverHours]);
  const [selected, select] = useSelection(series, selectedOffsetHours, onSelectOffset);
  if (!series || series.frames.length === 0) return null;
  const cur = series.frames[selected] || series.frames[0];
  const fmt = (m) => formatHeightFromMeters(m, unit, { withUnit: true });
  const pickDay = (d) => { if (d.best) select(d.best.index); else if (d.frames[0]) select(d.frames[0].index); };
  const lastDaily = series.daily.length ? series.daily[series.daily.length - 1].date : null;
  return (
    <section aria-label="Surf forecast chart" data-testid="spot-forecast-chart" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={`text-xs font-semibold ${t.textPrimary}`}>Surf forecast · Raw Surf {modelDisplayName(series.model)}</h3>
        <span className={`text-[10px] ${t.textSecondary}`}>Local solar time ({offsetLabel(series.offsetH)})</span>
      </div>
      <div className="overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
        <HourlyBars series={series} selected={selected} onSelect={select} theme={theme} unit={unit}
          label={`Hourly surf forecast, ${series.frames.length} forecast times. Use arrow keys to move.`} />
      </div>
      <p className={`text-xs ${t.textPrimary}`} aria-live="polite" data-testid="spot-chart-readout">
        <span className="font-semibold">{cur.label}</span>{' · '}{cur.heightM == null ? '—' : fmt(cur.heightM)}{' · '}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: levelColor(cur.level) }} />
          {levelWord(cur.level)}
        </span>
        {cur.windKt != null && ` · ${cur.windKt} kt ${cur.windWord || ''}`}
        {cur.tideM != null && ` · tide ${cur.tideM.toFixed(1)} m`}
      </p>
      <p className={`text-[10px] ${t.textSecondary}`}>
        Bar colour and word = surf rating. Arrows: ↑ offshore · ↔ cross-shore · ↓ onshore (kt).
        {series.hasTide ? ' Line = tide (model estimate, mean sea level).' : ' No tide forecast for this spot.'}
        {series.tideUntilMs != null && series.tideUntilMs < series.frames[series.frames.length - 1].ms ? ' Tide forecast reaches +72 h.' : ''}
      </p>
      <DailyRow series={series} selectedDate={cur.date} onPickDay={pickDay} onUpgrade={onUpgrade} t={t} theme={theme}
        unit={unit} isPremium={isPremium} />
      {series.leftoverFrom && lastDaily && (
        <p className={`text-[10px] ${t.textSecondary}`} data-testid="spot-chart-leftover">
          Hours after {dayLabel(lastDaily).weekday} through +{series.horizonHours} h are in the hourly chart.
        </p>
      )}
    </section>
  );
}

/** The compact chart for the map infobox (~170 px). Same slider, no daily row. */
export function SpotForecastMiniChart({ body, resolverHours, selectedOffsetHours = 0, onSelectOffset, hostTheme = null }) {
  // `hostTheme`: the palette of the glass this sits on (the infobox draws beach on its dark glass), so text and
  // outlines are measured against the background they are actually drawn over.
  const { theme: appTheme } = useTheme();
  const theme = hostTheme || appTheme;
  const t = getThemeTokens(theme);
  const unit = useHeightUnit();
  const series = useMemo(() => decodeSeries(body, { resolverHours }), [body, resolverHours]);
  const [selected, select] = useSelection(series, selectedOffsetHours, onSelectOffset);
  if (!series || series.frames.length === 0) return null;
  const cur = series.frames[selected] || series.frames[0];
  return (
    <div className="pt-1.5 mt-1.5 border-t border-zinc-800/20" data-testid="spot-mini-chart">
      <div className={`text-[9px] uppercase tracking-wider font-bold ${t.textMuted}`}>
        Next {series.horizonHours} h · Raw Surf rating
      </div>
      <div className="overflow-x-auto no-scrollbar py-0.5">
        <HourlyBars series={series} selected={selected} onSelect={select} theme={theme} unit={unit} compact
          label={`Surf forecast at this spot, next ${series.horizonHours} hours`} />
      </div>
      <div className={`text-[10px] ${t.textPrimary} truncate`} data-testid="spot-mini-chart-readout">
        {cur.label} ({offsetLabel(series.offsetH)}) · {cur.heightM == null ? '—' : formatHeightFromMeters(cur.heightM, unit, { withUnit: true })} · {levelWord(cur.level)}
      </div>
    </div>
  );
}
