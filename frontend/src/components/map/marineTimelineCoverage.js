/** Diagnostic identity only. Does not own the clock, select a frame, or drive rendering. */
const timeMs = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
};

export function readMarineTimelineRenderEvidence(model, layer,
  win = typeof window !== 'undefined' ? window : null) {
  const grid = win?.__MARINE_ENGINE__?._waveData?.waveGrid;
  const renderedValidTime = grid?.served_valid_time || grid?.valid_time || grid?.validTime;
  if (grid?.__sourceModel === model && grid?.__componentLayer === layer
    && timeMs(renderedValidTime) !== null) {
    // This is the engine's accepted data identity, not proof of a drawn GPU frame or RAF rate.
    return { verified: true, source: 'accepted_engine_grid', renderedValidTime,
      renderedDataHour: grid.hourOffset ?? null };
  }
  const parity = win?.__MARINE_RENDER_HOUR_PARITY__;
  return parity ? { ...parity, verified: false, source: 'legacy_hour_parity' } : null;
}

export function evaluateMarineTimelineCoverage(timeline = {}, renderEvidence = null, requestedHour) {
  const hour = Number.isFinite(requestedHour) ? requestedHour : timeline.timeOffsetHours;
  const requested = timeMs(timeline.requestedValidTime);
  const selected = timeMs(timeline.selectedValidTime);
  const responseTimeMismatch = requested !== null && selected !== null && requested !== selected;
  const renderedHour = renderEvidence?.renderedDataHour ?? renderEvidence?.renderedHour ?? null;
  const renderedTime = timeMs(renderEvidence?.renderedValidTime);
  const reportedRenderTimeMismatch = renderedTime !== null && requested !== null
    ? renderedTime !== requested
    : Number.isFinite(hour) && Number.isFinite(renderedHour) && hour !== renderedHour;
  // The legacy hour-parity global may lag the actual GPU upload. A caller must explicitly
  // identify authoritative evidence before we call its disagreement a verified identity mismatch.
  const renderVerified = renderEvidence?.verified === true;
  const renderTimeMismatch = renderVerified && reportedRenderTimeMismatch;
  const temporalStatus = responseTimeMismatch ? 'response_time_mismatch'
    : renderTimeMismatch ? 'render_time_mismatch'
      : reportedRenderTimeMismatch ? 'render_time_unverified'
        : requested !== null && selected !== null ? 'aligned' : 'unknown';
  return {
    temporalStatus, temporalMismatch: responseTimeMismatch || renderTimeMismatch,
    responseTimeMismatch, renderTimeMismatch, reportedRenderTimeMismatch, renderVerified,
    requestedHour: Number.isFinite(hour) ? hour : null,
    requestedValidTime: timeline.requestedValidTime ?? null,
    selectedValidTime: timeline.selectedValidTime ?? null,
    renderedHour, renderedValidTime: renderEvidence?.renderedValidTime ?? null,
    renderEvidenceSource: renderEvidence?.source ?? null,
  };
}

export function reconcileMarineTimelineCoverage(win = typeof window !== 'undefined' ? window : null) {
  const timeline = win?.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  if (!timeline || (timeline.domain && timeline.domain !== 'marine')) return null;
  const state = evaluateMarineTimelineCoverage(timeline,
    readMarineTimelineRenderEvidence(timeline.activeModel, timeline.activeLayer, win));
  const temporalStatuses = ['stale_time_mismatch', 'temporal_coverage_unverified'];
  const spatialCoverageStatus = temporalStatuses.includes(timeline.coverage_status)
    ? timeline.spatialCoverageStatus || 'unknown' : timeline.coverage_status || 'unknown';
  const coverage_status = state.temporalMismatch ? 'stale_time_mismatch'
    : state.temporalStatus === 'render_time_unverified' ? 'temporal_coverage_unverified'
      : spatialCoverageStatus;
  win.__FORECAST_TIMELINE_COVERAGE_DIAG__ = {
    ...timeline, ...state, spatialCoverageStatus, coverage_status,
  };
  return win.__FORECAST_TIMELINE_COVERAGE_DIAG__;
}

export function publishMarineTimelineRequest({ model, layer, hour, requestedValidTime,
  requestedValidTimeOriginal }, win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  const previous = win.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};
  win.__FORECAST_TIMELINE_COVERAGE_DIAG__ = {
    ...previous, domain: 'marine', activeModel: model, activeLayer: layer,
    timeOffsetHours: hour, requestedValidTime,
    requestedValidTimeOriginal: requestedValidTimeOriginal ?? null,
  };
  return reconcileMarineTimelineCoverage(win);
}

export function publishMarineTimelineFrame({ data, model, layer, hour, requestedValidTime },
  win = typeof window !== 'undefined' ? window : null) {
  if (!win || !data?.grid) return null;
  const grid = data.grid;
  const previous = win.__FORECAST_TIMELINE_COVERAGE_DIAG__ || {};
  // Prefer the backend's honest served time. Never substitute the requested time for absent
  // frame identity, and never carry a previous product's cycle identity onto a new frame.
  const selectedValidTime = data.served_valid_time || grid.served_valid_time
    || data.valid_time || data.validTime || grid.valid_time || grid.validTime || null;
  win.__FORECAST_TIMELINE_COVERAGE_DIAG__ = {
    ...previous, domain: 'marine', activeModel: model, activeLayer: layer,
    timeOffsetHours: hour, requestedValidTime, selectedValidTime,
    gridProductId: data.product_id || data.productId || grid.productId || grid.product_id || null,
    model_run_time: data.model_run_time ?? grid.model_run_time ?? null,
    model_run_time_status: data.model_run_time_status || grid.model_run_time_status || 'missing',
    commitRevision: data.__commitRevision ?? previous.commitRevision ?? 0,
    cacheStatus: 'committed_cache_frame',
  };
  return reconcileMarineTimelineCoverage(win);
}
