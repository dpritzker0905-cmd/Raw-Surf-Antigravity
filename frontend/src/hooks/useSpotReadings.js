import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const readModel = () => { try { return localStorage.getItem('rawsurf-active-model') || 'GFS'; } catch { return 'GFS'; } };
export function useSpotReadings(spotId, enabled, currentOnly = false) {
  const [model, setModel] = useState(readModel);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setModel(readModel());
    update();
    window.addEventListener('rawsurf-model-changed', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('rawsurf-model-changed', update); window.removeEventListener('storage', update); };
  }, [enabled]);
  const key = JSON.stringify([spotId, model, enabled, currentOnly]);
  const empty = { conditions: null, tideData: null, reports: null, forecast: [], loading: !!(enabled && spotId) };
  const [snapshot, setSnapshot] = useState(null);
  const owner = useRef(null);
  useEffect(() => {
    if (!enabled || !spotId) return;
    const scope = { key, controller: new AbortController(), versions: {} };
    owner.current = scope;
    setSnapshot({ key, ...empty });
    const load = async (field, url, select = data => data) => {
      const version = scope.versions[field] = (scope.versions[field] || 0) + 1;
      const current = () => owner.current === scope && !scope.controller.signal.aborted && scope.versions[field] === version;
      try {
        const response = await apiClient.get(url, { signal: scope.controller.signal });
        if (current()) setSnapshot(prev => ({ ...prev, [field]: select(response.data) }));
      } catch (error) {
        if (current()) logger.debug('Spot forecast read unavailable', field);
      } finally {
        if (field === 'conditions' && current()) setSnapshot(prev => ({ ...prev, loading: false }));
      }
    };
    load('conditions', `/conditions/${spotId}?model=${encodeURIComponent(model)}`);
    if (!currentOnly) {
      load('tideData', `/tides/${spotId}`, data => data?.error ? null : data);
      scope.refreshReports = () => load('reports', `/surf-reports/today/${spotId}`);
      scope.refreshReports();
      load('forecast', `/conditions/forecast/${spotId}?model=${encodeURIComponent(model)}`, data => data?.forecast || []);
    }
    return () => { scope.controller.abort(); if (owner.current === scope) owner.current = null; };
    // The key contains every request dependency; the empty snapshot belongs to this effect's key.
  }, [key]);
  const refreshReports = useCallback(() => {
    const scope = owner.current;
    if (scope?.key === key && !scope.controller.signal.aborted) scope.refreshReports?.();
  }, [key]);
  // Never expose the previous spot/model even on the render before effect cleanup runs.
  return { ...(snapshot?.key === key ? snapshot : empty), refreshReports };
}
