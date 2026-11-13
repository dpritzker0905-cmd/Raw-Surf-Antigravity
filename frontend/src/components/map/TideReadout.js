/**
 * TideReadout - the map infobox's tide block (2026-11-07). Selected height (ft/m setting), arrow + word
 * (Rising/Falling/Slack, never colour or arrow alone), rate, next high/low in UTC, and a mini
 * curve around the selected instant with its marker. MODEL sea level (Open-Meteo MSL), stated in the footer. Three themes.
 * Kill: window.__RAW_DISABLE_INFOBOX_TIDE__ = true. The infobox has ONE layout (desktop and mobile share it).
 */
import React, { useEffect, useState } from 'react';
import { usePointTide } from './usePointTide';
import { responsiveWeatherOn } from './useMapChromeLayout';
import {
  TIDE_FOOTER, TIDE_SOLAR_NOTE, TIDE_UNAVAILABLE, tideAt, tideUsesSolar, infoboxTideDisabled, trendWord, trendGlyph, formatTideHeight,
  formatTideEvent, formatTideRate, tideAriaLabel, tideCurve,
} from './tideReadoutFormat';

export const TIDE_TICK_MS = 5 * 60 * 1000;

/** `atTime` (ms or Date) follows the forecast selection; omitted consumers retain a current-time clock. */
export default function TideReadout({ lat, lng, heightUnit, isLight, isBeach, atTime }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (atTime != null) return undefined;
    const id = setInterval(() => setTick(Date.now()), TIDE_TICK_MS);   // recompute from the cache; no network
    return () => clearInterval(id);
  }, [atTime]);
  const atMs = atTime != null ? Number(atTime instanceof Date ? atTime.getTime() : atTime) : tick;
  const { status, data: payload } = usePointTide(lat, lng);
  const data = payload ? tideAt(payload, atMs) : null;
  if (infoboxTideDisabled() || status === 'off') return null;
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const muted = isLight ? 'text-gray-600' : isBeach ? 'text-cyan-200/80' : 'text-gray-400';
  const accent = isLight ? 'text-sky-700' : isBeach ? 'text-amber-300' : 'text-cyan-400';
  const rule = isLight ? 'border-gray-200' : isBeach ? 'border-cyan-900/50' : 'border-zinc-800/20';
  const wrap = `pt-1.5 mt-1.5 border-t ${rule}`;
  if (status === 'loading') {
    return <div className={`${wrap} text-[10px] ${muted}`} role="status">Loading modeled sea level…</div>;
  }
  if (status === 'unavailable' || (status === 'ok' && !data)) {
    return <div className={wrap}>
      <div className={`text-[10px] ${muted}`} data-testid="tide-readout-unavailable" role="status">{TIDE_UNAVAILABLE}</div>
    </div>;
  }
  const d = data;
  const unit = heightUnit;
  const rate = formatTideRate(d.rate_m_per_h, unit, d.trend);
  const hi = formatTideEvent('high', d.next_high, unit, d.tz_offset_h, undefined, atMs);
  const lo = formatTideEvent('low', d.next_low, unit, d.tz_offset_h, undefined, atMs);
  const curveHeight = responsiveWeatherOn() ? 56 : 40;
  const curve = tideCurve(d, d.now, 176, curveHeight);
  return (
    <div className={wrap} data-testid="tide-readout" role="group" aria-label="Tide">
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[10px] ${muted}`}>Tide</span>
        <span className={`text-xs font-bold ${textClass}`}>{formatTideHeight(d.height_m, unit)}</span>
        <span className={`text-[10px] font-semibold ${accent}`}>
          <span aria-hidden="true">{trendGlyph(d.trend)} </span>{trendWord(d.trend)}
        </span>
        {rate && <span className={`text-[9px] ${muted}`}>{rate}</span>}
      </div>
      {curve && (
        <svg role="img" tabIndex={0} aria-label={tideAriaLabel(d, unit)} viewBox={`0 0 ${curve.w} ${curve.h}`}
             style={{ height: curveHeight }} className={`w-full mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current ${accent}`} data-testid="tide-curve">
          <path d={curve.path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          {curve.nowX != null && (
            <>
              <line x1={curve.nowX} x2={curve.nowX} y1="2" y2={curve.h - 2} stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.6" />
              <circle cx={curve.nowX} cy={curve.nowY} r="3" fill="currentColor" stroke={isLight ? '#fff' : '#18181b'} strokeWidth="1" />
            </>
          )}
        </svg>
      )}
      {hi && <div className={`text-[10px] ${textClass}`}>{hi}</div>}
      {lo && <div className={`text-[10px] ${textClass}`}>{lo}</div>}
      <div className={`text-[10px] leading-tight mt-1 ${muted}`}>{TIDE_FOOTER}</div>
      {d.tz_approx && tideUsesSolar(d.tz_offset_h, undefined, atMs) && (
        <div className={`text-[8px] leading-tight ${muted}`} data-testid="tide-solar-note">{TIDE_SOLAR_NOTE}</div>
      )}
    </div>
  );
}
