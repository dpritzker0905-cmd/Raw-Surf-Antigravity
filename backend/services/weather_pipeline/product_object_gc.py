"""The storage-object GC for PRODUCT_RUN_KEYED_NAMES (dark, 2026-11-01): delete a product object only after the manifest moved.

With run-keyed names (product_run_keys.py) a new run writes new objects and the manifest moves to them; the old objects become
unreferenced, and with the flag on no prune deletes them in place (prune_object_protection.delete_pruned_object defers). A serve
box can hold the previous manifest for a restore interval (30 min) and still ask for an old object, so deletion is a MARK AND
SWEEP with a grace:

  * each sweep lists the bucket's top-level product objects and the PUBLISHED head manifest (unioned with this process's own
    manifest, so a registration whose publish has not landed yet is never collected);
  * an object neither names is MARKED with the time it was first seen unreferenced (state: L2 blob `product_gc/marks.json`);
  * an object is DELETED only when it was already marked by an earlier sweep at least PRODUCT_GC_GRACE_S ago (default 7200 s)
    and is still unreferenced now. An object that becomes referenced again loses its mark.

Concurrency: two lanes sweeping at once can overwrite each other's marks. That only DELAYS a delete (a lost mark restarts the
clock); a delete still needs this sweep's own fresh head to omit the object. The guards of scripts/sweep_orphaned_l2.py carry
over: no sweep from a head of fewer than PRODUCT_GC_MIN_MANIFEST (500) entries, none when more than 95% of the listed product
objects look unreferenced, at most PRODUCT_GC_MAX_DELETE (500) deletes a sweep. Only names in the product grammar are touched
(never manifest.json, manifests/, calibration/, spot_ratings/ or any other namespaced key).
"""
import json
import logging
import os
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MARKS_KEY = "product_gc/marks.json"
_PRODUCT_NAME = re.compile(r"^[a-z0-9]+_[a-z]+_[a-z0-9_]+_\d{8}T\d{6}Z(_estimated)?(\.r\d{8}T\d{4}-[0-9a-f]{8})?\.json$")


def is_product_object(name) -> bool:
    return bool(name) and "/" not in name and _PRODUCT_NAME.match(name) is not None


def plan_sweep(listed, referenced, marks, now, grace_s, min_manifest=500, max_delete=500, only=None):
    """PURE. (to_delete, new_marks, reason). `marks` maps name -> first-seen-unreferenced epoch seconds.

    reason is None for a normal sweep, or why nothing was planned (the guards). `only` (the #675 rollout, rollout_675_io.
    scoped_gc_sweep) limits marking and deleting to those names; the guards still read the whole listing."""
    products = [n for n in listed if is_product_object(n)]
    if len(referenced) < min_manifest:
        return [], dict(marks), f"head names only {len(referenced)} objects (< {min_manifest})"
    unreferenced = [n for n in products if n not in referenced]
    if products and len(unreferenced) > 0.95 * len(products):
        return [], dict(marks), f"{len(unreferenced)}/{len(products)} objects look unreferenced (> 95%)"
    if only is not None:
        unreferenced = [n for n in unreferenced if n in only]
    new_marks = {n: marks.get(n, now) for n in unreferenced}
    due = sorted((t, n) for n, t in new_marks.items() if n in marks and now - t >= grace_s)
    to_delete = [n for _, n in due[:max_delete]]
    for n in to_delete:
        new_marks.pop(n, None)
    return to_delete, new_marks, None


def _list_top_level(sb, bucket):
    names, offset, page = [], 0, 1000
    while True:
        batch = sb.storage.from_(bucket).list(options={"limit": page, "offset": offset})
        if not batch:
            break
        for obj in batch:
            name = obj.get("name") if isinstance(obj, dict) else getattr(obj, "name", None)
            if name:
                names.append(name)
        if len(batch) < page:
            break
        offset += page
    return names


def _read_marks(sb, bucket) -> dict:
    try:
        data = json.loads(sb.storage.from_(bucket).download(MARKS_KEY).decode("utf-8"))
        return {str(k): float(v) for k, v in (data.get("marks") or {}).items()}
    except Exception:
        return {}      # absent or unreadable: every candidate starts its grace now (the safe direction)


def run_object_gc(store, now=None) -> dict:
    """One sweep. Never raises; returns a summary dict for the ingest log."""
    from services.weather_pipeline import product_run_keys
    from services.weather_pipeline.store import WEATHER_BUCKET, _fetch_remote_manifest_products, _get_supabase_storage
    if not product_run_keys.enabled():
        return {"skipped": "flag off"}
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    try:
        sb = _get_supabase_storage()
        head = _fetch_remote_manifest_products()
        if sb is None or head is None:
            return {"skipped": "storage or head manifest unavailable"}
        referenced = {p.get("filename") for p in head if isinstance(p, dict)}
        referenced |= {p.filename for p in store.get_manifest().products}
        referenced.discard(None)
        listed = _list_top_level(sb, WEATHER_BUCKET)
        marks = _read_marks(sb, WEATHER_BUCKET)
        to_delete, new_marks, reason = plan_sweep(
            listed, referenced, marks, now,
            grace_s=float(os.environ.get("PRODUCT_GC_GRACE_S", "7200")),
            min_manifest=int(os.environ.get("PRODUCT_GC_MIN_MANIFEST", "500")),
            max_delete=int(os.environ.get("PRODUCT_GC_MAX_DELETE", "500")))
        if reason:
            logger.warning("[Product GC] sweep refused: %s", reason)
            return {"skipped": reason}
        for name in to_delete:
            store._delete_from_supabase(name)
        body = json.dumps({"written_at": now, "marks": new_marks}).encode("utf-8")
        store._upload_to_supabase(MARKS_KEY, body)
        summary = {"listed": len(listed), "referenced": len(referenced), "marked": len(new_marks), "deleted": len(to_delete)}
        logger.info("[Product GC] %s", summary)
        return summary
    except Exception as exc:
        logger.warning("[Product GC] sweep skipped: %s: %s", type(exc).__name__, exc)
        return {"skipped": f"{type(exc).__name__}"}
