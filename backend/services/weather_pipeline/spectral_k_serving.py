"""spectral_k_serving.py — SURF_SPECTRAL_K (default '0': it FAILED the round-7 four-season
history test (PR #722), so it does not ship on; '0' is the bulk chain, byte-identical): a California spot's nearshore sea from CDIP MOP's
published ray K applied to one member's partitions at ONE open-ocean read point per region.

With the flag on, a served point that stands on a California catalogue spot (within SPOT_MATCH_KM of an entry of the
committed table `data/spectral_k_ca.json` + `.npz`, built OFFLINE by `scripts/build_spectral_k_tables.py`) takes:
  1. the member's partitions (swell_1, swell_2, wind_waves) and total (`waves`) at its REGION's read point, through
     the caller's raw resolver (no surf augmentation, so no recursion), the represent gate and `reconcile_partitions`;
  2. `spectral_k.nearshore_sea`: rebuild E(f, theta), apply K (swl_et below 0.09 Hz, sea_et above), Hs and Tp at the
     MOP point's depth;
  3. that sea goes to `surf_point.estimate_surf_at(nearshore=...)`, i.e. the EXISTING breaking step
     (`mop_nearshore.estimate_surf_from_nearshore`). ONE FORECAST COMPOSITION: no second breaking formula.
Every other point, and every failure here, keeps the bulk chain unchanged. This module never raises.

THE READ POINTS (frozen 2026-11-03 from GEOGRAPHY, before any scoring; ETOPO 0.25 deg depth in brackets): each sits in
deep open water seaward of every island, bank and headland that shadows its region, so the K rays (which carry those
shadows) start from an unsheltered sea.
  socal    lat < 34.45 (south of Point Conception)   32.00 N, 119.80 W  [2532 m]  SW of Cortes Bank, outside the Bight
  central  34.45 <= lat < 37.0                       35.50 N, 122.25 W  [3632 m]  off Big Sur
  bay      37.0 <= lat < 38.5                        37.25 N, 123.50 W  [2825 m]  SW of the Farallones
  north    lat >= 38.5                               40.00 N, 125.00 W  [1428 m]  W of Cape Mendocino
No propagation lag (the research measured lags at +-0.002 m).

COST: the K arithmetic is ~0.2 ms per spot-hour (numpy, measured in the log); the read point is resolved once per
(resolver, member, region, valid time) and memoised on the resolver object, so a precompute pass pays 4 extra raw
point resolutions per region-hour per member, not per spot.
"""
import json
import logging
import math
import os
import time

logger = logging.getLogger(__name__)

FLAG = "SURF_SPECTRAL_K"
_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
TABLE_JSON = os.path.join(_DATA, "spectral_k_ca.json")
TABLE_NPZ = os.path.join(_DATA, "spectral_k_ca.npz")
SPOT_MATCH_KM = 0.3
READ_POINTS = (            # (region, lat_min, lat_max, read_lat, read_lng)
    ("socal", -90.0, 34.45, 32.00, -119.80),
    ("central", 34.45, 37.0, 35.50, -122.25),
    ("bay", 37.0, 38.5, 37.25, -123.50),
    ("north", 38.5, 90.0, 40.00, -125.00),
)
PARTITION_LAYERS = (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))
MEMO_TTL_S = 900.0
MEMO_MAX = 2048

_table = None             # {"entries": [...], "transfers": {key: Transfer}} loaded once


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def load_table(json_path=TABLE_JSON, npz_path=TABLE_NPZ):
    """The committed table as {entries, transfers}; an empty table when the files are absent or malformed."""
    global _table
    if _table is not None and json_path == TABLE_JSON and npz_path == TABLE_NPZ:
        return _table
    out = {"entries": [], "transfers": {}}
    try:
        import numpy as np
        from services.weather_pipeline.spectral_k import Transfer
        with open(json_path, encoding="utf-8") as f:
            idx = json.load(f)
        with np.load(npz_path, allow_pickle=False) as z:
            swl, sea = z["swl_et"].astype(float), z["sea_et"].astype(float)
            sf, qf = z["swell_freq"].astype(float), z["sea_freq"].astype(float)
        for e in idx.get("entries", []):
            r = int(e["row"])
            out["transfers"][e["key"]] = Transfer(swl[r], sea[r], sf, qf, e["depth_m"], e.get("shore_normal"),
                                                  e.get("label"))
            out["entries"].append(e)
    except (OSError, ValueError, KeyError, TypeError, IndexError) as e:
        logger.info(f"[spectral K] table unavailable, bulk chain kept: {type(e).__name__}")
        out = {"entries": [], "transfers": {}}
    if json_path == TABLE_JSON and npz_path == TABLE_NPZ:
        _table = out
    return out


def entry_for_point(lat, lng, table=None):
    """The table's SPOT entry this point stands on (within SPOT_MATCH_KM), or None."""
    t = table or load_table()
    best = None
    for e in t["entries"]:
        if e.get("kind") != "spot" or abs(e["lat"] - lat) > 0.01 or abs(e["lng"] - lng) > 0.012:
            continue
        d = _km(float(lat), float(lng), e["lat"], e["lng"])
        if d <= SPOT_MATCH_KM and (best is None or d < best[0]):
            best = (d, e)
    return best[1] if best else None


def region_for(lat):
    for name, lo, hi, rlat, rlng in READ_POINTS:
        if lo <= float(lat) < hi:
            return name, rlat, rlng
    return None


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


async def read_point_partitions(resolve_raw, model, region, valid_time_str):
    """The member's reconciled trains at the region's read point ({h, tp, dir, kind} list), or None. Memoised on the
    resolver object (so a replay resolver built per spot-hour never shares an entry with another cycle)."""
    rp = next((r for r in READ_POINTS if r[0] == region), None)
    if rp is None or resolve_raw is None:
        return None
    owner = getattr(resolve_raw, "__self__", None)
    memo = None
    if owner is not None:
        memo = owner.__dict__.setdefault("_spectral_k_memo", {})
        hit = memo.get((model, region, valid_time_str))
        if hit is not None and time.time() - hit[0] < MEMO_TTL_S:
            return hit[1]
    _, _, _, lat, lng = rp
    parts = None
    try:
        tot = await resolve_raw(model, "waves", lat, lng, valid_time_str)
        tp_ = getattr(tot, "point", None)
        total_h, total_tp = _num(getattr(tp_, "speed", None)), _num(getattr(tp_, "period", None))
        if total_h and total_h > 0:
            got = []
            for layer, kind in PARTITION_LAYERS:
                r = await resolve_raw(model, layer, lat, lng, valid_time_str)
                basis = getattr(r, "estimate_basis", None)
                if isinstance(basis, dict) and basis.get("method") == "wave_component_ratio_estimation":
                    continue           # a ratio-derived train is the total re-weighted, not a partition
                p = getattr(r, "point", None)
                h, tp, dr = _num(getattr(p, "speed", None)), _num(getattr(p, "period", None)), _num(getattr(p, "direction", None))
                if h and tp and h > 0 and tp > 0 and dr is not None:
                    got.append({"h": h, "tp": tp, "dir": dr, "kind": kind})
            from services.weather_pipeline.surf_partitions import partitions_represent, reconcile_partitions
            if got and partitions_represent(got, total_h, total_tp):
                parts = reconcile_partitions(got, total_h)
    except Exception as e:                                             # noqa: BLE001 - never costs the point
        logger.debug(f"[spectral K] read point {region} unavailable for {model} {valid_time_str}: {e!r}")
        parts = None
    if memo is not None:
        if len(memo) >= MEMO_MAX:
            memo.clear()
        memo[(model, region, valid_time_str)] = (time.time(), parts)
    return parts


async def nearshore_for_point(model, lat, lng, valid_time_str, resolve_raw):
    """The arm's nearshore sea for this served point and hour ({hs, tp, dp, depth_m, label, region}), or None.
    Flag-gated; an uncovered point or an unusable read point reads nothing and the bulk chain runs."""
    if not enabled() or resolve_raw is None:
        return None
    t = load_table()
    e = entry_for_point(float(lat), float(lng), t)
    if e is None:
        return None
    reg = region_for(e["lat"])
    if reg is None:
        return None
    parts = await read_point_partitions(resolve_raw, model, reg[0], valid_time_str)
    if not parts:
        return None
    from services.weather_pipeline.spectral_k import nearshore_sea
    sea = nearshore_sea(parts, t["transfers"][e["key"]])
    if sea is None:
        return None
    sea.pop("spectrum", None)
    return {**sea, "label": e.get("label"), "region": reg[0]}


async def station_hs(model, station_id, station_depth_m, valid_time_str, resolve_raw):
    """EVALUATION ONLY (eval_replay's primary quantity under the arm): the arm's Hs at a CDIP buoy, from the K of the
    buoy's own shoreFlag-1 MOP point (table entry `station:<id>`, within 3 km), shoaled from the MOP depth to the buoy
    depth by energy-flux conservation per frequency (no refraction). None (the bulk instrument is used) when the buoy
    has no entry or the read point is unusable."""
    if not enabled() or resolve_raw is None:
        return None
    t = load_table()
    e = next((x for x in t["entries"] if x.get("key") == f"station:{station_id}"), None)
    if e is None or not station_depth_m:
        return None
    reg = region_for(e["mop_lat"])
    parts = await read_point_partitions(resolve_raw, model, reg[0], valid_time_str) if reg else None
    if not parts:
        return None
    from services.weather_pipeline.spectral_k import hs_of, nearshore_sea, shoal_to_depth
    sea = nearshore_sea(parts, t["transfers"][e["key"]])
    if sea is None:
        return None
    return hs_of(shoal_to_depth(sea["spectrum"], e["depth_m"], float(station_depth_m)))


def _reset_for_test():
    global _table
    _table = None
