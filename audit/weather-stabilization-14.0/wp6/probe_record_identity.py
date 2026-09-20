"""Local, synthetic same-process provenance probe; never opens a network connection.

Uses real ProductStore restore/load and resolve_grid. Only L2 bytes and the unused
viewport/network boundaries are controlled. Temporary instrumentation records which
object/file the resolver reads; no serving source is changed.
"""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["TESTING"] = "1"
os.environ["L2_WRITER"] = "0"
for key in list(os.environ):
    if key.startswith("SUPABASE_"):
        os.environ.pop(key)

from services.weather_pipeline import store as store_module
from services.weather_pipeline.grid_resolver import resolve_grid
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline.store_helpers import _build_manifest_item


def no_network(*args, **kwargs):
    raise AssertionError("Diagnostic attempted a network operation")


def make_product(height, cycle, ingested):
    valid = datetime(2035, 1, 2, 18, tzinfo=timezone.utc)
    raw = [{"latitude": lat, "longitude": lon, "hourly": {
        "time": [valid.strftime("%Y-%m-%dT%H:%M:%SZ")], "wave_height": [height],
        "wave_direction": [180.0], "wave_period": [10.0],
    }} for lat in (26, 27) for lon in (-81, -80)]
    product = WeatherNormalizer().normalize(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        raw_results=raw, bbox={"west": -81, "south": 26, "east": -80, "north": 27},
        resolution=1.0, target_time=valid, run_time=cycle,
        region_id="diagnostic_local", coverage_mode="regional_tile",
    )
    product.model_run_time = cycle
    product.model_run_time_status = "known"
    product.ingested_at = ingested
    return product


def identity(product):
    return {"object_id_in_this_process": id(product),
            "product_id": product.product_id,
            "model_run_time": product.model_run_time.isoformat(),
            "ingested_at": product.ingested_at.isoformat(),
            "mean_height": sum(v.speed for v in product.grid.vectors) / len(product.grid.vectors),
            "grid_value_sha256": hashlib.sha256(json.dumps(
                [v.model_dump() for v in product.grid.vectors], sort_keys=True
            ).encode()).hexdigest()}


class TracedStore(store_module.ProductStore):
    def __init__(self, path):
        super().__init__(cache_dir=path)
        self.trace = []

    def load_product(self, filename, **kwargs):
        path = self.cache_dir / filename
        from_memory = filename in self._product_cache
        from_disk = path.exists()
        value = super().load_product(filename, **kwargs)
        self.trace.append({"operation": "load_product", "filename": filename,
                           "preexisting_memory_entry": from_memory,
                           "preexisting_disk_file": from_disk,
                           "returned": identity(value) if value else None})
        return value

    def get_manifest(self):
        manifest = super().get_manifest()
        self.trace.append({"operation": "get_manifest", "object_id_in_this_process": id(manifest),
                           "last_manifest_update": manifest.last_manifest_update.isoformat(),
                           "product_count": len(manifest.products)})
        return manifest

    def _upload_to_supabase(self, *args, **kwargs):
        raise AssertionError("Diagnostic must never upload")


async def scenario(changed_values):
    old = make_product(1.0, datetime(2035, 1, 1, 12, tzinfo=timezone.utc),
                       datetime(2035, 1, 1, 23, tzinfo=timezone.utc))
    new = make_product(2.0 if changed_values else 1.0,
                       datetime(2035, 1, 2, 6, tzinfo=timezone.utc),
                       datetime(2035, 1, 2, 15, tzinfo=timezone.utc))
    filename = "gfs_marine_waves_diagnostic_local_20350102T180000Z.json"
    old.product_id = new.product_id = filename
    new_entry = _build_manifest_item(new, filename, 1.0, False)
    fresh_manifest = PipelineManifest(last_manifest_update=new.ingested_at, products=[new_entry])
    downloads = []

    class Bucket:
        def download(self, key):
            downloads.append(key)
            if key != filename:
                raise AssertionError(f"Unexpected local L2 key: {key}")
            return new.model_dump_json().encode()

    bucket = Bucket()
    fake_l2 = SimpleNamespace(storage=SimpleNamespace(from_=lambda name: bucket))
    cls = store_module.ProductStore
    with TemporaryDirectory(prefix="raw-surf-wp6-") as directory:
        path = Path(directory)
        (path / filename).write_text(old.model_dump_json(), encoding="utf-8")
        old_manifest = PipelineManifest(last_manifest_update=old.ingested_at,
                                       products=[_build_manifest_item(old, filename, 1.0, False)])
        (path / "manifest.json").write_text(old_manifest.model_dump_json(), encoding="utf-8")
        with patch.object(cls, "_product_cache", {}), patch.object(cls, "_product_cache_vectors", {}), \
                patch.object(cls, "_cached_manifest", None), patch.object(cls, "_last_manifest_sha", None), \
                patch.object(store_module, "_get_supabase_storage", return_value=fake_l2), \
                patch("services.weather_pipeline.manifest_pointer.fetch_pointed_manifest",
                      return_value=fresh_manifest.model_dump_json().encode()), \
                patch.object(socket, "create_connection", no_network), \
                patch.object(socket.socket, "connect", no_network):
            store = TracedStore(path)
            initial = store.load_product(filename)
            disk_hash_before = hashlib.sha256((path / filename).read_bytes()).hexdigest()
            disk_mtime_before = (path / filename).stat().st_mtime
            cache_created = cls._product_cache[filename][1]
            restored, errors = store.restore_from_supabase()
            assert restored == 1 and not errors
            manifest = store.get_manifest()
            viewport = SimpleNamespace(is_viewport_enabled=lambda *a, **k: False)

            async def serve():
                return await resolve_grid(store, viewport, model="GFS", domain="marine", layer="waves",
                                          valid_time=new.valid_time.isoformat())

            warm = await serve()
            cls._product_cache.clear()
            cls._product_cache_vectors.clear()
            cold_disk = await serve()
            disk_hash_after = hashlib.sha256((path / filename).read_bytes()).hexdigest()
            disk_mtime_after = (path / filename).stat().st_mtime
            assert not downloads and disk_hash_before == disk_hash_after
            assert warm.model_run_time == cold_disk.model_run_time == old.model_run_time
            assert manifest.products[0].model_run_time == new.model_run_time
            # Positive control: a genuinely absent L1 object loads fresh bytes from fake L2.
            cls._product_cache.clear()
            cls._product_cache_vectors.clear()
            (path / filename).unlink()
            fresh = await serve()
            assert fresh.model_run_time == new.model_run_time
            assert fresh.grid.vectors[0].speed == new.grid.vectors[0].speed
            assert downloads == [filename]
            return {
                "scenario": "values_and_labels_changed" if changed_values else "labels_only_changed",
                "fixture": "synthetic, explicitly controlled; not a production capture",
                "manifest_product_id": manifest.products[0].product_id,
                "manifest_object_id_in_this_process": id(manifest.products[0]),
                "manifest_model_run_time": manifest.products[0].model_run_time.isoformat(),
                "manifest_ingested_at": manifest.products[0].ingested_at.isoformat(),
                "manifest_last_update": manifest.last_manifest_update.isoformat(),
                "restore_recorded_at": cls._last_restore_time,
                "product_cache_ttl_seconds": cls._PRODUCT_CACHE_TTL,
                "memory_cache_inserted_at": datetime.fromtimestamp(cache_created, timezone.utc).isoformat(),
                "l1_file_mtime_before_restore": datetime.fromtimestamp(disk_mtime_before, timezone.utc).isoformat(),
                "l1_file_mtime_after_restore": datetime.fromtimestamp(disk_mtime_after, timezone.utc).isoformat(),
                "initial": identity(initial), "after_manifest_restore_warm": identity(warm),
                "after_memory_clear_disk": identity(cold_disk),
                "after_l1_absence_fresh_download": identity(fresh),
                "l1_product_hash_unchanged_by_restore": disk_hash_before == disk_hash_after,
                "product_downloads": downloads, "trace": store.trace,
            }


async def main():
    source_paths = ["backend/services/weather_pipeline/" + name for name in (
        "store.py", "store_helpers.py", "grid_resolver.py", "normalizer.py", "schemas.py")]
    result = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "parent_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "source_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                          for name in source_paths},
        "network": "disabled; in-memory fake L2 and temporary local files only",
        "scenarios": [await scenario(False), await scenario(True)],
        "limit": "Demonstrates a real local serving mechanism, not the live Render worker's record identity."
    }
    (HERE / "record-identity-results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"scenarios_passed": len(result["scenarios"]), "network": result["network"]}))


if __name__ == "__main__":
    asyncio.run(main())
