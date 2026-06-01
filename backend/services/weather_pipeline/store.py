import os
import json
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
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
            filename=filename
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
