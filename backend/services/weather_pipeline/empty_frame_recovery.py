"""Exact-time, truthfully coarser recovery; never invent missing partitions."""
from datetime import datetime, timezone
import math

from services.weather_pipeline.route_helpers import filter_grid_to_bbox


def recover_empty_gfs_frame(product, store, bbox, run_time):
    """Return (usable estimated product, actual resolution), or None.

    Values come only from a non-fixture, non-estimated GFS parent at the exact
    valid time. The original failed frame and cached parent are never mutated.
    """
    if product.model != 'GFS' or product.domain != 'marine' or product.region_id in ('global_mid', 'global_coarse'):
        return None
    candidates = [row for row in store.get_manifest().products
                  if (row.model, row.domain, row.layer) == ('GFS', 'marine', product.layer)
                  and row.region_id in ('global_mid', 'global_coarse')
                  and row.valid_time_start == product.valid_time
                  and row.model_run_time_status == 'known' and row.model_run_time is not None
                  and not row.is_estimated and not row.is_test_fixture]
    candidates.sort(key=lambda row: row.resolution)
    for row in candidates:
        parent = store.load_product(row.filename)
        if (not parent or parent.is_test_fixture or parent.is_estimated or parent.valid_time != product.valid_time
                or parent.model_run_time_status != 'known' or parent.model_run_time is None):
            continue
        # A coarse cell can overlap a narrow coastal box while its centre falls
        # just outside it. Keep that real cell support, and disclose the margin.
        half = row.resolution / 2
        support = dict(west=max(-180, bbox['west']-half), south=max(-90, bbox['south']-half),
                       east=min(180, bbox['east']+half), north=min(90, bbox['north']+half))
        bbox_str = ','.join(str(support[k]) for k in ('west', 'south', 'east', 'north'))
        recovered = filter_grid_to_bbox(parent, bbox_str)
        if not recovered.grid or not any(v.is_valid for v in recovered.grid.vectors):
            continue
        if not all(all(value is None or math.isfinite(value) for value in
                       (v.lat, v.lng, v.speed, v.direction, v.u, v.v, v.period))
                   for v in recovered.grid.vectors if v.is_valid):
            continue
        recovered.region_id = recovered.tile_id = product.region_id
        recovered.coverage_mode = 'regional_tile'
        recovered.resolution = row.resolution
        recovered.run_time = run_time
        recovered.ingested_at = datetime.now(timezone.utc)
        recovered.product_id = None
        recovered.is_estimated = True
        recovered.is_forecast_authoritative = False
        recovered.source_dataset = 'stored_gfs_coarser_fallback'
        recovered.estimate_basis = {
            'type': 'coarser_grid_fallback', 'method': 'exact_time_stored_gfs_crop',
            'source_product_id': row.filename, 'source_resolution': row.resolution,
            'requested_region_bounds': dict(bbox), 'cell_support_margin_degrees': half,
            'source_valid_time': parent.valid_time.isoformat(),
            'source_model_run_time': parent.model_run_time.isoformat() if parent.model_run_time else None,
            'reason': 'regional_frame_has_no_valid_vectors',
        }
        recovered.warnings = [*recovered.warnings, 'Regional frame recovered from a coarser stored GFS grid; estimated.']
        return recovered, row.resolution
    return None
