// Explicit wire evidence only. Ingestion/legacy run_time never establishes a model cycle.
export function weatherFrameProvenance(frame) {
  return {
    model_run_time: frame.model_run_time ?? null,
    model_run_time_status: frame.model_run_time_status || 'missing',
    ingested_at: frame.ingested_at ?? null,
    served_valid_time: frame.served_valid_time || null,
    frame_offset_hours: frame.frame_offset_hours ?? 0,
    frame_substituted: !!frame.frame_substituted,
    upstream_provider: frame.upstream_provider || null,
    source_dataset: frame.source_dataset || null,
  };
}
