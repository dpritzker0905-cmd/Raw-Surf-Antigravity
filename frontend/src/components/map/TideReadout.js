/**
 * TideReadout - the map infobox's tide block (2026-11-07). Current height (ft/m setting), arrow + word
 * (Rising/Falling/Slack, never colour or arrow alone), rate, next high/low in local time, and a mini
 * curve of today with a "now" marker. MODEL sea level (Open-Meteo MSL), stated in the footer. Three themes.
 * Kill: window.__RAW_DISABLE_INFOBOX_TIDE__ = true. The infobox has ONE layout (desktop and mobile share it).
 */
import React from 'react';
import { usePointTide } from './usePointTide';
import {
  TIDE_FOOTER, TIDE_UNAVAILABLE, infoboxTideDisabled, trendWord, trendGlyph, formatTideHeight,
  formatTideEvent, formatTideRate, tideAriaLabel, tideCurve,
} from './tideReadoutFormat';

export default function TideReadout({ lat, lng, heightUnit, isLight, isBeach }) {
  const { status, data } = usePointTide(lat, lng);
  if (infoboxTideDisabled() || status === 'off' || status === 'loading') return null;
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const muted = isLight ? 'text-gray-500' : isBeach ? 'text-cyan-200/80' : 'text-gray-400';
  const accent = isLight ? 'text-sky-700' : isBeach ? 'text-amber-300' : 'text-cyan-400';
  const rule = isLight ? 'border-gray-200' : isBeach ? 'border-cyan-900/50' : 'border-zinc-800/20';
  const wrap = `pt-1.5 mt-1.5 border-t ${rule}`;
  if (status === 'unavailable') {
    return <div className={`${wrap} text-[10px] ${muted}`} data-testid="tide-readout-unavailable">{TIDE_UNAVAILABLE}</div>;
  }
  const d = data;
  const unit = heightUnit;
  const rate = formatTideRate(d.rate_m_per_h, unit);
  const hi = formatTideEvent('high', d.next_high, unit, d.tz_offset_h);
  const lo = formatTideEvent('low', d.next_low, unit, d.tz_offset_h);
  const curve = tideCurve(d.series, d.now);
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
        <svg role="img" aria-label={tideAriaLabel(d, unit)} viewBox={`0 0 ${curve.w} ${curve.h}`}
             className={`w-full h-10 mt-1 ${accent}`} data-testid="tide-curve">
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
      <div className={`text-[8px] leading-tight mt-0.5 ${muted}`}>{TIDE_FOOTER}</div>
    </div>
  );
}
