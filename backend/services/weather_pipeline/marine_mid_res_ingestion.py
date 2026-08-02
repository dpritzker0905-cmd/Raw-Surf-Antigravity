"""
marine_mid_res_ingestion.py

MID-RESOLUTION global marine ingestion — the z6-7 quality tier (2026-07-05). Between the close-zoom
regional 0.25° tiles and the 10° global_coarse there was a resolution cliff: a z6-7 viewport (span
2-15°) WIDER than any regional tile fell to the 10° global — at an ~8° viewport that's <1 cell across
the screen, so every crest shares one direction (uniform "grid" lattice) and the heatmap is one flat
cell. These jobs pre-compute a finer (~2°, {GFS,ICON,EURO}_MID_RES) global product per marine provider,
saved under region_id 'global_mid'; grid_resolver's Step 3.6 serves it CLIPPED to the viewport so the
client renders it as a regional-quality fine grid.

Extracted from scheduler.py (thin `ingest_*_global_mid` wrappers delegate here) to keep that file under
the 800-LOC ceiling — same pattern as pressure_ingestion / wind_ingestion. Provenance MIRRORS the coarse
siblings exactly (native GFS ncep_gfswave025 / native ICON dwd_gwam / native CMEMS for EURO's primary
horizon) so the normalizer derives is_estimated/source_dataset unchanged — real-vs-estimated truth is
preserved, nothing relabeled.

Since 2026-07-13 this module ALSO hosts the ICON/EURO regional 0.25° PILOT impls (`ingest_icon_
marine_pilot_impl` / `ingest_euro_marine_pilot_impl`) — the close-zoom / rating-band fine tiles.
Both are MULTI-BBOX-FIRST: one whole-globe download pass samples flagship + ALL worldwide regions
(get_all_pilot_regions — no rotation staleness), falling back to the bounded per-region flagship
path when the multi fetch fails.
"""
import os
import logging
from datetime import datetime, timezone

from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_marine_results,
    generate_mock_icon_marine_results,
    normalize_and_save_loop,
)

logger = logging.getLogger(__name__)

_GLOBAL_REGION = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}


def gfs_mid_resolution() -> float:
    """The global_mid output grid, in degrees. Read from ONE place because the fold makes it a
    per-region resolution inside someone else's fetch, not just this job's own argument."""
    return float(os.environ.get("GFS_MID_RES", "2.0"))


def gfs_mid_forecast_days(is_test_env: bool) -> int:
    """14 d MIRRORS ingest_gfs_marine_global's horizon — the forecast timeline must not change
    resolution mid-scrub, and the EURO extended-estimates machinery anchors on these targets. It is
    also what decides WHICH horizon group the fold joins, so it must not be re-derived by eye."""
    return int(os.environ.get("GFS_MID_RES_FORECAST_DAYS", "2" if is_test_env else "14"))


def gfs_mid_folds_into_pilot() -> bool:
    """Does the 2° global_mid tile ride the flagship pilot's multi-bbox pass instead of running its
    own job and re-downloading the identical f000-f336 set?

    ONE expression, imported by BOTH the registration site (scheduler/forecast.py, which must then
    NOT register the standalone job) and the pilot itself. Two copies of a predicate is exactly how
    a job ends up registered twice or nowhere — the duplicated-constant class, which only ever
    diverges on the boundary where someone flips one switch.

    Every clause is a PRECONDITION for the fold to be possible at all: with no NOAA-direct path and
    no multi-bbox pass there is no shared download to ride. Kill switch GFS_MARINE_MID_FOLD=0
    restores the standalone job."""
    return (os.environ.get("GFS_MARINE_MID_RES_INGEST", "1") != "0"
            and os.environ.get("GFS_MARINE_MID_FOLD", "1") != "0"
            and os.environ.get("MARINE_PILOT_MULTI_BBOX", "1") != "0"
            and os.environ.get("GFS_MARINE_NOAA_DIRECT", "1") != "0")


async def save_gfs_marine_global_mid(scheduler, env, run_time, results, resolution,
                                     save_step) -> int:
    """Save a GFS-Wave point set as the global_mid tile: 4 layers, global_tile coverage, per-layer
    prune, then the grid size climatology accumulation.

    EXTRACTED 2026-08-02 so the identical save runs whether the points came from this job's own
    fetch or from the flagship pilot's shared multi-bbox pass — one download, two consumers. A
    second copy of a save loop is how two paths drift apart (the same reasoning that keeps the
    multi-region spawn plumbing threaded through ONE subprocess helper). Caller owns
    `_cleanup_and_pause`, because the pilot already does it per region."""
    total_saved = 0
    for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="GFS", provider="open-meteo", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] GFS {layer} global_mid"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} GFS {layer} global mid-res grid files.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("GFS", "marine", layer, "global_mid", run_time)

    # Fold hour-0 BREAKING heights into the per-cell GRID size climatology (the rating band's local-
    # calibration reference field — the band half of what spot_size_climatology is for glyphs; the
    # points are already in hand at 2°, so this is pure math + one small blob). Single-writer (this
    # job, pilots lane). NEVER fatal — a climatology hiccup must not fail the mid ingest. Gate
    # RATING_GRID_SIZE_CLIMATOLOGY (default ON in prod, OFF under tests; it only WRITES a separate
    # blob — nothing reads it until RATING_LOCAL_SIZE turns local-reference serving on).
    _grid_clim_default = "0" if env["is_test_env"] else "1"
    if total_saved > 0 and os.environ.get("RATING_GRID_SIZE_CLIMATOLOGY", _grid_clim_default) == "1":
        try:
            from services.weather_pipeline.grid_size_climatology import (
                accumulate_points_into_grid_climatology, load_grid_size_climatology_l2,
                upload_grid_size_climatology_l2)
            from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal, shelf_width_km
            clim = accumulate_points_into_grid_climatology(
                load_grid_size_climatology_l2(), results,
                depth_fn=shelf_depth_at, coastal_fn=is_coastal, width_fn=shelf_width_km)
            upload_grid_size_climatology_l2(scheduler.store, clim)
            logger.info("[Pipeline Scheduler] grid size climatology updated: %d coastal cells tracked.",
                        len(clim.get("cells", {})))
        except Exception as _gce:
            logger.warning(f"[Pipeline Scheduler] grid size climatology accumulation skipped: {_gce}")
    return total_saved


async def ingest_gfs_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global GFS/NOAA waves — same NOAA-direct GFS-Wave path as the coarse sibling, only a finer
    resolution (GFS_MID_RES, default 2°). Kill switch: GFS_MARINE_MID_RES_INGEST=0 (registration site)."""
    logger.info("[Pipeline Scheduler] Starting GFS Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    resolution = gfs_mid_resolution()
    # 14 days (was 10) MIRRORS ingest_gfs_marine_global's horizon (GFS_GLOBAL_FORECAST_DAYS=14): the
    # forecast timeline must not change resolution mid-scrub. This also FEEDS the blend mirror — the
    # frontend's ICON >168h and ICON swell_2 blends recursively fetch GFS component grids (which now
    # resolve to this mid product at z6-7), and the EURO extended-estimates machinery uses GFS
    # global_mid targets to build the EURO mid 240→336h estimated extension.
    forecast_days = gfs_mid_forecast_days(env["is_test_env"])

    noaa_direct = os.environ.get("GFS_MARINE_NOAA_DIRECT", "1") != "0"
    results = None
    from_noaa = False
    if noaa_direct:
        try:
            from services.noaa_marine_service import fetch_gfs_marine_global_coarse
            results = await fetch_gfs_marine_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
            if results:
                from_noaa = True
                logger.info(f"[Pipeline Scheduler] GFS-Wave mid-res NOAA-direct OK: {len(results)} points.")
        except Exception as _ne:
            logger.error(f"[Pipeline Scheduler] GFS-Wave mid-res NOAA-direct fetch errored: {_ne}")

    if not results:
        results = await scheduler._fetch_or_mock(
            "GFS", "marine", "all_marine", _GLOBAL_REGION, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_marine_results(scheduler.om_provider, _GLOBAL_REGION, resolution),
            "global_mid"
        )
    if not results:
        logger.error("[Pipeline Scheduler] GFS marine global_mid fetch failed. Skipping.")
        return False

    total_saved = await save_gfs_marine_global_mid(
        scheduler, env, run_time, results, resolution, 1 if from_noaa else 3)

    await scheduler._cleanup_and_pause(results, 0)
    return total_saved > 0


async def ingest_icon_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global ICON/gwam waves — DWD-direct at ICON_MID_RES (default 2°). Mirror of the coarse
    ICON global (no swell_2). Kill switch: ICON_MARINE_MID_RES_INGEST=0 (registration site)."""
    logger.info("[Pipeline Scheduler] Starting ICON Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    resolution = float(os.environ.get("ICON_MID_RES", "2.0"))
    forecast_days = int(os.environ.get("ICON_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else "7"))

    dwd_direct = os.environ.get("ICON_MARINE_DWD_DIRECT", "1") != "0"
    results = None
    from_dwd = False
    if dwd_direct:
        try:
            from services.dwd_marine_service import fetch_icon_marine_global_coarse
            results = await fetch_icon_marine_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
            if results:
                from_dwd = True
                logger.info(f"[Pipeline Scheduler] ICON marine mid-res DWD-direct OK: {len(results)} points.")
        except Exception as _de:
            logger.error(f"[Pipeline Scheduler] ICON marine mid-res DWD-direct fetch errored: {_de}")

    if not results:
        results = await scheduler._fetch_or_mock(
            "ICON", "marine", "all_marine", _GLOBAL_REGION, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_icon_marine_results(scheduler.om_provider, _GLOBAL_REGION, resolution),
            "global_mid"
        )
    if not results:
        logger.error("[Pipeline Scheduler] ICON marine global_mid fetch failed. Skipping.")
        return False

    save_step = 1 if from_dwd else 3
    for layer in ["waves", "swell_1", "wind_waves"]:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="ICON", provider="open-meteo", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] ICON {layer} global_mid"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} ICON {layer} global mid-res grid files.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("ICON", "marine", layer, "global_mid", run_time)

    await scheduler._cleanup_and_pause(results, 0)
    return total_saved > 0


async def ingest_euro_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global EURO waves at EURO_MID_RES (default 2°), PRIMARY horizon.

    PRIMARY = ECMWF Open Data wave stream (2026-07-12): free CC-BY 0.25° GRIB (swh/mwp/pp1d/mwd,
    byte-range, no auth) via ecmwf_wave_service — the same infra EURO wind/pressure already use. This
    replaces the SECOND ~15-30 min CMEMS fetch that kept the job default-OFF (the "band only on GFS"
    root: EURO global_mid count was 0, so EURO waves fell to the 10° coarse -> coarse_extent skip -> no
    rating band). ECMWF covers the TOTAL `waves` layer only (no swell-partition params in the free
    feed) — exactly what the mid tier's rating band needs; mid swell partitions stay absent for EURO.
    provider stays 'open-meteo' -> normalizer stamps source_dataset='ecmwf_wam025' (native, honest).

    The 240→336h ESTIMATED extension is NOT built here: the region-parameterized
    ingest_euro_marine_extended_estimates job includes region 'global_mid' and anchors on any native
    EURO product (no provider filter), so it grows the honest estimate tail from these anchors.

    FALLBACK / kill: EURO_MARINE_MID_ECMWF=0 forces the legacy CMEMS 4-layer path (also taken when the
    ECMWF fetch fails); EURO_MARINE_MID_RES_INGEST=0 at the registration site kills the whole job."""
    logger.info("[Pipeline Scheduler] Starting EURO Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    resolution = float(os.environ.get("EURO_MID_RES", "2.0"))
    cop_days = int(os.environ.get("EURO_MID_RES_DAYS", "2" if env["is_test_env"] else "10"))
    _cop_basis = {"type": "copernicus_native_global_coarse", "method": "cmems_thin_band_subset",
                  "source_model": "ecmwf_wam_cmems_glo_0083"}

    ecmwf_direct = os.environ.get("EURO_MARINE_MID_ECMWF", "1") != "0"
    if ecmwf_direct:
        ecmwf_results = None
        try:
            from services.ecmwf_wave_service import fetch_euro_marine_waves_global
            ecmwf_results = await fetch_euro_marine_waves_global(_GLOBAL_REGION, resolution, cop_days)
        except Exception as _ee:
            logger.error(f"[Pipeline Scheduler] EURO marine mid ECMWF-direct fetch errored: {_ee}")
        if ecmwf_results:
            logger.info(f"[Pipeline Scheduler] EURO marine mid ECMWF-direct OK: {len(ecmwf_results)} points.")
            c = await normalize_and_save_loop(
                scheduler.normalizer, scheduler.store, ecmwf_results,
                model="EURO", provider="open-meteo", domain="marine", layer="waves",
                bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
                region_id="global_mid", coverage_mode="global_tile",
                is_test_env=env["is_test_env"], step=1,
                log_prefix="[Pipeline Scheduler] EURO waves (ecmwf wave stream) global_mid"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {c} EURO waves global mid-res grid files (ECMWF).")
            if c > 0:
                scheduler.store.prune_superseded_products("EURO", "marine", "waves", "global_mid", run_time)
                await scheduler._cleanup_and_pause(ecmwf_results, 0)
                return True
        logger.warning("[Pipeline Scheduler] EURO marine mid ECMWF-direct unavailable; falling back to CMEMS.")

    cop_results = None
    try:
        from services.copernicus_marine_service import fetch_euro_marine_global_coarse
        cop_results = await fetch_euro_marine_global_coarse(_GLOBAL_REGION, resolution, cop_days)
    except Exception as _ce:
        logger.error(f"[Pipeline Scheduler] EURO Copernicus mid-res fetch errored: {_ce}")
    if not cop_results:
        logger.warning("[Pipeline Scheduler] EURO marine global_mid unavailable (Copernicus); skipping.")
        return False

    for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
        c = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, cop_results,
            model="EURO", provider="copernicus", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=1,
            log_prefix=f"[Pipeline Scheduler] EURO {layer} (copernicus native) global_mid",
            estimate_basis=_cop_basis
        )
        logger.info(f"[Pipeline Scheduler] Ingested {c} EURO {layer} global mid-res grid files.")
        total_saved += c
        if c > 0:
            scheduler.store.prune_superseded_products("EURO", "marine", layer, "global_mid", run_time)

    await scheduler._cleanup_and_pause(cop_results, 0)
    return total_saved > 0


def _icon_pilot_layers():
    return ["waves", "swell_1", "wind_waves"]   # gwam has no secondary swell (matches ICON global)


async def _save_marine_regional(scheduler, env, run_time, model, layers, region_id, region,
                                results, save_step, log_tag) -> int:
    """Save `results` as regional_tile products for each layer + prune superseded. Shared by the
    multi-bbox and per-region pilot paths (identical manifest shape either way)."""
    saved = 0
    resolution = float(region.get("resolution", 0.25))
    for layer in layers:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model=model, provider="open-meteo", domain="marine", layer=layer,
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] {log_tag} {layer} {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} {model} {layer} products for region {region_id}.")
        saved += count
        if count > 0:
            scheduler.store.prune_superseded_products(model, "marine", layer, region_id, run_time)
    return saved


async def ingest_icon_marine_pilot_impl(scheduler) -> bool:
    """ICON marine 0.25° REGIONAL pilot (round-12 §2a-i, the ICON close-zoom / rating-band fix).
    GWAM is natively 0.25° (probe-verified). MULTI-BBOX FIRST (2026-07-13): ONE GWAM download pass
    samples flagship + ALL worldwide regions (get_all_pilot_regions — every region refreshes every
    cycle; DWD has no spatial byte-range, so per-region passes re-download identical whole-globe
    files — the run 29249603524 budget post-mortem). Falls back to the bounded per-region flagship
    path (DWD-direct 600 s cap → open-meteo) when the multi fetch fails. Horizon
    ICON_MARINE_PILOT_FORECAST_DAYS default 2 (far hours fall through to mid/global via the
    ladder). Kills: ICON_MARINE_PILOT_INGEST=0 (registration site) / ICON_MARINE_DWD_DIRECT=0
    (skips DWD entirely → per-region open-meteo fallback path)."""
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS, get_all_pilot_regions
    logger.info("[Pipeline Scheduler] Starting ICON Marine Pilot (regional 0.25°) job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    dwd_direct = os.environ.get("ICON_MARINE_DWD_DIRECT", "1") != "0"
    forecast_days = int(os.environ.get("ICON_MARINE_PILOT_FORECAST_DAYS", "2"))
    layers = _icon_pilot_layers()

    # ══ MULTI-BBOX single-download-pass: all regions for one region's download cost ══
    if dwd_direct:
        regions_all = get_all_pilot_regions()
        multi = None
        try:
            from services.dwd_marine_service import fetch_icon_marine_regions
            multi = await fetch_icon_marine_regions(regions_all, 0.25, forecast_days, timeout_s=900)
        except Exception as _me:
            logger.error(f"[Pipeline Scheduler] ICON marine multi-region fetch errored: {_me}")
        if multi:
            logger.info(f"[Pipeline Scheduler] ICON marine multi-region OK: {len(multi)} regions in one pass.")
            for region_id, results in multi.items():
                region = regions_all.get(region_id)
                if not region or not results:
                    continue
                # DWD GWAM is natively 3-hourly -> step=1 keeps every step.
                total_saved += await _save_marine_regional(
                    scheduler, env, run_time, "ICON", layers, region_id, region, results, 1, "ICON")
                await scheduler._cleanup_and_pause(results, 0)
            if total_saved > 0:
                logger.info(f"[Pipeline Scheduler] ICON Marine Pilot (multi) done! Saved {total_saved} products.")
                return True
        logger.warning("[Pipeline Scheduler] ICON marine multi-region unavailable; "
                       "falling back to per-region flagship.")

    # ══ FALLBACK: bounded per-region flagship (DWD-direct 600 s cap → open-meteo) ══
    for region_id, region in dict(REGIONAL_CONFIGS).items():
        resolution = float(region.get("resolution", 0.25))
        logger.info(f"[Pipeline Scheduler] Ingesting ICON Marine for region: {region_id}")
        results = None
        from_dwd = False
        if dwd_direct:
            try:
                from services.dwd_marine_service import fetch_icon_marine_global_coarse
                results = await fetch_icon_marine_global_coarse(region, resolution, forecast_days,
                                                                timeout_s=600)
                if results:
                    from_dwd = True
                    logger.info(f"[Pipeline Scheduler] ICON marine DWD-direct OK for {region_id}: "
                                f"{len(results)} points (off open-meteo).")
            except Exception as _de:
                logger.error(f"[Pipeline Scheduler] ICON marine DWD-direct fetch errored for {region_id}: {_de}")
        if not results:
            if dwd_direct:
                logger.warning(f"[Pipeline Scheduler] ICON marine DWD-direct unavailable for {region_id}; "
                               "falling back to open-meteo.")
            results = await scheduler._fetch_or_mock(
                "ICON", "marine", "all_marine", region, resolution, forecast_days,
                env["is_test_env"],
                lambda r=region, res=resolution: generate_mock_icon_marine_results(scheduler.om_provider, r, res),
                region_id
            )
        if not results:
            continue
        # DWD GWAM is natively 3-hourly (step=1); open-meteo all_marine is hourly (step=3 -> 3-hourly).
        total_saved += await _save_marine_regional(
            scheduler, env, run_time, "ICON", layers, region_id, region, results,
            1 if from_dwd else 3, "ICON")
        await scheduler._cleanup_and_pause(results)

    logger.info(f"[Pipeline Scheduler] ICON Marine Pilot done! Saved {total_saved} total conformed product files.")
    return total_saved > 0


async def ingest_euro_marine_pilot_impl(scheduler) -> bool:
    """EURO marine 0.25° REGIONAL pilot (2026-07-13, round-12 §2a follow-up — the EURO rating-band
    resolution fix): the EURO band was the last one stuck on the ~2° global_mid clip at close zoom
    (GFS + ICON bands both serve 0.25° regional tiles since the ICON pilot landed). EURO's legacy
    regional method (ingest_copernicus_regional) was never carried into the decoupled CI lane and is
    CMEMS-based — the throttle landmine that kept EURO mid OFF for weeks. This pilot AVOIDS CMEMS
    entirely: the free ECMWF Open Data wave stream is natively 0.25° (probe-verified: open-meteo
    ecmwf_wam025 snaps 0.05°-spaced points to 0.25° both axes) and already lights the EURO mid tier,
    so the fine tiles reuse fetch_euro_marine_waves_global with a regional bbox — same shape as the
    GFS/ICON pilots. BOUNDED like the ICON pilot (pilots-lane budget, run 29249603524 post-mortem):
    FLAGSHIP regions only, short horizon (EURO_MARINE_PILOT_FORECAST_DAYS default 2 — far hours fall
    through to mid/global via the resolver ladder), 600 s per-region fetch cap, waves layer ONLY (the
    free feed has no swell partitions — the rating band samples `waves`, exactly what this fixes;
    swell partitions keep their CMEMS mid/coarse lanes). No CMEMS fallback: a failed fetch skips the
    region (mid still covers) rather than re-opening the throttle landmine.
    provider='open-meteo' -> normalizer stamps source_dataset='ecmwf_wam025' (native, honest —
    mirrors the mid lane). Kill: EURO_MARINE_PILOT_INGEST=0 at the registration site (repo Actions
    variable, no commit needed)."""
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS, get_all_pilot_regions
    logger.info("[Pipeline Scheduler] Starting EURO Marine Pilot (regional 0.25°, ECMWF wave stream) job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    forecast_days = int(os.environ.get("EURO_MARINE_PILOT_FORECAST_DAYS", "2"))

    # ══ MULTI-BBOX single-download-pass: all regions for one region's download cost (2026-07-13) ══
    regions_all = get_all_pilot_regions()
    multi = None
    try:
        from services.ecmwf_wave_service import fetch_euro_marine_waves_regions
        multi = await fetch_euro_marine_waves_regions(regions_all, 0.25, forecast_days, timeout_s=900)
    except Exception as _me:
        logger.error(f"[Pipeline Scheduler] EURO marine multi-region fetch errored: {_me}")
    if multi:
        logger.info(f"[Pipeline Scheduler] EURO marine multi-region OK: {len(multi)} regions in one pass.")
        for region_id, results in multi.items():
            region = regions_all.get(region_id)
            if not region or not results:
                continue
            total_saved += await _save_marine_regional(
                scheduler, env, run_time, "EURO", ["waves"], region_id, region, results, 1, "EURO waves (ecmwf)")
            await scheduler._cleanup_and_pause(results, 0)
        if total_saved > 0:
            logger.info(f"[Pipeline Scheduler] EURO Marine Pilot (multi) done! Saved {total_saved} products.")
            return True
    logger.warning("[Pipeline Scheduler] EURO marine multi-region unavailable; "
                   "falling back to per-region flagship.")

    for region_id, region in REGIONAL_CONFIGS.items():
        resolution = float(region.get("resolution", 0.25))
        logger.info(f"[Pipeline Scheduler] Ingesting EURO Marine (ECMWF) for region: {region_id}")
        results = None
        try:
            from services.ecmwf_wave_service import fetch_euro_marine_waves_global
            results = await fetch_euro_marine_waves_global(region, resolution, forecast_days, timeout_s=600)
        except Exception as _ee:
            logger.error(f"[Pipeline Scheduler] EURO marine pilot ECMWF fetch errored for {region_id}: {_ee}")
        if not results:
            if env["is_test_env"]:
                logger.warning(f"[Pipeline Scheduler] EURO marine pilot fetch empty for {region_id} (test env) "
                               "— injecting mock data...")
                results = generate_mock_marine_results(scheduler.om_provider, region, resolution)
            else:
                logger.warning(f"[Pipeline Scheduler] EURO marine pilot ECMWF unavailable for {region_id}; "
                               "skipping (mid tier still covers).")
                continue

        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="EURO", provider="open-meteo", domain="marine", layer="waves",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"], step=1,
            log_prefix=f"[Pipeline Scheduler] EURO waves (ecmwf wave stream) {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} EURO waves products for region {region_id}.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("EURO", "marine", "waves", region_id, run_time)
        await scheduler._cleanup_and_pause(results)

    logger.info(f"[Pipeline Scheduler] EURO Marine Pilot done! Saved {total_saved} total conformed product files.")
    return total_saved > 0
