import { buildTruthTag, recordTruthStage } from './weatherTruthTracker';

// Convert one backend series frame into a marineData object shaped exactly like a normal
// cached grid commit, so the orchestrator's existing commit/parity logic accepts it.
export function frameToMarineData(frame, model, layer) {
  const provider = frame.provider || (model === 'EURO' ? 'copernicus' : 'open-meteo');
  const renderable = Array.isArray(frame.vectors) && frame.vectors.length > 0;
  // True data origin for the HUD provenance. `provider` is the deliberate 'open-meteo' contract key (kept
  // byte-identical across the NOAA-direct + open-meteo paths), so without __sourceDataset the HUD mislabels
  // NOAA-direct GFS as "open-meteo". Prefer the backend's per-frame source_dataset; else derive from the model
  // (on the decoupled ingest runner open-meteo is unreachable, so GFS marine is always NOAA-direct ncep_gfswave025,
  // ICON=GWAM/DWD, EURO=Copernicus). The HUD's __basicSourceName maps these → NOAA / DWD / Copernicus.
  // ⛔⛔ THE MODEL->DATASET GUESS IS FALSIFIED FOR EURO (measured 2026-08-03). The derivation below
  // assumes one upstream per model, and the comment above says why that was true when written. It is
  // NOT true for EURO: sampled over 70 NDBC coordinates, `EURO` served THREE different
  // `upstream_provider`s — copernicus, ecmwf, and gfs_estimated_fallback — and their accuracy is not
  // interchangeable. Scoring GFS on the SAME sites:
  //     EURO/copernicus MAE 0.159 (3.2x better than GFS)
  //     EURO/ecmwf      MAE 0.339 (WORSE than GFS's 0.266 there) -- 36% of EURO's coverage
  //     EURO/gfs_estimated_fallback MAE 0.114
  // The Florida EURO grid returns `upstream_provider: "ecmwf"`, so the guess labels it
  // "copernicus_cmems" and the HUD tells the user Copernicus for a coarser field. A label that is
  // right 50% of the time is a PROVENANCE defect, which is this repo's recurring class.
  // ⇒ PREFER THE BACKEND'S OWN `upstream_provider` (served on every marine response, alongside the
  //   `provider` DISPATCH KEY). The model guess stays as the last resort for frames that predate it,
  //   so nothing regresses where the guess was already right.
  const __upstreamProvider = frame.upstream_provider || null;
  const __sourceDataset = frame.source_dataset || (
    __upstreamProvider === 'copernicus' ? 'copernicus_cmems' :
    __upstreamProvider === 'ecmwf' ? 'ecmwf_ifs' :
    __upstreamProvider === 'noaa' ? 'ncep_gfswave025' :
    __upstreamProvider === 'dwd' ? 'gwam_dwd' :
    __upstreamProvider === 'gfs_estimated_fallback' ? 'gfs_estimated_fallback' :
    model === 'GFS' ? 'ncep_gfswave025' :
    model === 'ICON' ? 'gwam_dwd' :
    model === 'EURO' ? 'copernicus_cmems' : null
  );
  const cycleProvenance = {
    model_run_time: frame.model_run_time ?? null,
    model_run_time_status: frame.model_run_time_status || 'missing',
    ingested_at: frame.ingested_at ?? null,
  };
  const grid = {
    ...cycleProvenance,
    vectors: frame.vectors,
    cols: frame.cols,
    rows: frame.rows,
    bounds: frame.bounds,
    __renderable: renderable,
    // MISSING STAMP = the EURO series stall (2026-07-06): every REAL fetch path stamps
    // __gridSupportsLayer (mapper/copernicusGridFetcher/backend clients), and useMarineWindData's
    // hasCopernicusGrid REQUIRES it === true for provider 'copernicus'/'backend-weather-service' —
    // so a series-committed EURO frame (the clamp sharpen's ONLY route at close zoom, and the
    // scrub safety-net's fast path) conformed to hasCopernicusGrid:false and the gate NULLED it.
    // The raw marineData still fed useSimulationField, hence the log signature "series frames
    // bind to the SIM FIELD but the ENGINE keeps coarse_global". The series endpoint returns
    // frames FOR the requested layer, so vectors-present ⇒ the grid supports it: truthful stamp.
    __gridSupportsLayer: renderable,
    __componentLayer: layer,
    __sourceModel: model,
    __sourceDataset,
    __gridProvider: provider,
    // The ORIGIN beside the DISPATCH KEY, so a consumer can tell an 8 km MFWAM field from a 25 km
    // IFS one. `__MARINE_RENDER_SOURCE_DIAG__.upstreamProvider` reads this.
    __upstreamProvider,
    provider,
    hourOffset: frame.hour_offset,
    is_estimated: !!frame.is_estimated,
    is_dynamic_viewport_product: true,
    __fromSeries: true,
    // Carry the surf-RATING signal so the shader paints the rating band on series-committed frames (clamp/scrub
    // commit series frames; without this the rating band never rendered even with surf=1). See _frame_rating_mode.
    ratingMode: !!frame.rating_mode,
    // §0c SERVING HONESTY: the frame actually served per the backend (valid_time echoes the
    // ask). Surfaced in FORENSIC-SNAP as frameOff — a pasted log self-reports frame skew.
    valid_time: frame.valid_time || null,
    served_valid_time: frame.served_valid_time || null,
    frame_offset_hours: frame.frame_offset_hours ?? 0,
    frame_substituted: !!frame.frame_substituted,
  };
  const product_id = `series_${model}_${layer}_h${frame.hour_offset}`;
  // Audit #18/A3: mint the lineage tag ONCE here — recordTruthStage PRESERVES an existing tag, so
  // commit and webglUpload share product_id + traceId. Without this the engine reconstructs a tag
  // from the bare waveGrid (no product_id there) → "Product: undefined" + a divergent traceId, and
  // the same-product previousStages filter never matches series frames. Stamped on the GRID because
  // that's the object the engine sees (waveGrid.truthTag), and mirrored on the wrapper for the
  // orchestratorCommit's marineData.truthTag read.
  const truthTag = renderable ? buildTruthTag({
    ...cycleProvenance,
    grid, model, domain: 'marine', layer,
    valid_time: frame.valid_time, run_time: frame.run_time,
    product_id, provider,
    is_dynamic_viewport_product: true,
    coverage_scope: frame.coverage_scope,
  }, 'seriesFrameMint') : null;
  if (truthTag) {
    if (Number.isFinite(frame.hour_offset)) truthTag.timeOffsetHours = frame.hour_offset;
    grid.truthTag = truthTag;
    // Task #14 (2026-07-18): REGISTER the chain at its mint. Series frames legitimately commit
    // through direct lanes (scrub-settle, clamp backstop, hour-0 revalidate) that never record an
    // orchestratorCommit — their webglUpload then compared against the PREVIOUS chain's commit on
    // the same stable product_id (series_*_h0) and console.error'd a false MISMATCH on every
    // mini/series commit (TruthOverlay render storm rode the same spam). 'seriesFrameMint' is a
    // START stage (exempt from backward comparison, arms the absence watchdog) so the upload
    // compares within ITS OWN chain; real within-chain divergence still trips. Scope mirrors the
    // tracker's GFS-waves@h0 gate. Kill: __RAW_DISABLE_SERIES_MINT_STAGE__.
    if (model === 'GFS' && layer === 'waves' && frame.hour_offset === 0 &&
        typeof window !== 'undefined' && !window.__RAW_DISABLE_SERIES_MINT_STAGE__) {
      recordTruthStage('seriesFrameMint', {
        model, domain: 'marine', layer,
        valid_time: frame.valid_time, run_time: frame.run_time,
        product_id, grid, truthTag,
      }, 'marineGridSeries.js', 'mapSeriesFrame');
    }
  }
  return {
    type: 'FeatureCollection',
    features: [],
    grid,
    __sourceModel: model,
    __provider: provider,
    __renderable: renderable,
    __fromSeries: true,
    valid_time: frame.valid_time,
    run_time: frame.run_time,
    ...cycleProvenance,
    hourOffset: frame.hour_offset,
    ...(truthTag ? { truthTag } : {}),
    product_id,
    region_id: 'series',
    is_dynamic_viewport_product: true,
  };
}

