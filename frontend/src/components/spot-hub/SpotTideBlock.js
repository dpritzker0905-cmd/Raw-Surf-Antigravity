/**
 * SpotTideBlock: the "Today's Tides" block, shared by the pinned drawer (SpotConditions) and the full
 * hub (SpotHubTides). ONE tide source: `/tides/{spotId}` (services/weather_pipeline/tide.py), never
 * a second fetch path.
 *
 * Phase 1 (2026-11-03): the source line says what the data is (Open-Meteo modelled sea level, mean
 * sea level datum) instead of "NOAA Tides & Currents", which stopped being true on 2026-07-29; the
 * rising/falling pill gets classes for all three themes. The kill switch
 * (window.__RAW_DISABLE_SPOT_HUB_P1__) renders the block exactly as it was.
 * Accessibility: the trend is a word beside its arrow and each extreme names its type, so nothing is
 * conveyed by colour alone.
 */
import React from 'react';
import { ArrowUp, ArrowDown, Droplets } from 'lucide-react';
import { Badge } from '../ui/badge';
import { spotHubP1Enabled, tideSourceLabel } from './spotHubP1Format';

function trendPillClass(rising, p1, isLight, isBeach) {
  if (!p1) return rising ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400';
  if (isLight) return rising ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800';
  if (isBeach) return rising ? 'bg-emerald-200 text-emerald-900' : 'bg-orange-200 text-orange-900';
  return rising ? 'bg-emerald-500/20 text-emerald-300' : 'bg-orange-500/20 text-orange-300';
}

function extremeClass(isHigh, p1, isLight, isBeach) {
  if (!p1 || (!isLight && !isBeach)) return isHigh ? 'text-cyan-400' : 'text-blue-400';
  if (isLight) return isHigh ? 'text-cyan-700' : 'text-blue-700';
  return isHigh ? 'text-cyan-800' : 'text-blue-800';
}

export default function SpotTideBlock({ tideData, t, containerBorder, testId = 'spot-tide-block' }) {
  if (!tideData || !Array.isArray(tideData.tides) || tideData.tides.length === 0) return null;
  const p1 = spotHubP1Enabled();
  const { isLight, isBeach } = t;
  const rising = tideData.current_status === 'Rising';
  return (
    <div className={`border-t ${containerBorder} p-4`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-3">
        <Droplets aria-hidden={p1 ? 'true' : undefined} className="w-5 h-5 text-cyan-400" />
        <h4 className={`font-bold ${t.textPrimary} text-sm`}>Today's Tides</h4>
        {tideData.current_status && (
          <Badge className={`text-[10px] ${trendPillClass(rising, p1, isLight, isBeach)}`}>
            {rising ? (
              <><ArrowUp className="w-3 h-3 mr-1" /> Rising</>
            ) : (
              <><ArrowDown className="w-3 h-3 mr-1" /> Falling</>
            )}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tideData.tides.slice(0, 4).map((tide, index) => {
          const tideTime = new Date(tide.time);
          const isHigh = tide.type === 'High';
          const isPast = tideTime < new Date();
          return (
            <div key={index} className={`p-2 rounded-lg ${isPast ? t.cellBgFaded : t.cellBg}`}>
              <div className="flex items-center gap-2 mb-1">
                {isHigh ? (
                  <ArrowUp className={`w-4 h-4 ${extremeClass(true, p1, isLight, isBeach)}`} />
                ) : (
                  <ArrowDown className={`w-4 h-4 ${extremeClass(false, p1, isLight, isBeach)}`} />
                )}
                <span className={`text-xs font-medium ${extremeClass(isHigh, p1, isLight, isBeach)}`}>
                  {tide.type} Tide
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-lg font-bold ${t.textPrimary}`}>
                  {tideTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`text-xs ${t.textSecondary}`}>
                  {parseFloat(tide.height).toFixed(1)}ft
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className={`text-[10px] ${t.textMuted} mt-2`} data-testid="tide-source-label">
        {p1 ? tideSourceLabel(tideData) : 'Data from NOAA Tides & Currents'}
      </p>
    </div>
  );
}
