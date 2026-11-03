import os
import json
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from services.weather_pipeline.schemas import (
    NormalizedProduct, PipelineManifest, ManifestProduct, CoverageBounds
)

from services.weather_pipeline.prune_object_protection import retained_prune_references, delete_pruned_object
logger = logging.getLogger(__name__)


def _validate_lattice_basis(store, product, manifest):
    """Accept only bounded interpolation backed by two real, matching native frames."""
    basis = product.estimate_basis
    try:
        if not isinstance(basis, dict) or basis.get("type") != "native_time_interpolation":
            raise ValueError("missing native interpolation basis")
        if product.is_forecast_authoritative or product.provider != "estimated":
            raise ValueError("interpolation must be non-authoritative and estimated")
        ta, tb = (datetime.fromisoformat(basis[key].replace("Z", "+00:00"))
                  for key in ("bracket_a_valid_time", "bracket_b_valid_time"))
        slot = product.valid_time
        weight = float(basis["weight"])
        if not all(t.tzinfo is not None for t in (ta, tb, slot)):
            raise ValueError("unqualified bracket time")
        if not (ta < slot < tb and (tb-ta).total_seconds() <= 21600):
            raise ValueError("invalid or wider than six-hour brackets")
        if not math.isfinite(weight) or not 0 < weight < 1 or abs(weight-(slot-ta)/(tb-ta)) > 0.0001:
            raise ValueError("interpolation weight disagrees with times")
        manifest = manifest or store.get_manifest()
        parents = []
        from services.weather_pipeline.lattice_fill import _grids_compatible
        for key, time in (("bracket_a_product_id", ta), ("bracket_b_product_id", tb)):
            ref = basis.get(key)
            row = next((p for p in manifest.products if ref and ref in (p.product_id, p.filename)), None)
            if row is None:
                raise ValueError("bracket absent from manifest")
            parent = store.load_product(row.filename)
            if (parent is None or parent.is_test_fixture or parent.provider == "test-fixture"
                    or parent.is_estimated or not parent.is_forecast_authoritative
                    or parent.valid_time != time
                    or any(getattr(parent, k) != getattr(product, k)
                           for k in ("model", "domain", "layer", "region_id"))
                    or not _grids_compatible(parent, product)):
                raise ValueError("bracket is not a matching native frame")
            parents.append(parent)
        if (any(p.model_run_time_status != "known" or p.model_run_time is None for p in parents)
                or parents[0].model_run_time != parents[1].model_run_time
                or product.model_run_time_status != "known"
                or product.model_run_time != parents[0].model_run_time):
            raise ValueError("bracket model cycles disagree or are unknown")
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        return False, f"Invalid lattice interpolation: {exc}"
    return True, "Valid bounded native interpolation"

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
        lattice = (os.environ.get("EURO_MARINE_LATTICE_VALIDATION", "0") == "1"
                   and product.source_dataset == "estimated_interpolation")
        if lattice:
            valid, reason = _validate_lattice_basis(store, product, manifest)
            if not valid:
                return valid, reason
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
        if product.source_dataset not in allowed_datasets and not lattice:
            return False, f"Estimated product source_dataset must be in {allowed_datasets}, got {product.source_dataset}"
        
        basis = getattr(product, "estimate_basis", None)
        if not basis:
            return False, "Estimated product missing estimate_basis"
        
        basis_type = basis.get("type") if isinstance(basis, dict) else getattr(basis, "type", None)
        if basis_type not in (
            "euro_persistence_gfs_icon_blend", "euro_persistence_gfs_blend",
            "open_meteo_fallback", "gfs_estimated_fallback",
            "ecmwf_ifs_derived_fallback", "gfs_derived_fallback"
        ) and not lattice:
            return False, f"Estimated product estimate_basis type must be allowed, got {basis_type}"
        
        if not lattice and basis_type not in ("open_meteo_fallback", "gfs_estimated_fallback", "ecmwf_ifs_derived_fallback", "gfs_derived_fallback"):
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
    # COPERNICUS_PEAK_PERIOD stores the total period from VTPK (cmems_period_map); either period variable is a valid
    # waves product, so products written before and after a flip both validate.
    if layer == "waves" and "VTPK" in actual_vars:
        expected_vars = (expected_vars - {"VTM10"}) | {"VTPK"}
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
    from services.weather_pipeline.manifest_publish_step import absorb_published_head, submit_manifest_publish
    manifest = store.get_manifest()
    absorb_published_head(manifest)
    manifest.last_manifest_update = datetime.now(timezone.utc)

    remaining_products = [p for p in manifest.products if not p.valid_time_start < before_time]
    protected_files, protected_keys = retained_prune_references(remaining_products)
    pruned_keys = set()
    for p in manifest.products:
        if p.valid_time_start < before_time:
            delete_pruned_object(store, p, protected_files)
            pruned_keys.add(p.product_id or p.filename)

    pruned_keys.difference_update(protected_keys)

    manifest.products = remaining_products
    store._save_manifest(manifest)
    try:
        # exclude_keys: the entries just deleted are still in the remote manifest — folding them
        # back would resurrect dangling references to L2 objects we just destroyed (audit #28).
        submit_manifest_publish(store, manifest, exclude_keys=pruned_keys)
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
    if os.environ.get('INGEST_PRUNE_VERIFIED_CYCLES', '0') == '1':
        from services.weather_pipeline.prune_verified_cycles import prune_verified_cycles
        return prune_verified_cycles(store)
    from services.weather_pipeline.manifest_publish_step import absorb_published_head, submit_manifest_publish
    manifest = store.get_manifest()
    absorb_published_head(manifest)

    # PROVENANCE-AWARE ranking (2026-07-06, the EURO waves lane wipe — run 28786800982): a failed
    # CMEMS fetch made the native job save ESTIMATED fallbacks with a newer run_time; a pure
    # newest-run_time rule let them displace the healthy natives at the same valid_times. At one
    # valid_time an AUTHORITATIVE product now beats any estimated regardless of run_time; among
    # same-provenance duplicates newest run_time still wins.
    def _rank(prod):
        rt = prod.run_time or datetime.min.replace(tzinfo=timezone.utc)
        return (1 if prod.is_forecast_authoritative else 0, rt)

    best = {}
    for p in manifest.products:
        key = (
            p.model.upper(), p.domain.lower(), p.layer.lower(),
            p.region_id or getattr(p, "coverage_mode", None) or "",
            p.valid_time_start,
        )
        cur = best.get(key)
        if cur is None or _rank(p) > _rank(cur):
            best[key] = p

    keep = set(id(p) for p in best.values())
    from services.weather_pipeline import rollout_675 as _rollout
    keep.update(id(p) for p in manifest.products if _rollout.read_only(p))   # non-owning lane: owned entries are read-only
    protected_files, protected_keys = retained_prune_references([p for p in manifest.products if id(p) in keep])
    remaining = []
    pruned = 0
    pruned_keys = set()
    for p in manifest.products:
        if id(p) in keep:
            remaining.append(p)
            continue
        delete_pruned_object(store, p, protected_files)
        pruned_keys.add(p.product_id or p.filename)
        pruned += 1

    pruned_keys.difference_update(protected_keys)

    if pruned > 0:
        manifest.products = remaining
        manifest.last_manifest_update = datetime.now(timezone.utc)
        store._save_manifest(manifest)
        try:
            submit_manifest_publish(store, manifest, exclude_keys=pruned_keys)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit after duplicate sweep failed: {e}")
        logger.info(f"[Product Store] Duplicate-valid_time sweep pruned {pruned} superseded products.")
    else:
        logger.info("[Product Store] Duplicate-valid_time sweep found no duplicates.")
    return pruned


def prune_superseded_products_helper(
    store, model: str, domain: str, layer: str, region_id: str, latest_run_time: datetime
):
    """Removes older superseded runs from manifest and disk/Supabase.

    PROVENANCE GUARD (2026-07-06, the EURO waves lane wipe — run 28786800982): a failed CMEMS
    waves fetch made the native job save ESTIMATED fallbacks, and this prune — keyed on
    run_time alone — then deleted the healthy natives from the prior run AND the 241-336h
    estimated tail (the extended-estimates anchor pool went empty, killing the lane).
    AUTHORITATIVE products are now only superseded by a NEWER AUTHORITATIVE run in the same
    lane. Lanes with no estimated products (wind/pressure/GFS) behave exactly as before
    (latest authoritative == latest run).

    INGEST-WINDOW CONTINUITY (2026-07-10, the far-horizon estimate gap — run 29052535445):
    estimated products used to keep the plain newest-run rule, so the NATIVE save's prune
    (~T+55min into the cycle) deleted last cycle's 241-336h estimated tail while its only
    regenerator — the extended-estimates job — runs ~T+75min and its L2 manifest lands ~T+95min:
    a ~35-45 min far-horizon outage EVERY 4h cycle (in-job GFS-ext saves 0 in production).
    Estimated products are now only superseded by a NEWER ESTIMATED generation in the lane
    (write-new-then-delete-old): the old tail keeps serving until the new one exists, then the
    next prune / cycle-end duplicate sweep (provenance-aware) removes it. Edge accepted: a
    fallback batch of NEW estimates that spans less than the old tail still supersedes it by
    run-time class rule (same as before; the extend job re-covers within the cycle).
    Kill switch INGEST_PRUNE_PRESERVE_ESTIMATES=0 restores the plain newest-run rule (operator
    lever to purge a poisoned estimated generation with one healthy native run).
    """
    if os.environ.get('INGEST_PRUNE_VERIFIED_CYCLES', '0') == '1':
        from services.weather_pipeline.prune_verified_cycles import prune_verified_cycles

        def lane(product):
            return (product.model.upper() == model.upper() and product.domain.lower() == domain.lower()
                    and product.layer.lower() == layer.lower()
                    and (product.region_id == region_id
                         or (region_id and product.region_id is None and product.coverage_mode == 'global_tile')))

        return prune_verified_cycles(store, lane)
    from services.weather_pipeline.manifest_publish_step import absorb_published_head, submit_manifest_publish
    manifest = store.get_manifest()
    absorb_published_head(manifest)
    manifest.last_manifest_update = datetime.now(timezone.utc)

    def _lane_match(p):
        region_match = (
            p.region_id == region_id
            or (region_id and p.region_id is None and getattr(p, "coverage_mode", None) == "global_tile")
        )
        return (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
            and region_match
        )

    latest_auth_run_time = None
    latest_est_run_time = None
    for p in manifest.products:
        if _lane_match(p) and p.run_time is not None:
            if p.is_forecast_authoritative:
                if latest_auth_run_time is None or p.run_time > latest_auth_run_time:
                    latest_auth_run_time = p.run_time
            elif latest_est_run_time is None or p.run_time > latest_est_run_time:
                latest_est_run_time = p.run_time

    preserve_estimates = os.environ.get("INGEST_PRUNE_PRESERVE_ESTIMATES", "1") != "0"
    # PRUNE AFTER REPLACE (item 15, 2026-11-01): the lane rule above still lets the native save's prune delete the whole
    # previous estimated generation as soon as it writes ANY newer estimate. The EURO coarse save writes a short GFS-ext
    # tail, so at 16:05:52Z on 10-27 it deleted 112 estimated objects that the extended-estimates stage only re-created
    # from 16:28:19Z: about 22 min a cycle with no EURO tail product on the /grid path
    # (log/2026-10-27-claude-lead-prune-protect-flip.md, "#590 flags read back"). With this flag an estimate is superseded
    # only once a replacement exists AT ITS VALID TIME: an authoritative product, or an estimate of a newer run. Estimates
    # are time-keyed, so the stage that rewrites them overwrites the same object (MANIFEST_ONE_ENTRY_PER_OBJECT drops the
    # older registration); hours a native now covers go here or in the cycle-end duplicate sweep (authoritative wins).
    # Pairs with LATTICE_FILL_REFRESH_STALE, so a kept interpolation from an older generation is regenerated, not kept.
    # ROLLOUT v2 (2026-11-02, rollout_675.py): in the hosted lanes the new rule runs only behind a dry run + snapshot, with
    # its storage deletes MARKED for the scoped GC; a BLOCKED run prunes no estimate at all (never the old rule instead);
    # the non-owning lane keeps the old rule and never touches owned entries. No run context = #675 as shipped.
    from services.weather_pipeline import rollout_675 as _rollout
    mode = _rollout.prune_mode()
    replace_first = preserve_estimates and mode in ("ungated", "active")
    replaced_at = {}  # valid_time -> (newest authoritative run, newest estimated run) in the lane
    if replace_first:
        for p in manifest.products:
            if _lane_match(p) and p.run_time is not None and p.valid_time_start is not None:
                newest_auth, newest_est = replaced_at.get(p.valid_time_start, (None, None))
                if p.is_forecast_authoritative:
                    if newest_auth is None or p.run_time > newest_auth:
                        newest_auth = p.run_time
                elif newest_est is None or p.run_time > newest_est:
                    newest_est = p.run_time
                replaced_at[p.valid_time_start] = (newest_auth, newest_est)

    def _replaced(p):
        # A native replaces an estimate only from a run at least as new: an OLDER native at the same hour must not wipe a newer
        # estimated generation (tests/test_manifest_one_step_absorb.py P5: natives at r1, another writer's estimate at r3).
        newest_auth, newest_est = replaced_at.get(p.valid_time_start, (None, None))
        return ((newest_auth is not None and newest_auth >= p.run_time)
                or (newest_est is not None and p.run_time < newest_est))

    def _superseded(p):
        superseded = False
        if _rollout.read_only(p):
            return False
        if _lane_match(p) and p.run_time is not None and p.run_time < latest_run_time:
            if p.is_forecast_authoritative:
                superseded = latest_auth_run_time is not None and p.run_time < latest_auth_run_time
            elif replace_first:
                superseded = _replaced(p)
            elif preserve_estimates and mode == "blocked":
                superseded = False
            elif preserve_estimates:
                superseded = latest_est_run_time is not None and p.run_time < latest_est_run_time
            else:
                superseded = True
        return superseded

    remaining_products = [p for p in manifest.products if not _superseded(p)]
    new_rule = [p for p in manifest.products if mode == "active" and not p.is_forecast_authoritative and _superseded(p)]
    plan = None
    if new_rule:
        plan = _rollout.prune_plan(manifest, new_rule, remaining_products, _lane_match, f"{model}/{domain}/{layer}/{region_id}")
        if _rollout.check_plan(_rollout.current(), plan):
            _rollout.execute(plan)            # records the reasons and turns the run BLOCKED; mutates nothing
            mode, replace_first, new_rule, plan = "blocked", False, [], None
            remaining_products = [p for p in manifest.products if not _superseded(p)]
    deferred = {id(p) for p in new_rule}
    protected_files, protected_keys = retained_prune_references(remaining_products)
    superseded_now = [p for p in manifest.products if _superseded(p)]
    pruned_keys = {p.product_id or p.filename for p in superseded_now}
    pruned_count = len(superseded_now)
    pruned_keys.difference_update(protected_keys)

    def _apply():
        for p in superseded_now:
            if id(p) not in deferred:       # the new rule's storage deletes are MARKED (after publish), never run here
                delete_pruned_object(store, p, protected_files)
        if pruned_count > 0:
            manifest.products = remaining_products
            store._save_manifest(manifest)
            try:
                submit_manifest_publish(store, manifest, exclude_keys=pruned_keys)
                logger.info(f"[Product Store] Manifest L2 uploaded submit after pruning {pruned_count} superseded products.")
            except Exception as e:
                logger.warning(f"[Product Store] Manifest L2 upload submit after prune failed: {e}")

    if plan is None:
        _apply()
    elif not _rollout.execute(plan, publish=_apply):     # snapshot failed: BLOCKED, this call mutates nothing
        return
