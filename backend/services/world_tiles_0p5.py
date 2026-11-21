"""The 0.5-degree world wave tier (option B, dark): GFS-Wave's own reductions -> the normalizer's per-node mapping -> RSWF v1 tile
frames, all VECTORIZED, from the hour the GFS Marine pass has already decoded (2026-11-16; registration and gates:
docs/weather-program/log/2026-11-16-opus-world-0p5-tier.md).

WHY. A first visit outside a 0.25-degree pilot box shows the 2-degree world frame, then refines: the coarse-then-fine gap Move 3
measured. The pass already decodes the full 0.25-degree GFS-Wave grid every hour, so a 0.5-degree tier needs no new download.
But the pass's per-point Python series, the normalizer's per-vector loop and frame_binary.encode_frame's per-vector loop cannot
carry 238,651 nodes x 4 layers x 129 hours. This module does the SAME arithmetic on arrays:
  1. reduce_hour: the pass's reductions (services/_fetch_region_reduce, the functions the hour loop itself calls since #962) at
     resolution 0.5 (half = 1), rounded as the loop rounds its series (4 decimals; NaN = None).
  2. layer_planes: the normalizer's mapping for one marine layer (validity, rounding, the direction's own confidence series, the
     +180 column mirroring -180). WAVES_ANIM_DOMINANT_SWELL=1 (dominant-swell stamping, default off) is NOT reproduced: the tier
     refuses to build while it is on rather than draw a different direction than the 2-degree frame.
  3. tile_frame: frame_binary.encode_frame's bytes for one 30 x 30 degree tile, from the planes.
Gate (1a) is that a tile equals encode_frame(the real fetcher -> normalizer product) cropped to the tile, byte for byte
(tests/test_world_tiles_0p5.py on the loop-shadow stub; real GRIB offline).

PACKAGING. One object per layer-hour: the 72 tiles as independent RSWF gzip members concatenated (the regional bundle format the
client already reads); the run index lists each tile's byte range, bounds and sha12. 516 objects a run (4 layers x 129 hours).
"""
from __future__ import annotations

import gzip
import hashlib
import os
import struct

RES = 0.5
BBOX = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}     # marine_mid_res_ingestion._GLOBAL_REGION
TILE_DEG = 30.0
LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
LAYER_KEYS = {   # normalizer.LAYER_VARS for the marine domain: (speed, direction, period)
    "waves": ("wave_height", "wave_direction", "wave_period"),
    "swell_1": ("swell_wave_height", "swell_wave_direction", "swell_wave_period"),
    "swell_2": ("secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period"),
    "wind_waves": ("wind_wave_height", "wind_wave_direction", "wind_wave_period"),
}

try:
    import _fetch_region_reduce as _reduce  # script-by-path (the fetcher subprocess)
except ImportError:
    from services import _fetch_region_reduce as _reduce  # package


def _fb():
    try:
        import frame_binary as fb  # script-by-path (the fetcher subprocess: services is not importable)
    except ImportError:
        from services import frame_binary as fb  # package
    return fb


def _fetcher():
    try:
        import noaa_gfs_wave_fetcher as f  # script-by-path
    except ImportError:
        from services import noaa_gfs_wave_fetcher as f  # package
    return f


def axis(lo, hi, step):
    """The fetcher's own axis (_coarse_axis): inclusive of both ends, except a full 360-degree longitude axis (endpoint-exclusive)."""
    return _fetcher()._coarse_axis(lo, hi, step)


def world_axes(res=RES, bbox=BBOX):
    """(lat axis, lon axis as fetched (-180 .. 179.5), lon axis as the normalizer grids it (-180 .. 180, +180 mirrored))."""
    lats = axis(bbox["south"], bbox["north"], res)
    lons = axis(bbox["west"], bbox["east"], res)
    grid_lons = lons + [round(lons[0] + 360.0, 4)] if (lons[-1] - lons[0]) >= 360.0 - res * 1.5 else lons
    return lats, lons, grid_lons


def node_indices(lat1d, lon1d, lats, lons):
    """(rs, cs) of the native cell each (lat, lon) node reads, row-major over lats x lons: the fetcher's nearest-index rule."""
    import numpy as np
    lat1d, lon1d = np.asarray(lat1d, float), np.asarray(lon1d, float)
    is_360 = bool(lon1d.max() > 180.0)
    r = np.array([int(np.abs(lat1d - la).argmin()) for la in lats], dtype=np.intp)
    c = np.array([int(np.abs(lon1d - ((lo % 360.0) if is_360 else lo)).argmin()) for lo in lons], dtype=np.intp)
    return np.repeat(r, len(lons)), np.tile(c, len(lats))


def _round4(a):
    import numpy as np
    return np.round(np.asarray(a, dtype=float), 4)


def reduce_hour(arrs, rs, cs, res=RES):
    """{om: values} for the nodes (rs, cs): exactly the series values fetch_global_coarse appends for a region at `res`
    (NaN where it appends None), including the direction confidences it exports. Vectorized path only."""
    import numpy as np
    F = _fetcher()
    if not F._vector_blockmean():
        raise RuntimeError("the world tier needs FETCH_VECTOR_BLOCKMEAN on (the per-point loop cannot hold 238k nodes)")
    blockmean = os.environ.get("NOAA_COARSE_DIR_BLOCKMEAN", "1") != "0"
    scalar_blockmean = blockmean and os.environ.get("NOAA_COARSE_SCALAR_BLOCKMEAN", "1") != "0"
    total_field = os.environ.get("NOAA_COARSE_DIR_TOTAL_FIELD", "1") != "0"
    export_confidence = blockmean and os.environ.get("NOAA_COARSE_DIR_CONFIDENCE", "1") != "0"
    export_part_conf = blockmean and os.environ.get("NOAA_PARTITION_DIR_CONFIDENCE", "1") != "0"
    half = max(1, int(round(res / 0.25 / 2.0)))
    nat = F._native_enabled() and F.is_native(res)
    hs_native = arrs["wave_height"]
    pairs = [(arrs[d], arrs[h]) for d, h in F.TOTAL_SEA_PARTITIONS]
    total_h = arrs.get("wave_height") if total_field else None
    out = {}
    for om in F.OM_ORDER:
        arr = arrs[om]
        if blockmean and om == "wave_direction":
            bd, bc, bp = _reduce.total_direction(arr, pairs, total_h, hs_native, rs, cs, half, nat)
            out[om] = _round4(bd)
            if export_confidence:
                out[F.DIR_CONFIDENCE_OM] = np.where(np.asarray(bp, bool), _round4(bc), np.nan)
            continue
        h_arr = arrs.get(F.DIR_TO_HEIGHT[om]) if (blockmean and om in F.DIR_TO_HEIGHT) else None
        is_height = scalar_blockmean and om in F.HEIGHT_VARS
        p_h_arr = arrs.get(F.PERIOD_TO_HEIGHT[om]) if (scalar_blockmean and om in F.PERIOD_TO_HEIGHT) else None
        part_key = F.PARTITION_DIR_CONFIDENCE_OM.get(om) if export_part_conf else None
        got = _reduce.variable(arr, h_arr, is_height, p_h_arr, part_key, hs_native, rs, cs, half, nat)
        if got is None:
            out[om] = _round4(arr[rs, cs])
            continue
        vals, pconfs = got
        out[om] = _round4(vals)
        if pconfs is not None and part_key:
            out[part_key] = _round4(pconfs)
    return out


def layer_planes(series, layer, rows, cols_fetched, mirror=True):
    """The normalizer's vectors for one marine layer as planes over the GRID (rows x cols_fetched + 1, the +180 column mirroring
    -180): speed (m), direction, period, dir_confidence (NaN = None), valid."""
    import numpy as np
    if os.environ.get("WAVES_ANIM_DOMINANT_SWELL", "0") == "1" and layer == "waves":
        raise RuntimeError("WAVES_ANIM_DOMINANT_SWELL=1 is not reproduced by the world tier; refusing to build waves")
    sk, dk, pk = LAYER_KEYS[layer]
    speed = np.asarray(series[sk], float).reshape(rows, cols_fetched)
    direc = np.asarray(series[dk], float).reshape(rows, cols_fetched)
    period = np.asarray(series[pk], float).reshape(rows, cols_fetched)
    conf_src = series.get(f"{dk}_confidence")
    conf = (np.asarray(conf_src, float).reshape(rows, cols_fetched) if conf_src is not None
            else np.full((rows, cols_fetched), np.nan))
    valid = np.isfinite(speed) & np.isfinite(direc)
    p = {"speed": np.where(valid, np.round(speed, 4), 0.0),
         "direction": np.where(valid, np.round(direc, 2), 0.0),
         "period": np.where(valid & np.isfinite(period), np.round(period, 2), 0.0),
         "dir_confidence": np.where(valid, np.round(conf, 4), np.nan),
         "valid": valid}
    if not mirror:
        return p
    return {k: np.concatenate([v, v[:, :1]], 1) for k, v in p.items()}      # the +180 column mirrors -180 (normalizer)


def _codes(planes, fid):
    import numpy as np
    fb = _fb()
    _nb, _layout, missing, scale, _off = fb.FIELD_SPECS[fid]
    valid = planes["valid"]
    if fid == fb.HEIGHT:
        h = planes["speed"]
        ok = valid & np.isfinite(h) & (h >= 0)
        return np.where(ok, np.minimum(0xFFFF, np.rint(h / scale).astype(np.int64) + 1), 0)
    if fid == fb.DIRECTION:
        return np.rint((planes["direction"] % 360.0) / scale).astype(np.int64) % 36000
    if fid == fb.PERIOD:
        return np.clip(np.rint(planes["period"] / scale).astype(np.int64), 0, 0xFFFE)
    if fid == fb.DIR_CONFIDENCE:
        c = planes["dir_confidence"]
        return np.where(np.isfinite(c), np.clip(np.rint(np.nan_to_num(c) / scale).astype(np.int64), 0, 254), missing)
    raise ValueError(f"field {fid} is not a world-tier field")


def tile_frame(planes, r0, r1, c0, c1, lats, grid_lons, valid_epoch, run_epoch):
    """frame_binary.encode_frame's bytes for the node block rows r0..r1-1, cols c0..c1-1 of the planes (row 0 = south)."""
    import numpy as np
    fb = _fb()
    sub = {k: v[r0:r1, c0:c1] for k, v in planes.items()}
    rows, cols = r1 - r0, c1 - c0
    fields = tuple(sorted(set(fb.DEFAULT_FIELDS)))
    mask = 0
    for fid in fields:
        mask |= 1 << fid
    header_bytes = fb.HEADER_FIXED + fb.DESCRIPTOR.size * len(fields)
    bounds = (grid_lons[c0], lats[r0], grid_lons[c1 - 1], lats[r1 - 1])          # cell_bounds: the outer node centres
    head = bytearray(fb.MAGIC)
    # uv convention 0: the normalizer writes u = -h sin d, v = -h cos d on every valid node (uv_convention's first-node rule)
    head += struct.pack("<HHHHIBBBBI", fb.ENCODING_VERSION, fb.TRANSFORM_VERSION, cols, rows, mask, 0, 0, len(fields), 0,
                        header_bytes)
    head += struct.pack("<4d", *bounds)
    head += struct.pack("<2d", valid_epoch, run_epoch)
    planes_out = []
    for fid in fields:
        nb, layout, missing, scale, offset = fb.FIELD_SPECS[fid]
        head += fb.DESCRIPTOR.pack(fid, nb, layout, 0, missing, scale, offset)
        codes = _codes(sub, fid).ravel()
        if nb == 1:
            planes_out.append(codes.astype(np.uint8).tobytes())
        else:
            arr = codes.astype("<u4" if nb == 4 else "<u2")
            raw = arr.tobytes()
            planes_out.append(b"".join(raw[k::nb] for k in range(nb)) if layout == 1 else raw)
    return bytes(head) + b"".join(planes_out)


def tile_blocks(lats, grid_lons, tile_deg=TILE_DEG):
    """[(tile_id, r0, r1, c0, c1)]: 30-degree blocks from the south-west corner, each sharing its last row / column with the
    next tile (so a tile's edge interpolates without its neighbour)."""
    step_r = int(round(tile_deg / (lats[1] - lats[0])))
    step_c = int(round(tile_deg / (grid_lons[1] - grid_lons[0])))
    out = []
    for r0 in range(0, len(lats) - 1, step_r):
        for c0 in range(0, len(grid_lons) - 1, step_c):
            r1, c1 = min(len(lats), r0 + step_r + 1), min(len(grid_lons), c0 + step_c + 1)
            out.append((f"r{r0:03d}c{c0:03d}", r0, r1, c0, c1))
    return out


def sha12(data):
    return hashlib.sha256(data).hexdigest()[:12]


def layer_hour_bundle(planes, lats, grid_lons, valid_epoch, run_epoch):
    """(bundle bytes, [tile records]) for one layer-hour: each tile an independent gzip member, records in member order."""
    fb = _fb()
    blob, recs = bytearray(), []
    for tid, r0, r1, c0, c1 in tile_blocks(lats, grid_lons):
        gz = fb.gzip_frame(tile_frame(planes, r0, r1, c0, c1, lats, grid_lons, valid_epoch, run_epoch))
        recs.append({"tile": tid, "offset": len(blob), "length": len(gz), "sha12": sha12(gz),
                     "bounds": [grid_lons[c0], lats[r0], grid_lons[c1 - 1], lats[r1 - 1]], "cols": c1 - c0, "rows": r1 - r0})
        blob += gz
    return bytes(blob), recs


def gunzip_member(blob, rec):
    return gzip.decompress(blob[rec["offset"]:rec["offset"] + rec["length"]])


def write_hour(out_dir, arrs, lat1d, lon1d, cycle, valid, state):
    """Called by the GFS-Wave pass once per decoded hour (payload `world_tiles_dir`): write the 4 layer-hour bundles under
    out_dir/<layer>/<valid stamp>.bin and append each one's tile records to out_dir/<layer>/index.jsonl. `state` (a dict the
    pass keeps) caches the node indices across hours. The pass catches any exception and stops calling (never fatal)."""
    import json
    from pathlib import Path
    if "idx" not in state:
        lats, lons, grid_lons = world_axes()
        state.update(idx=node_indices(lat1d, lon1d, lats, lons), lats=lats, lons=lons, grid_lons=grid_lons)
    lats, lons, grid_lons = state["lats"], state["lons"], state["grid_lons"]
    series = reduce_hour(arrs, *state["idx"])
    stamp = valid.strftime("%Y%m%dT%H%M%SZ")
    for layer in LAYERS:
        planes = layer_planes(series, layer, len(lats), len(lons))
        blob, recs = layer_hour_bundle(planes, lats, grid_lons, valid.timestamp(), cycle.timestamp())
        d = Path(out_dir) / layer
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{stamp}.bin").write_bytes(blob)
        with open(d / "index.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"valid_time": valid.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "run": cycle.strftime("%Y-%m-%dT%H:%M:%SZ"), "file": f"{stamp}.bin",
                                 "bytes": len(blob), "sha12": sha12(blob), "tiles": recs}) + "\n")
