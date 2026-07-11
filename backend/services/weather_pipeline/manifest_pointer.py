"""S2 (2026-07-11): run-keyed manifest + Postgres pointer CAS.

Supabase Storage has no If-Match/ETag preconditions, so `manifest.json` is a hot mutable
object with last-writer-wins semantics (the audit #28 clobber family) and must be served
with max-age 0 + cache-busting (the f8c0c6b2 scar) — uncacheable on every edge, for every
user, on the hottest route.

This module flips that architecture without touching the legacy lane:

  writer (designated only):  upload immutable `manifests/manifest-g<generation>.json`
                             → CAS-advance the single pointer row in Postgres
                             (UPDATE ... WHERE generation = expected)
  reader:                    resolve pointer → GET the immutable run-keyed object
                             (plain GET, CDN-cacheable — no cache-busting needed)
                             → fall back to legacy `manifest.json` on ANY failure

The legacy `manifest.json` keeps being written and remains the fallback, so the lane is
transition-safe in both directions. If the pointer table does not exist yet (migration
pending), the first REST error disables the lane for the process and everything behaves
exactly as before.

Kill switch: MANIFEST_POINTER=0 disables both the publish and the read path.
"""

import os
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

POINTER_TABLE = "weather_manifest_pointer"
KEEP_RUN_KEYED = 5  # ring of retained run-keyed manifests (readers mid-GET stay safe)

_disabled_for_process = False
_disable_lock = threading.Lock()


def pointer_enabled() -> bool:
    if os.environ.get("MANIFEST_POINTER", "1") == "0":
        return False
    return not _disabled_for_process


def _disable_for_process(reason: str):
    global _disabled_for_process
    with _disable_lock:
        if not _disabled_for_process:
            _disabled_for_process = True
            logger.warning(f"[Manifest Pointer] Lane disabled for this process: {reason} "
                           f"(legacy manifest.json path continues unaffected)")


def _rest_base_and_headers() -> Tuple[Optional[str], Optional[dict]]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None, None
    return base, {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }


def run_keyed_manifest_key(generation: int) -> str:
    return f"manifests/manifest-g{generation:012d}.json"


def read_pointer() -> Optional[dict]:
    """Resolve the current pointer row. Never raises; None on any failure."""
    if not pointer_enabled():
        return None
    base, headers = _rest_base_and_headers()
    if not base:
        return None
    try:
        import requests
        resp = requests.get(
            f"{base}/rest/v1/{POINTER_TABLE}?id=eq.1&select=generation,manifest_key,run_id,written_by,updated_at",
            headers=headers, timeout=8,
        )
        if resp.status_code == 404 or (resp.status_code == 400 and "42P01" in resp.text):
            _disable_for_process(f"pointer table missing (HTTP {resp.status_code}) — migration not applied yet")
            return None
        if resp.status_code != 200:
            logger.warning(f"[Manifest Pointer] read HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        rows = resp.json()
        return rows[0] if rows else None
    except Exception as e:
        logger.warning(f"[Manifest Pointer] read failed: {e}")
        return None


def _insert_initial(manifest_key: str, run_id: Optional[str], written_by: str) -> bool:
    base, headers = _rest_base_and_headers()
    if not base:
        return False
    try:
        import requests
        resp = requests.post(
            f"{base}/rest/v1/{POINTER_TABLE}",
            headers={**headers, "Prefer": "return=minimal"},
            data=json.dumps({
                "id": 1, "generation": 1, "manifest_key": manifest_key,
                "run_id": run_id, "written_by": written_by,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }),
            timeout=8,
        )
        return resp.status_code in (200, 201)
    except Exception as e:
        logger.warning(f"[Manifest Pointer] initial insert failed: {e}")
        return False


def cas_advance(expected_generation: int, manifest_key: str, run_id: Optional[str], written_by: str) -> bool:
    """Compare-and-swap the pointer forward. True only if OUR row landed."""
    base, headers = _rest_base_and_headers()
    if not base:
        return False
    try:
        import requests
        resp = requests.patch(
            f"{base}/rest/v1/{POINTER_TABLE}?id=eq.1&generation=eq.{expected_generation}",
            headers={**headers, "Prefer": "return=representation"},
            data=json.dumps({
                "generation": expected_generation + 1,
                "manifest_key": manifest_key,
                "run_id": run_id,
                "written_by": written_by,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }),
            timeout=8,
        )
        if resp.status_code == 404 or (resp.status_code == 400 and "42P01" in resp.text):
            _disable_for_process(f"pointer table missing (HTTP {resp.status_code}) — migration not applied yet")
            return False
        if resp.status_code not in (200, 201):
            logger.warning(f"[Manifest Pointer] CAS HTTP {resp.status_code}: {resp.text[:200]}")
            return False
        rows = resp.json()
        return bool(rows)  # empty list = precondition lost (another writer advanced first)
    except Exception as e:
        logger.warning(f"[Manifest Pointer] CAS failed: {e}")
        return False


def publish_run_keyed(store, manifest_bytes: bytes, upload_fn, delete_fn) -> Optional[str]:
    """Publish an immutable run-keyed manifest copy and CAS-advance the pointer.

    Called ONLY from the successful legacy `manifest.json` upload path (which is behind the
    designated-writer gate, so non-designated boxes can never reach this). `upload_fn` /
    `delete_fn` are the store's L2 REST helpers — `manifests/...` is a namespaced key, so it
    passes the gate by construction and receives immutable cache headers (not the manifest.json
    max-age 0 special case).

    Returns the published key, or None (lane disabled / CAS lost / any failure).
    Never raises: the legacy lane must be unaffected by ANY failure here.
    """
    if not pointer_enabled():
        return None
    try:
        current = read_pointer()
        run_id = os.environ.get("GITHUB_RUN_ID")
        from services.weather_pipeline.store import _l2_writer_identity
        written_by = _l2_writer_identity()

        if current is None:
            if not pointer_enabled():  # read_pointer may have just disabled the lane (no table)
                return None
            key = run_keyed_manifest_key(1)
            upload_fn(key, manifest_bytes)
            if _insert_initial(key, run_id, written_by):
                logger.info(f"[Manifest Pointer] initialized → {key}")
                return key
            # Insert lost a race — re-read and fall through to CAS on the next publish.
            return None

        gen = int(current.get("generation", 0))
        key = run_keyed_manifest_key(gen + 1)
        upload_fn(key, manifest_bytes)  # immutable object FIRST, pointer flip = the commit point
        if not cas_advance(gen, key, run_id, written_by):
            # Lost the race (or table vanished). Another designated writer advanced — their
            # snapshot wins, ours lingers unreferenced until the retention sweep below runs
            # from the winner's later publishes. GH's serial concurrency group makes this rare.
            logger.warning(f"[Manifest Pointer] CAS lost at generation {gen} — {key} left unreferenced")
            return None

        # Retention ring: best-effort prune of the copy KEEP_RUN_KEYED generations back.
        old_gen = gen + 1 - KEEP_RUN_KEYED
        if old_gen > 0:
            try:
                delete_fn(run_keyed_manifest_key(old_gen))
            except Exception:
                pass
        logger.info(f"[Manifest Pointer] advanced g{gen}→g{gen + 1} → {key}")
        return key
    except Exception as e:
        logger.warning(f"[Manifest Pointer] publish failed (legacy lane unaffected): {e}")
        return None


def fetch_pointed_manifest() -> Optional[bytes]:
    """Reader: resolve the pointer and GET the immutable run-keyed manifest.

    Plain GET — run-keyed objects never mutate, so any CDN edge copy is correct by
    construction (the whole point of S2). None on any failure → caller falls back to the
    legacy cache-busted manifest.json path.
    """
    if not pointer_enabled():
        return None
    ptr = read_pointer()
    if not ptr or not ptr.get("manifest_key"):
        return None
    base, headers = _rest_base_and_headers()
    if not base:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        resp = requests.get(
            f"{base}/storage/v1/object/{WEATHER_BUCKET}/{ptr['manifest_key']}",
            headers=headers, timeout=30,
        )
        if resp.status_code != 200:
            logger.warning(f"[Manifest Pointer] pointed manifest GET {ptr['manifest_key']} → HTTP {resp.status_code}")
            return None
        logger.info(f"[Manifest Pointer] manifest served from {ptr['manifest_key']} (g{ptr.get('generation')}, by {ptr.get('written_by')})")
        return resp.content
    except Exception as e:
        logger.warning(f"[Manifest Pointer] pointed manifest fetch failed: {e}")
        return None
