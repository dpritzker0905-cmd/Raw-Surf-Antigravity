/**
 * useMarineOrchestratorDiag.js
 * 
 * Extracted logging and telemetry functions for useMarineOrchestrator.
 */

import { computeGridContentHash } from './marineGridHash';

export function _marineDataSignature(data, layer) {
  if (!data?.grid) return null;
  const g = data.grid;
  const contentHash = computeGridContentHash(g, layer);
  return `${g.__sourceModel}_${g.__componentLayer}_${data.hourOffset}_${g.__provider}_${g.cols}x${g.rows}_n${g.vectors?.length}_ch${contentHash}`;
}

export function _logPipelineEvent(eventType, detail, pipelineEventsRef, pipelineCountersRef, activeModelRef, activeMarineLayerRef, timeOffsetRef, lastCommittedSigRef, pendingMarineIntentRef) {
  const entry = { event: eventType, ...detail, timestamp: new Date().toISOString() };
  pipelineEventsRef.current = [...pipelineEventsRef.current.slice(-19), entry];
  const c = pipelineCountersRef.current;
  
  if (eventType === 'stale_async_response_rejected') c.staleRejections++;
  if (eventType === 'intent_buffered') c.pendingIntents++;
  if (eventType.startsWith('network_fetch')) c.networkFetches++;
  if (eventType.startsWith('local_cache_remap')) c.cacheRemaps++;
  if (eventType === 'duplicate_commit_skipped') c.duplicateCommitSkipped++;
  if (eventType === 'extended_estimate_fetch') c.extendedEstimateFetches++;
  if (eventType === 'extended_estimate_skipped') c.extendedEstimateSkipped++;
  if (eventType === 'rate_limit_429') c.rateLimits++;

  if (typeof window !== 'undefined') {
    c.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ || 0;
    c.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__ || 0;
    c.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__ || 0;
    window.__MARINE_PIPELINE_TRUTH__ = {
      deployedVersion: 'v7.14',
      activeModel: activeModelRef.current,
      activeLayer: activeMarineLayerRef.current || 'waves',
      activeHour: timeOffsetRef.current,
      cacheMode: activeModelRef.current !== 'EURO' ? 'all_vars_model_cache' : 'layer_scoped',
      pendingIntent: pendingMarineIntentRef.current,
      fetchPending: !!window.__MARINE_FETCH_PENDING__,
      lastCommittedSignature: lastCommittedSigRef.current,
      counters: { ...c },
      lastEvents: pipelineEventsRef.current,
      timestamp: new Date().toISOString()
    };
  }
}
