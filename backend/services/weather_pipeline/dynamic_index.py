import os
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class DynamicProductIndex:
    """
    Lightweight dynamic catalog for tracking transient viewport conformed weather products.
    Stores metadata in dynamic_products_index.json to avoid manifest.json bloat.
    """
    def __init__(self, cache_dir: Optional[Path] = None):
        if cache_dir:
            self.cache_dir = cache_dir
        else:
            self.cache_dir = Path(__file__).parent.parent.parent / "uploads" / "weather_products"
        self.index_path = self.cache_dir / "dynamic_products_index.json"
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        if not self.cache_dir.exists():
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> List[Dict[str, Any]]:
        if not self.index_path.exists():
            return []
        try:
            with open(self.index_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"[Dynamic Index] Failed to load index: {e}")
            return []

    def _save_index(self, data: List[Dict[str, Any]]):
        tmp_path = self.index_path.with_suffix(".tmp")
        try:
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, self.index_path)
        except Exception as e:
            logger.error(f"[Dynamic Index] Failed to save index: {e}")
            if tmp_path.exists():
                try: os.remove(tmp_path)
                except Exception: pass

    def prune_expired(self):
        """Removes expired dynamic index entries and deletes corresponding L1 files."""
        now = datetime.now(timezone.utc)
        items = self._load_index()
        valid_items = []
        pruned_count = 0

        for item in items:
            try:
                expires_at = datetime.fromisoformat(item["expires_at"].replace("Z", "+00:00"))
                if now > expires_at:
                    # File expired, delete L1 conformed viewport file
                    filename = item["product_id"]
                    filepath = self.cache_dir / filename
                    if filepath.exists():
                        try:
                            os.remove(filepath)
                            logger.info(f"[Dynamic Index] Pruned expired L1 file: {filename}")
                        except Exception as e:
                            logger.warning(f"[Dynamic Index] Failed to delete pruned L1 file {filename}: {e}")
                    pruned_count += 1
                else:
                    valid_items.append(item)
            except Exception as e:
                logger.error(f"[Dynamic Index] Error pruning item {item.get('product_id')}: {e}")
                valid_items.append(item)

        if pruned_count > 0:
            self._save_index(valid_items)
            logger.info(f"[Dynamic Index] Pruned {pruned_count} expired index entries.")

    def add_product(
        self,
        product_id: str,
        model: str,
        domain: str,
        layer: str,
        valid_time: datetime,
        requested_bbox: str,
        served_bbox: str,
        coverage_scope: str,
        resolution: float,
        cache_key: str,
        source: str,
        ttl_hours: float = 3.0
    ):
        """Registers a dynamic product in the index catalog."""
        self.prune_expired()
        items = self._load_index()

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=ttl_hours)

        # Eliminate duplicate entries for the exact same cache_key and valid_time
        items = [
            item for item in items
            if not (
                item.get("cache_key") == cache_key
                and item.get("valid_time") == valid_time.isoformat()
                and item.get("model").upper() == model.upper()
                and item.get("layer").lower() == layer.lower()
            )
        ]

        new_item = {
            "product_id": product_id,
            "model": model.upper(),
            "domain": domain.lower(),
            "layer": layer.lower(),
            "valid_time": valid_time.isoformat(),
            "requested_bbox": requested_bbox,
            "served_bbox": served_bbox,
            "coverage_scope": coverage_scope,
            "resolution": resolution,
            "cache_key": cache_key,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "source": source
        }
        items.append(new_item)
        self._save_index(items)
        logger.info(f"[Dynamic Index] Registered dynamic product: {product_id} (key: {cache_key})")

    def find_product(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time: datetime,
        cache_key: str
    ) -> Optional[Dict[str, Any]]:
        """Finds a conformed dynamic product by model, layer, valid_time, and cache key."""
        self.prune_expired()
        items = self._load_index()
        target_ts = valid_time.timestamp()

        for item in items:
            if (
                item.get("model").upper() == model.upper()
                and item.get("domain").lower() == domain.lower()
                and item.get("layer").lower() == layer.lower()
                and item.get("cache_key") == cache_key
            ):
                try:
                    item_dt = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
                    # Allow 3h time tolerance alignment
                    if abs(item_dt.timestamp() - target_ts) <= 3 * 3600:
                        return item
                except ValueError:
                    continue
        return None

    def find_product_containing(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time: datetime,
        lat: float,
        lng: float,
        grid_bbox: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Finds any registered dynamic product that contains the requested coordinate and time, sorted by closest match."""
        self.prune_expired()
        items = self._load_index()
        target_ts = valid_time.timestamp()

        candidates = []
        for item in items:
            if (
                item.get("model").upper() == model.upper()
                and item.get("domain").lower() == domain.lower()
                and item.get("layer").lower() == layer.lower()
            ):
                try:
                    item_dt = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
                    time_diff = abs(item_dt.timestamp() - target_ts)
                    if time_diff <= 3 * 3600:
                        # Parse served_bbox to check bounds: west,south,east,north
                        bbox_parts = [float(x) for x in item["served_bbox"].split(",")]
                        if len(bbox_parts) == 4:
                            west, south, east, north = bbox_parts
                            margin = 0.01
                            
                            # Handle antimeridian crossing bounds
                            in_lat = (south - margin) <= lat <= (north + margin)
                            if west <= east:
                                in_lng = (west - margin) <= lng <= (east + margin)
                                area = (north - south) * (east - west)
                            else:
                                # Antimeridian crossing: coordinate must be west of East OR east of West
                                in_lng = lng >= (west - margin) or lng <= (east + margin)
                                area = (north - south) * ((east - west) % 360.0)

                            if in_lat and in_lng:
                                # Calculate bbox match score (0 is best, 1 is fallback)
                                bbox_match = 1
                                if grid_bbox:
                                    if item.get("requested_bbox") == grid_bbox or item.get("served_bbox") == grid_bbox:
                                        bbox_match = 0
                                    else:
                                        try:
                                            g_parts = [float(x) for x in grid_bbox.split(",")]
                                            if len(g_parts) == 4:
                                                g_w, g_s, g_e, g_n = g_parts
                                                if abs(g_w - west) < 0.1 and abs(g_s - south) < 0.1 and abs(g_e - east) < 0.1 and abs(g_n - north) < 0.1:
                                                    bbox_match = 0
                                        except Exception:
                                            pass

                                candidates.append({
                                    "item": item,
                                    "bbox_match": bbox_match,
                                    "time_diff": time_diff,
                                    "area": area
                                })
                except (ValueError, KeyError, IndexError):
                    continue

        if candidates:
            # Sort: 1) bbox_match, 2) time_diff, 3) area (smaller is better)
            candidates.sort(key=lambda c: (c["bbox_match"], c["time_diff"], c["area"]))
            return candidates[0]["item"]

        return None
