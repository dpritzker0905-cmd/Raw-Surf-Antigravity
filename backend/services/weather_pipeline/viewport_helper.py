import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

from services.weather_pipeline.route_helpers import parse_bbox, is_bbox_covered_by
from services.weather_pipeline.schemas import NormalizedProduct

logger = logging.getLogger(__name__)

async def find_any_cached_product_helper(
    model: str,
    domain: str,
    layer: str,
    target_dt: datetime,
    dynamic_index,
    store,
    bbox_str: Optional[str] = None
) -> Optional[NormalizedProduct]:
    """Searches dynamic index and manifest for any product matching model/layer and target time, choosing the closest."""
    req_w, req_s, req_e, req_n = None, None, None, None
    if bbox_str:
        try:
            req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        except Exception:
            pass

    # 1. Search Dynamic Index
    items = dynamic_index._load_index()
    target_ts = target_dt.timestamp()
    
    best_item = None
    min_diff = float("inf")
    
    for item in items:
        if (
            item.get("model", "").upper() == model.upper()
            and item.get("domain", "").lower() == domain.lower()
            and item.get("layer", "").lower() == layer.lower()
        ):
            try:
                item_dt = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
                diff = abs(item_dt.timestamp() - target_ts)
                # Allow up to 24 hours stale product fallback for rate limit
                if diff < min_diff and diff <= 24 * 3600:
                    # If bbox is specified, verify that item overlaps/covers it
                    if req_w is not None:
                        cand_bbox = item.get("served_bbox") or item.get("requested_bbox")
                        if cand_bbox:
                            cw, cs, ce, cn = parse_bbox(cand_bbox)
                            # Simple overlap check
                            lat_overlap = not (req_n < cs or req_s > cn)
                            if cw <= ce:
                                if req_w <= req_e:
                                    lon_overlap = not (req_e < cw or req_w > ce)
                                else:
                                    lon_overlap = not (ce < req_w and cw > req_e)
                            else:
                                if req_w <= req_e:
                                    lon_overlap = not (req_e < cw and req_w > ce)
                                else:
                                    lon_overlap = True
                            if not (lat_overlap and lon_overlap):
                                continue
                    min_diff = diff
                    best_item = item
            except Exception:
                continue

    # 2. Search Manifest (pruning for anomalous future-dated entries runs inside get_manifest())
    manifest = await asyncio.to_thread(store.get_manifest)
    best_manifest_item = None
    min_manifest_diff = float("inf")
    
    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            diff = abs(p.valid_time_start.timestamp() - target_ts)
            # Allow up to 24 hours stale product fallback for rate limit
            if diff < min_manifest_diff and diff <= 24 * 3600:
                # If bbox is specified, manifest fallback MUST fully cover the bbox.
                # Partial coverage falls back to Step 6 instead!
                if req_w is not None:
                    if not is_bbox_covered_by(req_w, req_s, req_e, req_n, p.coverage, margin=0.05):
                        continue
                min_manifest_diff = diff
                best_manifest_item = p

    # Compare best dynamic vs best manifest, serving the one with the smallest time difference
    if best_item and (best_manifest_item is None or min_diff <= min_manifest_diff):
        loaded = await asyncio.to_thread(store.load_product, best_item["product_id"])
        if loaded:
            return loaded

    if best_manifest_item:
        loaded = await asyncio.to_thread(store.load_product, best_manifest_item.filename)
        if loaded:
            loaded.product_id = best_manifest_item.filename
            return loaded
            
    # Fallback to loading dynamic index item if manifest loading failed
    if best_item:
        loaded = await asyncio.to_thread(store.load_product, best_item["product_id"])
        if loaded:
            return loaded

    return None
