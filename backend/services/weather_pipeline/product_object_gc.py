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
objects look unreferenced, at most PRODUCT_GC_MAX_DELETE deletes a sweep. Only names in the product grammar are touched
(never manifest.json, manifests/, calibration/, spot_ratings/ or any other namespaced key).

THE CAP AND ITS FUSES (2026-11-17, before PRODUCT_RUN_KEYED_NAMES ships on, #1005): each 4-hour cycle overwrites ~18,000 product
objects; run-keyed, each changed one is a new object, so the old 500-a-sweep cap could not keep up (~750 deletes per 4 h, the
bucket would grow 12-50 GB a day). The cap is now 25,000 (just above the ~21,800 live objects). A cap that high is no longer a
fuse by itself (a manifest read empty or truncated would make everything look unreferenced), so two fuses refuse the WHOLE
sweep, and say why in the log line:
  * FUSE A, the head shrank: this sweep's referenced set is under PRODUCT_GC_MIN_REFERENCED_RATIO (0.8) of the previous sweep's
    (kept in the marks blob). A truncated or partial manifest stops here. The refusal is PERMANENT (it fails closed: the stored
    count is not updated, so every later sweep refuses too) until a person decides the shrink is real and RELEASES it: the
    owner (David) sets the repository variable PRODUCT_GC_MIN_REFERENCED_RATIO = '0' for ONE ingest run, which records the new
    count, then unsets it.
  * FUSE B, too much at once: everything DUE (marked by an earlier sweep past the grace and still unreferenced), counted BEFORE
    the cap, exceeds PRODUCT_GC_MAX_DELETE_SHARE (0.6) of the listed product objects. In steady state about a third is due. A
    writer that publishes names its objects do not have makes most of the bucket due at once; that stops here, not at the cap.
    It also trips after a BACKLOG: about three missed sweeps in a row (the head unavailable for ~12 h) push what is due past 60 %,
    and it then refuses every sweep while the bucket grows. RELEASE: once a person has checked that the head is complete (its
    referenced count near the live set), the owner (David) raises the repository variable PRODUCT_GC_MAX_DELETE_SHARE (e.g. '0.9')
    until the object count is back, then unsets it. Both GC lanes pass the variable (default '0.6').
  * The per-object fallback (a failed bulk batch) is capped at PRODUCT_GC_MAX_SINGLE_DELETE (500) a sweep; what is left keeps
    its mark for the next sweep, so a broken bulk call cannot turn into 25,000 sequential DELETEs inside the ingest job.
  * A refusal, or a capped fallback, is printed as a GitHub ::warning:: annotation and a line in the step summary, besides the
    log line, so a standing refusal (the bucket then grows) is seen on the run page.
A stale (old but complete) published head cannot delete current objects: the sweep unions it with the writer's own manifest.
Deletes go in batches through the Storage bulk-delete REST call (the designated-writer gate applies), falling back to one
DELETE per object if a batch fails.
"""
import json
import logging
import os
import re
from datetime import datetime, timezone
from core.supabase_auth import supabase_headers

logger = logging.getLogger(__name__)

MARKS_KEY = "product_gc/marks.json"
_PRODUCT_NAME = re.compile(r"^[a-z0-9]+_[a-z]+_[a-z0-9_]+_\d{8}T\d{6}Z(_estimated)?(\.r\d{8}T\d{4}-[0-9a-f]{8})?\.json$")


def is_product_object(name) -> bool:
    return bool(name) and "/" not in name and _PRODUCT_NAME.match(name) is not None


def plan_sweep(listed, referenced, marks, now, grace_s, min_manifest=500, max_delete=500, only=None,
               prev_referenced=None, min_referenced_ratio=0.8, max_delete_share=0.6):
    """PURE. (to_delete, new_marks, reason). `marks` maps name -> first-seen-unreferenced epoch seconds.

    `prev_referenced` (the previous sweep's referenced count, or None) arms FUSE A; FUSE B caps the share of the listed
    product objects one sweep may delete. Either fuse refuses the whole sweep (marks unchanged).

    reason is None for a normal sweep, or why nothing was planned (the guards). `only` (the #675 rollout, rollout_675_io.
    scoped_gc_sweep) limits marking and deleting to those names; the guards still read the whole listing."""
    products = [n for n in listed if is_product_object(n)]
    if len(referenced) < min_manifest:
        return [], dict(marks), f"head names only {len(referenced)} objects (< {min_manifest})"
    if prev_referenced and len(referenced) < min_referenced_ratio * prev_referenced:
        return [], dict(marks), (f"FUSE A: head names {len(referenced)} objects, under {min_referenced_ratio:.0%} of the "
                                 f"previous sweep's {prev_referenced}")
    unreferenced = [n for n in products if n not in referenced]
    if products and len(unreferenced) > 0.95 * len(products):
        return [], dict(marks), f"{len(unreferenced)}/{len(products)} objects look unreferenced (> 95%)"
    if only is not None:
        unreferenced = [n for n in unreferenced if n in only]
    new_marks = {n: marks.get(n, now) for n in unreferenced}
    due = sorted((t, n) for n, t in new_marks.items() if n in marks and now - t >= grace_s)
    to_delete = [n for _, n in due[:max_delete]]
    if products and len(due) > max_delete_share * len(products):
        return [], dict(marks), (f"FUSE B: {len(due)} objects due of {len(products)} listed product objects "
                                 f"(> {max_delete_share:.0%})")
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
    return _read_state(sb, bucket)[0]


def _read_state(sb, bucket):
    """(marks, previous sweep's referenced count or None)."""
    try:
        data = json.loads(sb.storage.from_(bucket).download(MARKS_KEY).decode("utf-8"))
        prev = data.get("referenced")
        return {str(k): float(v) for k, v in (data.get("marks") or {}).items()}, (int(prev) if prev else None)
    except Exception:
        return {}, None      # absent or unreadable: every candidate starts its grace now; FUSE A unarmed this sweep


def _bulk_delete_rest(names, bucket) -> bool:
    """One Storage bulk delete (DELETE /storage/v1/object/{bucket}, body {"prefixes": [...]}). True on success."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return False
    try:
        import requests
        resp = requests.delete(f"{base}/storage/v1/object/{bucket}", json={"prefixes": list(names)}, timeout=60,
                               headers=supabase_headers(key))
        return resp.status_code in (200, 204)
    except Exception as exc:
        logger.warning("[Product GC] bulk delete failed: %s: %s", type(exc).__name__, exc)
        return False


def delete_names(store, names, bucket, batch=1000, bulk=_bulk_delete_rest, max_single=500):
    """Delete `names` in batches of `batch` (Supabase: at most 1,000 objects per remove). A batch that fails falls back to one
    store._delete_from_supabase per name, at most `max_single` in the whole sweep. Returns (bulk batches that succeeded,
    names NOT attempted, which keep their marks). Honours the designated-writer gate (no gate, no bulk call)."""
    from services.weather_pipeline.store import _l2_pipeline_writes_allowed
    ok, single, left = 0, 0, []
    for i in range(0, len(names), batch):
        chunk = names[i:i + batch]
        if _l2_pipeline_writes_allowed() and bulk(chunk, bucket):
            ok += 1
            continue
        for name in chunk:
            if single >= max_single:
                left.append(name)
                continue
            store._delete_from_supabase(name)
            single += 1
    return ok, left


def announce(title, text):
    """A refusal or a capped fallback, made visible on the run page: a ::warning:: annotation and a step-summary line."""
    print(f"::warning title={title}::{text}")
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        try:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(f"- **{title}:** {text}\n")
        except OSError:
            pass


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
        marks, prev_referenced = _read_state(sb, WEATHER_BUCKET)
        to_delete, new_marks, reason = plan_sweep(
            listed, referenced, marks, now,
            grace_s=float(os.environ.get("PRODUCT_GC_GRACE_S", "7200")),
            min_manifest=int(os.environ.get("PRODUCT_GC_MIN_MANIFEST", "500")),
            max_delete=int(os.environ.get("PRODUCT_GC_MAX_DELETE", "25000")),
            prev_referenced=prev_referenced,
            min_referenced_ratio=float(os.environ.get("PRODUCT_GC_MIN_REFERENCED_RATIO", "0.8")),
            max_delete_share=float(os.environ.get("PRODUCT_GC_MAX_DELETE_SHARE", "0.6")))
        if reason:
            logger.warning("[Product GC] sweep refused: %s", reason)
            if reason.startswith("FUSE"):
                announce("Product GC sweep refused", f"{reason}; nothing deleted, the bucket grows until released (product_object_gc.py)")
            return {"skipped": reason}
        batches, left = delete_names(store, to_delete, WEATHER_BUCKET,
                                     max_single=int(os.environ.get("PRODUCT_GC_MAX_SINGLE_DELETE", "500")))
        if left:
            new_marks.update({n: marks[n] for n in left if n in marks})       # not attempted: keep the mark for next sweep
            announce("Product GC bulk delete failed", f"{len(left)} of {len(to_delete)} due objects left for the next sweep "
                                                      f"(per-object fallback capped)")
        body = json.dumps({"written_at": now, "marks": new_marks, "referenced": len(referenced)}).encode("utf-8")
        store._upload_to_supabase(MARKS_KEY, body)
        summary = {"listed": len(listed), "referenced": len(referenced), "marked": len(new_marks),
                   "deleted": len(to_delete) - len(left), "left": len(left), "bulk_batches": batches}
        logger.info("[Product GC] %s", summary)
        return summary
    except Exception as exc:
        logger.warning("[Product GC] sweep skipped: %s: %s", type(exc).__name__, exc)
        return {"skipped": f"{type(exc).__name__}"}
