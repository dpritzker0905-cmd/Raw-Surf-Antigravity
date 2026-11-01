"""MARINE_REGIONAL_TILE_FIRST: inside a GFS pilot box, the stored NOAA GFS-Wave tile is the ONE zoom 7-9 source (DARK, default '0').

WHY (2026-10-23, the owner, 18:13 EDT: "Yes: make the stored NOAA GFS tile the single zoom 7-9 source inside the pilot boxes (server
dark flag + client bundles), retire the Open-Meteo lane there, and flip both together after live parity passes.")
-------------------------------------------------------------------------------------------------------------------------------------
grid_resolver Steps 1-2 look up the DYNAMIC cache (an Open-Meteo `ncep_gfswave025` product resampled onto the viewport, keyed on the
1-deg snapped box) BEFORE Step 3 serves the stored pilot tile. The only override (Root-A, MARINE_DYNCACHE_PREFER_FINE_REGIONAL)
drops a dynamic hit only when it is > 1.25x coarser than the tile, and a 0.25-deg dynamic product never is, so a warm cache answered
a box the tile fully covers with a different lattice and possibly a different run. The client's regional bundles (staticRegional.js,
#491/#500, dark) carry the TILE, so client and server disagreed (the live parity read, 2026-10-23 21:5xZ: florida_east_coast whole
tile 0 comparable nodes, sub-box 465/585 differ). Same NOAA model either way: the dynamic lane adds no resolution, only resampling.

THE RULE IS THE CLIENT'S, line for line (frontend/src/components/map/staticRegional.js pickRegionalTile + regionalClipWindow):
  1. GFS marine waves / swell_1 / swell_2 / wind_waves only (REGIONAL_MODELS / REGIONAL_LAYERS), never surf.
  2. The tile: among the regional manifest items (lng span < 350) whose coverage CONTAINS the request (margin 0), the smallest by
     area; an exact area tie -> no tile. Authoritative items first, estimated only when no authoritative one contains it.
  3. Covered: the request's 1-deg snapped box (get_snapped_bbox) lies inside the tile's DATA extent (its lattice), AND the window
     Step 3 serves (filter_grid_to_bbox(get_snapped_bbox)) covers the request with margin 0 (Step 3's own partial_coverage test).
With a tile so covering, Steps 1-2 are skipped and Step 3 serves that tile unchanged (no second copy of the clip). Anything else
(partial cover, no tile, a tie, another model or layer, surf) takes today's path. Off: nothing here runs except the sampled diff.

WHILE DARK, a sampled diff (MARINE_TILE_FIRST_DIFF_SAMPLE, default 0.05, at most MARINE_TILE_FIRST_DIFF_MAX_PER_HOUR = 30 an hour):
when the dynamic cache answered a box the tile fully covers, log tile vs dynamic at the same nodes (runs, lattices, |dH|, |dDir|),
counted in TILE_FIRST_STATS (/admin/surf-forecast/status). It loads the tile from L1 only on the sampled requests.
"""
import logging
import math
import os
import random
import threading
import time
from collections import Counter

from services.weather_pipeline.route_helpers import (
    filter_grid_to_bbox, get_snapped_bbox, is_bbox_covered_by, parse_bbox,
)

logger = logging.getLogger(__name__)

REGIONAL_MODELS = ("GFS",)
REGIONAL_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
_E9 = 1e-9
TILE_FIRST_STATS = Counter()       # served_tile, declined_<reason>, diff_logged, diff_skipped_cap
_DIFF_LOCK = threading.Lock()
_DIFF_WINDOW = {"hour": None, "n": 0}


def tile_first_enabled():
    return os.environ.get("MARINE_REGIONAL_TILE_FIRST", "0") == "1"


def _span(c):
    return (c.east - c.west) if c.west <= c.east else (360.0 + c.east - c.west)


def _contains(c, w, s, e, n):
    return c.west <= w and c.east >= e and c.south <= s and c.north >= n


def _nearest_per_region(candidates):
    """find_candidates yields (item, |valid_time - target| seconds) pairs, one per stored valid time within 3 h; a bare item counts
    as diff 0. One tile is ONE region: keep its nearest-in-time item (the client picks the tile, then the nearest frame)."""
    best = {}
    for c in candidates or ():
        item, diff = (c if isinstance(c, tuple) else (c, 0.0))[:2]
        key = getattr(item, "region_id", None) or getattr(item, "filename", None) or id(item)
        if key not in best or diff < best[key][1]:
            best[key] = (item, diff)
    return [item for item, _ in best.values()]


def pick_tile(candidates, w, s, e, n):
    """The client's pickRegionalTile over one candidate list: the smallest regional tile whose coverage contains the request; an
    exact area tie between two tiles -> None."""
    best, best_area, tie = None, math.inf, False
    for item in _nearest_per_region(candidates):
        c = getattr(item, "coverage", None)
        if c is None or not all(isinstance(x, (int, float)) for x in (c.west, c.south, c.east, c.north)):
            continue
        if _span(c) >= 350.0 or not _contains(c, w, s, e, n):
            continue
        area = _span(c) * (c.north - c.south)
        if abs(area - best_area) < 1e-9:
            tie = True
        elif area < best_area:
            best, best_area, tie = item, area, False
    return None if (best is None or tie) else best


def eligible(model, domain, layer, surf, bbox):
    return (bool(bbox) and not surf and (model or "").upper() in REGIONAL_MODELS and (domain or "").lower() == "marine"
            and (layer or "").lower() in REGIONAL_LAYERS)


def covering_tile(store, model, domain, layer, surf, bbox, authoritative, estimated):
    """(manifest item, None) when the tile fully covers `bbox` by the client's rule, else (None, reason). Loads the tile (an L1 hit
    when Step 3 has served it before) to read its data extent; Step 3 then loads it again from L1."""
    if not eligible(model, domain, layer, surf, bbox):
        return None, "not_eligible"
    w, s, e, n = parse_bbox(bbox)
    if not (w < e and s < n):
        return None, "crossing_box"
    item = pick_tile(authoritative, w, s, e, n) or pick_tile(estimated, w, s, e, n)
    if item is None:
        return None, "no_tile"
    product = store.load_product(item.filename)
    g = getattr(product, "grid", None) if product is not None else None
    if g is None or not getattr(g, "vectors", None) or getattr(g, "bounds", None) is None:
        return None, "tile_unreadable"
    snapped = get_snapped_bbox(bbox, model)
    sw, ss, se, sn = parse_bbox(snapped)
    b = g.bounds
    if not (sw >= b.west - _E9 and se <= b.east + _E9 and ss >= b.south - _E9 and sn <= b.north + _E9):
        return None, "snap_outside_data"
    served = filter_grid_to_bbox(product, snapped)
    sb = getattr(getattr(served, "grid", None), "bounds", None)
    if sb is None or not is_bbox_covered_by(w, s, e, n, sb, margin=0.0):
        return None, "partial_cover"
    return item, None


def decide(store, model, domain, layer, surf, bbox, authoritative, estimated):
    """MARINE_REGIONAL_TILE_FIRST=1: the covering tile's manifest item, or None (today's path). Never raises."""
    if not tile_first_enabled():
        return None
    try:
        item, why = covering_tile(store, model, domain, layer, surf, bbox, authoritative, estimated)
    except Exception as ex:     # a decision helper must never take the route down: today's path serves
        logger.warning(f"[Tile First] decision failed ({type(ex).__name__}: {ex}); serving today's path")
        TILE_FIRST_STATS["declined_error"] += 1
        return None
    TILE_FIRST_STATS["served_tile" if item is not None else f"declined_{why}"] += 1
    return item


# ── the dark-period diff ──────────────────────────────────────────────────────────────────────────────────────────────────
def _sample_rate():
    try:
        return min(1.0, max(0.0, float(os.environ.get("MARINE_TILE_FIRST_DIFF_SAMPLE", "0.05"))))
    except ValueError:
        return 0.05


def _cap():
    try:
        return max(0, int(os.environ.get("MARINE_TILE_FIRST_DIFF_MAX_PER_HOUR", "30")))
    except ValueError:
        return 30


def _take_slot(now=None):
    hour = int((now if now is not None else time.time()) // 3600)
    with _DIFF_LOCK:
        if _DIFF_WINDOW["hour"] != hour:
            _DIFF_WINDOW["hour"], _DIFF_WINDOW["n"] = hour, 0
        if _DIFF_WINDOW["n"] >= _cap():
            return False
        _DIFF_WINDOW["n"] += 1
        return True


def _pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))], 4)


def compare(tile_product, dyn_product):
    """Node-by-node tile vs dynamic at the nodes both carry (coordinates rounded to 4 dp): counts and |dH| / |dDir| percentiles."""
    def by_node(p):
        return {(round(float(v.lat), 4), round(float(v.lng), 4)): v for v in (getattr(getattr(p, "grid", None), "vectors", None) or ())}
    a, b = by_node(tile_product), by_node(dyn_product)
    common = set(a) & set(b)
    dh, dd, validity = [], [], 0
    for k in common:
        va, vb = a[k], b[k]
        ok_a, ok_b = getattr(va, "is_valid", True) is not False, getattr(vb, "is_valid", True) is not False
        if ok_a != ok_b:
            validity += 1
            continue
        if not ok_a:
            continue
        dh.append(abs(float(va.speed) - float(vb.speed)))
        if va.direction is not None and vb.direction is not None:
            x = abs(float(va.direction) - float(vb.direction)) % 360.0
            dd.append(min(x, 360.0 - x))
    lat = lambda p: [getattr(getattr(p, "grid", None), k, None) for k in ("cols", "rows")]
    return {"tile_nodes": len(a), "dynamic_nodes": len(b), "common_nodes": len(common), "validity_mismatch": validity,
            "tile_lattice": lat(tile_product), "dynamic_lattice": lat(dyn_product),
            "dH_m_p50_p90_max": [_pct(dh, 0.5), _pct(dh, 0.9), round(max(dh), 4) if dh else None],
            "dDir_deg_p50_p90_max": [_pct(dd, 0.5), _pct(dd, 0.9), round(max(dd), 1) if dd else None]}


def maybe_log_diff(store, model, domain, layer, surf, bbox, authoritative, estimated, dyn_product, rng=random.random, now=None):
    """While dark: a sampled, capped comparison of the dynamic-cache answer against the tile that fully covers the same box.
    Never raises; does nothing with the flag on (the tile is served then) or when the sample / hourly cap says no."""
    if tile_first_enabled() or dyn_product is None or not eligible(model, domain, layer, surf, bbox):
        return None
    try:
        if rng() >= _sample_rate():
            return None
        if not _take_slot(now):
            TILE_FIRST_STATS["diff_skipped_cap"] += 1
            return None
        item, why = covering_tile(store, model, domain, layer, surf, bbox, authoritative, estimated)
        if item is None:
            return None
        tile = filter_grid_to_bbox(store.load_product(item.filename), get_snapped_bbox(bbox, model))
        out = compare(tile, dyn_product)
        out.update({"model": model, "layer": layer, "bbox": bbox, "tile": item.filename,
                    "tile_run": str(getattr(tile, "model_run_time", None)), "dynamic_run": str(getattr(dyn_product, "model_run_time", None)),
                    "dynamic_product": getattr(dyn_product, "product_id", None)})
        TILE_FIRST_STATS["diff_logged"] += 1
        logger.info(f"[Tile First] dark diff: {out}")
        return out
    except Exception as ex:
        logger.warning(f"[Tile First] dark diff failed ({type(ex).__name__}: {ex})")
        return None


def tile_first_stats():
    with _DIFF_LOCK:
        window = dict(_DIFF_WINDOW)
    return {"enabled": tile_first_enabled(), "sample_rate": _sample_rate(), "diff_cap_per_hour": _cap(), "diff_window": window,
            "counts": dict(TILE_FIRST_STATS)}


# ── the GFS/ICON live series lane (GFS_ICON_SERIES_FASTPATH) ─────────────────────────────────────────────────────────────────
def inside_pilot_box(bbox):
    """True when `bbox` lies inside one of the GFS marine pilot boxes (every group, whatever the ingest gates say: the client's
    PILOT_BOXES list, pinned to pilot_regions.py), with GFS_PILOT_WHOLE_DEGREE_BOUNDS=1 the boxes as the GFS pass then stores them
    (padded to whole degrees, pilot_regions.whole_degree_regions), so a box in the padded band also skips the live lane."""
    from services.weather_pipeline.pilot_regions import all_gfs_pilot_boxes, whole_degree_regions
    w, s, e, n = parse_bbox(bbox)
    for c in whole_degree_regions(all_gfs_pilot_boxes()).values():
        if c["west"] <= w and e <= c["east"] and c["south"] <= s and n <= c["north"]:
            return True
    return False


def skips_live_series(model, domain, layer, surf, bbox):
    """MARINE_REGIONAL_TILE_FIRST=1: a series page for a box inside a pilot box never takes the Open-Meteo live lane; its hours go
    through resolve_grid, which serves the tile when it fully covers the box and today's path when it does not. Never raises."""
    try:
        return tile_first_enabled() and eligible(model, domain, layer, surf, bbox) and inside_pilot_box(bbox)
    except Exception:
        return False
