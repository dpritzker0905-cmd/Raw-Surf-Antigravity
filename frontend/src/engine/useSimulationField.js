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
import { computeGridContentHash } from '../components/map/marineGridHash';



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
  const lastFieldRef = useRef(null);
  const lastFieldSigRef = useRef('');

  const isMarineValid = marineData && 
                        marineData.grid?.vectors && 
                        marineData.grid.vectors.length > 0 && 
                        marineData.__provider !== 'fallback_safe_zero' && 
                        marineData.grid?.__provider !== 'fallback_safe_zero' && 
                        marineData.grid?.__renderable !== false &&
                        marineData.__renderable !== false;
  const effectiveMarineData = isMarineValid ? marineData : null;

  // Compute stable primitive dependency keys to bypass React object reference changes on every frame
  const windDep = windData ? `${windData.vectors?.length || 0}-${windData.bounds?.west || 0}-${windData.revision || 0}` : 'null';
  const mContentHash = effectiveMarineData?.grid ? computeGridContentHash(effectiveMarineData.grid, activeMarineLayer) : 0;
  const marineDep = effectiveMarineData ? `${effectiveMarineData.grid?.vectors?.length || 0}-${effectiveMarineData.grid?.__sourceModel || 'x'}-${effectiveMarineData.grid?.__componentLayer || 'x'}-${effectiveMarineData.grid?.__renderable}-${effectiveMarineData.grid?.__provider || 'x'}-${mContentHash}` : 'null';
  const pressureDep = pressureData ? `${pressureData.vectors?.length || 0}-${pressureData.bounds?.west || 0}-${pressureData.revision || 0}` : 'null';

  // Memo keys: rebuild only when actual data values change
  const field = useMemo(() => {
    // Skip if no data at all
    if (!windData && !effectiveMarineData && !pressureData) return null;

    // Compute a strict data signature to see if the actual grid contents changed
    const wSig = windData ? `${windData.vectors?.length || 0}_${windData.bounds?.west?.toFixed(2) || 0}` : 'null';
    const mSig = effectiveMarineData ? `${effectiveMarineData.grid?.vectors?.length || 0}_${effectiveMarineData.grid?.__componentLayer || 'x'}_ch${mContentHash}_${effectiveMarineData.grid?.__renderable}` : 'null';
    const pSig = pressureData ? `${pressureData.vectors?.length || 0}_${pressureData.bounds?.west?.toFixed(2) || 0}` : 'null';
    const currentSig = `${wSig}_${mSig}_${pSig}_${activeModel}_${activeMarineLayer}`;

    if (lastFieldRef.current && lastFieldSigRef.current === currentSig) {
      const prevField = lastFieldRef.current;

      // The content signature intentionally omits timeOffsetHours. If the grid
      // content is identical but the REQUESTED hour changed, the previous field's
      // hourOffset/time would be stale — which downstream FCE dispatcher validation
      // and diagnostics read. Correct the temporal metadata WITHOUT rebuilding the
      // field (reuse the existing grid arrays).
      if (prevField.hourOffset !== timeOffsetHours) {
        const isScrubbing = typeof window !== 'undefined' && window.isScrubbingTimeline === true;
        const refreshedTime = Date.now() + timeOffsetHours * 3600000;

        if (isScrubbing) {
          // During an active scrub, correct the metadata IN PLACE (same object
          // reference, same revision). This keeps the requested hour truthful for
          // diagnostics while avoiding a new field identity — which would re-render
          // map consumers and trigger SimulationLoop.bindField rebind churn on every
          // intermediate hour. The per-frame FCE dispatcher is a no-op in normal map
          // mode (and self-suppresses during scrub when enabled), so nothing reads a
          // stale evolved-field hour here.
          prevField.hourOffset = timeOffsetHours;
          prevField.time = refreshedTime;
          if (typeof window !== 'undefined') {
            window.__SIM_BIND_REASON__ = {
              changed: ['timeOffset'], deduped: true, reason: 'metadata_time_refresh_scrub_inplace',
              signature: currentSig, prevRevision: prevField.revision, nextRevision: prevField.revision,
              nextHourOffset: timeOffsetHours, timestamp: new Date().toISOString()
            };
          }
          return prevField;
        }

        // Settled: propagate via a metadata-only revision bump so ALL consumers —
        // including the SimulationLoop-cloned evolved field the dispatcher reads —
        // pick up the corrected hour. Grid arrays are still reused (no rebuild).
        const refreshed = {
          ...prevField,
          hourOffset: timeOffsetHours,
          time: refreshedTime,
          revision: prevField.revision + 1,
        };
        lastRevisionRef.current = refreshed.revision;
        lastFieldRef.current = refreshed;
        if (typeof window !== 'undefined') {
          window.__SIM_BIND_REASON__ = {
            changed: ['timeOffset'],
            deduped: true,
            reason: 'metadata_only_time_refresh',
            signature: currentSig,
            prevRevision: prevField.revision,
            nextRevision: refreshed.revision,
            prevHourOffset: prevField.hourOffset,
            nextHourOffset: timeOffsetHours,
            timestamp: new Date().toISOString()
          };
        }
        return refreshed;
      }

      if (typeof window !== 'undefined') {
        window.__SIM_BIND_REASON__ = {
          changed: [],
          deduped: true,
          reason: 'identical_data_signature',
          signature: currentSig,
          prevRevision: lastRevisionRef.current,
          nextRevision: lastRevisionRef.current,
          timestamp: new Date().toISOString()
        };
      }
      return prevField;
    }

    const f = buildSimulationField({
      windData,
      marineData: effectiveMarineData,
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
        deduped: false,
        marineDataIgnored: !!marineData && !isMarineValid,
        marineIgnoreReason: (marineData && !isMarineValid) ? {
          noGrid: !marineData.grid,
          noVectors: !marineData.grid?.vectors,
          emptyVectors: marineData.grid?.vectors?.length === 0,
          fallbackSafeZero: marineData.__provider === 'fallback_safe_zero' || marineData.grid?.__provider === 'fallback_safe_zero',
          notRenderable: marineData.grid?.__renderable === false || marineData.__renderable === false
        } : null,
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
    lastFieldRef.current = f;
    lastFieldSigRef.current = currentSig;
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
