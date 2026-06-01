/**
 * useSimulationField.js — React Hook Bridge
 *
 * Connects the existing production data hooks (WeatherEngine,
 * useMarineOrchestrator, usePressureEngine) to the SimulationField
 * data model.
 *
 * This hook runs IN PARALLEL with existing rendering. It does NOT
 * replace any rendering path — it just produces the unified field
 * for the FCE to consume.
 *
 * RULES:
 * - Pure React hook (no side effects beyond memoization)
 * - Does NOT fetch data (that's still done by existing hooks)
 * - Does NOT render anything (that's still done by existing layers)
 * - Produces SimulationField + diagnostics for validation
 */

import { useMemo, useRef } from 'react';
import { buildSimulationField } from './SimulationFieldBuilder';
import { getFieldDiagnostics, isFieldPopulated } from './SimulationField';

/**
 * Build a SimulationField from all available weather data sources.
 *
 * @param {Object} params
 * @param {Object|null} params.windData - From useWeatherEngine
 * @param {Object|null} params.marineData - From useMarineOrchestrator
 * @param {Object|null} params.pressureData - From usePressureEngine
 * @param {string} params.activeModel - 'GFS' | 'ICON' | 'EURO'
 * @param {number} params.timeOffsetHours - Timeline offset
 * @param {boolean} [params.enableLogging=false] - Log diagnostics to console
 *
 * @returns {{ field: SimulationField|null, revision: number, diagnostics: Object }}
 */
export function useSimulationField({
  windData = null,
  marineData = null,
  pressureData = null,
  activeModel = 'GFS',
  timeOffsetHours = 0,
  enableLogging = false,
  activeMarineLayer = null,
}) {
  const lastRevisionRef = useRef(0);
  const lastLogTimeRef = useRef(0);
  const lastDepsRef = useRef({ windDep: 'null', marineDep: 'null', pressureDep: 'null', activeModel: '', timeOffsetHours: 0, activeMarineLayer: '' });

  // Compute stable primitive dependency keys to bypass React object reference changes on every frame
  const windDep = windData ? `${windData.vectors?.length || 0}-${windData.bounds?.west || 0}-${windData.revision || 0}` : 'null';
  const marineDep = marineData ? `${marineData.grid?.vectors?.length || 0}-${marineData.grid?.__sourceModel || 'x'}-${marineData.grid?.__componentLayer || 'x'}-${marineData.grid?.__activeLayerNonzeroCount || 0}-${marineData.grid?.__renderable}-${marineData.hourOffset || 0}-${marineData.__commitRevision || 0}` : 'null';
  const pressureDep = pressureData ? `${pressureData.vectors?.length || 0}-${pressureData.bounds?.west || 0}-${pressureData.revision || 0}` : 'null';

  // Memo keys: rebuild only when actual data values change
  const field = useMemo(() => {
    // Skip if no data at all
    if (!windData && !marineData && !pressureData) return null;

    const f = buildSimulationField({
      windData,
      marineData,
      pressureData,
      model: activeModel,
      hourOffset: timeOffsetHours,
      activeMarineLayer,
    });

    // v7.12: Track bind reason
    const prev = lastDepsRef.current;
    const changed = [];
    if (prev.windDep !== windDep) changed.push('wind');
    if (prev.marineDep !== marineDep) changed.push('marine');
    if (prev.pressureDep !== pressureDep) changed.push('pressure');
    if (prev.activeModel !== activeModel) changed.push('model');
    if (prev.timeOffsetHours !== timeOffsetHours) changed.push('timeOffset');
    if (prev.activeMarineLayer !== activeMarineLayer) changed.push('marineLayer');
    if (typeof window !== 'undefined') {
      window.__SIM_BIND_REASON__ = {
        changed,
        prevWindDep: prev.windDep,
        nextWindDep: windDep,
        prevMarineDep: prev.marineDep,
        nextMarineDep: marineDep,
        prevPressureDep: prev.pressureDep,
        nextPressureDep: pressureDep,
        prevActiveModel: prev.activeModel,
        nextActiveModel: activeModel,
        prevActiveMarineLayer: prev.prevActiveMarineLayer || prev.activeMarineLayer,
        nextActiveMarineLayer: activeMarineLayer,
        prevTimeOffsetHours: prev.timeOffsetHours,
        nextTimeOffsetHours: timeOffsetHours,
        prevRevision: lastRevisionRef.current,
        nextRevision: f.revision,
        timestamp: new Date().toISOString()
      };
    }
    lastDepsRef.current = { windDep, marineDep, pressureDep, activeModel, timeOffsetHours, activeMarineLayer };
    lastRevisionRef.current = f.revision;
    return f;
  }, [windDep, marineDep, pressureDep, activeModel, timeOffsetHours, activeMarineLayer]);

  // Generate diagnostics (cheap — only iterates once)
  const diagnostics = useMemo(() => {
    if (!field) return { populated: false };
    return getFieldDiagnostics(field);
  }, [field]);

  // Throttled console logging (max once per 5s to avoid spam)
  if (enableLogging && field && isFieldPopulated(field)) {
    const now = Date.now();
    if (now - lastLogTimeRef.current > 5000) {
      lastLogTimeRef.current = now;
      console.log('[FCE] SimulationField:', diagnostics);
    }
  }

  return {
    field,
    revision: lastRevisionRef.current,
    diagnostics,
  };
}
