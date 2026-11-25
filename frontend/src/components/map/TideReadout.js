/**
 * TideReadout - the map infobox's tide block (2026-11-07). Selected height (ft/m setting), arrow + word
 * (Rising/Falling/Slack, never colour or arrow alone), rate, next high/low in UTC, and a mini
 * curve around the selected instant with its marker. MODEL sea level, stated in the footer with its data credit, which
 * follows the served series' provenance (tideCredit). Three themes.
 * Kill: window.__RAW_DISABLE_INFOBOX_TIDE__ = true. The infobox has ONE layout (desktop and mobile share it).
 */
import React, { useEffect, useState } from 'react';
import { usePointTide } from './usePointTide';
import { responsiveWeatherOn } from './useMapChromeLayout';
import { tideDatumOf, pointTideForDisplay, typoMinus, minusTideWord, tidePlainLineDisabled } from './tideDatum';
import TideDatumInfo from './TideDatumInfo';
import {
  tideFooter, TIDE_SOLAR_NOTE, TIDE_UNAVAILABLE, tideAt, tideCredit, tideUsesSolar, infoboxTideDisabled, trendWord, trendGlyph, formatTideHeight,
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
  const { status, data: served } = usePointTide(lat, lng);
  const payload = served ? pointTideForDisplay(served) : served;   // heights in the datum the label names
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
  const credit = tideCredit(payload);
  const datum = tideDatumOf(payload.datum_info);
  const mslNow = datum.isMllw && Number.isFinite(d.height_m) ? d.height_m - datum.offsetM : null;
  const curveHeight = responsiveWeatherOn() ? 56 : 40;
  const curve = tideCurve(d, d.now, 176, curveHeight);
  return (
    <div className={wrap} data-testid="tide-readout" role="group" aria-label="Tide">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={`text-[10px] ${muted}`}>Tide</span>
        {/* Decision B (2026-11-25): a plain number, "Tide 1.2 ft, rising" (typographic minus, no datum name); the
            datum is said once for this location in the info tip below. */}
        <span className={`text-xs font-bold ${textClass}`}>
          <span data-testid="tide-height">{typoMinus(formatTideHeight(d.height_m, unit))}</span>,
        </span>
        <span className={`text-[10px] font-semibold ${accent}`}>
          <span aria-hidden="true">{trendGlyph(d.trend)} </span>{trendWord(d.trend)}
        </span>
        {rate && <span className={`text-[9px] ${muted}`}>{rate}</span>}
      </div>
      {tidePlainLineDisabled()
        ? (
          <span className={`text-[9px] ${muted}`} data-testid="tide-datum" title={datum.long}>
            {datum.chip}{minusTideWord(d.height_m, datum) ? ` (${minusTideWord(d.height_m, datum)})` : ''}
          </span>
        )
        : <TideDatumInfo datum={datum} isLight={isLight} isBeach={isBeach} />}
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
      {mslNow != null && (
        <div className={`text-[9px] leading-tight ${muted}`} data-testid="tide-msl-line">
          ≈ {formatTideHeight(mslNow, unit)} above local mean sea level
        </div>
      )}
      {datum.isMllw && datum.source && (
        <div className={`text-[9px] leading-tight ${muted}`} data-testid="tide-datum-source">
          {datum.source ? `MLLW from ${datum.source}.` : ''}
        </div>
      )}
      <div className={`text-[10px] leading-tight mt-1 ${muted}`}>
        {tideFooter(datum)}
        {credit && <>
          {' · '}
          {credit.href
            ? <a href={credit.href} target="_blank" rel="noopener noreferrer" aria-label={credit.label} title={credit.title || undefined} data-testid="tide-credit"
                 className="underline decoration-dotted underline-offset-2 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current rounded-sm">{credit.text}</a>
            : <span data-testid="tide-credit" title={credit.title || undefined}>{credit.text}</span>}
        </>}
      </div>
      {d.tz_approx && tideUsesSolar(d.tz_offset_h, undefined, atMs) && (
        <div className={`text-[8px] leading-tight ${muted}`} data-testid="tide-solar-note">{TIDE_SOLAR_NOTE}</div>
      )}
    </div>
  );
}
