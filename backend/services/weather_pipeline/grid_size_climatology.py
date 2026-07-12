"""
grid_size_climatology.py — per-CELL local size expectation for the surf-rating BAND (P-local, band half).

The glyph half (spot_size_climatology) keys the size gate to each SPOT's own good-day breaking height.
The BAND (rating_transform_grid) rates arbitrary coastal GRID CELLS — most of them nowhere near a known
spot — so it needs the same local reference as a FIELD: reference(lat,lng) -> "fully-working" breaking
height for that stretch of coast. GLOBAL-FIRST: a per-spot nearest-neighbor lookup would only calibrate
near the 1,516 curated (US-heavy) spots; this gridded climatology calibrates ANY coast on Earth.

Basis parity (critical for the band<->glyph consistency gate): same bins, same surfable-day floor, same
p80, same clamps — the pure helpers are IMPORTED from spot_size_climatology, and samples are BREAKING
heights from the same estimate_surf physics the band applies at serve time. Sampling cadence mirrors the
spot blob (hour-0 of each cycle) so both references bootstrap on the same clock.

Accumulation: the GFS global_mid waves ingest (pilots lane, 6x/day) folds hour-0 breaking heights of
every COASTAL 2-degree cell into a rolling histogram blob in L2 (single-writer cron — no CAS). GFS-only,
matching the spot climatology's default basis (SPOT_RATINGS_PRECOMPUTE_MODELS=GFS): the reference is a
property of the COAST, not of the model, so all models read the same field. Gate
RATING_GRID_SIZE_CLIMATOLOGY (default ON — it only writes a separate blob; nothing reads it until
RATING_LOCAL_SIZE turns serving on).

Serving (RATING_LOCAL_SIZE=1, wired in apply_surf_overlay): reference_for(clim, lat, lng) — exact-cell
p80, falling back to the mean of 8-neighbor references (a fine dynamic-lane cell whose 2-degree cell
center classified open-ocean still inherits its coast's reference), else None -> global 1.2 m default.
"""
import json
import logging
import os
from typing import Optional

from services.weather_pipeline.spot_size_climatology import (
    merge_samples, reference_from_hist, hist_count,
)

logger = logging.getLogger(__name__)

GRID_SIZE_CLIMATOLOGY_L2_KEY = "spot_ratings/grid_size_climatology.json"
SCHEMA_VERSION = 1
LATTICE_DEG = 2.0        # matches the global_mid product resolution (GFS_MID_RES default)


def cell_key(lat: float, lng: float, lattice: float = LATTICE_DEG) -> Optional[str]:
    """Stable lattice key 'i,j' (floor-quantized from -90/-180) — robust to product-grid axis shifts."""
    if lat is None or lng is None:
        return None
    lng = ((lng + 180.0) % 360.0) - 180.0
    i = int((lat + 90.0) // lattice)
    j = int((lng + 180.0) // lattice)
    return f"{i},{j}"


def accumulate_points_into_grid_climatology(clim_obj: Optional[dict], points, *,
                                            depth_fn, coastal_fn, width_fn,
                                            hour_index: int = 0) -> dict:
    """Fold one ingest run's hour-``hour_index`` BREAKING heights into the per-cell histograms.

    ``points`` are Open-Meteo-shaped marine point dicts (hourly wave_height/wave_period). Per point:
    skip non-coastal cells (surf is a coastline property), estimate the breaking height with the SAME
    physics the band applies at serve (estimate_surf: shoaling + shelf friction + depth-limited), skip
    non-surf regimes, and merge into the point's lattice cell (sub-rideable samples are excluded inside
    merge_samples, mirroring the spot blob). Returns the updated schema-versioned climatology object."""
    from services.weather_pipeline.surf_transform import estimate_surf

    cells = {}
    if clim_obj and isinstance(clim_obj.get("cells"), dict):
        cells = dict(clim_obj["cells"])

    by_cell = {}
    for pt in points or []:
        try:
            lat = pt.get("latitude")
            lng = pt.get("longitude")
            hourly = pt.get("hourly") or {}
            heights = hourly.get("wave_height") or []
            periods = hourly.get("wave_period") or []
            if lat is None or lng is None or hour_index >= len(heights):
                continue
            h0 = heights[hour_index]
            if h0 is None or h0 <= 0:
                continue
            t0 = periods[hour_index] if hour_index < len(periods) else None
            try:
                if not coastal_fn(lat, lng):
                    continue
            except Exception:
                continue
            try:
                depth = depth_fn(lat, lng)
            except Exception:
                depth = None
            try:
                width = width_fn(lat, lng) or 0.0
            except Exception:
                width = 0.0
            surf, regime = estimate_surf(h0, t0, depth, coastal=True, shelf_width_km=width)
            if surf is None or regime in ("open_ocean", "calm", "unknown"):
                continue
            key = cell_key(lat, lng)
            if key is None:
                continue
            by_cell.setdefault(key, []).append(surf)
        except Exception:
            continue                      # one bad point must never poison the fold

    for key, samples in by_cell.items():
        rec = cells.get(key) if isinstance(cells.get(key), dict) else {}
        rec = {"hist": merge_samples(rec.get("hist"), samples)}
        rec["n"] = hist_count(rec["hist"])
        cells[key] = rec

    from datetime import datetime, timezone
    return {"schema_version": SCHEMA_VERSION, "updated_at": datetime.now(timezone.utc).isoformat(),
            "lattice_deg": LATTICE_DEG, "cells": cells}


def reference_for(clim_obj: Optional[dict], lat: float, lng: float, **kw) -> Optional[float]:
    """The local size reference (m) for a coordinate: exact-cell clamped p80, else the mean of the
    8-neighbor cell references, else None (caller falls back to the global default). Same percentile,
    min-samples, and clamps as the per-spot reference (imported helpers) — band and glyph saturate
    identically where they overlap."""
    if not clim_obj or not isinstance(clim_obj.get("cells"), dict):
        return None
    key = cell_key(lat, lng, float(clim_obj.get("lattice_deg") or LATTICE_DEG))
    if key is None:
        return None
    cells = clim_obj["cells"]
    rec = cells.get(key)
    if isinstance(rec, dict):
        ref = reference_from_hist(rec.get("hist"), **kw)
        if ref is not None:
            return ref
    try:
        i, j = (int(x) for x in key.split(","))
    except Exception:
        return None
    neigh = []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == 0 and dj == 0:
                continue
            r = cells.get(f"{i + di},{j + dj}")
            if isinstance(r, dict):
                nref = reference_from_hist(r.get("hist"), **kw)
                if nref is not None:
                    neigh.append(nref)
    if not neigh:
        return None
    return round(sum(neigh) / len(neigh), 3)


# ── L2 persistence (mirrors spot_size_climatology load/upload) ──────────────────────────────────────
def upload_grid_size_climatology_l2(store, obj) -> None:
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(GRID_SIZE_CLIMATOLOGY_L2_KEY, data)


_l2_cache = {"obj": None, "ts": 0.0}


def load_grid_size_climatology_l2_cached(ttl: float = 600.0) -> Optional[dict]:
    import time
    now = time.time()
    if _l2_cache["obj"] is not None and (now - _l2_cache["ts"]) < ttl:
        return _l2_cache["obj"]
    obj = load_grid_size_climatology_l2()
    _l2_cache["obj"] = obj
    _l2_cache["ts"] = now
    return obj


def load_grid_size_climatology_l2() -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{GRID_SIZE_CLIMATOLOGY_L2_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception as e:
        logger.debug(f"[grid-size-climatology] L2 load failed: {e}")
        return None
