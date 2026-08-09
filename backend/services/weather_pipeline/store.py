import os
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from services.weather_pipeline.schemas import (
    NormalizedProduct, PipelineManifest
)

logger = logging.getLogger(__name__)

from services.weather_pipeline.copernicus_validator import is_test_environment

# ── Supabase Storage L2 persistence ──────────────────────────────────────
WEATHER_BUCKET = "weather-products"


def manifest_cache_control(filename: str) -> str:
    """Upload cache-control (seconds → CDN max-age) by mutation class:
    - manifest.json: '0' — the hot-mutating registry, every edge revalidates (2026-07-06 scar).
    - 'manifests/...': '3600' — S2 run-keyed manifest copies are immutable-per-filename.
    - other namespaced keys ('spot_ratings/...', 'calibration/...'): '60' — MUTATING state blobs
      re-uploaded in place. These carried the product default 3600 until 2026-07-14, which meant
      the serve box could read a ratings object up to an HOUR stale off a CDN edge — silently
      undoing the checkpoint merge-uploads (a checkpoint lands, edges keep serving pre-checkpoint).
    - everything else (top-level product files): '3600' — immutable (valid_time in the name)."""
    if filename == "manifest.json":
        return "0"
    if filename.startswith("manifests/"):
        return "3600"
    if "/" in filename:
        return "60"
    return "3600"


def manifest_download_url(base: str, bucket: str) -> str:
    """Cache-busted manifest GET URL: a unique query param defeats any CDN edge copy uploaded
    under the OLD max-age=3600 policy (objects keep their upload-time headers until re-uploaded,
    so download-side busting is required for the transition — and is harmless forever after)."""
    import time as _time
    return f"{base}/storage/v1/object/{bucket}/manifest.json?cb={int(_time.time() * 1000)}"
_supabase_client = None
_bucket_created_checked = False
_bucket_lock = threading.Lock()

# Thread pools for background (fire-and-forget) L2 operations
_upload_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="supabase_upload")
_manifest_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="supabase_manifest_upload")

# DESIGNATED-WRITER gate (2026-07-11, audit #28 LIVE INCIDENT): manifest.json and the product files
# are a single shared mutable dataset with NO concurrency control — any box holding the Supabase key
# that runs ingestion/prunes uploads its own full in-memory snapshot, last-writer-wins. Live-caught:
# a LOCAL dev backend (server.py up 14h, in-process 4h ingestion) re-uploaded a manifest built from
# its boot-time baseline every cycle, silently reverting the GH runner's registrations (fresh ICON
# marine 12Z entries lost; 47 dangling entries resurrected whose L2 objects the runner had deleted;
# EURO marine estimated tail window regressed ~6h -> user-felt far-hour 404s + health false-critical).
# Only the DESIGNATED writer may mutate pipeline artifacts in L2: the decoupled GH ingest runner
# (scripts/ingest_forecast_ci.py and the L2 maintenance scripts set L2_WRITER=1). Serve-only Render
# and local dev stay read-only. If in-process Render ingestion is ever re-enabled
# (DISABLE_FORECAST_SCHEDULER unset on Render), set L2_WRITER=1 in the Render env.
# Scope: top-level keys only (manifest.json + immutable product files). Namespaced state blobs
# ("calibration/...", "spot_ratings/...") are serve-box-writable and stay ungated.
# Kill: L2_WRITER_GATE=0 restores the old any-box-writes behavior.
_l2_write_skips = 0


def _l2_pipeline_writes_allowed() -> bool:
    if os.environ.get("L2_WRITER_GATE", "1") == "0":
        return True
    return os.environ.get("L2_WRITER", "") == "1"


def _note_l2_write_skipped(action: str, filename: str):
    global _l2_write_skips
    _l2_write_skips += 1
    msg = (f"[Product Store] L2 pipeline {action} SKIPPED (this box is not the designated writer): "
           f"{filename} (total skipped: {_l2_write_skips}). Designated writers set L2_WRITER=1; "
           f"kill switch: L2_WRITER_GATE=0.")
    if _l2_write_skips <= 3 or _l2_write_skips % 500 == 0:
        logger.warning(msg)
    else:
        logger.debug(msg)


def _l2_writer_identity() -> str:
    """Writer attribution for the manifest stamp: the GH runner identifies by run id (clickable in
    the Actions UI), anything else by hostname; the role prefix is what the health monitor keys on."""
    import socket
    run_id = os.environ.get("GITHUB_RUN_ID")
    host = f"gh-run-{run_id}" if run_id else socket.gethostname()
    role = "designated" if _l2_pipeline_writes_allowed() else "non-writer"
    return f"{role}:{host}"


def dump_manifest_for_l2(manifest) -> bytes:
    """Single serialization choke-point for every manifest.json L2 upload (audit #28 attribution):
    stamps written_by so the served manifest always names its last L2 writer — the exact evidence
    the rogue-local-backend incident lacked (it took a live probe of :8000 to attribute the clobber).
    Local-only saves (_save_manifest) deliberately do NOT stamp, so a restored L2 copy keeps its
    upstream attribution on the serve box."""
    manifest.written_by = _l2_writer_identity()
    return manifest.model_dump_json(indent=2).encode("utf-8")


def _fetch_remote_manifest_products() -> Optional[list]:
    """Fetch the CURRENT remote manifest.json's raw product list, bypassing any local process
    cache — used by reconcile_manifest_products_for_upload to detect a concurrent writer's
    registrations before we clobber them. None on any failure (caller treats that as 'no
    concurrent writer visible, upload the local snapshot as-is' — the pre-fix behavior)."""
    manifest_bytes = None
    try:
        from services.weather_pipeline.manifest_pointer import fetch_pointed_manifest
        manifest_bytes = fetch_pointed_manifest()
    except Exception:
        manifest_bytes = None
    if manifest_bytes is None:
        sb = _get_supabase_storage()
        if sb is None:
            return None
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not key:
            return None
        try:
            import requests
            resp = requests.get(
                manifest_download_url(base, WEATHER_BUCKET),
                headers={"Authorization": f"Bearer {key}", "apikey": key,
                         "Cache-Control": "no-cache", "Pragma": "no-cache"},
                timeout=15,
            )
            if resp.status_code != 200:
                return None
            manifest_bytes = resp.content
        except Exception:
            return None
    try:
        data = json.loads(manifest_bytes.decode("utf-8"))
        return data.get("products") or []
    except Exception:
        return None


def reconcile_manifest_products_for_upload(manifest, exclude_keys=None) -> int:
    """MANIFEST CONCURRENCY (2026-07-14, next-phase queue #1): manifest.json has no If-Match/CAS
    precondition, so two ingest processes (core + pilots) racing the upload each re-serialize
    their OWN full in-memory snapshot — whichever lands last silently erases every registration
    the other made since its restore. That lost-update risk is the reason core+pilots have been
    forced into one serial GH concurrency group (forecast-ingest-pilots.yml history) — congestion
    in that shared group is the root of the pending-run eviction cascade.

    Call immediately before every manifest.json upload: re-fetch the FRESH remote product list
    and fold in any entry present there but absent from our own in-memory snapshot (i.e. a
    concurrent writer's registration since our restore). Our own snapshot always wins on key
    collisions (product_id) since it reflects the newest write for whatever slice we just
    touched. Mutates manifest.products in place; returns the count folded in from the remote
    side (0 = no concurrent writer detected, or reconciliation unavailable this call).

    NOTE this narrows the corruption window from "the other process's entire run duration" down
    to "the gap between this reconcile call and our upload landing" (one HTTP round trip on the
    process's serial _manifest_executor) — it is NOT full compare-and-swap, so a same-instant
    double-write can still race.

    PRUNE CALL SITES (2026-07-14 fast-follow) pass `exclude_keys` = the product ids they just
    deleted: those entries are still present in the fresh remote manifest (our prune hasn't
    uploaded yet), and folding them back in would RESURRECT manifest entries whose L2 objects we
    just destroyed — minting the dangling-entry 404 class (audit #28). With the exclusion, a
    remote-only entry is unambiguously a concurrent writer's registration.
    Residual accepted risks (documented, both self-healing within a cycle): (a) our fold-in of a
    concurrent writer's registration can race THEIR prune of that same key → one dangling entry
    until the next sweep; (b) for keys both sides hold, OUR copy wins even if theirs is newer →
    their metadata update reverts until their next registration.
    Never raises: any failure leaves the local snapshot as the sole upload basis (pre-fix
    behavior). Kill switch: MANIFEST_MERGE_ON_UPLOAD=0.
    """
    if os.environ.get("MANIFEST_MERGE_ON_UPLOAD", "1") == "0":
        return 0
    try:
        remote_products = _fetch_remote_manifest_products()
        if not remote_products:
            return 0
        from services.weather_pipeline.schemas import ManifestProduct
        from services.weather_pipeline.store_helpers import raw_run_time_newer as _raw_run_time_newer
        ours = {(p.product_id or p.filename): p for p in manifest.products if (p.product_id or p.filename)}
        excl = set(exclude_keys or ())
        prefer_newer = os.environ.get("MANIFEST_MERGE_PREFER_NEWER", "1") != "0"
        folded, refreshed = [], []
        for raw in remote_products:
            pid = raw.get("product_id") or raw.get("filename")
            if not pid or pid in excl:
                continue
            mine = ours.get(pid)
            if mine is not None and not (prefer_newer and _raw_run_time_newer(raw, mine.run_time)):
                continue  # key collision, ours is current (or the guard is off) — pre-fix behaviour
            try:
                item = ManifestProduct.model_validate(raw)
            except Exception:
                continue
            if mine is None:
                folded.append(item)
            else:
                ours[pid] = item
                refreshed.append((pid, mine.run_time, item.run_time))
        if refreshed:
            manifest.products = [ours.get(p.product_id or p.filename, p) for p in manifest.products]
            logger.warning(f"[Product Store] Manifest reconciliation KEPT THE NEWER REMOTE RUN for "
                           f"{len(refreshed)} entries a stale restored copy would have reverted: "
                           f"{[(k, w.isoformat(), n.isoformat()) for k, w, n in refreshed[:3]]}")
        if folded:
            manifest.products = manifest.products + folded
            logger.info(f"[Product Store] Manifest reconciliation folded in {len(folded)} "
                        f"concurrent-writer entries before upload.")
        return len(folded)
    except Exception as e:
        logger.warning(f"[Product Store] Manifest reconciliation skipped (upload proceeds with local snapshot): {e}")
        return 0


def _get_supabase_storage():
    global _supabase_client, _bucket_created_checked
    if _supabase_client is not None:
        return _supabase_client
    if os.environ.get("NODE_ENV") == "test" or os.environ.get("TESTING") == "1":
        return None
    try:
        from supabase import create_client as _create_supabase_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not url or not key:
            return None
        with _bucket_lock:
            if _supabase_client is not None:
                return _supabase_client
            client = _create_supabase_client(url, key)
            if not _bucket_created_checked:
                try:
                    client.storage.create_bucket(WEATHER_BUCKET, options={"public": False})
                except Exception as _e:
                    # R11-07: "exists" is routine (debug); a MISSING bucket used to latch done silently.
                    if "exist" in str(_e).lower() or "duplicate" in str(_e).lower():
                        logger.debug(f"[Store] bucket ensure: {WEATHER_BUCKET} already present")
                    else:
                        logger.warning(f"[Store] create_bucket({WEATHER_BUCKET}) failed; not retried this process: {type(_e).__name__}: {_e}")
                _bucket_created_checked = True
            _supabase_client = client
            return _supabase_client
    except Exception as e:
        logger.error(f"[Product Store] Supabase Storage init failed: {e}")
        return None


class ProductStore:
    """
    Manages atomic persistent storage of prepared weather products on disk
    at uploads/weather_products/ along with a master registry manifest.

    Two-tier storage:
      L1: Local disk (fast reads, ephemeral on Render)
      L2: Supabase Storage (durable, survives restarts/deploys)
    """
    # Shared class-level persistence diagnostics to survive instantiation across requests
    _last_restore_time: Optional[str] = None
    _restored_count: int = 0
    _restore_errors: List[str] = []
    _last_upload_time: Optional[str] = None
    _last_upload_errors: List[str] = []
    _pruned_anomalous_count: int = 0
    _pruned_anomalous_ids: List[str] = []
    _download_locks: Dict[str, threading.Lock] = {}
    _download_locks_lock = threading.Lock()
    _l2_negative_cache: Dict[str, float] = {}
    _l2_negative_cache_lock = threading.Lock()
    _L2_NEGATIVE_CACHE_TTL = 60.0
    _cached_manifest: Optional[PipelineManifest] = None
    _cached_manifest_mtime: float = 0.0
    _manifest_lock = threading.RLock()
    
    # In-memory product cache to speed up scrubbing and avoid duplicate Pydantic parses
    _product_cache: Dict[str, Tuple[NormalizedProduct, float]] = {}
    _product_cache_lock = threading.Lock()
    _PRODUCT_CACHE_TTL = 300.0  # 5 minutes
    # Hold enough products hot to cover a multi-hour scrub across several layers/models without thrashing
    # back to disk/L2. Was 8 — far too small for scrubbing (a single layer's scrub touches dozens of hourly
    # products), which made every scrub frame / layer switch a fresh disk read+parse (or cold L2 download).
    # Products are small (regional ~117 vec, global-coarse ~629 vec ≈ <1MB parsed), so 128 ≈ tens of MB.
    # Env-tunable for the serve box: PRODUCT_CACHE_LIMIT.
    _PRODUCT_CACHE_LIMIT = int(os.environ.get("PRODUCT_CACHE_LIMIT", "128"))
    # VECTOR-WEIGHTED budget (2026-07-05, Render OOM root): the 128-item count limit was sized for
    # <1MB parsed products, but a global_mid product is ~15,000 vectors (~12MB parsed) — 128 of
    # those ≈ 1.5-1.9GB, the EXACT resident plateau measured (Render metrics, 60s resolution) on
    # the 2Gi standard instance before every one of the 29 oomKilled events on 2026-07-05. Cap the
    # cache by TOTAL VECTORS so mid-era products can't balloon the count assumption: 120k vectors
    # ≈ the old-world budget (128 × ~900) ≈ 8 resident full mid products. Env-tunable:
    # PRODUCT_CACHE_VECTOR_BUDGET.
    _PRODUCT_CACHE_VECTOR_BUDGET = int(os.environ.get("PRODUCT_CACHE_VECTOR_BUDGET", "120000"))
    _product_cache_vectors: Dict[str, int] = {}  # filename -> vector count (budget bookkeeping)

    def __init__(self, cache_dir: Optional[Path] = None):
        if cache_dir:
            self.cache_dir = cache_dir
        else:
            self.cache_dir = Path(__file__).parent.parent.parent / "uploads" / "weather_products"
        
        self.manifest_path = self.cache_dir / "manifest.json"
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # ── Supabase Storage L2 helpers ──────────────────────────────────────

    def _upload_to_supabase(self, filename: str, data_bytes: bytes):
        """Upload a file to Supabase Storage L2 (fire-and-forget with logging).

        Uses the Storage REST API directly (via requests) instead of storage3's sync .upload(): in the
        pinned supabase==2.4.6, that method raises an UnboundLocalError ("cannot access local variable
        'response'") that masked the real result and broke ALL L2 persistence (every product + manifest).
        The REST POST is self-contained, surfaces real HTTP errors, and avoids upgrading the whole
        supabase stack (no auth/DB regression). x-upsert overwrites by key, matching the prior intent.
        """
        # Designated-writer gate (audit #28): top-level pipeline artifacts (manifest.json + product
        # files) may only be written by the ingest runner. Namespaced keys ("calibration/...",
        # "spot_ratings/...") are per-feature state blobs and pass through.
        if "/" not in filename and not _l2_pipeline_writes_allowed():
            _note_l2_write_skipped("upload", filename)
            return
        sb = _get_supabase_storage()  # gates on config + ensures the bucket exists (one-time create)
        if sb is None:
            return
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not key:
            return
        try:
            import requests
            url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{filename}"
            headers = {
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": "application/json",
                "x-upsert": "true",
                # CDN cache policy (2026-07-06, the stale-manifest root): manifest.json mutates
                # every few minutes but was uploaded with max-age 3600 — Supabase's CDN edges
                # served the serve-box periodic L2 restore copies up to an HOUR stale and
                # INCONSISTENTLY (live: restore counts oscillated 6218→6210→6338→6211; the
                # rebuilt EURO estimated tail appeared at the 05:37Z pull and VANISHED at
                # 06:07Z). Products are immutable-per-filename (valid_time in the name) so
                # caching them hard is right; the manifest must always revalidate.
                "cache-control": manifest_cache_control(filename),
            }
            resp = requests.post(url, headers=headers, data=data_bytes, timeout=30)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            ProductStore._last_upload_time = datetime.now(timezone.utc).isoformat()
            logger.info(f"[Product Store] L2 upload OK: {filename} ({len(data_bytes)} bytes)")
            # S2 run-keyed manifest + pointer CAS: every successful legacy manifest.json upload
            # also publishes an immutable run-keyed copy and CAS-advances the Postgres pointer.
            # This site runs on the serial _manifest_executor and is behind the designated-writer
            # gate above, so publishes are ordered and non-designated boxes never reach it.
            # Never raises; any failure leaves the legacy lane exactly as it was.
            if filename == "manifest.json":
                try:
                    from services.weather_pipeline.manifest_pointer import publish_run_keyed
                    publish_run_keyed(self, data_bytes, self._upload_to_supabase, self._delete_from_supabase)
                except Exception as ptr_err:
                    logger.warning(f"[Product Store] run-keyed manifest publish failed (legacy lane OK): {ptr_err}")
        except Exception as e:
            err_msg = f"L2 upload failed for {filename}: {e}"
            logger.warning(f"[Product Store] {err_msg}")
            ProductStore._last_upload_errors = (ProductStore._last_upload_errors + [err_msg])[-10:]

    def _delete_from_supabase(self, filename: str):
        """Delete a product from Supabase Storage L2 (best-effort, never raises).

        Uses the Storage REST API directly (via requests) instead of storage3's sync .remove(): in the
        pinned supabase==2.4.6 that method hits the same UnboundLocalError ("cannot access local variable
        'response'") that broke the upload path (see _upload_to_supabase above). The bug is non-fatal here
        — an un-pruned product just lingers until the next REST-based prune — but routing the DELETE through
        REST stops the noise and actually prunes. Failures are swallowed/logged to preserve that semantics.
        """
        # Designated-writer gate (audit #28): deletes are only ever pipeline prunes/sweeps — a
        # non-designated box pruning prod L2 is how the dangling-manifest-entry 404s were minted.
        if not _l2_pipeline_writes_allowed():
            _note_l2_write_skipped("delete", filename)
            return
        sb = _get_supabase_storage()  # gates on config + ensures the bucket exists
        if sb is None:
            return
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not key:
            return
        try:
            import requests
            url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{filename}"
            headers = {
                "Authorization": f"Bearer {key}",
                "apikey": key,
            }
            resp = requests.delete(url, headers=headers, timeout=30)
            if resp.status_code not in (200, 204):
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        except Exception as e:
            logger.warning(f"[Product Store] L2 delete failed for {filename}: {e}")

    def restore_from_supabase(self) -> Tuple[int, List[str]]:
        """Restore weather products from Supabase Storage L2 into disk L1.

        Downloads manifest.json first, then validates each product entry.
        Skips stale/missing/corrupt entries without crashing.
        Never restores test fixtures in production.

        Returns (restored_count, error_messages).
        """
        from services.weather_pipeline.store_helpers import restore_from_supabase_helper
        return restore_from_supabase_helper(self)

    def get_persistence_diagnostics(self) -> Dict[str, Any]:
        """Return diagnostics about L1/L2 persistence state."""
        disk_count = 0
        try:
            disk_count = len([f for f in os.listdir(self.cache_dir)
                             if f.endswith(".json") and f != "manifest.json"])
        except Exception:
            pass

        sb = _get_supabase_storage()
        supabase_count = None
        supabase_connected = sb is not None
        if sb:
            try:
                objects = sb.storage.from_(WEATHER_BUCKET).list()
                supabase_count = len([
                    o for o in (objects or [])
                    if (
                        (isinstance(o, dict) and o.get("name", "").endswith(".json") and o.get("name") != "manifest.json") or
                        (hasattr(o, "name") and getattr(o, "name", "").endswith(".json") and getattr(o, "name") != "manifest.json")
                    )
                ])
            except Exception:
                supabase_count = -1  # Error counting

        return {
            "disk_product_count": disk_count,
            "supabase_connected": supabase_connected,
            "supabase_product_count": supabase_count,
            "last_restore_time": ProductStore._last_restore_time,
            "restored_count": ProductStore._restored_count,
            "restore_errors": ProductStore._restore_errors[-5:],
            "last_upload_time": ProductStore._last_upload_time,
            "last_upload_errors": ProductStore._last_upload_errors[-5:],
            "pruned_anomalous_count": ProductStore._pruned_anomalous_count,
            "pruned_anomalous_ids": ProductStore._pruned_anomalous_ids
        }


    def get_manifest(self) -> PipelineManifest:
        """Loads and returns the registry manifest.json."""
        if not self.manifest_path.exists():
            return PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])
        
        try:
            current_mtime = self.manifest_path.stat().st_mtime
        except Exception:
            current_mtime = 0.0

        with ProductStore._manifest_lock:
            if ProductStore._cached_manifest is not None and ProductStore._cached_manifest_mtime == current_mtime:
                return ProductStore._cached_manifest

            import time
            retries = 5
            last_err = None
            manifest = None
            for attempt in range(retries):
                try:
                    with open(self.manifest_path, "r") as f:
                        data = json.load(f)
                    manifest = PipelineManifest.model_validate(data)
                    break
                except Exception as e:
                    last_err = e
                    time.sleep(0.05)
            
            if manifest is None:
                logger.error(f"[Product Store] Manifest parse error after {retries} retries: {last_err}")
                sb = _get_supabase_storage()
                if sb:
                    try:
                        logger.warning("[Product Store] Local manifest read/parse failed. Attempting fallback download from Supabase...")
                        manifest_bytes = sb.storage.from_(WEATHER_BUCKET).download("manifest.json")
                        if manifest_bytes:
                            data = json.loads(manifest_bytes.decode("utf-8"))
                            manifest = PipelineManifest.model_validate(data)
                            with open(self.manifest_path, "w") as f:
                                f.write(manifest.model_dump_json(indent=2))
                    except Exception as sb_err:
                        logger.error(f"[Product Store] Supabase manifest fallback download failed: {sb_err}")
                
                if manifest is None:
                    raise RuntimeError(f"Failed to load or parse manifest.json registry: {last_err}")

            # Dynamic self-healing: prune impossible future-dated products (>30 days in future)
            now = datetime.now(timezone.utc)
            valid_products = []
            pruned_ids = []
            has_corrupt = False
            
            # Test environments (like test_euro_estimator) use 2035 mock dates; only prune in prod/dev or if forced.
            should_prune = not is_test_environment() or os.environ.get("FORCE_MANIFEST_PRUNING") == "true"
            
            for p in manifest.products:
                if should_prune and p.valid_time_start > now + timedelta(days=30):
                    logger.warning(f"[Product Store] Pruning impossible future product from manifest: {p.filename} (valid time: {p.valid_time_start})")
                    pruned_ids.append(p.product_id or p.filename)
                    has_corrupt = True
                else:
                    valid_products.append(p)
            
            if has_corrupt:
                manifest.products = valid_products
                ProductStore._pruned_anomalous_count = max(ProductStore._pruned_anomalous_count, len(pruned_ids))
                for pid in pruned_ids:
                    if pid not in ProductStore._pruned_anomalous_ids:
                        ProductStore._pruned_anomalous_ids.append(pid)
                try:
                    self._save_manifest(manifest)
                    logger.info(f"[Product Store] Cleaned manifest saved locally with {len(pruned_ids)} pruned entries: {pruned_ids}")
                    # Cleaned manifest L2 resave (do not delete product files from Supabase blindly)
                    try:
                        manifest_json = dump_manifest_for_l2(manifest)
                        self._upload_to_supabase("manifest.json", manifest_json)
                        logger.info("[Product Store] Cleaned manifest uploaded to L2 (Supabase)")
                    except Exception as e:
                        logger.warning(f"[Product Store] Cleaned manifest L2 upload failed: {e}")
                except Exception as se:
                    logger.error(f"[Product Store] Failed to save cleaned manifest: {se}")
            
            # Apply backward compatibility mapping for older/restored products
            for p in manifest.products:
                is_florida = (
                    abs(p.coverage.west - (-85.0)) < 0.1 and
                    abs(p.coverage.south - 24.0) < 0.1 and
                    abs(p.coverage.east - (-79.0)) < 0.1 and
                    abs(p.coverage.north - 31.0) < 0.1
                )
                if is_florida:
                    if not p.region_id:
                        p.region_id = "florida_east_coast"
                    if not p.tile_id:
                        p.tile_id = "florida_east_coast"
                    if not p.coverage_mode:
                        p.coverage_mode = "regional_tile"
                if not p.coverage_mode:
                    if p.filename and "global_coarse" in p.filename:
                        p.coverage_mode = "global_tile"
                    else:
                        cov = p.coverage
                        span = (cov.east - cov.west) if cov.west <= cov.east else (180.0 - cov.west) + (cov.east + 180.0)
                        p.coverage_mode = "global_tile" if span >= 350.0 else "regional_tile"
                if not p.product_id:
                    p.product_id = p.filename
            
            ProductStore._cached_manifest = manifest
            ProductStore._cached_manifest_mtime = current_mtime
            return manifest


    def _save_manifest(self, manifest: PipelineManifest):
        """Atomically saves the manifest registry."""
        for p in manifest.products:
            is_florida = (
                abs(p.coverage.west - (-85.0)) < 0.1 and
                abs(p.coverage.south - 24.0) < 0.1 and
                abs(p.coverage.east - (-79.0)) < 0.1 and
                abs(p.coverage.north - 31.0) < 0.1
            )
            if is_florida:
                if not p.region_id:
                    p.region_id = "florida_east_coast"
                if not p.tile_id:
                    p.tile_id = "florida_east_coast"
                if not p.coverage_mode:
                    p.coverage_mode = "regional_tile"
            if not p.coverage_mode:
                if p.filename and "global_coarse" in p.filename:
                    p.coverage_mode = "global_tile"
                else:
                    cov = p.coverage
                    span = (cov.east - cov.west) if cov.west <= cov.east else (180.0 - cov.west) + (cov.east + 180.0)
                    p.coverage_mode = "global_tile" if span >= 350.0 else "regional_tile"
            if not p.product_id:
                p.product_id = p.filename

        import time
        import uuid
        tmp_path = self.manifest_path.parent / f"manifest_{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp_path, "w") as f:
                f.write(manifest.model_dump_json(indent=2))
            
            # Retry loop to survive transient Windows file/antivirus locks
            retries = 5
            for attempt in range(retries):
                try:
                    os.replace(tmp_path, self.manifest_path)
                    break
                except PermissionError as pe:
                    if attempt == retries - 1:
                        raise pe
                    time.sleep(0.05)

            try:
                current_mtime = self.manifest_path.stat().st_mtime
            except Exception:
                current_mtime = 0.0
            with ProductStore._manifest_lock:
                ProductStore._cached_manifest = manifest
                ProductStore._cached_manifest_mtime = current_mtime
        except Exception as e:
            logger.error(f"[Product Store] Manifest atomic save failed: {e}")
            if tmp_path.exists():
                try: os.remove(tmp_path)
                except Exception: pass

    def save_product(
        self,
        product: NormalizedProduct,
        resolution: float = 0.25
    ) -> Optional[str]:
        """
        Saves a normalized grid product atomically on disk and registers it in the manifest.
        Returns the saved file's basename.
        """
        from services.weather_pipeline.store_helpers import save_product_helper
        return save_product_helper(self, product, resolution)

    def save_products_batch(
        self,
        products_to_save: List[Tuple[NormalizedProduct, float]]
    ) -> int:
        """
        Saves a batch of normalized grid products atomically on disk, uploads them to Supabase,
        and registers them in the manifest in a single bulk operation.
        """
        from services.weather_pipeline.store_helpers import save_products_batch_helper
        return save_products_batch_helper(self, products_to_save)

    def load_product(self, filename: str) -> Optional[NormalizedProduct]:
        """Loads and returns a stored grid product by filename."""
        import time

        # 1. Check in-memory product cache
        now = time.time()
        with ProductStore._product_cache_lock:
            if filename in ProductStore._product_cache:
                cached_product, cached_time = ProductStore._product_cache[filename]
                if now - cached_time < ProductStore._PRODUCT_CACHE_TTL:
                    logger.debug(f"[Product Store] Memory cache HIT for {filename}")
                    # Shallow copy product and grid container to avoid deep-copying vector list
                    cloned = cached_product.model_copy()
                    if cloned.grid is not None:
                        cloned.grid = cloned.grid.model_copy()
                    return cloned
                else:
                    ProductStore._product_cache.pop(filename, None)
                    ProductStore._product_cache_vectors.pop(filename, None)

        filepath = self.cache_dir / filename
        if not filepath.exists():
            with ProductStore._l2_negative_cache_lock:
                if filename in ProductStore._l2_negative_cache:
                    fail_time = ProductStore._l2_negative_cache[filename]
                    if now - fail_time < ProductStore._L2_NEGATIVE_CACHE_TTL:
                        logger.debug(f"[Product Store] L2 negative cache HIT for {filename}. Skipping Supabase download.")
                        return None

            with ProductStore._download_locks_lock:
                if filename not in ProductStore._download_locks:
                    ProductStore._download_locks[filename] = threading.Lock()
                lock = ProductStore._download_locks[filename]
            
            with lock:
                if not filepath.exists():
                    with ProductStore._l2_negative_cache_lock:
                        if filename in ProductStore._l2_negative_cache:
                            fail_time = ProductStore._l2_negative_cache[filename]
                            if now - fail_time < ProductStore._L2_NEGATIVE_CACHE_TTL:
                                return None

                    logger.info(f"[Product Store] L1 miss for {filename}. Attempting dynamic download from L2...")
                    sb = _get_supabase_storage()
                    if sb:
                        try:
                            product_bytes = sb.storage.from_(WEATHER_BUCKET).download(filename)
                            if product_bytes:
                                temp_filepath = filepath.with_suffix(".tmp")
                                temp_filepath.write_bytes(product_bytes)
                                temp_filepath.rename(filepath)
                                logger.info(f"[Product Store] Dynamically restored {filename} from L2 to L1")
                        except Exception as e:
                            logger.warning(f"[Product Store] Dynamic L2 download failed for {filename}: {e}")
                            with ProductStore._l2_negative_cache_lock:
                                ProductStore._l2_negative_cache[filename] = time.time()
            
            # Re-check filepath existence after download attempt
            if not filepath.exists():
                logger.warning(f"[Product Store] Stored product path not found: {filename}")
                return None
        
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
                product = NormalizedProduct.model_validate(data)
                
                # Apply backward compatibility mapping for older products
                is_florida = (
                    abs(product.coverage.west - (-85.0)) < 0.1 and
                    abs(product.coverage.south - 24.0) < 0.1 and
                    abs(product.coverage.east - (-79.0)) < 0.1 and
                    abs(product.coverage.north - 31.0) < 0.1
                )
                if is_florida:
                    if not product.region_id:
                        product.region_id = "florida_east_coast"
                    if not product.tile_id:
                        product.tile_id = "florida_east_coast"
                    if not product.coverage_mode:
                        product.coverage_mode = "regional_tile"
                if not product.coverage_mode:
                    if filename and "global_coarse" in filename:
                        product.coverage_mode = "global_tile"
                    else:
                        cov = product.coverage
                        span = (cov.east - cov.west) if cov.west <= cov.east else (180.0 - cov.west) + (cov.east + 180.0)
                        product.coverage_mode = "global_tile" if span >= 350.0 else "regional_tile"
                if not product.product_id:
                    product.product_id = filename
                
                # Cache the product before returning a deepcopy. Evict LRU until BOTH the count
                # limit and the vector budget hold (insertion order == LRU here; big mid products
                # displace many small ones instead of silently multiplying resident memory ~25×).
                with ProductStore._product_cache_lock:
                    nvec = len(product.grid.vectors) if (product.grid and product.grid.vectors) else 0
                    while ProductStore._product_cache and (
                        len(ProductStore._product_cache) >= ProductStore._PRODUCT_CACHE_LIMIT
                        or sum(ProductStore._product_cache_vectors.values()) + nvec
                            > ProductStore._PRODUCT_CACHE_VECTOR_BUDGET
                    ):
                        oldest_key = next(iter(ProductStore._product_cache.keys()))
                        ProductStore._product_cache.pop(oldest_key, None)
                        ProductStore._product_cache_vectors.pop(oldest_key, None)
                    ProductStore._product_cache[filename] = (product, time.time())
                    ProductStore._product_cache_vectors[filename] = nvec

                cloned = product.model_copy()
                if cloned.grid is not None:
                    cloned.grid = cloned.grid.model_copy()
                return cloned
        except Exception as e:
            logger.error(f"[Product Store] Stored product load and parse failed for {filename}: {e}")
            return None


    def prune_old_products(self, before_time: datetime):
        """Cleans up old JSON product files that fall before the cutoff date."""
        from services.weather_pipeline.copernicus_validator import prune_old_products_helper
        return prune_old_products_helper(self, before_time)

    def prune_superseded_products(
        self, model: str, domain: str, layer: str, region_id: str, latest_run_time: datetime
    ):
        """Removes older superseded runs from manifest and disk/Supabase."""
        from services.weather_pipeline.copernicus_validator import prune_superseded_products_helper
        return prune_superseded_products_helper(self, model, domain, layer, region_id, latest_run_time)

    def prune_duplicate_valid_times(self) -> int:
        """Manifest-wide sweep: keep only the newest run_time per (model, domain, layer, region,
        valid_time); deletes true duplicates left behind by CANCELLED ingestion runs (which upload
        early hours but never reach their per-layer prune). Coverage-safe by construction."""
        from services.weather_pipeline.copernicus_validator import prune_duplicate_valid_times_helper
        return prune_duplicate_valid_times_helper(self)

    def validate_copernicus_product(
        self,
        product: NormalizedProduct,
        manifest: Optional[PipelineManifest] = None
    ) -> Tuple[bool, str]:
        """Validates a Copernicus product."""
        from services.weather_pipeline.copernicus_validator import validate_copernicus_product_helper
        return validate_copernicus_product_helper(self, product, manifest)

    def quarantine_invalid_copernicus_products(self):
        """Moves invalid Copernicus products to quarantine."""
        from services.weather_pipeline.copernicus_validator import quarantine_invalid_copernicus_products_helper
        return quarantine_invalid_copernicus_products_helper(self)

