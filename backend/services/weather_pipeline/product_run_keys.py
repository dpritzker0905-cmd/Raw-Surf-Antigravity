"""PRODUCT_RUN_KEYED_NAMES (dark, 2026-11-01): immutable run-keyed product object names.

WHY. A product object is named by its VALID time only (`gfs_marine_waves_florida_east_coast_20261102T030000Z.json`), so every
run rewrites the same key, and every cache keyed by the name believes the bytes never change: the serve box downloads a product
from storage only `if not filepath.exists()` (store_helpers.fetch_l2_to_disk), the L1 cache is keyed by the name, and objects are
uploaded with a 3600 s CDN max-age on the claim "immutable (valid_time in the name)" (store.manifest_cache_control). Measured
2026-11-01: the Render box (uptime 50 h) served the Cocoa Beach GFS pilot tile from the 10-30T18Z run while storage, the manifest
and the CDN frames all held 11-01T18Z (side-session notes FLORIDA-GFS-PILOT-STALE-2026-11-01.md).

THE RULE (the design our own frame store already follows: `v1/<model>/.../<run>/bundle-<sha>.bin` + `latest.json`). With the flag
on, a saved product's object name carries its run and a short hash of its bytes:

    <legacy name without .json>.r<run %Y%m%dT%H%M>-<sha256[:8]>.json
    gfs_marine_waves_florida_east_coast_20261102T030000Z.r20261101T1800-3fa9c2d1.json

A new run (or a same-run rewrite with different bytes: the lattice fill, the extended estimates) writes a NEW object, and the
manifest moves to it. Nothing reuses a key, so a disk copy, an L1 entry or a CDN edge copy can never hold another run's bytes
under the name a reader asks for. The LOGICAL name (the legacy name, recovered by `logical_name`) is the slice identity: the
manifest merge treats two entries with the same logical name as one slice (store.reconcile_manifest_products_for_upload), exactly
as it treated two entries with the same legacy filename before.

Deletion moves off the write path: with the flag on, a prune never deletes an object straight away (a box can hold the previous
manifest for a restore interval and still ask for it). product_object_gc deletes an object only after two sweeps at least the
grace apart found it unreferenced by the published manifest. The serve box drops run-keyed disk files its manifest no longer
names (sweep_local_disk), so its disk does not grow by a copy per run.

FORMAT CHOICES. The run token is `r` + 8 digits + `T` + 4 digits, deliberately NOT the `\\d{8}T\\d{6}Z` shape of the valid time,
so every reader that finds the valid time in a name with that regex (point_resolution's scrub swap) still finds the valid time
first and only. The hash is over the serialized product with `product_id` set to a same-length placeholder, so it is computed
from ONE dump; the placeholder is then replaced by the final name, keeping product_id == filename inside the bytes.

Flag off: every name, byte and manifest entry is identical to before (tests/test_product_run_keys.py pins it).
Kill: PRODUCT_RUN_KEYED_NAMES=0 on the writers (forecast-ingest, forecast-ingest-pilots, precompute repo variable). Rollback
plan, mixed manifests and the GC: docs/weather-program/log/2026-11-01-claude-run-keyed-products.md.
"""
import hashlib
import logging
import os
import re
import time
from datetime import timezone

logger = logging.getLogger(__name__)

FLAG = "PRODUCT_RUN_KEYED_NAMES"
_RUN_TOKEN = re.compile(r"\.r\d{8}T\d{4}-[0-9a-f]{8}(?=\.json$)")
_PLACEHOLDER_HASH = "0" * 8


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def is_run_keyed(filename) -> bool:
    return bool(filename) and _RUN_TOKEN.search(filename) is not None


def logical_name(filename):
    """The slice identity of an object name: the legacy valid-time name (unchanged for a legacy name)."""
    if not filename:
        return filename
    return _RUN_TOKEN.sub("", filename)


def _run_token(run_time) -> str:
    if run_time is None:
        return "r00000000T0000"
    if run_time.tzinfo is not None:
        run_time = run_time.astimezone(timezone.utc)
    return run_time.strftime("r%Y%m%dT%H%M")


def run_keyed_name(legacy: str, run_time, digest: str) -> str:
    stem = legacy[:-5] if legacy.endswith(".json") else legacy
    return f"{stem}.{_run_token(run_time)}-{digest[:8]}.json"


def name_and_bytes(product, legacy: str):
    """(filename, bytes) for a product about to be saved. Flag off: (legacy, the plain dump), byte-identical to before.

    Flag on: one dump with a same-length placeholder name as product_id, a hash of those bytes, then the placeholder replaced
    by the final name. Sets product.product_id to the returned filename in both cases."""
    if not enabled():
        product.product_id = legacy
        return legacy, product.model_dump_json().encode("utf-8")
    placeholder = run_keyed_name(legacy, product.run_time, _PLACEHOLDER_HASH)
    product.product_id = placeholder
    raw = product.model_dump_json().encode("utf-8")
    final = run_keyed_name(legacy, product.run_time, hashlib.sha256(raw).hexdigest())
    needle = f'"product_id":"{placeholder}"'.encode("utf-8")
    if raw.count(needle) != 1:      # never ship a body whose product_id disagrees with its name
        raise ValueError(f"run-keyed name: placeholder not unique in the dump of {legacy}")
    product.product_id = final
    return final, raw.replace(needle, f'"product_id":"{final}"'.encode("utf-8"), 1)


def logical_index(products_by_pid) -> dict:
    """logical name -> (pid, product) over a {pid: product} map (the manifest merge's `ours`)."""
    index = {}
    for pid, p in products_by_pid.items():
        index[logical_name(getattr(p, "filename", None) or pid)] = (pid, p)
    return index


def swap_valid_time(manifest, grid_product_id: str, filename_ts: str, target_ts: str):
    """The scrub swap for a run-keyed grid_product_id: the CURRENT object of the same slice at target_ts, from the manifest.

    The legacy swap edits the timestamp inside the name, which for a run-keyed name would keep the old run and hash and name an
    object that never exists. Returns the registered filename, or None when the manifest registers no such slice."""
    wanted = logical_name(grid_product_id).replace(filename_ts, target_ts)
    for p in getattr(manifest, "products", None) or ():
        fn = getattr(p, "filename", None)
        if fn and logical_name(fn) == wanted:
            return fn
    return None


def sweep_local_disk(cache_dir, referenced, now=None, grace_s=None) -> int:
    """The serve box's disk: delete run-keyed product files the manifest no longer names, once they are older than the grace.

    Only run-keyed names are touched (a legacy file is the old protocol's and stays where it is). The grace (default 3600 s,
    PRODUCT_RUN_KEYED_DISK_GRACE_S) leaves a reader holding the previous manifest time to finish. Never raises."""
    now = time.time() if now is None else now
    grace = float(os.environ.get("PRODUCT_RUN_KEYED_DISK_GRACE_S", "3600")) if grace_s is None else grace_s
    removed = 0
    try:
        for path in cache_dir.glob("*.json"):
            name = path.name
            if not is_run_keyed(name) or name in referenced:
                continue
            try:
                if now - path.stat().st_mtime < grace:
                    continue
                path.unlink()
                removed += 1
            except OSError:
                continue
    except Exception as exc:
        logger.warning("[Product Store] run-keyed disk sweep skipped: %s: %s", type(exc).__name__, exc)
        return removed
    if removed:
        logger.info("[Product Store] run-keyed disk sweep removed %d superseded product file(s)", removed)
    return removed
