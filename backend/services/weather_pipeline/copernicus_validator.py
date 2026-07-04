import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from services.weather_pipeline.schemas import (
    NormalizedProduct, PipelineManifest, ManifestProduct, CoverageBounds
)

logger = logging.getLogger(__name__)

def is_test_environment() -> bool:
    import sys
    is_pytest = "pytest" in sys.modules
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod = (node_env == "production" or env == "production" or os.environ.get("IS_PROD", "").lower() == "true")
    if is_pytest and is_prod:
        return False
    if os.environ.get("LOCAL_TEST_FIXTURE", "").lower() == "true":
        return True
    if is_prod:
        return False
    return node_env == "test" or os.environ.get("TESTING") == "1"


def validate_copernicus_product_helper(
    store,
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

    if product.domain.lower() != "marine":
        return True, "Valid (Not a marine product)"

    is_test_env = is_test_environment()
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
        if product.provider not in ("estimated", "open-meteo", "gfs_estimated_fallback", "copernicus"):
            return False, f"Estimated product provider must be estimated, open-meteo, or gfs_estimated_fallback, got {product.provider}"
        if not product.is_estimated:
            return False, "Estimated product is_estimated must be True"
        if product.is_forecast_authoritative and product.provider != "copernicus":
            return False, "Estimated product is_forecast_authoritative must be False"
        allowed_datasets = (
            "estimated_blend", "open_meteo_fallback", "gfs_estimated_fallback",
            "ecmwf_wam025", "ncep_gfswave025", "dwd_gwam", "gfs_seamless", "dwd_icon", "ecmwf_ifs",
            "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
        )
        if product.source_dataset not in allowed_datasets:
            return False, f"Estimated product source_dataset must be in {allowed_datasets}, got {product.source_dataset}"
        
        basis = getattr(product, "estimate_basis", None)
        if not basis:
            return False, "Estimated product missing estimate_basis"
        
        basis_type = basis.get("type") if isinstance(basis, dict) else getattr(basis, "type", None)
        if basis_type not in (
            "euro_persistence_gfs_icon_blend", "euro_persistence_gfs_blend",
            "open_meteo_fallback", "gfs_estimated_fallback",
            "ecmwf_ifs_derived_fallback", "gfs_derived_fallback"
        ):
            return False, f"Estimated product estimate_basis type must be allowed, got {basis_type}"
        
        if basis_type not in ("open_meteo_fallback", "gfs_estimated_fallback", "ecmwf_ifs_derived_fallback", "gfs_derived_fallback"):
            if not manifest:
                manifest = store.get_manifest()
                
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
        diag_vector_count = diag.get("vectorCount") if diag.get("vectorCount") is not None else diag.get("vectors_length")
        if diag_vector_count != actual_len:
            return False, f"Grid diagnostics mismatch: vectorCount = {diag_vector_count}, got len(vectors) = {actual_len}"
            
        nonzero_count = diag.get("nonzeroCount", 0)
        if not (0 <= nonzero_count <= actual_len):
            return False, f"Grid diagnostics mismatch: nonzeroCount = {nonzero_count} must be between 0 and {actual_len}"
            
        if product.layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") and nonzero_count == 0 and not is_test_env:
            return False, f"Estimated marine product cannot be empty (nonzeroCount == 0)"
            
        return True, "Valid estimated product"

    # 2. Authoritative products validation
    if is_tf and not is_test_env:
        return False, "Product is explicitly marked as a test fixture or provider is 'test-fixture'"

    if not is_tf and not product.is_forecast_authoritative:
        return False, "Product has is_forecast_authoritative == False"

    src_dataset = getattr(product, "source_dataset", None)
    if not src_dataset:
        src_dataset = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
        product.source_dataset = src_dataset

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

    if not (is_test_env or is_tf):
        warnings_str = " ".join(product.warnings or []).lower()
        if any(keyword in warnings_str for keyword in ["mock", "synthetic", "test"]):
            return False, f"Warnings metadata indicates synthetic/mock data: '{warnings_str}'"

        if product.grid:
            vectors = product.grid.vectors
            if len(vectors) > 1:
                unique_lats = sorted(list(set(v.lat for v in vectors)))
                if len(unique_lats) > 1:
                    res_diff = unique_lats[1] - unique_lats[0]
                    if abs(res_diff - 1.5) < 0.01:
                        return False, f"Grid resolution {res_diff}° matches mock resolution (1.5°)"

    return True, "Valid real Copernicus product"


def quarantine_invalid_copernicus_products_helper(store):
    """
    Scans all files on disk matching Copernicus names and manifest entries.
    Validates them, and moves invalid ones to a quarantine directory.
    """
    logger.info("[Product Store] Starting selective validation and quarantine scan for Copernicus products...")
    quarantine_dir = store.cache_dir / "quarantine"
    if not quarantine_dir.exists():
        quarantine_dir.mkdir(parents=True, exist_ok=True)

    manifest = store.get_manifest()
    manifest_updated = False
    remaining_products = []

    files = []
    if store.cache_dir.exists():
        try:
            files = [f for f in os.listdir(store.cache_dir) if f.startswith("euro_marine_") and f.endswith(".json")]
        except Exception as e:
            logger.error(f"[Product Store] Failed to list cache directory for quarantine: {e}")

    validated_files = {}

    for filename in files:
        filepath = store.cache_dir / filename
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
            
            try:
                product = NormalizedProduct.model_validate(data)
                valid, reason = store.validate_copernicus_product(product, manifest)
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

    for p in manifest.products:
        is_copernicus = (p.domain.lower() == "marine") and (p.model.upper() == "EURO" or p.provider == "copernicus" or (p.provider == "test-fixture" and p.model.upper() == "EURO"))
        if is_copernicus:
            is_valid = validated_files.get(p.filename, True)
            if not is_valid:
                logger.warning(f"[Product Store] Removing invalid product registry '{p.filename}' from manifest.")
                manifest_updated = True
                filepath = store.cache_dir / p.filename
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
        store._save_manifest(manifest)
        logger.info("[Product Store] Updated manifest registry after quarantine scan.")
    else:
        logger.info("[Product Store] Quarantine scan complete. No products quarantined.")


def prune_old_products_helper(store, before_time: datetime):
    """Cleans up old JSON product files that fall before the cutoff date."""
    from services.weather_pipeline.store import _upload_executor, _manifest_executor
    manifest = store.get_manifest()
    manifest.last_manifest_update = datetime.now(timezone.utc)

    remaining_products = []
    for p in manifest.products:
        if p.valid_time_start < before_time:
            filepath = store.cache_dir / p.filename
            if filepath.exists():
                try:
                    os.remove(filepath)
                    logger.info(f"[Product Store] Pruned old product file: {p.filename}")
                except Exception as e:
                    logger.warning(f"[Product Store] Failed to delete pruned file {p.filename}: {e}")
            _upload_executor.submit(store._delete_from_supabase, p.filename)
        else:
            remaining_products.append(p)

    manifest.products = remaining_products
    store._save_manifest(manifest)
    try:
        manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
        _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
    except Exception as e:
        logger.warning(f"[Product Store] Manifest L2 upload submit after prune failed: {e}")


def prune_duplicate_valid_times_helper(store) -> int:
    """Manifest-wide sweep (2026-07-04, manifest-bloat audit): for every
    (model, domain, layer, region, valid_time) keep ONLY the product with the newest run_time and
    delete older duplicates from manifest/disk/L2. Returns the number pruned.

    WHY: per-layer prune_superseded_products only runs after a layer's save loop completes, so a
    CANCELLED ingestion run (concurrency-superseded — the audited 2h45m cancellation) uploads its
    early hours and never prunes; over cycles GFS accumulated ~763 products/layer (~6-7 run
    generations) vs EURO 112, bloating the manifest every client downloads at boot. Per-valid_time
    dedup is SAFE where a blanket run_time prune is not: hours only an OLDER run covers (a newer
    cancelled run stopped early) keep their only product — no coverage loss, only true duplicates go.
    """
    from services.weather_pipeline.store import _upload_executor, _manifest_executor
    manifest = store.get_manifest()

    best = {}
    for p in manifest.products:
        key = (
            p.model.upper(), p.domain.lower(), p.layer.lower(),
            p.region_id or getattr(p, "coverage_mode", None) or "",
            p.valid_time_start,
        )
        cur = best.get(key)
        if cur is None or (p.run_time and cur.run_time and p.run_time > cur.run_time):
            best[key] = p

    keep = set(id(p) for p in best.values())
    remaining = []
    pruned = 0
    for p in manifest.products:
        if id(p) in keep:
            remaining.append(p)
            continue
        filepath = store.cache_dir / p.filename
        if filepath.exists():
            try:
                os.remove(filepath)
            except Exception as e:
                logger.warning(f"[Product Store] Failed to delete duplicate-valid_time file {p.filename}: {e}")
        _upload_executor.submit(store._delete_from_supabase, p.filename)
        pruned += 1

    if pruned > 0:
        manifest.products = remaining
        manifest.last_manifest_update = datetime.now(timezone.utc)
        store._save_manifest(manifest)
        try:
            manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit after duplicate sweep failed: {e}")
        logger.info(f"[Product Store] Duplicate-valid_time sweep pruned {pruned} superseded products.")
    else:
        logger.info("[Product Store] Duplicate-valid_time sweep found no duplicates.")
    return pruned


def prune_superseded_products_helper(
    store, model: str, domain: str, layer: str, region_id: str, latest_run_time: datetime
):
    """Removes older superseded runs from manifest and disk/Supabase."""
    from services.weather_pipeline.store import _upload_executor, _manifest_executor
    manifest = store.get_manifest()
    manifest.last_manifest_update = datetime.now(timezone.utc)

    remaining_products = []
    pruned_count = 0
    for p in manifest.products:
        region_match = (
            p.region_id == region_id
            or (region_id and p.region_id is None and getattr(p, "coverage_mode", None) == "global_tile")
        )
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
            and region_match
            and p.run_time < latest_run_time
        ):
            filepath = store.cache_dir / p.filename
            if filepath.exists():
                try:
                    os.remove(filepath)
                    logger.info(f"[Product Store] Pruned superseded product file: {p.filename}")
                except Exception as e:
                    logger.warning(f"[Product Store] Failed to delete pruned file {p.filename}: {e}")
            _upload_executor.submit(store._delete_from_supabase, p.filename)
            pruned_count += 1
        else:
            remaining_products.append(p)

    if pruned_count > 0:
        manifest.products = remaining_products
        store._save_manifest(manifest)
        try:
            manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
            logger.info(f"[Product Store] Manifest L2 uploaded submit after pruning {pruned_count} superseded products.")
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit after prune failed: {e}")
