import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Tuple, Optional

from services.weather_pipeline.schemas import PipelineManifest, NormalizedProduct, ManifestProduct
from services.weather_pipeline.copernicus_validator import is_test_environment

logger = logging.getLogger(__name__)


def _apply_florida_region_defaults(product) -> None:
    """Backward-compat: tag Florida-bbox products as florida_east_coast / regional_tile."""
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


def _build_product_filename(product) -> str:
    """Consistent on-disk filename preventing collisions across regions/estimates."""
    time_str = product.valid_time.strftime("%Y%m%dT%H%M%SZ")
    region_suffix = f"_{product.region_id}" if product.region_id else ""
    estimated_suffix = "_estimated" if getattr(product, "is_estimated", False) else ""
    return f"{product.model.lower()}_{product.domain.lower()}_{product.layer.lower()}{region_suffix}_{time_str}{estimated_suffix}.json"


def _write_product_to_disk(target_path, product_json_bytes) -> bool:
    """Atomic L1 write with a retry loop to survive transient Windows file/AV locks."""
    import time
    tmp_path = target_path.with_suffix(".tmp")
    try:
        with open(tmp_path, "wb") as f:
            f.write(product_json_bytes)
        retries = 5
        for attempt in range(retries):
            try:
                os.replace(tmp_path, target_path)
                break
            except PermissionError as pe:
                if attempt == retries - 1:
                    raise pe
                time.sleep(0.05)
        return True
    except Exception as e:
        logger.error(f"[Product Store] Product atomic save failed for {target_path.name}: {e}")
        if tmp_path.exists():
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        return False


def _build_manifest_item(product, filename: str, resolution: float, is_tf: bool) -> ManifestProduct:
    """Build the manifest registration entry for a saved product (single-frame slice)."""
    return ManifestProduct(
        model=product.model,
        provider=product.provider,
        domain=product.domain,
        layer=product.layer,
        run_time=product.run_time,
        valid_time_start=product.valid_time,
        valid_time_end=product.valid_time,  # single frame grid product
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


def save_product_helper(store, product: NormalizedProduct, resolution: float = 0.25) -> Optional[str]:
    """Helper implementing ProductStore.save_product: atomic L1 write + L2 upload + manifest register."""
    from services.weather_pipeline.store import _upload_executor, _manifest_executor, ProductStore

    if not product or not product.grid:
        logger.warning("[Product Store] Attempted to save empty or ungrid product.")
        return None

    _apply_florida_region_defaults(product)

    filename = _build_product_filename(product)
    product.product_id = filename  # Ensure product_id is set to the saved filename
    target_path = store.cache_dir / filename

    # Double check test fixture guard before writing to disk
    is_test_env = is_test_environment()
    is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)
    if is_tf and not is_test_env:
        logger.error(f"[Product Store] Security Violation: Refusing to save test-fixture product '{filename}' in non-test environment.")
        return None

    # 1. Write product data atomically to disk (L1)
    product_json_bytes = product.model_dump_json().encode("utf-8")
    if not _write_product_to_disk(target_path, product_json_bytes):
        return None
    logger.info(f"[Product Store] Atomic save complete: {filename}")

    # 2b. Upload product to Supabase Storage (L2 — fire-and-forget)
    if not is_tf:
        _upload_executor.submit(store._upload_to_supabase, filename, product_json_bytes)

    # 2. Update registration in master manifest
    if is_tf and not is_test_env:
        logger.warning(f"[Product Store] Refusing to register test-fixture product '{filename}' in manifest in non-test environment.")
        return filename

    manifest = store.get_manifest()
    manifest.last_manifest_update = datetime.now(timezone.utc)

    # Eliminate any existing duplicate registration for the exact same slice
    updated_products = [
        p for p in manifest.products
        if not (
            p.model == product.model
            and p.provider == product.provider
            and p.domain == product.domain
            and p.layer == product.layer
            and p.valid_time_start == product.valid_time  # single frame slice
            and p.region_id == product.region_id  # distinguish by region to avoid collisions!
        )
    ]
    updated_products.append(_build_manifest_item(product, filename, resolution, is_tf))
    manifest.products = updated_products

    store._save_manifest(manifest)

    # Upload updated manifest to Supabase (L2)
    if not is_tf:
        try:
            manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit failed: {e}")

    with ProductStore._product_cache_lock:
        ProductStore._product_cache.pop(filename, None)

    return filename


def save_products_batch_helper(store, products_to_save: List[Tuple[NormalizedProduct, float]]) -> int:
    """Helper implementing ProductStore.save_products_batch: bulk atomic write + L2 + single manifest update."""
    from services.weather_pipeline.store import _upload_executor, _manifest_executor, ProductStore

    if not products_to_save:
        return 0

    is_test_env = is_test_environment()
    manifest = store.get_manifest()
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

        _apply_florida_region_defaults(product)

        filename = _build_product_filename(product)
        product.product_id = filename  # Ensure product_id is set to the saved filename
        target_path = store.cache_dir / filename

        # Double check test fixture guard before writing to disk
        is_tf = product.provider == "test-fixture" or getattr(product, "is_test_fixture", False)
        if is_tf and not is_test_env:
            logger.error(f"[Product Store] Security Violation: Refusing to save test-fixture product '{filename}' in non-test environment.")
            continue

        # 1. Write product data atomically to disk (L1)
        product_json_bytes = product.model_dump_json().encode("utf-8")
        if not _write_product_to_disk(target_path, product_json_bytes):
            continue
        logger.info(f"[Product Store] Atomic save complete in batch: {filename}")

        # 2. Upload product to Supabase Storage (L2 — fire-and-forget)
        if not is_tf:
            _upload_executor.submit(store._upload_to_supabase, filename, product_json_bytes)
            has_non_tf = True

        # 3. Add to manifest dict, updating/overwriting any existing duplicate slice
        slice_key = (
            (product.model or "").upper(),
            (product.provider or "").lower(),
            (product.domain or "").lower(),
            (product.layer or "").lower(),
            product.valid_time,
            product.region_id
        )
        dict_by_slice[slice_key] = _build_manifest_item(product, filename, resolution, is_tf)
        success_count += 1

    manifest.products = list(dict_by_slice.values())
    store._save_manifest(manifest)

    # Upload updated manifest to Supabase (L2)
    if has_non_tf:
        try:
            manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit failed in batch: {e}")

    with ProductStore._product_cache_lock:
        for product, _ in products_to_save:
            if product and product.product_id:
                ProductStore._product_cache.pop(product.product_id, None)

    return success_count

def restore_from_supabase_helper(store) -> Tuple[int, List[str]]:
    """Helper implementing restore_from_supabase for ProductStore."""
    from services.weather_pipeline.store import _get_supabase_storage, WEATHER_BUCKET, ProductStore
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
    is_test_env = is_test_environment()
    logger.info("[Product Store] Lazy restoration enabled: skipping individual product downloads on startup.")

    # Step 3: Write manifest to disk
    try:
        manifest = PipelineManifest.model_validate(manifest_data)
        # Preserve existing local test fixtures and estimated products if in dev/test environment
        node_env = os.environ.get("NODE_ENV", "").lower()
        env = os.environ.get("ENV", "").lower()
        is_prod = (node_env == "production" or env == "production" or os.environ.get("IS_PROD", "").lower() == "true")
        is_dev_or_test = not is_prod

        if is_dev_or_test and store.manifest_path.exists():
            try:
                with open(store.manifest_path, "r") as f:
                    local_data = json.load(f)
                local_manifest = PipelineManifest.model_validate(local_data)
                local_tf_and_estimated = [
                    p for p in local_manifest.products
                    if p.is_test_fixture or getattr(p, "is_estimated", False)
                ]
                if local_tf_and_estimated:
                    # Merge local test fixtures and conformed estimated products into downloaded manifest, avoiding duplicates
                    existing_ids = {p.product_id for p in manifest.products if p.product_id}
                    existing_filenames = {p.filename for p in manifest.products if p.filename}
                    merged_count = 0
                    for tf in local_tf_and_estimated:
                        tf_id = tf.product_id or tf.filename
                        if tf_id not in existing_ids and tf.filename not in existing_filenames:
                            manifest.products.append(tf)
                            merged_count += 1
                    if merged_count > 0:
                        logger.info(f"[Product Store] Merged {merged_count} existing local test fixtures / estimated products from disk manifest")
            except Exception as merge_err:
                logger.warning(f"[Product Store] Failed to merge local test fixtures / estimated products: {merge_err}")

        # Filter out test fixtures from manifest in production
        if not is_test_env:
            manifest.products = [
                p for p in manifest.products
                if not p.is_test_fixture
            ]

        # Startup hygiene: Purge stale ICON wind AUTH products beyond native horizon.
        # ICON wind native horizon is 120h. Any non-estimated product beyond that
        # is a leftover from old ingestion runs and should not exist.
        now_utc = datetime.now(timezone.utc)
        icon_native_cutoff = now_utc + timedelta(hours=120)
        pre_purge_count = len(manifest.products)
        manifest.products = [
            p for p in manifest.products
            if not (
                p.model.upper() == "ICON"
                and p.domain.lower() == "wind"
                and p.layer.lower() == "wind"
                and not getattr(p, "is_estimated", False)
                and p.valid_time_start > icon_native_cutoff
            )
        ]
        purged = pre_purge_count - len(manifest.products)
        if purged > 0:
            logger.info(f"[Product Store] Startup hygiene: Purged {purged} stale ICON wind AUTH products beyond 120h horizon")
        
        with open(store.manifest_path, "w") as f:
            f.write(manifest.model_dump_json(indent=2))
        try:
            current_mtime = store.manifest_path.stat().st_mtime
        except Exception:
            current_mtime = 0.0
        with ProductStore._manifest_lock:
            ProductStore._cached_manifest = manifest
            ProductStore._cached_manifest_mtime = current_mtime
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
