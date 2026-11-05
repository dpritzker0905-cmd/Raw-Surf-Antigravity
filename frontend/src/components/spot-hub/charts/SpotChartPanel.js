/**
 * SpotChartPanel.js: spot-hub phase 4. The one switch every surface uses: the chart when the spot's
 * series is published and the kill switch is off, otherwise the surface's previous rows (`fallback`).
 */
import React from 'react';
import { useSpotSeries } from './useSpotSeries';
import SpotForecastChart, { SpotForecastMiniChart } from './SpotForecastChart';

// The infobox is ~200 px wide: it shows the free window (the map's and scrubber's +72 h) for every tier.
export const MINI_CHART_HOURS = 72;

export function SpotChartPanel({ spotId, user, model, selectedOffsetHours, onSelectOffset, onUpgrade, fallback = null, className = '' }) {
  const s = useSpotSeries(spotId, user, model);
  // While the series loads (and whenever it is not published) the surface keeps its previous rows: never a blank card.
  if (s.status !== 'ok') return fallback;
  return (
    <div className={className}>
      <SpotForecastChart body={s.body} resolverHours={s.window.hours} selectedOffsetHours={selectedOffsetHours}
        onSelectOffset={onSelectOffset} onUpgrade={onUpgrade} isPremium={s.window.isPremium} />
    </div>
  );
}

export function SpotMiniChartPanel({ spotId, user, model, selectedOffsetHours, onSelectOffset, hostTheme = null }) {
  const s = useSpotSeries(spotId, user, model);
  if (s.status !== 'ok') return null;
  return (
    <SpotForecastMiniChart body={s.body} resolverHours={Math.min(s.window.hours, MINI_CHART_HOURS)}
      selectedOffsetHours={selectedOffsetHours} onSelectOffset={onSelectOffset} hostTheme={hostTheme} />
  );
}

/** Whether a surface should hide its old daily rows: only once the chart is actually showing. */
export function useSpotChartShowing(spotId, user, model) {
  return useSpotSeries(spotId, user, model).status === 'ok';
}
