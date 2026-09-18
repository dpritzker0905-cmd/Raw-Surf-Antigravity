"""Bounded, request-local evidence; legacy ingestion timestamps are not model cycles."""
def cycle_census(frames):
    cycles = sorted({str(f['model_run_time']) for f in frames
                     if f.get('model_run_time') and f.get('model_run_time_status') == 'known'})
    unknown = sum(not f.get('model_run_time') or f.get('model_run_time_status') != 'known' for f in frames)
    sources = sorted({(f.get('upstream_provider') or 'unknown', f.get('source_dataset') or 'unknown') for f in frames})
    return {'distinct_known_cycles': len(cycles), 'cycles': cycles, 'unknown_cycle_frames': unknown,
            'same_cycle_verified': bool(frames) and not unknown and len(cycles) == 1,
            'mixed_known_cycles': len(cycles) > 1,
            'sources': [{'supplier': s, 'dataset': d} for s, d in sources], 'mixed_sources': len(sources) > 1}
