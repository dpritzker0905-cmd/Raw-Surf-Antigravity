"""Static frame SETS: which products become frames, the run index, and what retention keeps (step 2b, 2026-10-20).

One set = one model x domain x layer x region tier (slice 1: GFS / marine / waves / global_mid, the world-view field).
For each set the publisher writes, to the PUBLIC bucket `weather-frames`:

  v1/<model>/<domain>/<layer>/<region>/<run>/<valid>-<sha12>.bin   one gzipped frame (frame_binary.py)  immutable
  v1/<model>/<domain>/<layer>/<region>/index/<run>-<sha12>.json    the run index: every frame + its     immutable
                                                                   product identity and metadata
  v1/latest.json                                                   {sets: {key: {index, previous_index}}}  no-cache,
                                                                   written LAST
Every path that can be cached forever is content-addressed, so a reader can never see a frame change under its URL,
and a client pins one index for a scrub session. Retention keeps the current and the previous index of each set and
the frames they name; everything else under the set's prefix is deleted.

SOURCE RULE (egress): frames are built only from product files already on the ingest runner's disk (the products
the ingest step just wrote). Nothing here downloads a product. A frame whose source identity (filename, model run,
run time, ingested_at) matches the previous index is carried over without reading anything; a changed product that
is not on disk is listed with `path: null`, and the client falls back to /grid for that hour. The GFS world products
are written by the PILOTS lane (scheduler/forecast.py pilot_jobs), so the step runs in forecast-ingest-pilots.yml; a
lane whose disk holds less than FRAME_MIN_COVERAGE of a set publishes nothing for it.

SELECTION RULE (parity with /grid): the index lists every stored product of the set, flagged authoritative or
estimated. The client picks the frame /grid would serve (grid_resolver -> mid_res_tier.pick_mid_item): the nearest
valid time within 3 h, authoritative before estimated, the earlier one on a tie.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from services import frame_binary as fb

LATEST = "v1/latest.json"
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"
FRAME_TYPE = "application/octet-stream"
JSON_TYPE = "application/json"
INDEX_VERSION = 1
WINDOW_S = 3 * 3600
MIN_COVERAGE_DEFAULT = 0.9   # a set publishes a new index only when this share of its entries has a frame

SETS = (
    {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"},
)

# Product fields the client needs to rebuild the /grid response (backendWeatherServiceClient + mapNormalizedGridToWebGL).
PRODUCT_META = (
    "model", "provider", "domain", "layer", "run_time", "model_run_time", "model_run_time_status", "ingested_at",
    "valid_time", "is_forecast_authoritative", "is_estimated", "estimate_basis", "coverage", "value_kind",
    "value_unit", "display_unit_hint", "units", "source_variables", "freshness_sec", "warnings", "is_test_fixture",
    "source_dataset", "upstream_provider", "upstream_model", "coarse_fill", "region_id",
)
# The stored grid.diagnostics keys a client reads (gridMode: backendWeatherServiceClient; the rest are provenance).
DIAGNOSTICS_KEPT = ("gridMode", "animChannel", "mid_res_tier")


def set_key(target):
    return "/".join(target[k] for k in ("model", "domain", "layer", "region_id"))


def set_prefix(target):
    return "v1/" + "/".join(target[k].lower() for k in ("model", "domain", "layer", "region_id"))


def stamp(ts):
    """2026-10-20T00:00:00Z -> 20261020T000000Z (path-safe)."""
    return (ts or "unknown").replace("-", "").replace(":", "").split(".")[0].replace("+0000", "Z")


def iso(ts):
    """Any ISO timestamp -> the API's own form, YYYY-MM-DDTHH:MM:SSZ (None stays None)."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return str(ts)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def select_entries(products, target):
    """The set's manifest entries, one per (valid time, estimated?) — the first in manifest order, as the resolver's
    `min` keeps the first of equal time differences. Sorted by valid time."""
    seen, out = set(), []
    for p in products or []:
        if any(p.get(k) != v for k, v in target.items()) or not p.get("filename"):
            continue
        vt = iso(p.get("valid_time_start") or p.get("valid_time"))
        if not vt:
            continue
        k = (vt, bool(p.get("is_estimated")))
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return sorted(out, key=lambda p: (iso(p.get("valid_time_start") or p.get("valid_time")), bool(p.get("is_estimated"))))


def source_identity(entry):
    """What makes a stored product the same product: if these match, the frame is unchanged."""
    return {"filename": entry.get("filename"), "model_run_time": iso(entry.get("model_run_time")),
            "run_time": iso(entry.get("run_time")), "ingested_at": iso(entry.get("ingested_at"))}


def product_meta(product, filename):
    meta = {k: product.get(k) for k in PRODUCT_META}
    for k in ("run_time", "model_run_time", "ingested_at", "valid_time"):
        meta[k] = iso(meta[k])
    meta["product_id"] = filename          # /grid's mid tier serves product_id = the manifest filename
    diag = (product.get("grid") or {}).get("diagnostics") or {}
    meta["diagnostics"] = {k: diag[k] for k in DIAGNOSTICS_KEPT if k in diag}
    return meta


def factor_common(frames):
    """Move meta values equal across EVERY frame into one `common_meta` dict (the index stays ~10x smaller);
    the client rebuilds a frame's meta as {**common_meta, **frame.meta}."""
    if not frames:
        return {}
    keys = set(frames[0]["meta"])
    common = {}
    for k in sorted(keys):
        v = frames[0]["meta"][k]
        if all(k in f["meta"] and f["meta"][k] == v for f in frames[1:]):
            common[k] = v
    for f in frames:
        f["meta"] = {k: v for k, v in f["meta"].items() if k not in common}
    return common


def build_frame(product, entry):
    """(raw frame bytes, parity report) for one product; raises ValueError when it cannot be encoded."""
    raw = fb.encode_frame(product)
    return raw, fb.parity(product, fb.decode_frame(raw))


def _grid_record(product):
    g = product["grid"]
    return {"cols": g["cols"], "rows": g["rows"], "bounds": g["bounds"], "row0": "south", "col0": "west"}


def min_coverage():
    """The share of a set's entries that must have a frame before a new index is published (FRAME_MIN_COVERAGE)."""
    try:
        return max(0.0, min(1.0, float(os.environ.get("FRAME_MIN_COVERAGE", str(MIN_COVERAGE_DEFAULT)))))
    except ValueError:
        return MIN_COVERAGE_DEFAULT


def publish_set(source, sink, target, previous_index, uploader, log=print, coverage_floor=None):
    """Build, check and upload one set's frames; return (index or None, stats).

    `source.product_bytes(filename)` returns local bytes or None and never downloads. `uploader(jobs)` uploads
    [(path, bytes, content_type, cache_control)]. `previous_index` is the index latest.json pointed to, or None.
    EVERY selected manifest entry is listed in the index; an entry with no frame (not on this runner's disk, a stale
    disk copy, or refused by the parity gate) is listed with `path: null` and an `unbuilt` reason, so the client's pick
    lands on it and falls back to /grid instead of substituting a neighbouring frame up to 3 h away.
    Returns index None when nothing changed, nothing could be built, or fewer than `coverage_floor` (default
    FRAME_MIN_COVERAGE) of the entries have a frame: then NOTHING is uploaded and the published index stays.
    """
    prefix = set_prefix(target)
    floor = min_coverage() if coverage_floor is None else coverage_floor
    prev_common = (previous_index or {}).get("common_meta") or {}
    prev_grid = (previous_index or {}).get("grid")
    prev_frames = {}
    for f in (previous_index or {}).get("frames", []):
        if f.get("path"):
            f = dict(f, meta={**prev_common, **(f.get("meta") or {})}, grid=f.get("grid") or prev_grid)
        prev_frames[(f["valid_time"], bool(f.get("is_estimated")))] = f
    stats = {"entries": 0, "built": 0, "carried": 0, "unchanged": 0, "uploaded": 0, "not_local": 0, "stale_local": 0,
             "refused": 0, "bytes_uploaded": 0, "parity_bad": 0, "coverage": 0.0, "coverage_refused": False}
    frames, uploads, grid, max_err = [], [], (previous_index or {}).get("grid"), {}
    entries = select_entries(source.manifest().get("products"), target)
    stats["entries"] = len(entries)

    def unbuilt(vt, est, ident, reason):
        stats[reason] += 1
        frames.append({"valid_time": vt, "is_estimated": est, "path": None, "unbuilt": reason, "source": ident})

    for entry in entries:
        vt, est = iso(entry.get("valid_time_start") or entry.get("valid_time")), bool(entry.get("is_estimated"))
        ident = source_identity(entry)
        prev = prev_frames.get((vt, est))
        if prev and prev.get("path") and prev.get("source") == ident:
            frames.append(prev)
            stats["carried"] += 1
            continue
        raw_json = source.product_bytes(entry["filename"])
        if raw_json is None:
            unbuilt(vt, est, ident, "not_local")
            continue
        product = json.loads(raw_json)
        if iso(product.get("model_run_time")) != ident["model_run_time"] or iso(product.get("run_time")) != ident["run_time"]:
            unbuilt(vt, est, ident, "stale_local")   # the disk copy is not the run the manifest names: never mix runs
            continue
        try:
            raw, check = build_frame(product, entry)
        except ValueError as e:
            log(f"[frames] {entry['filename']}: refused ({e})")
            unbuilt(vt, est, ident, "refused")
            continue
        if check["bad"]:
            stats["parity_bad"] += check["bad"]
            log(f"[frames] {entry['filename']}: parity refused, nothing uploaded: {check}")
            unbuilt(vt, est, ident, "refused")
            continue
        for k, v in check["max_abs_err"].items():
            max_err[k] = max(max_err.get(k, 0.0), v)
        stats["built"] += 1
        g = _grid_record(product)
        if grid is not None and (grid["cols"], grid["rows"], grid["bounds"]) != (g["cols"], g["rows"], g["bounds"]):
            log(f"[frames] {entry['filename']}: grid {g['cols']}x{g['rows']} differs from the set's; carried in its frame")
        grid = grid or g
        sha = fb.sha256_hex(raw)
        meta = product_meta(product, entry["filename"])
        run_stamp = stamp(meta["model_run_time"] or meta["run_time"])
        if prev and prev.get("path") and prev.get("sha256") == sha:
            path, nbytes = prev["path"], prev["bytes"]
            stats["unchanged"] += 1
        else:
            gz = fb.gzip_frame(raw)
            path, nbytes = f"{prefix}/{run_stamp}/{stamp(vt)}-{sha[:12]}.bin", len(gz)
            uploads.append((path, gz, FRAME_TYPE, IMMUTABLE))
            stats["bytes_uploaded"] += nbytes
        frames.append({"valid_time": vt, "is_estimated": est, "path": path, "sha256": sha, "bytes": nbytes,
                       "raw_bytes": len(raw), "grid": g, "source": ident, "meta": meta})
    built = [f for f in frames if f.get("path")]
    stats["coverage"] = round(len(built) / len(entries), 4) if entries else 0.0
    if not built:
        return None, stats
    if stats["coverage"] < floor:
        stats["coverage_refused"] = True   # e.g. a lane whose disk holds only part of the set: keep the published index
        log(f"[frames] {set_key(target)}: only {len(built)}/{len(entries)} entries have a frame "
            f"(coverage {stats['coverage']} < {floor}); nothing uploaded, the published index stays")
        return None, stats
    if uploads:
        uploader(uploads)
        stats["uploaded"] = len(uploads)
    frames.sort(key=lambda f: (f["valid_time"], f["is_estimated"]))
    if previous_index and [(f["path"], f["source"]) for f in frames] == \
            [(f.get("path"), f.get("source")) for f in previous_index.get("frames", [])]:
        return None, stats                 # the published index already names exactly these frames
    # `run` is the verified MODEL CYCLE (model_run_time) only; `run_time` (the manifest registration time) is a label.
    runs = sorted({f["meta"]["model_run_time"] for f in built if f["meta"].get("model_run_time")})
    run_times = sorted(f["source"]["run_time"] for f in built if f["source"].get("run_time"))
    for f in built:                        # a frame keeps its own grid only where it differs from the set's
        if f.get("grid") == grid:
            f.pop("grid", None)
    common = factor_common(built)
    index = {
        "version": INDEX_VERSION, "encoding_version": fb.ENCODING_VERSION, "transform_version": fb.TRANSFORM_VERSION,
        "set": set_key(target), **target, "run": runs[-1] if runs else None, "runs": runs,
        "run_time": run_times[-1] if run_times else None, "grid": grid, "coverage": stats["coverage"],
        "selection": "nearest valid_time within 3 h over EVERY entry; authoritative before estimated; earlier on a tie "
                     "(grid_resolver -> mid_res_tier.pick_mid_item); an entry with path null -> /grid",
        "quantisation": {fb.FIELD_NAMES[k]: {"tolerance": fb.TOLERANCE[k]} for k in fb.DEFAULT_FIELDS},
        "parity_max_abs_err": {k: round(v, 6) for k, v in max_err.items()},
        "common_meta": common,
        "frames": frames,
    }
    body = json.dumps(index, sort_keys=True, separators=(",", ":")).encode("utf-8")
    index["path"] = f"{prefix}/index/{stamp(index['run'])}-{fb.sha256_hex(body)[:12]}.json"
    return index, stats


def index_bytes(index):
    return json.dumps(index, sort_keys=True, separators=(",", ":")).encode("utf-8")


def referenced_paths(index):
    if not index:
        return set()
    return {index["path"], *(f["path"] for f in index.get("frames", []) if f.get("path"))}


def retention_deletes(existing_paths, target, keep):
    """Objects under the set's prefix that neither the current nor the previous index names.

    Refuses (returns []) when `keep` is empty: a bug that lost both indexes must never empty the bucket."""
    if not keep:
        return []
    prefix = set_prefix(target) + "/"
    return sorted(p for p in existing_paths if p.startswith(prefix) and p not in keep)


def latest_record(index, previous_entry, written_at, writer):
    return {"index": index["path"], "run": index["run"], "run_time": index.get("run_time"), "coverage": index.get("coverage"),
            "frames": sum(1 for f in index["frames"] if f.get("path")), "entries": len(index["frames"]),
            "previous_index": (previous_entry or {}).get("index"), "written_at": written_at, "writer": writer}
