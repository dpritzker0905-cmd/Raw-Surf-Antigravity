"""The READER's half of the #675 reader proof: /capabilities fields on the EURO marine row (rollout_675.reader_gate reads them).

  reader_protocol  integer version of this proof's contract (1).
  commit           the deployed commit (Render's RENDER_GIT_COMMIT), so a read names what answered.
  revision_probe   {"revision": <run_time ISO>} of the canary object loaded through the REAL L2 loader
                   (ProductStore.load_product: memory cache, disk copy, download-if-missing and, with
                   PRODUCT_REVISION_REFRESH=1 (#684), the per-read registration refresh). The writer rewrites the canary under the
                   SAME key every owning-lane run, so a reader that keeps a stale disk copy (a8: download only if missing,
                   no refresh) keeps serving an older revision and the writer's gate stays closed.

The probe is memoised for PROBE_TTL_S so /capabilities stays cheap on the 1-CPU serve box. Adds fields; changes no horizon.
"""
import os
import threading
import time

READER_PROTOCOL = 1
PROBE_TTL_S = 60.0
_lock = threading.Lock()
_memo = {"at": None, "value": None}


def probe_canary(store=None) -> dict:
    from services.weather_pipeline.rollout_675 import CANARY_FILENAME, iso
    try:
        if store is None:
            from services.weather_pipeline.store import ProductStore
            store = ProductStore()
        product = store.load_product(CANARY_FILENAME)
        if product is None:
            return {"revision": None, "error": "canary not loaded"}
        out = {"revision": iso(product.run_time)}
        if getattr(product, "stale", False):
            out["stale"] = getattr(product, "staleReason", None) or True
        return out
    except Exception as exc:
        return {"revision": None, "error": type(exc).__name__}


def revision_probe(now=None) -> dict:
    now = time.monotonic() if now is None else now
    with _lock:
        if _memo["at"] is not None and now - _memo["at"] < PROBE_TTL_S:
            return dict(_memo["value"])
    value = probe_canary()
    with _lock:
        _memo["at"], _memo["value"] = now, value
    return dict(value)


def reader_fields() -> dict:
    commit = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or ""
    return {"reader_protocol": READER_PROTOCOL, "commit": commit[:12] or None, "revision_probe": revision_probe()}
