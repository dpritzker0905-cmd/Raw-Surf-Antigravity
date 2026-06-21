import os
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from services.weather_pipeline.schemas import (
    NormalizedProduct, PipelineManifest, ManifestProduct, CoverageBounds
)

logger = logging.getLogger(__name__)

from services.weather_pipeline.copernicus_validator import is_test_environment

# ── Supabase Storage L2 persistence ──────────────────────────────────────
WEATHER_BUCKET = "weather-products"
_supabase_client = None
_bucket_created_checked = False
_bucket_lock = threading.Lock()

# Thread pools for background (fire-and-forget) L2 operations
_upload_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="supabase_upload")
_manifest_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="supabase_manifest_upload")

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
                except Exception:
                    pass
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
        """Upload a file to Supabase Storage L2 (fire-and-forget with logging)."""
        sb = _get_supabase_storage()
        if sb is None:
            return
        try:
            sb.storage.from_(WEATHER_BUCKET).upload(
                filename, data_bytes,
                file_options={"content-type": "application/json", "upsert": "true"}
            )
            ProductStore._last_upload_time = datetime.now(timezone.utc).isoformat()
            logger.info(f"[Product Store] L2 upload OK: {filename} ({len(data_bytes)} bytes)")
        except Exception as e:
            err_msg = f"L2 upload failed for {filename}: {e}"
            logger.warning(f"[Product Store] {err_msg}")
            ProductStore._last_upload_errors = (ProductStore._last_upload_errors + [err_msg])[-10:]

    def _delete_from_supabase(self, filename: str):
        sb = _get_supabase_storage()
        if sb:
            try: sb.storage.from_(WEATHER_BUCKET).remove([filename])
            except Exception as e: logger.warning(f"[Product Store] L2 delete failed for {filename}: {e}")

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
                        manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
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
        if not product or not product.grid:
            logger.warning("[Product Store] Attempted to save empty or ungrid product.")
            return None

        # Apply backward compatibility: Treat Florida coordinates as florida_east_coast if region not explicitly set
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

        # Build consistent filename preventing collisions across regions
        time_str = product.valid_time.strftime("%Y%m%dT%H%M%SZ")
        region_suffix = f"_{product.region_id}" if product.region_id else ""
        estimated_suffix = "_estimated" if getattr(product, "is_estimated", False) else ""
        filename = f"{product.model.lower()}_{product.domain.lower()}_{product.layer.lower()}{region_suffix}_{time_str}{estimated_suffix}.json"
        
        # Ensure product_id is set to the saved filename
        product.product_id = filename
        
        target_path = self.cache_dir / filename
        tmp_path = target_path.with_suffix(".tmp")

        # Double check test fixture guard before writing to disk (Correction 2)
        is_test_env = is_test_environment()
        is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)
        if is_tf and not is_test_env:
            logger.error(f"[Product Store] Security Violation: Refusing to save test-fixture product '{filename}' in non-test environment.")
            return None

        try:
            # 1. Write product data atomically to disk (L1)
            product_json_bytes = product.model_dump_json().encode("utf-8")
            with open(tmp_path, "wb") as f:
                f.write(product_json_bytes)
            
            # Retry loop to survive transient Windows file/antivirus locks
            import time
            retries = 5
            for attempt in range(retries):
                try:
                    os.replace(tmp_path, target_path)
                    break
                except PermissionError as pe:
                    if attempt == retries - 1:
                        raise pe
                    time.sleep(0.05)
            logger.info(f"[Product Store] Atomic save complete: {filename}")
        except Exception as e:
            logger.error(f"[Product Store] Product atomic save failed for {filename}: {e}")
            if tmp_path.exists():
                try: os.remove(tmp_path)
                except Exception: pass
            return None

        # 2b. Upload product to Supabase Storage (L2 — fire-and-forget)
        if not is_tf:
            _upload_executor.submit(self._upload_to_supabase, filename, product_json_bytes)

        # 2. Update registration in master manifest
        is_test_env = is_test_environment()
        is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)
        if is_tf and not is_test_env:
            logger.warning(f"[Product Store] Refusing to register test-fixture product '{filename}' in manifest in non-test environment.")
            return filename

        manifest = self.get_manifest()
        manifest.last_manifest_update = datetime.now(timezone.utc)

        # Eliminate any existing duplicate registration for the exact same slice
        updated_products = [
            p for p in manifest.products
            if not (
                p.model == product.model
                and p.provider == product.provider
                and p.domain == product.domain
                and p.layer == product.layer
                and p.valid_time_start == product.valid_time # single frame slice
                and p.region_id == product.region_id # distinguish by region to avoid collisions!
            )
        ]

        # Append new manifest item entry
        manifest_item = ManifestProduct(
            model=product.model,
            provider=product.provider,
            domain=product.domain,
            layer=product.layer,
            run_time=product.run_time,
            valid_time_start=product.valid_time,
            valid_time_end=product.valid_time, # single frame grid product
            resolution=resolution,
            freshness_sec=product.freshness_sec,
            is_forecast_authoritative=product.is_forecast_authoritative,
            is_estimated=getattr(product, "is_estimated", False),
            estimate_basis=getattr(product, "estimate_basis", None),
            coverage=product.coverage,
            filename=filename,
            is_test_fixture=is_tf,
            source_dataset=getattr(product, "source_dataset", None),
            upstream_provider=getattr(product, "upstream_provider", None),
            upstream_model=getattr(product, "upstream_model", None),
            region_id=product.region_id,
            coverage_mode=product.coverage_mode,
            tile_id=product.tile_id,
            product_id=filename
        )
        updated_products.append(manifest_item)
        manifest.products = updated_products

        self._save_manifest(manifest)

        # Upload updated manifest to Supabase (L2)
        if not is_tf:
            try:
                manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
                _manifest_executor.submit(self._upload_to_supabase, "manifest.json", manifest_json)
            except Exception as e:
                logger.warning(f"[Product Store] Manifest L2 upload submit failed: {e}")

        with ProductStore._product_cache_lock:
            ProductStore._product_cache.pop(filename, None)

        return filename

    def save_products_batch(
        self,
        products_to_save: List[Tuple[NormalizedProduct, float]]
    ) -> int:
        """
        Saves a batch of normalized grid products atomically on disk, uploads them to Supabase,
        and registers them in the manifest in a single bulk operation.
        """
        if not products_to_save:
            return 0

        is_test_env = is_test_environment()
        manifest = self.get_manifest()
        manifest.last_manifest_update = datetime.now(timezone.utc)

        # Build dictionary from existing manifest by unique slice key
        dict_by_slice = {}
        for p in manifest.products:
            key = (
                (p.model or "").upper(),
                (p.provider or "").lower(),
                (p.domain or "").lower(),
                (p.layer or "").lower(),
                p.valid_time_start,
                p.region_id
            )
            dict_by_slice[key] = p

        success_count = 0
        has_non_tf = False

        for product, resolution in products_to_save:
            if not product or not product.grid:
                logger.warning("[Product Store] Attempted to save empty or ungrid product in batch.")
                continue

            # Apply backward compatibility: Treat Florida coordinates as florida_east_coast if region not explicitly set
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

            # Build consistent filename preventing collisions across regions
            time_str = product.valid_time.strftime("%Y%m%dT%H%M%SZ")
            region_suffix = f"_{product.region_id}" if product.region_id else ""
            estimated_suffix = "_estimated" if getattr(product, "is_estimated", False) else ""
            filename = f"{product.model.lower()}_{product.domain.lower()}_{product.layer.lower()}{region_suffix}_{time_str}{estimated_suffix}.json"
            
            # Ensure product_id is set to the saved filename
            product.product_id = filename
            
            target_path = self.cache_dir / filename
            tmp_path = target_path.with_suffix(".tmp")

            # Double check test fixture guard before writing to disk
            is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)
            if is_tf and not is_test_env:
                logger.error(f"[Product Store] Security Violation: Refusing to save test-fixture product '{filename}' in non-test environment.")
                continue

            try:
                # 1. Write product data atomically to disk (L1)
                product_json_bytes = product.model_dump_json().encode("utf-8")
                with open(tmp_path, "wb") as f:
                    f.write(product_json_bytes)
                
                # Retry loop to survive transient Windows file/antivirus locks
                import time
                retries = 5
                for attempt in range(retries):
                    try:
                        os.replace(tmp_path, target_path)
                        break
                    except PermissionError as pe:
                        if attempt == retries - 1:
                            raise pe
                        time.sleep(0.05)
                logger.info(f"[Product Store] Atomic save complete in batch: {filename}")
            except Exception as e:
                logger.error(f"[Product Store] Product atomic save failed in batch for {filename}: {e}")
                if tmp_path.exists():
                    try: os.remove(tmp_path)
                    except Exception: pass
                continue

            # 2. Upload product to Supabase Storage (L2 — fire-and-forget)
            if not is_tf:
                _upload_executor.submit(self._upload_to_supabase, filename, product_json_bytes)
                has_non_tf = True

            # 3. Add to manifest dict, updating/overwriting any existing duplicate slice
            manifest_item = ManifestProduct(
                model=product.model,
                provider=product.provider,
                domain=product.domain,
                layer=product.layer,
                run_time=product.run_time,
                valid_time_start=product.valid_time,
                valid_time_end=product.valid_time,
                resolution=resolution,
                freshness_sec=product.freshness_sec,
                is_forecast_authoritative=product.is_forecast_authoritative,
                is_estimated=getattr(product, "is_estimated", False),
                estimate_basis=getattr(product, "estimate_basis", None),
                coverage=product.coverage,
                filename=filename,
                is_test_fixture=is_tf,
                source_dataset=getattr(product, "source_dataset", None),
                upstream_provider=getattr(product, "upstream_provider", None),
                upstream_model=getattr(product, "upstream_model", None),
                region_id=product.region_id,
                coverage_mode=product.coverage_mode,
                tile_id=product.tile_id,
                product_id=filename
            )
            
            slice_key = (
                (product.model or "").upper(),
                (product.provider or "").lower(),
                (product.domain or "").lower(),
                (product.layer or "").lower(),
                product.valid_time,
                product.region_id
            )
            dict_by_slice[slice_key] = manifest_item
            success_count += 1

        manifest.products = list(dict_by_slice.values())
        self._save_manifest(manifest)

        # Upload updated manifest to Supabase (L2)
        if has_non_tf:
            try:
                manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
                _manifest_executor.submit(self._upload_to_supabase, "manifest.json", manifest_json)
            except Exception as e:
                logger.warning(f"[Product Store] Manifest L2 upload submit failed in batch: {e}")

        with ProductStore._product_cache_lock:
            for product, _ in products_to_save:
                if product and product.product_id:
                    ProductStore._product_cache.pop(product.product_id, None)

        return success_count

    def load_product(self, filename: str) -> Optional[NormalizedProduct]:
        """Loads and returns a stored grid product by filename."""
        import time
        import copy

        # 1. Check in-memory product cache
        now = time.time()
        with ProductStore._product_cache_lock:
            if filename in ProductStore._product_cache:
                cached_product, cached_time = ProductStore._product_cache[filename]
                if now - cached_time < ProductStore._PRODUCT_CACHE_TTL:
                    logger.debug(f"[Product Store] Memory cache HIT for {filename}")
                    return copy.deepcopy(cached_product)
                else:
                    ProductStore._product_cache.pop(filename, None)

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
                
                # Cache the product before returning a deepcopy
                with ProductStore._product_cache_lock:
                    if len(ProductStore._product_cache) >= 64:
                        oldest_key = next(iter(ProductStore._product_cache.keys()))
                        ProductStore._product_cache.pop(oldest_key, None)
                    ProductStore._product_cache[filename] = (product, time.time())
                
                return copy.deepcopy(product)
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

