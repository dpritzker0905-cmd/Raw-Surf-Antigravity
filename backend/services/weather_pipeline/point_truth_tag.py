"""point_truth_tag.py — the `/point` truthTag / gridPointParity block, moved out of routes/weather.py (audit SRV-4).

It hashed every vector of the sampled product TWICE (pure-Python FNV, ~165 ms for a global_mid product, measured
2026-11-10) on the event loop for every GFS-waves and wind /point. Now:
  * load + crop + hash run in ONE worker thread (the loop is never blocked), and
  * the finished tag is memoised per product (identity stamp incl. file mtime, crop bbox) in a small LRU with a
    TTL, so a second ask for the same product costs a dict lookup. `createdAt` is re-stamped on every hit.
Tag VALUES are unchanged (same compute_truth_tag). Kill: POINT_TRUTH_TAG_CACHE=0 (still off-loop, no memo).
"""
import asyncio
import json
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

from fastapi.responses import JSONResponse

from services.weather_pipeline.route_helpers import compute_truth_tag, filter_grid_to_bbox, get_snapped_bbox
from services.weather_pipeline.schemas import NormalizedPointResponse

_MAX_ENTRIES = 128
_TTL_S = 300.0     # a runtime-flag flip can change what the served view loads under the same filename
_memo: "OrderedDict[tuple, tuple]" = OrderedDict()
_memo_lock = threading.Lock()


def _tag_of(p, stage):
    return compute_truth_tag(
        model=p.model, domain=p.domain, layer=p.layer, valid_time=p.valid_time, run_time=p.run_time,
        product_id=p.product_id, provider=p.provider, upstream_model=p.upstream_model,
        is_dynamic_viewport_product=p.is_dynamic_viewport_product, coverage_scope=p.coverage_scope,
        requested_bbox=p.requested_bbox, served_bbox=p.served_bbox,
        cols=p.grid.cols if p.grid else 0, rows=p.grid.rows if p.grid else 0,
        vectors=p.grid.vectors if p.grid else [], source_stage=stage)


def _restamp(tag, now):
    out = dict(tag, createdAt=now)
    for k in ("sourceTruthTag", "sampledTruthTag", "cropTruthTag"):
        if isinstance(out.get(k), dict):
            out[k] = _restamp(out[k], now)
    return out


def _mtime_ns(store, product_id):
    try:
        return os.stat(store.cache_dir / product_id).st_mtime_ns
    except Exception:
        return 0


def _build(store, product_id, domain, grid_bbox):
    """Sync (runs in a worker thread): the truth tag for the stored product, or None when it has no grid."""
    product = store.load_product(product_id)
    if not (product and product.grid):
        return None
    crop = bool(grid_bbox) and domain.lower() != "wind" and getattr(product, "coverage_mode", None) != "global_tile"
    snapped = get_snapped_bbox(grid_bbox, product.model) if crop else None
    key = (product_id, str(product.run_time), str(product.valid_time), product.grid.cols, product.grid.rows,
           len(product.grid.vectors), _mtime_ns(store, product_id), snapped)
    use_memo = os.environ.get("POINT_TRUTH_TAG_CACHE", "1") != "0"
    now_s = time.monotonic()
    if use_memo:
        with _memo_lock:
            hit = _memo.get(key)
            if hit and now_s - hit[0] < _TTL_S:
                _memo.move_to_end(key)
                return _restamp(hit[1], datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    source_tag = _tag_of(product, "sourceResponse")
    cropped = filter_grid_to_bbox(product, snapped) if crop else product
    crop_tag = _tag_of(cropped, "pointResponse")
    if source_tag["dataHash"] == crop_tag["dataHash"] and source_tag["boundsHash"] == crop_tag["boundsHash"]:
        tag = crop_tag
    else:
        tag = crop_tag.copy()
        tag["sourceTruthTag"] = source_tag
        tag["sampledTruthTag"] = crop_tag
        tag["cropTruthTag"] = crop_tag
        tag["parentProductId"] = product.product_id
    if use_memo:
        with _memo_lock:
            _memo[key] = (now_s, tag)
            _memo.move_to_end(key)
            while len(_memo) > _MAX_ENTRIES:
                _memo.popitem(last=False)
    return tag


async def attach_point_truth(response, store, domain, grid_product_id, grid_bbox):
    """Add truthTag + gridPointParity to a /point response (GFS marine waves and wind only; the caller decides)."""
    sampled_product_id = source = None
    body_dict = {}
    if isinstance(response, NormalizedPointResponse):
        sampled_product_id, source = response.product_id, response.source
    elif isinstance(response, JSONResponse):
        try:
            body_dict = json.loads(response.body.decode("utf-8"))
            sampled_product_id, source = body_dict.get("product_id"), body_dict.get("source")
        except Exception:
            body_dict = {}
    else:
        return response

    truth_tag = None
    if sampled_product_id:
        truth_tag = await asyncio.to_thread(_build, store, sampled_product_id, domain, grid_bbox)

    mismatch_reason = None
    if grid_product_id:
        is_match = source == "grid_file" and sampled_product_id == grid_product_id
        if not is_match:
            mismatch_reason = (f"Sampled from source={source}, product={sampled_product_id} "
                               f"but expected grid_product_id={grid_product_id}")
    else:
        is_match = source == "grid_file"
        if not is_match:
            mismatch_reason = f"Sampled from source={source} (no grid_product_id requested)"
    parity = {"status": "MATCH" if is_match else "MISMATCH", "mismatchReason": mismatch_reason}

    if isinstance(response, NormalizedPointResponse):
        response.truthTag = truth_tag
        response.gridPointParity = parity
        response.mismatchReason = mismatch_reason
        return response
    body_dict["truthTag"] = truth_tag
    body_dict["gridPointParity"] = parity
    body_dict["mismatchReason"] = mismatch_reason
    return JSONResponse(status_code=response.status_code, content=body_dict)
