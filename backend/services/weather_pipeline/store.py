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

class ProductStore:
    """
    Manages atomic persistent storage of prepared weather products on disk
    at uploads/weather_products/ along with a master registry manifest.
    """

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

    def get_manifest(self) -> PipelineManifest:
        """Loads and returns the registry manifest.json."""
        if not self.manifest_path.exists():
            return PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])
        
        try:
            with open(self.manifest_path, "r") as f:
                data = json.load(f)
                return PipelineManifest.model_validate(data)
        except Exception as e:
            logger.error(f"[Product Store] Manifest parse error: {e}")
            return PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])

    def _save_manifest(self, manifest: PipelineManifest):
        """Atomically saves the manifest registry."""
        tmp_path = self.manifest_path.with_suffix(".manifest.tmp")
        try:
            with open(tmp_path, "w") as f:
                f.write(manifest.model_dump_json(indent=2))
            os.replace(tmp_path, self.manifest_path)
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

        # Build consistent filename
        time_str = product.valid_time.strftime("%Y%m%dT%H%M%SZ")
        filename = f"{product.model.lower()}_{product.domain.lower()}_{product.layer.lower()}_{time_str}.json"
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
            # 1. Write product data atomically to disk
            with open(tmp_path, "w") as f:
                f.write(product.model_dump_json())
            os.replace(tmp_path, target_path)
            logger.info(f"[Product Store] Atomic save complete: {filename}")
        except Exception as e:
            logger.error(f"[Product Store] Product atomic save failed for {filename}: {e}")
            if tmp_path.exists():
                try: os.remove(tmp_path)
                except Exception: pass
            return None

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
            coverage=product.coverage,
            filename=filename,
            is_test_fixture=is_tf,
            source_dataset=getattr(product, "source_dataset", None),
            upstream_provider=getattr(product, "upstream_provider", None),
            upstream_model=getattr(product, "upstream_model", None)
        )
        updated_products.append(manifest_item)
        manifest.products = updated_products

        self._save_manifest(manifest)
        return filename

    def load_product(self, filename: str) -> Optional[NormalizedProduct]:
        """Loads and returns a stored grid product by filename."""
        filepath = self.cache_dir / filename
        if not filepath.exists():
            logger.warning(f"[Product Store] Stored product path not found: {filename}")
            return None
        
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
                return NormalizedProduct.model_validate(data)
        except Exception as e:
            logger.error(f"[Product Store] Stored product load and parse failed for {filename}: {e}")
            return None

    def prune_old_products(self, before_time: datetime):
        """Cleans up old JSON product files that fall before the cutoff date."""
        manifest = self.get_manifest()
        manifest.last_manifest_update = datetime.now(timezone.utc)

        remaining_products = []
        for p in manifest.products:
            if p.valid_time_start < before_time:
                # Remove file
                filepath = self.cache_dir / p.filename
                if filepath.exists():
                    try:
                        os.remove(filepath)
                        logger.info(f"[Product Store] Pruned old product file: {p.filename}")
                    except Exception as e:
                        logger.warning(f"[Product Store] Failed to delete pruned file {p.filename}: {e}")
            else:
                remaining_products.append(p)

        manifest.products = remaining_products
        self._save_manifest(manifest)

    def validate_copernicus_product(self, product: NormalizedProduct) -> Tuple[bool, str]:
        """
        Validates a Copernicus product against truth and authenticity rules.
        Returns (valid: bool, reason: str).
        """
        if not product:
            return False, "Empty or None product"

        if product.model.upper() != "EURO":
            return True, "Valid (Not a EURO/Copernicus product)"

        # 1. Test fixtures are invalid in production/dev
        if product.provider == "test-fixture" or getattr(product, "is_test_fixture", False):
            return False, "Product is explicitly marked as a test fixture or provider is 'test-fixture'"

        # 2. Estimate/mock products
        if product.is_estimated:
            return False, "Product has is_estimated == True"

        # 3. Not forecast authoritative
        if not product.is_forecast_authoritative:
            return False, "Product has is_forecast_authoritative == False"

        # 4. Missing source dataset or wrong source dataset for copernicus
        src_dataset = getattr(product, "source_dataset", None)
        if not src_dataset:
            return False, "Missing source_dataset attribute for Copernicus/EURO model"

        # 5. Missing source variables or wrong CMEMS variables
        expected_vars = {"VHM0_SW1", "VMDR_SW1", "VTM01_SW1"}
        actual_vars = set(product.source_variables or [])
        if not expected_vars.issubset(actual_vars):
            return False, f"Missing required CMEMS variables. Expected subset {expected_vars}, got {actual_vars}"

        # 6. Metadata warning/synthetic check
        warnings_str = " ".join(product.warnings or []).lower()
        if any(keyword in warnings_str for keyword in ["mock", "synthetic", "test"]):
            return False, f"Warnings metadata indicates synthetic/mock data: '{warnings_str}'"

        # 7. Schema/Resolution validation check (mock resolution is 1.5, real is 0.5 or 0.25)
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
                    valid, reason = self.validate_copernicus_product(product)
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
