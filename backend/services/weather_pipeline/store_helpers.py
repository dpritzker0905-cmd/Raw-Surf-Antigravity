import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Tuple, Optional

from services.weather_pipeline.schemas import PipelineManifest, NormalizedProduct, ManifestProduct
from services.weather_pipeline.copernicus_validator import is_test_environment

logger = logging.getLogger(__name__)


def _icon_wind_native_horizon_h() -> float:
    try:
        return float(os.environ.get("ICON_WIND_NATIVE_HORIZON_H", "180"))
    except ValueError:
        return 180.0


def icon_wind_overclaims_native_horizon(p, now_utc: datetime, horizon_h: float) -> bool:
    """True when an ICON wind AUTHORITATIVE product claims a valid_time beyond what the model can
    natively forecast FROM ITS OWN RUN (+6h slack for ingest-stamped run times). Guards the
    original defect class — cyclic-fill leftovers mislabeled authoritative out to +336h — without
    the two mistakes the old rule made (2026-07-30, the "blank day" family): a 120h horizon (the
    open-meteo path's figure; the production DWD-direct path delivers real 3-hourly natives to
    run+180h, so the FIRST restore after every ingest destroyed the last ~60h of real data) and a
    wall-clock-relative cutoff (`now + 120h`), which made what survives depend on WHEN a box
    restarted rather than on what the model produced. Net live state: natives ended near
    now+120h while the estimated tail stayed anchored at the old run+181h — a 46h dead hole,
    13 lattice slots with nothing within 3h: the user-visible "blank day". A product without a
    run_time falls back to the wall-clock reference, the lenient direction."""
    if not (
        p.model.upper() == "ICON"
        and p.domain.lower() == "wind"
        and p.layer.lower() == "wind"
        and not getattr(p, "is_estimated", False)
    ):
        return False
    anchor = getattr(p, "run_time", None) or now_utc
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    valid = p.valid_time_start
    if valid.tzinfo is None:
        valid = valid.replace(tzinfo=timezone.utc)
    return valid > anchor + timedelta(hours=horizon_h + 6.0)


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


def raw_run_time_newer(raw: dict, mine) -> bool:
    """True if a RAW remote manifest entry's run_time is strictly newer than ours.

    Read straight off the raw dict so the common non-colliding path never pays full model
    validation (the manifest carries ~15k entries). Returns False on ANYTHING unparseable — an
    unreadable timestamp must never displace a known-good local entry.
    """
    try:
        rt = raw.get("run_time")
        theirs = rt if isinstance(rt, datetime) else datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
        theirs = theirs if theirs.tzinfo else theirs.replace(tzinfo=timezone.utc)
        return theirs > (mine if mine.tzinfo else mine.replace(tzinfo=timezone.utc))
    except Exception:
        return False


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
    from services.weather_pipeline.store import (
        _upload_executor, _manifest_executor, ProductStore, dump_manifest_for_l2,
        reconcile_manifest_products_for_upload,
    )

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
            reconcile_manifest_products_for_upload(manifest)
            manifest_json = dump_manifest_for_l2(manifest)
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit failed: {e}")

    with ProductStore._product_cache_lock:
        ProductStore._product_cache.pop(filename, None)

    return filename


def save_products_batch_helper(store, products_to_save: List[Tuple[NormalizedProduct, float]]) -> int:
    """Helper implementing ProductStore.save_products_batch: bulk atomic write + L2 + single manifest update."""
    from services.weather_pipeline.store import (
        _upload_executor, _manifest_executor, ProductStore, dump_manifest_for_l2,
        reconcile_manifest_products_for_upload,
    )

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
    failed_count = 0
    has_non_tf = False

    for product, resolution in products_to_save:
        # PER-ITEM ISOLATION (2026-07-20 bug-class sweep, the f9c5e59a blast-radius shape,
        # skeptic-confirmed): this loop had NO try/except, so one escaping error (the live
        # trigger: _upload_executor.submit raising RuntimeError('cannot schedule new futures
        # after interpreter shutdown') when a CI run is cancelled mid-batch) aborted before
        # _save_manifest below — the REST of the batch was lost AND every already-written
        # item became an unregistered orphan on L1/L2 (the phantom-manifest-entry shape).
        # One bad product must cost exactly one product; the manifest write for the saved
        # subset must always be reached.
        try:
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
        except Exception as e:
            failed_count += 1
            logger.error(
                f"[Product Store] Batch-save item failed (product_id="
                f"{getattr(product, 'product_id', None)!r}): {type(e).__name__}: {e}"
            )

    if failed_count:
        logger.error(
            f"[Product Store] Batch save completed with {failed_count} failed item(s); "
            f"{success_count} saved and registered."
        )

    manifest.products = list(dict_by_slice.values())
    store._save_manifest(manifest)

    # Upload updated manifest to Supabase (L2)
    if has_non_tf:
        try:
            reconcile_manifest_products_for_upload(manifest)
            manifest_json = dump_manifest_for_l2(manifest)
            _manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)
        except Exception as e:
            logger.warning(f"[Product Store] Manifest L2 upload submit failed in batch: {e}")

    with ProductStore._product_cache_lock:
        for product, _ in products_to_save:
            # getattr, not direct access: failed items may be arbitrary objects, and an
            # exception HERE (after the manifest write) would skip the remaining cache
            # invalidations — stale pre-overwrite copies would serve from L1 up to the TTL.
            pid = getattr(product, "product_id", None) if product else None
            if pid:
                ProductStore._product_cache.pop(pid, None)

    return success_count

def restore_from_supabase_helper(store) -> Tuple[int, List[str]]:
    """Helper implementing restore_from_supabase for ProductStore."""
    from services.weather_pipeline.store import _get_supabase_storage, WEATHER_BUCKET, ProductStore
    # COLD-START flag (2026-07-06, chip task_e618f9ff): requests race this restore on every
    # deploy — grid_series reads it to extend its per-hour budget and mark empty responses
    # `warming` (an empty series mid-restore is an artifact, not "no coverage"). Class attr,
    # same pattern as _restore_errors/_last_restore_time; ALWAYS cleared in the finally.
    ProductStore._restore_in_progress = True
    try:
        return _restore_from_supabase_inner(store)
    finally:
        ProductStore._restore_in_progress = False


def _restore_from_supabase_inner(store) -> Tuple[int, List[str]]:
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

    # Step 1: Download manifest — CACHE-BUSTED (2026-07-06, the stale-manifest root): the client
    # .download() hit Supabase's CDN, whose edges held manifest.json copies up to an HOUR stale
    # (upload-time max-age 3600) and inconsistently — the serve box's periodic restore oscillated
    # between manifest versions and the rebuilt EURO estimated tail vanished from serving after
    # briefly appearing. A unique query param bypasses every edge copy; request no-cache headers
    # are belt-and-braces. Falls back to the plain client download on any failure.
    manifest_data = None
    try:
        manifest_bytes = None
        # S2 pointer-first read: resolve the Postgres pointer and GET the immutable run-keyed
        # manifest (plain GET — correct on any CDN edge by construction). Falls through to the
        # legacy cache-busted manifest.json on ANY failure, including pointer-table-not-yet-
        # migrated. Kill: MANIFEST_POINTER=0.
        try:
            from services.weather_pipeline.manifest_pointer import fetch_pointed_manifest
            manifest_bytes = fetch_pointed_manifest()
        except Exception as ptr_err:
            logger.warning(f"[Product Store] pointer-first manifest read failed ({ptr_err}); using legacy path")
        if manifest_bytes is None:
            try:
                import requests
                from services.weather_pipeline.store import manifest_download_url
                base = os.environ.get("SUPABASE_URL", "").rstrip("/")
                key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
                if base and key:
                    resp = requests.get(
                        manifest_download_url(base, WEATHER_BUCKET),
                        headers={"Authorization": f"Bearer {key}", "apikey": key,
                                 "Cache-Control": "no-cache", "Pragma": "no-cache"},
                        timeout=30,
                    )
                    if resp.status_code == 200:
                        manifest_bytes = resp.content
                    else:
                        logger.warning(f"[Product Store] Cache-busted manifest GET -> HTTP {resp.status_code}; falling back to client download")
            except Exception as cb_err:
                logger.warning(f"[Product Store] Cache-busted manifest GET failed ({cb_err}); falling back to client download")
        if manifest_bytes is None:
            manifest_bytes = sb.storage.from_(WEATHER_BUCKET).download("manifest.json")
        if manifest_bytes:
            # ⭐⭐⭐ IDENTITY SKIP (2026-08-11, the RSS ratchet). MEASURED on the live box: RSS grew
            # +74.8 MB then +76.6 MB across two consecutive 25-min windows while
            # `disk_product_count` sat FLAT at 618 — so it was not traffic. The periodic restore
            # fired at 01:11:21 and 01:41:23 (interval[0:30:00]), exactly one per window, and each
            # re-parses a 20,007-entry manifest: json.loads (~17 MB dict) + model_validate (~93 MB
            # model) + model_dump_json (a full re-serialisation) while the OLD cached manifest is
            # still referenced. ~200 MB transient, ~75 MB of it never returned.
            #
            # And it is almost always for NOTHING: the manifest is written by the ingest workflow,
            # which runs every ~3-4 h, against a restore that runs every 30 min — so roughly 7 of
            # every 8 restores re-parse a BYTE-IDENTICAL file. Hash the downloaded bytes and skip
            # the whole parse/serialise/write cycle when they have not changed.
            #
            # ★ THE HASH IS OF THE DOWNLOADED BYTES, i.e. the INPUT. Everything below transforms
            # that input deterministically (fixture merge, is_test_fixture filter, ICON horizon
            # purge), so identical input => identical result, and skipping is sound.
            # ⚠️ ONE EDGE, STATED: the ICON purge takes `now_utc`, but its cutoff is RUN-relative
            # by deliberate design (see its comment below — wall-clock was the "blank day" bug), so
            # it is time-invariant for a fixed input. The ONLY time-dependent case is a product
            # with no run_time, which falls back to wall-clock; skipping can leave such a product
            # in place one cycle longer. That is the lenient direction the purge itself prefers
            # ("never deletes legitimately fetched data").
            # Kill: MANIFEST_RESTORE_SKIP_UNCHANGED=0 restores the unconditional re-parse.
            if os.environ.get("MANIFEST_RESTORE_SKIP_UNCHANGED", "1") != "0":
                import hashlib
                digest = hashlib.sha256(manifest_bytes).hexdigest()
                if (digest == getattr(ProductStore, "_last_manifest_sha", None)
                        and ProductStore._cached_manifest is not None
                        and store.manifest_path.exists()):
                    ProductStore._last_restore_time = datetime.now(timezone.utc).isoformat()
                    ProductStore._restore_errors = errors
                    logger.info(
                        "[Product Store] L2 restore: manifest UNCHANGED (sha %s) — skipped the "
                        "re-parse of %d entries. %d products remain available on demand.",
                        digest[:12], len(ProductStore._cached_manifest.products),
                        ProductStore._restored_count)
                    return ProductStore._restored_count, errors
                ProductStore._pending_manifest_sha = digest
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

        # Startup hygiene: purge ICON wind AUTH products that claim more forecast than the model
        # can natively produce FROM THEIR OWN RUN. Guards against the original defect class:
        # cyclic-fill leftovers mislabeled authoritative out to +336h. Two corrections baked in
        # (2026-07-30, the "blank day" family): the horizon is 180h — the production DWD-direct
        # path delivers real 3-hourly natives to run+180h (120h was the open-meteo path's figure,
        # so this rule deleted the last 60h of real data every startup) — and the cutoff must be
        # RUN-relative, never wall-clock-relative: `now + horizon` slid forward with every
        # restart, trimming surviving natives deeper while the estimated tail stayed fixed, which
        # opened a widening dead hole mid-timeline (measured live: 46h / 13 lattice slots with
        # nothing within 3h — the user-visible "blank day"). A product without a run_time falls
        # back to the wall-clock reference, which is the lenient direction (never deletes
        # legitimately fetched data).
        now_utc = datetime.now(timezone.utc)
        _icon_native_horizon_h = _icon_wind_native_horizon_h()
        pre_purge_count = len(manifest.products)
        manifest.products = [
            p for p in manifest.products
            if not icon_wind_overclaims_native_horizon(p, now_utc, _icon_native_horizon_h)
        ]
        purged = pre_purge_count - len(manifest.products)
        if purged > 0:
            logger.info(
                f"[Product Store] Startup hygiene: Purged {purged} ICON wind AUTH products claiming "
                f"beyond run+{_icon_native_horizon_h:.0f}h native horizon"
            )
        
        with open(store.manifest_path, "w") as f:
            f.write(manifest.model_dump_json(indent=2))
        try:
            current_mtime = store.manifest_path.stat().st_mtime
        except Exception:
            current_mtime = 0.0
        with ProductStore._manifest_lock:
            ProductStore._cached_manifest = manifest
            ProductStore._cached_manifest_mtime = current_mtime
        # Only commit the identity hash once the parse+write actually SUCCEEDED. Committing it
        # earlier would let a failed restore poison the skip: the next cycle would match the hash,
        # skip, and leave the box on a manifest that was never loaded.
        _pending = getattr(ProductStore, "_pending_manifest_sha", None)
        if _pending:
            ProductStore._last_manifest_sha = _pending
            ProductStore._pending_manifest_sha = None
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


# Names `load_product_helper` needs from the store module. Imported INSIDE the function to keep
# the store <-> store_helpers pair free of an import cycle (store_helpers is imported lazily by
# store's delegators for exactly that reason).
def load_product_helper(store, filename: str, stride: Optional[int] = None) -> Optional[NormalizedProduct]:
    """Loads and returns a stored grid product by filename.

    ``stride`` (>1) decimates the grid BEFORE `model_validate`, so the discarded cells are
    never turned into `GridVector` models. Default None keeps all 36 existing call sites
    byte-identical. Measured: a cold global series constructs ~525k vectors for ~210 MB
    resident; the warm repeat constructs almost nothing and costs +2.0 MB.

    ⚠️⚠️ A strided product must NEVER land under the full grid's cache key — `_product_cache`
    hands out SHALLOW copies to the point lane, spot ratings and the gulf fill, so a decimated
    entry there would be silently wrong for every later reader. Hence `filename#sN`.

    Kill switch: SERIES_LOAD_STRIDE=0. Full rationale + the four guarded hazards:
    docs/research/DESIGN-2026-08-10-the-grid-series-load-time-stride.md
    """
    import time
    import threading
    from services.weather_pipeline.store import (
        ProductStore, WEATHER_BUCKET, _get_supabase_storage,
        _effective_load_stride, _stride_raw_grid_dicts,
    )

    stride = _effective_load_stride(stride)
    # Strided reads get their OWN cache identity. See the warning above — this one line is what
    # keeps a decimated grid out of every other consumer's hands.
    cache_key = filename if stride <= 1 else f"{filename}#s{stride}"

    # 1. Check in-memory product cache
    now = time.time()
    with ProductStore._product_cache_lock:
        if cache_key in ProductStore._product_cache:
            cached_product, cached_time = ProductStore._product_cache[cache_key]
            if now - cached_time < ProductStore._PRODUCT_CACHE_TTL:
                logger.debug(f"[Product Store] Memory cache HIT for {cache_key}")
                # Shallow copy product and grid container to avoid deep-copying vector list
                cloned = cached_product.model_copy()
                if cloned.grid is not None:
                    cloned.grid = cloned.grid.model_copy()
                return cloned
            else:
                ProductStore._product_cache.pop(cache_key, None)
                ProductStore._product_cache_vectors.pop(cache_key, None)

    filepath = store.cache_dir / filename
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
            # ── THE CONSTRUCTION SEAM (2026-08-10) ────────────────────────────────────────
            # `model_validate` below is where a product's cells become GridVector models —
            # ~420 B of resident growth each, measured. Striding the RAW DICTS first means the
            # discarded cells are never modelled. Doing it after this line would shrink the
            # document and leave the cost, which is the defect this exists to remove.
            _stride_raw_grid_dicts(data, stride)
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
                ProductStore._product_cache[cache_key] = (product, time.time())
                ProductStore._product_cache_vectors[cache_key] = nvec

            cloned = product.model_copy()
            if cloned.grid is not None:
                cloned.grid = cloned.grid.model_copy()
            return cloned
    except Exception as e:
        logger.error(f"[Product Store] Stored product load and parse failed for {filename}: {e}")
        return None
