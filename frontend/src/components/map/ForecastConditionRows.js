import React from 'react';
import { Check, Info, AlertTriangle } from 'lucide-react';
import { STATUS_RENDERS } from './forecastCardCompiler';

// Forecast row semantics and status wording live beside their presentation.
// These fragments add no wrapper, preserving the card's list and focus geometry.
export function ForecastConditionRows({ cards, textMuted, textClass, timeClass }) {
  return (<>
{cards.map((card, i) => {
  const Icon = card.icon;
  return (
    // ACCESSIBILITY (2026-07-14 mandate): each row is a listitem carrying its own
    // label+value as accessible text, so a screen reader hears "Surf, 2.1 feet
    // estimated" rather than an orphaned number. `ariaLabel` lets a card spell the
    // quantity out in full where the visible label is abbreviated for width — which
    // matters most here, since 'Swell' and 'Surf' are DIFFERENT QUANTITIES in the
    // same units and the distinction must survive being read aloud.
    <div key={i} role="listitem"
         aria-label={card.ariaLabel || `${card.label}: ${card.value}`}
         className="flex items-center gap-2">
      <Icon
        aria-hidden="true"
        className={`w-3.5 h-3.5 ${card.color} shrink-0 inline-block`}
        style={(card.rotate !== undefined && card.rotate !== null) ? { transform: `rotate(${card.rotate}deg)`, transformOrigin: 'center' } : undefined}
      />
      <span aria-hidden="true" className={`text-[10px] ${textMuted} w-12`}>{card.label}</span>
      {card.badgeColor ? (
        // Rating is conveyed by COLOR + TEXT, never colour alone (mandate): the pill's
        // text is the level name, and the row's aria-label repeats it.
        <span aria-hidden="true" className={`text-[11px] font-bold px-2 py-0.5 rounded-full${card.provisional ? ' opacity-60' : ''}`} style={{ backgroundColor: card.badgeColor, color: '#fff' }}>{card.value}</span>
      ) : (
        // Provisional (grid-sampled) values render dimmed alongside their '…' text
        // marker until the exact-point authority lands; works in all three themes.
        <span aria-hidden="true" className={`text-xs font-bold ${textClass} transition-opacity duration-300${card.provisional ? ' opacity-60' : ''}`}>{card.value}</span>
      )}
      {card.note && <span aria-hidden="true" className={`text-[9px] ${timeClass} truncate`}>{card.note}</span>}
    </div>
  );
})}
  </>);
}

export function ForecastHeatmapStatus({ status, model, layer, isLight }) {
  const tone = isLight ? (status === 'ready' ? 'text-emerald-800'
    : STATUS_RENDERS[status]?.color === 'text-rose-400' ? 'text-rose-800' : 'text-amber-800') : STATUS_RENDERS[status]?.color;
  const coverageMissing = ['no_backend_coverage', 'no_copernicus_coverage'].includes(status);
  const layerName = { waves: 'waves', swell_1: 'swell', swell_2: 'swell 2', wind_waves: 'wind waves' }[layer] || 'weather';
  const coverageLabel = `${model ? `${model} ` : ''}${layerName} map grid unavailable`;
  return (<>
{STATUS_RENDERS[status] && (() => {
  const IconComponent = status === 'ready' ? Check
    : ['zoom_too_low', 'no_copernicus_coverage', 'no_backend_coverage'].includes(status) ? Info
    : AlertTriangle;
  return (
    <div className={`pt-1.5 mt-1.5 border-t border-zinc-800/20 text-[10px] ${tone} font-semibold flex items-center gap-1.5`}>
      <IconComponent aria-hidden="true" className={`w-3 h-3 shrink-0 ${tone}`} />
      <span>{coverageMissing ? coverageLabel : STATUS_RENDERS[status].text}
        {coverageMissing && <span className="block font-normal mt-0.5">No usable map grid for this view/time. Tide data loads separately.</span>}
      </span>
    </div>
  );
})()}
  </>);
}
