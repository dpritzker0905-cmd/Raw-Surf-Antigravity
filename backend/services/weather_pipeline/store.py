import os
import json
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from services.weather_pipeline.schemas import (
    NormalizedProduct, PipelineManifest, ManifestProduct, CoverageBounds
)

logger = logging.getLogger(__name__)

# ── Supabase Storage L2 persistence ──────────────────────────────────────
WEATHER_BUCKET = "weather-products"
_supabase_client = None
_supabase_init_attempted = False

def _get_supabase_storage():
    """Lazily initialize and return the Supabase storage client.
    Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (same as uploads/core.py).
    Returns None if credentials are missing — graceful degradation."""
    global _supabase_client, _supabase_init_attempted
    if _supabase_client is not None:
        return _supabase_client
    if _supabase_init_attempted:
        return None  # Already tried and failed
        
    # Prevent tests from writing to/corrupting live Supabase bucket
    is_test_env = (
        os.environ.get("NODE_ENV") == "test" or 
        os.environ.get("TESTING") == "1"
    )
    if is_test_env:
        logger.info("[Product Store] Supabase L2 storage disabled in test environment")
        return None

    _supabase_init_attempted = True
    try:
        from supabase import create_client as _create_supabase_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not url or not key:
            logger.warning("[Product Store] Supabase credentials not found — L2 persistence disabled")
            return None
        _supabase_client = _create_supabase_client(url, key)
        # Ensure private bucket exists (idempotent)
        try:
            _supabase_client.storage.create_bucket(
                WEATHER_BUCKET,
                options={"public": False}
            )
            logger.info(f"[Product Store] Created Supabase bucket '{WEATHER_BUCKET}' (private)")
        except Exception:
            pass  # Bucket already exists — expected
        logger.info("[Product Store] Supabase Storage L2 connected")
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

    def __init__(self, cache_dir: Optional[Path] = None):
        if cache_dir:
            self.cache_dir = cache_dir
        else:
            self.cache_dir = Path(__file__).parent.parent.parent / "uploads" / "weather_products"
        
        self.manifest_path = self.cache_dir / "manifest.json"
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        """Creates the product directory if not exists."""
        if not self.cache_dir.exists():
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"[Product Store] Created products cache directory: {self.cache_dir}")

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
        """Delete a file from Supabase Storage L2 (best-effort)."""
        sb = _get_supabase_storage()
        if sb is None:
            return
        try:
            sb.storage.from_(WEATHER_BUCKET).remove([filename])
            logger.info(f"[Product Store] L2 delete OK: {filename}")
        except Exception as e:
            logger.warning(f"[Product Store] L2 delete failed for {filename}: {e}")

    def restore_from_supabase(self) -> Tuple[int, List[str]]:
        """Restore weather products from Supabase Storage L2 into disk L1.

        Downloads manifest.json first, then validates each product entry.
        Skips stale/missing/corrupt entries without crashing.
        Never restores test fixtures in production.

        Returns (restored_count, error_messages).
        """
        errors: List[str] = []
        restored = 0
        sb = _get_supabase_storage()

        if sb is None:
            err = "Supabase Storage unavailable — skipping L2 restore"
            logger.warning(f"[Product Store] {err}")
            ProductStore._restore_errors = [err]
            ProductStore._last_restore_time = datetime.now(timezone.utc).isoformat()
            return 0, [err]

        logger.info("[Product Store] Starting L2 restore from Supabase Storage...")

        # Step 1: Download manifest
        manifest_data = None
        try:
            manifest_bytes = sb.storage.from_(WEATHER_BUCKET).download("manifest.json")
            if manifest_bytes:
                manifest_data = json.loads(manifest_bytes.decode("utf-8"))
                logger.info(f"[Product Store] Downloaded manifest from L2 ({len(manifest_data.get('products', []))} entries)")
        except Exception as e:
            err = f"Manifest download failed: {e}"
            logger.warning(f"[Product Store] {err}")
            errors.append(err)

        if not manifest_data or not manifest_data.get("products"):
            logger.info("[Product Store] No products in L2 manifest — nothing to restore")
            ProductStore._last_restore_time = datetime.now(timezone.utc).isoformat()
            ProductStore._restored_count = 0
            ProductStore._restore_errors = errors
            return 0, errors

        # Step 2: Skip downloading individual product files on startup.
        # They will be dynamically restored from L2 on-demand when loaded via load_product().
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )
        logger.info("[Product Store] Lazy restoration enabled: skipping individual product downloads on startup.")

        # Step 3: Write manifest to disk
        try:
            manifest = PipelineManifest.model_validate(manifest_data)
            # Filter out test fixtures from manifest in production
            if not is_test_env:
                manifest.products = [
                    p for p in manifest.products
                    if not p.is_test_fixture
                ]
            with open(self.manifest_path, "w") as f:
                f.write(manifest.model_dump_json(indent=2))
            logger.info(f"[Product Store] Manifest restored to disk with {len(manifest.products)} entries")
            # All registered products are considered restored (available on demand)
            restored = len(manifest.products)
        except Exception as e:
            err = f"Manifest disk write failed: {e}"
            logger.warning(f"[Product Store] {err}")
            errors.append(err)

        ProductStore._last_restore_time = datetime.now(timezone.utc).isoformat()
        ProductStore._restored_count = restored
        ProductStore._restore_errors = errors
        logger.info(f"[Product Store] L2 restore complete: manifest loaded, {restored} products available on demand")
        return restored, errors

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
        }


    def get_manifest(self) -> PipelineManifest:
        """Loads and returns the registry manifest.json."""
        if not self.manifest_path.exists():
            return PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])
        
        try:
            with open(self.manifest_path, "r") as f:
                data = json.load(f)
                manifest = PipelineManifest.model_validate(data)
                
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
                    if not p.product_id:
                        p.product_id = p.filename
                return manifest
        except Exception as e:
            logger.error(f"[Product Store] Manifest parse error: {e}")
            return PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])


    def _save_manifest(self, manifest: PipelineManifest):
        """Atomically saves the manifest registry."""
        import time
        tmp_path = self.manifest_path.with_suffix(".manifest.tmp")
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
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )
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
            self._upload_to_supabase(filename, product_json_bytes)

        # 2. Update registration in master manifest
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )
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
                self._upload_to_supabase("manifest.json", manifest_json)
            except Exception as e:
                logger.warning(f"[Product Store] Manifest L2 upload failed: {e}")

        return filename

    def load_product(self, filename: str) -> Optional[NormalizedProduct]:
        """Loads and returns a stored grid product by filename."""
        filepath = self.cache_dir / filename
        if not filepath.exists():
            logger.info(f"[Product Store] L1 miss for {filename}. Attempting dynamic download from L2...")
            sb = _get_supabase_storage()
            if sb:
                try:
                    product_bytes = sb.storage.from_(WEATHER_BUCKET).download(filename)
                    if product_bytes:
                        with open(filepath, "wb") as f:
                            f.write(product_bytes)
                        logger.info(f"[Product Store] Dynamically restored {filename} from L2 to L1")
                except Exception as e:
                    logger.warning(f"[Product Store] Dynamic L2 download failed for {filename}: {e}")
            
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
                if not product.product_id:
                    product.product_id = filename
                    
                return product
        except Exception as e:
            logger.error(f"[Product Store] Stored product load and parse failed for {filename}: {e}")
            return None


    def prune_old_products(self, before_time: datetime):
        """Cleans up old JSON product files that fall before the cutoff date.
        Removes from both L1 (disk) and L2 (Supabase Storage)."""
        manifest = self.get_manifest()
        manifest.last_manifest_update = datetime.now(timezone.utc)

        remaining_products = []
        for p in manifest.products:
            if p.valid_time_start < before_time:
                # Remove file from disk (L1)
                filepath = self.cache_dir / p.filename
                if filepath.exists():
                    try:
                        os.remove(filepath)
                        logger.info(f"[Product Store] Pruned old product file: {p.filename}")
                    except Exception as e:
                        logger.warning(f"[Product Store] Failed to delete pruned file {p.filename}: {e}")
                # Remove from Supabase Storage (L2)
                self._delete_from_supabase(p.filename)
            else:
                remaining_products.append(p)

        manifest.products = remaining_products
        self._save_manifest(manifest)
        # Update manifest in Supabase after prune
        try:
            manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
            self._upload_to_supabase("manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload after prune failed: {e}")

    def validate_copernicus_product(
        self,
        product: NormalizedProduct,
        manifest: Optional[PipelineManifest] = None
    ) -> Tuple[bool, str]:
        """
        Validates a Copernicus product (authoritative CMEMS or estimated blend)
        against strict contract, authenticity, and grid rules.
        Returns (valid: bool, reason: str).
        """
        if not product:
            return False, "Empty or None product"

        if product.model.upper() != "EURO":
            return True, "Valid (Not a EURO/Copernicus product)"

        # Check if we are in a test environment
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true" or
            os.environ.get("TESTING") == "1"
        )

        is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)

        # 1. Estimate/mock products
        if product.is_estimated and not is_tf:
            # Enforce 14 strict rules
            if product.model.upper() != "EURO":
                return False, f"Estimated product model must be EURO, got {product.model}"
            if product.domain.lower() != "marine":
                return False, f"Estimated product domain must be marine, got {product.domain}"
            if product.layer.lower() not in ("waves", "swell_1", "swell_2", "wind_waves"):
                return False, f"Estimated product layer must be waves/swell_1/swell_2/wind_waves, got {product.layer}"
            if product.provider != "estimated":
                return False, f"Estimated product provider must be estimated, got {product.provider}"
            if not product.is_estimated:
                return False, "Estimated product is_estimated must be True"
            if product.is_forecast_authoritative:
                return False, "Estimated product is_forecast_authoritative must be False"
            if product.source_dataset != "estimated_blend":
                return False, f"Estimated product source_dataset must be estimated_blend, got {product.source_dataset}"
            
            basis = getattr(product, "estimate_basis", None)
            if not basis:
                return False, "Estimated product missing estimate_basis"
            
            basis_type = basis.get("type") if isinstance(basis, dict) else getattr(basis, "type", None)
            if basis_type not in ("euro_persistence_gfs_icon_blend", "euro_persistence_gfs_blend"):
                return False, f"Estimated product estimate_basis type must be allowed, got {basis_type}"
            
            if not manifest:
                manifest = self.get_manifest()
                
            manifest_ids = {p.product_id for p in manifest.products if p.product_id}
            manifest_filenames = {p.filename for p in manifest.products if p.filename}
            all_manifest_ids = manifest_ids.union(manifest_filenames)
            
            source_keys = ["euro_anchor_product_id", "gfs_anchor_product_id", "gfs_target_product_id"]
            if basis_type == "euro_persistence_gfs_icon_blend":
                source_keys.extend(["icon_anchor_product_id", "icon_target_product_id"])
                
            for key in source_keys:
                val = basis.get(key) if isinstance(basis, dict) else getattr(basis, key, None)
                if not val:
                    return False, f"Estimated product missing required basis key: {key}"
                if val not in all_manifest_ids:
                    return False, f"Estimated product source ID '{val}' for key '{key}' not found in manifest"
                
                src_entry = next((p for p in manifest.products if p.product_id == val or p.filename == val), None)
                if src_entry:
                    if src_entry.is_test_fixture or src_entry.provider == "test-fixture":
                        if not is_test_env:
                            return False, f"Source product '{val}' is a test fixture in a non-test environment"
                else:
                    return False, f"Source product '{val}' not found in manifest"
                    
            if is_tf and not is_test_env:
                return False, "Estimated product itself is a test fixture in a non-test environment"
                
            if not product.grid:
                return False, "Estimated product missing grid"
            vectors = product.grid.vectors
            if not vectors:
                return False, "Estimated product grid vectors are empty"
            cols = product.grid.cols
            rows = product.grid.rows
            expected_len = cols * rows
            actual_len = len(vectors)
            if actual_len != expected_len:
                return False, f"Grid contract mismatch: expected cols * rows = {expected_len}, got len(vectors) = {actual_len}"
                
            diag = product.grid.diagnostics or {}
            diag_vector_count = diag.get("vectorCount")
            if diag_vector_count != actual_len:
                return False, f"Grid diagnostics mismatch: vectorCount = {diag_vector_count}, got len(vectors) = {actual_len}"
                
            nonzero_count = diag.get("nonzeroCount", 0)
            if not (0 <= nonzero_count <= actual_len):
                return False, f"Grid diagnostics mismatch: nonzeroCount = {nonzero_count} must be between 0 and {actual_len}"
                
            return True, "Valid estimated product"

        # 2. Authoritative products validation
        # Test fixtures are invalid in production/dev
        if is_tf and not is_test_env:
            return False, "Product is explicitly marked as a test fixture or provider is 'test-fixture'"

        # Not forecast authoritative
        if not is_tf and not product.is_forecast_authoritative:
            return False, "Product has is_forecast_authoritative == False"

        # Missing source dataset or wrong source dataset for copernicus
        src_dataset = getattr(product, "source_dataset", None)
        if not src_dataset:
            # Backwards compatibility fallback for older/restored Copernicus products
            src_dataset = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
            product.source_dataset = src_dataset

        # Missing source variables or wrong CMEMS variables
        layer = (product.layer or "").lower()
        if layer == "waves":
            expected_vars = {"VHM0", "VMDR", "VTM10"}
            fallback_vars = {"wave_height", "wave_direction", "wave_period"}
        elif layer == "swell_2":
            expected_vars = {"VHM0_SW2", "VMDR_SW2", "VTM01_SW2"}
            fallback_vars = {"secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period"}
        elif layer == "wind_waves":
            expected_vars = {"VHM0_WW", "VMDR_WW", "VTM01_WW"}
            fallback_vars = {"wind_wave_height", "wind_wave_direction", "wind_wave_period"}
        else:  # default or swell_1
            expected_vars = {"VHM0_SW1", "VMDR_SW1", "VTM01_SW1"}
            fallback_vars = {"swell_wave_height", "swell_wave_direction", "swell_wave_period"}
        actual_vars = set(product.source_variables or [])
        if not expected_vars.issubset(actual_vars) and not fallback_vars.issubset(actual_vars):
            return False, f"Missing required CMEMS variables. Expected subset {expected_vars} or {fallback_vars}, got {actual_vars}"

        # Metadata warning/synthetic check
        if not (is_test_env or is_tf):
            warnings_str = " ".join(product.warnings or []).lower()
            if any(keyword in warnings_str for keyword in ["mock", "synthetic", "test"]):
                return False, f"Warnings metadata indicates synthetic/mock data: '{warnings_str}'"

            # Schema/Resolution validation check (mock resolution is 1.5, real is 0.5 or 0.25)
            if product.grid:
                vectors = product.grid.vectors
                if len(vectors) > 1:
                    unique_lats = sorted(list(set(v.lat for v in vectors)))
                    if len(unique_lats) > 1:
                        res_diff = unique_lats[1] - unique_lats[0]
                        if abs(res_diff - 1.5) < 0.01:
                            return False, f"Grid resolution {res_diff}° matches mock resolution (1.5°)"

        return True, "Valid real Copernicus product"

    def quarantine_invalid_copernicus_products(self):
        """
        Scans all files on disk matching Copernicus names and manifest entries.
        Validates them, and moves invalid ones to a quarantine directory.
        """
        logger.info("[Product Store] Starting selective validation and quarantine scan for Copernicus products...")
        quarantine_dir = self.cache_dir / "quarantine"
        if not quarantine_dir.exists():
            quarantine_dir.mkdir(parents=True, exist_ok=True)

        manifest = self.get_manifest()
        manifest_updated = False
        remaining_products = []

        files = []
        if self.cache_dir.exists():
            try:
                files = [f for f in os.listdir(self.cache_dir) if f.startswith("euro_marine_") and f.endswith(".json")]
            except Exception as e:
                logger.error(f"[Product Store] Failed to list cache directory for quarantine: {e}")

        validated_files = {}

        # 1. Scan and validate files on disk
        for filename in files:
            filepath = self.cache_dir / filename
            try:
                with open(filepath, "r") as f:
                    data = json.load(f)
                
                try:
                    product = NormalizedProduct.model_validate(data)
                    valid, reason = self.validate_copernicus_product(product, manifest)
                except Exception as ve:
                    valid, reason = False, f"Schema validation error: {ve}"
                
                if not valid:
                    dest_path = quarantine_dir / filename
                    if dest_path.exists():
                        os.remove(dest_path)
                    os.replace(filepath, dest_path)
                    logger.warning(f"[Product Store] Quarantined invalid product '{filename}' (Reason: {reason})")
                    validated_files[filename] = False
                else:
                    validated_files[filename] = True
            except Exception as e:
                logger.error(f"[Product Store] Failed to process/parse file '{filename}' during quarantine scan: {e}")
                try:
                    dest_path = quarantine_dir / filename
                    if dest_path.exists():
                        os.remove(dest_path)
                    os.replace(filepath, dest_path)
                    logger.warning(f"[Product Store] Quarantined unparseable file '{filename}' due to exception.")
                except Exception:
                    pass
                validated_files[filename] = False

        # 2. Filter manifest entries
        for p in manifest.products:
            is_copernicus = (p.domain.lower() == "marine") and (p.model.upper() == "EURO" or p.provider == "copernicus" or (p.provider == "test-fixture" and p.model.upper() == "EURO"))
            if is_copernicus:
                is_valid = validated_files.get(p.filename, False)
                if not is_valid:
                    logger.warning(f"[Product Store] Removing invalid product registry '{p.filename}' from manifest.")
                    manifest_updated = True
                    filepath = self.cache_dir / p.filename
                    if filepath.exists():
                        try:
                            dest_path = quarantine_dir / p.filename
                            os.replace(filepath, dest_path)
                        except Exception:
                            pass
                else:
                    remaining_products.append(p)
            else:
                remaining_products.append(p)

        if manifest_updated:
            manifest.products = remaining_products
            self._save_manifest(manifest)
            logger.info("[Product Store] Updated manifest registry after quarantine scan.")
        else:
            logger.info("[Product Store] Quarantine scan complete. No products quarantined.")
