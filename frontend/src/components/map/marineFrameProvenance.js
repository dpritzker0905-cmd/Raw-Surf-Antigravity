// Preserve explicit source facts through adapters. Never derive a cycle from a cache revision,
// or a served time from the request. Explicit null on the committed grid remains unknown.
export const MARINE_FRAME_PROVENANCE_FIELDS = [
  'model_run_time', 'model_run_time_status', 'ingested_at',
  'served_valid_time', 'frame_offset_hours', 'frame_substituted',
  'upstream_provider', 'source_dataset',
];

export function copyMarineFrameProvenance(primary, fallback) {
  return Object.fromEntries(MARINE_FRAME_PROVENANCE_FIELDS.map(key => [key,
    primary && primary[key] !== undefined ? primary[key]
      : fallback && fallback[key] !== undefined ? fallback[key] : null,
  ]));
}
