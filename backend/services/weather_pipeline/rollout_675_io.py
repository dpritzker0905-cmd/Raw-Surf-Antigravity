"""Storage I/O for the #675 rollout (rollout_675.py): one small adapter so the tests can drive every path offline.

The adapter's five verbs are all the rollout uses: download (None = the object is absent; any other failure raises),
upload, copy, delete, list, plus head_products (the published head's raw product list, None = unreadable).

COPY. supabase-py's documented call is `client.storage.from_(bucket).copy(from_path, to_path)` (Supabase Python reference,
checked through Context7 on 2026-11-02). The pinned supabase==2.4.6 storage3 has the sync UnboundLocalError on upload/remove
(store.py), so a copy that raises, or a client without `copy`, falls back to download-then-upload; the snapshot is then read
back and compared by sha256 either way (rollout_675.snapshot).
"""
import json
import logging
import os

logger = logging.getLogger(__name__)


class SupabaseIO:
    def __init__(self, store):
        self.store = store

    def _bucket(self):
        from services.weather_pipeline.store import WEATHER_BUCKET, _get_supabase_storage
        sb = _get_supabase_storage()
        if sb is None:
            raise RuntimeError("L2 storage unavailable")
        return sb.storage.from_(WEATHER_BUCKET)

    def download(self, key):
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not secret:
            raise RuntimeError("L2 storage is not configured")
        resp = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}",
                            headers={"Authorization": f"Bearer {secret}", "apikey": secret, "Cache-Control": "no-cache"},
                            timeout=60)
        if resp.status_code == 200:
            return resp.content
        if resp.status_code in (400, 404) and "not" in resp.text.lower() and "found" in resp.text.lower():
            return None
        raise RuntimeError(f"HTTP {resp.status_code} reading {key}")

    def upload(self, key, data):
        self.store._upload_to_supabase(key, data, strict=True)

    def copy(self, src, dst):
        bucket = self._bucket()
        if not hasattr(bucket, "copy"):
            raise NotImplementedError("storage client has no copy")
        bucket.copy(src, dst)

    def delete(self, key):
        self.store._delete_from_supabase(key)

    def list(self, prefix=""):
        bucket, names, offset = self._bucket(), [], 0
        while True:
            batch = bucket.list(prefix, {"limit": 1000, "offset": offset}) if prefix else \
                bucket.list(options={"limit": 1000, "offset": offset})
            if not batch:
                break
            names.extend(o.get("name") if isinstance(o, dict) else getattr(o, "name", None) for o in batch)
            if len(batch) < 1000:
                break
            offset += 1000
        return [n for n in names if n]

    def head_products(self):
        from services.weather_pipeline.store import _fetch_remote_manifest_products
        return _fetch_remote_manifest_products()


def read_status(io) -> dict:
    """{} when absent; raises when unreadable (the caller fails closed)."""
    from services.weather_pipeline.rollout_675 import STATUS_KEY
    data = io.download(STATUS_KEY)
    if data is None:
        return {}
    doc = json.loads(data.decode("utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("status object is not a JSON object")
    return doc


def write_status(io, doc):
    from services.weather_pipeline.rollout_675 import STATUS_KEY
    io.upload(STATUS_KEY, json.dumps(doc, sort_keys=True, indent=1).encode("utf-8"))


def read_marks(io) -> dict:
    from services.weather_pipeline.rollout_675 import MARKS_KEY
    try:
        data = io.download(MARKS_KEY)
        return {str(k): float(v) for k, v in (json.loads(data.decode("utf-8")).get("marks") or {}).items()} if data else {}
    except Exception:
        return {}      # unreadable: every candidate starts its grace now (the safe direction)


def write_marks(io, marks, now):
    from services.weather_pipeline.rollout_675 import MARKS_KEY
    io.upload(MARKS_KEY, json.dumps({"written_at": now, "marks": marks}, sort_keys=True).encode("utf-8"))


def scoped_gc_sweep(io, candidates, referenced, now, grace_s=None, min_manifest=None, max_delete=None) -> dict:
    """product_object_gc's mark-and-sweep, limited to the #675 marks: a candidate is deleted only when an EARLIER sweep
    marked it at least grace_s ago and the merged published head still does not name it. Legacy (non-run-keyed) names are in
    the GC's product grammar (product_object_gc.is_product_object), so no name adapter is needed; this scoping is the only one."""
    from services.weather_pipeline.product_object_gc import plan_sweep
    grace_s = float(os.environ.get("PRODUCT_GC_GRACE_S", "7200")) if grace_s is None else grace_s
    min_manifest = int(os.environ.get("PRODUCT_GC_MIN_MANIFEST", "500")) if min_manifest is None else min_manifest
    max_delete = int(os.environ.get("PRODUCT_GC_MAX_DELETE", "500")) if max_delete is None else max_delete
    marks = read_marks(io)
    scope = set(marks) | set(candidates)
    listed = io.list("")
    to_delete, new_marks, reason = plan_sweep(listed, referenced, {k: v for k, v in marks.items()}, now, grace_s,
                                              min_manifest=min_manifest, max_delete=max_delete, only=scope)
    if reason:
        return {"skipped": reason, "marked": len(marks)}
    for name in to_delete:
        io.delete(name)
    write_marks(io, new_marks, now)
    return {"listed": len(listed), "scope": len(scope), "marked": len(new_marks), "deleted": len(to_delete), "names": to_delete[:5]}


def prune_snapshots(io, lane, keep):
    """Keep the newest `keep` cycle folders of snapshots/<lane>/ (cycle ids sort by time); delete older ones."""
    from services.weather_pipeline.rollout_675 import SNAPSHOT_ROOT
    cycles = sorted({n.split("/")[0] for n in io.list(f"{SNAPSHOT_ROOT}/{lane}")})
    dropped = cycles[:-keep] if keep and len(cycles) > keep else []
    for cycle in dropped:
        for name in io.list(f"{SNAPSHOT_ROOT}/{lane}/{cycle}"):
            io.delete(f"{SNAPSHOT_ROOT}/{lane}/{cycle}/{name}")
    return {"kept": cycles[-keep:] if keep else cycles, "dropped": dropped}


def flush_manifest_publish(timeout=300.0) -> bool:
    """Wait for every manifest publish queued so far (the executor has one worker, so a no-op behind them is enough)."""
    from services.weather_pipeline import store as module
    try:
        module._manifest_executor.submit(lambda: None).result(timeout=timeout)
        return True
    except Exception as exc:
        logger.warning("[Rollout 675] manifest publish flush failed: %s", type(exc).__name__)
        return False
