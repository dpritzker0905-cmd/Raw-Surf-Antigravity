"""
euro_marine_coarse_ingestion.py

EURO marine GLOBAL COARSE (10°, region_id 'global_coarse') ingestion.

Extracted from scheduler.py (2026-07-26) — the thin `ingest_euro_marine_global` wrapper delegates
here — to keep that file under the 800-LOC governance ceiling. Same pattern as
marine_mid_res_ingestion / wind_ingestion / pressure_ingestion. Pure mechanical move: the body is
byte-identical apart from `self.` -> `scheduler.`, so provenance, kill switches and ordering are
unchanged.

This is the densest single unit in the pipeline (294 lines, ~37% of scheduler.py) and carries the
whole EURO coarse saga: the Copernicus/CMEMS primary, the ECMWF-Open-Data `waves` hybrid that
restores the Gulf, the NOAA-GFS reuse that de-strands the 429'd re-fetch, the GFS-fill of
enclosed-sea/Antarctic masked cells, and the open-meteo fallback path.

Kill switches (all preserved): EURO_MARINE_GFS_REUSE_CACHE, EURO_MARINE_COARSE_ECMWF,
EURO_MARINE_COARSE_GFS_FILL, EURO_KEEP_NATIVE_WAVES, EURO_COPERNICUS_DAYS,
EURO_GLOBAL_FORECAST_DAYS, GFS_GLOBAL_FORECAST_DAYS.
"""
import os
import logging
from datetime import datetime, timezone

from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_marine_results,
    normalize_and_save_loop,
)

logger = logging.getLogger(__name__)


async def ingest_euro_marine_global_impl(scheduler) -> bool:
    """
    Ingests EURO waves grid forecast globally at a coarse resolution.
    Fetches 7 days of forecasts in 3-hour increments.
    Conforms waves under model='EURO', and component layers under GFS fallback conjoined to EURO.
    """
    logger.info("[Pipeline Scheduler] Starting EURO Marine Global Coarse Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    global_region = {
        "west": -180.0,
        "south": -80.0,
        "east": 180.0,
        "north": 85.0
    }
    resolution = 10.0

    forecast_days = int(os.environ.get("EURO_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "7"))
    # GFS swell/wind_waves fallback: request the SAME horizon as ingest_gfs_marine_global (which runs
    # ~1 min earlier in the same cycle) so this resolves as a provider _GRID_CACHE HIT (TTL 300s)
    # instead of a SECOND, redundant open-meteo all_marine fetch of identical GFS data. open-meteo
    # bills each of the ~612 grid locations as a call, so de-duplicating this frees ~600+ calls/cycle
    # of the daily quota — enough to keep the cycle's tail jobs (ICON marine) under the 5k/hour cap so
    # they stop getting 429'd. Worst case (GFS job failed / cache expired) it re-fetches as before — no
    # regression. (The longer-term win is moving EURO marine onto Copernicus entirely; tiled fetch is
    # memory-safe but ~60 slow tile downloads, deferred.)
    gfs_forecast_days = int(os.environ.get("GFS_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "14"))

    # ══ PRIMARY: native EURO from Copernicus (REAL ECMWF-WAM swells), 0-10d + cached-GFS 10->14d ══
    # Moves EURO marine OFF open-meteo (frees ~1,200 calls/cycle for ICON) and upgrades swell_1/swell_2/
    # wind_waves from GFS-fallback to REAL CMEMS partitions. The Copernicus fetch is slow (~15-30 min)
    # but LOW-STRAIN (background thin-latitude-band subsets, ~0.3 GB, ~36 MB peak — see
    # copernicus_global_fetcher.py). CMEMS global waves is a ~10-day product, so days 10->14 are filled
    # by the cached GFS all_marine (estimated). Copernicus unavailable/failed -> falls through to the
    # existing open-meteo path below (zero regression).
    cop_days = int(os.environ.get("EURO_COPERNICUS_DAYS", "2" if env["is_test_env"] else "10"))
    _cop_basis = {"type": "copernicus_native_global_coarse", "method": "cmems_thin_band_subset", "source_model": "ecmwf_wam_cmems_glo_0083"}
    _gfs_ext_basis = {"type": "gfs_estimated_fallback", "method": "gfs_wave_fallback", "source_model": "ncep_gfswave025"}

    def _parse_iso(s):
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            # open-meteo GFS times are offset-NAIVE ("...T00:00"); Copernicus times are AWARE ("...Z").
            # Normalize to UTC-aware so the GFS 10->14d slice comparison can't raise a naive-vs-aware
            # TypeError (which otherwise aborts the whole EURO ingest before any product is saved).
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except Exception:
            return None

    def _slice_after(results, after_dt):
        """Trim Open-Meteo-shaped point results to hourly times STRICTLY AFTER after_dt (the GFS 10->14d tail)."""
        if not results or after_dt is None:
            return None
        sliced = []
        for pt in results:
            hourly = pt.get("hourly", {}) or {}
            times = hourly.get("time", []) or []
            keep = [i for i, t in enumerate(times) if (_parse_iso(t) and _parse_iso(t) > after_dt)]
            if not keep:
                continue
            new_hourly = {k: ([arr[i] for i in keep] if (isinstance(arr, list) and len(arr) == len(times)) else arr)
                          for k, arr in hourly.items()}
            npt = dict(pt)
            npt["hourly"] = new_hourly
            sliced.append(npt)
        return sliced or None

    cop_results = None
    try:
        from services.copernicus_marine_service import fetch_euro_marine_global_coarse
        cop_results = await fetch_euro_marine_global_coarse(global_region, resolution, cop_days)
    except Exception as _ce:
        logger.error(f"[Pipeline Scheduler] EURO Copernicus global-coarse fetch errored: {_ce}")

    if cop_results:
        logger.info(f"[Pipeline Scheduler] EURO Copernicus global-coarse OK: {len(cop_results)} points (native swells).")
        # GFS coarse grid for the 10->14d `gfs_ext` tail AND the enclosed-sea/Antarctic GFS-fill below.
        # PREFER the NOAA-direct grid ingest_gfs_marine_global stashed (reliable, HAS the Gulf, coarse_axis-
        # aligned) over a 429-prone open-meteo re-fetch that stranded the fill (run 29922098897). Kill: env.
        gfs_ext_src = None
        if os.environ.get("EURO_MARINE_GFS_REUSE_CACHE", "1") != "0" and scheduler._gfs_coarse_marine_cache:
            gfs_ext_src = scheduler._gfs_coarse_marine_cache
            logger.info(f"[Pipeline Scheduler] EURO coarse reusing cached NOAA GFS coarse grid "
                        f"({len(gfs_ext_src)} pts) for gfs_ext + enclosed-sea/Antarctic GFS-fill (no re-fetch).")
        if not gfs_ext_src:
            gfs_ext_src = await scheduler._fetch_or_mock(
                "GFS", "marine", "all_marine", global_region, resolution, gfs_forecast_days,
                env["is_test_env"],
                lambda: generate_mock_marine_results(scheduler.om_provider, global_region, resolution),
                "global_coarse"
            )
        _cop_times = cop_results[0].get("hourly", {}).get("time", []) if cop_results else []
        _cop_max = _parse_iso(_cop_times[-1]) if _cop_times else None
        gfs_ext = _slice_after(gfs_ext_src, _cop_max)

        # ENCLOSED-SEA GULF FIX (2026-07-22): CMEMS cmems_mod_glo_wav STRUCTURALLY MASKS the Gulf of
        # Mexico + other enclosed seas (E Med, Black Sea, Sea of Japan, Gulf of California) — verified
        # live: the CMEMS coarse row has valid open-ocean cells worldwide but is_valid=False over those
        # basins, so the `waves` heatmap inflates them from distant cells (~4-5ft; user-reported). The
        # 0fcde49c block-mean CANNOT recover data CMEMS lacks. The MID tier already solved this by
        # sourcing `waves` from the ECMWF Open-Data wave stream (ECMWF-WAM HAS the Gulf, ~0.5m — proven
        # live: the 2deg mid tile shows 0.41-0.50m Gulf cells). Port that hybrid to the COARSE tier for
        # the `waves` layer ONLY; swells stay on CMEMS (the free ECMWF feed has no swell partitions, and
        # swells are not what the height heatmap renders). ECMWF fail -> `waves` falls back to CMEMS
        # (today's behavior, no regression). Kill: EURO_MARINE_COARSE_ECMWF=0. Mirrors
        # ingest_euro_marine_global_mid_impl / EURO_MARINE_MID_ECMWF.
        ecmwf_waves = None
        if os.environ.get("EURO_MARINE_COARSE_ECMWF", "1") != "0":
            try:
                from services.ecmwf_wave_service import fetch_euro_marine_waves_global
                ecmwf_waves = await fetch_euro_marine_waves_global(global_region, resolution, cop_days)
            except Exception as _ewe:
                logger.error(f"[Pipeline Scheduler] EURO marine coarse ECMWF-direct waves fetch errored: {_ewe}")
            if ecmwf_waves:
                logger.info(f"[Pipeline Scheduler] EURO marine coarse ECMWF-direct waves OK: {len(ecmwf_waves)} points (Gulf/enclosed seas covered).")
            else:
                logger.warning("[Pipeline Scheduler] EURO marine coarse ECMWF-direct waves unavailable; `waves` stays on CMEMS (Gulf may drop).")
        _ew_times = ecmwf_waves[0].get("hourly", {}).get("time", []) if ecmwf_waves else []
        _ew_max = _parse_iso(_ew_times[-1]) if _ew_times else None
        _ew_gfs_ext = _slice_after(gfs_ext_src, _ew_max) if ecmwf_waves else None

        # GFS-FILL (2026-07-22) — the ACTUAL Gulf/enclosed-sea/Antarctic fix. Both the ECMWF-WAM and
        # CMEMS coarse `waves` sources structurally MASK enclosed seas (Gulf of Mexico, E Med, Black
        # Sea, Sea of Japan, Gulf of California) AND the Southern Ocean south of ~-60 (the "Antarctic
        # projection" regression) -> is_valid=FALSE -> the heatmap inflates those holes from distant
        # open-ocean cells. NOAA GFS's land-sea mask HAS those cells (why GFS renders correctly), its
        # coarse grid is already in hand (gfs_ext_src) and cell-aligned (all coarse fetchers share
        # coarse_axis). Fill the masked `waves` cells from the RAW gfs_ext_src — the FULL 0-14d horizon,
        # NOT the _slice_after(_cop_max) tail (which would leave 0-10d cells masked). Open-ocean
        # ECMWF/CMEMS values are untouched (only NaN cells are filled). Mutates the waves source in
        # place so the layer loop below saves the filled grid. Kill: EURO_MARINE_COARSE_GFS_FILL=0.
        _waves_src = ecmwf_waves if ecmwf_waves is not None else cop_results
        if os.environ.get("EURO_MARINE_COARSE_GFS_FILL", "1") != "0" and gfs_ext_src and _waves_src:
            try:
                from services._fetch_common import fill_masked_waves_from_gfs
                _nfilled = fill_masked_waves_from_gfs(_waves_src, gfs_ext_src, _diag=(_fd := {}))
                logger.info(f"[Pipeline Scheduler] EURO coarse waves GFS-fill: filled {_nfilled} masked (cell,hour) values (Gulf/enclosed seas/Antarctic) DIAG={_fd}")
            except Exception as _fe:
                logger.error(f"[Pipeline Scheduler] EURO coarse waves GFS-fill errored (waves stay masked): {_fe}")

        for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
            # `waves` rides ECMWF (has the Gulf) when available; swells + fallback ride CMEMS.
            _use_ecmwf = (layer == "waves" and ecmwf_waves is not None)
            _src = ecmwf_waves if _use_ecmwf else cop_results
            _prov = "open-meteo" if _use_ecmwf else "copernicus"
            # ECMWF waves: NO estimate_basis (mirror the mid tier) so the normalizer derives the honest
            # native provider='open-meteo' -> source_dataset='ecmwf_wam025', is_estimated=False.
            _basis = None if _use_ecmwf else _cop_basis
            _layer_gfs_ext = _ew_gfs_ext if _use_ecmwf else gfs_ext
            # native 0-10d, step=1 saves every entry. ⚠️ CADENCE (2026-07-30): CMEMS is 3-hourly
            # throughout, but the ECMWF Open-Data wave stream is 3-hourly only to +144h and
            # 6-HOURLY from +144h to +240h — so the `waves` lane leaves 12-16 empty 3h lattice
            # slots per run in that band. lattice_fill.py interpolates them post-ingest; do not
            # "fix" the step here (the entries simply don't exist upstream).
            c = await normalize_and_save_loop(
                scheduler.normalizer, scheduler.store, _src,
                model="EURO", provider=_prov, domain="marine", layer=layer,
                bbox=global_region, resolution=resolution, run_time=run_time,
                region_id="global_coarse", coverage_mode="global_tile",
                is_test_env=env["is_test_env"], step=1,
                log_prefix=f"[Pipeline Scheduler] EURO {layer} ({'ecmwf wave stream' if _use_ecmwf else 'copernicus native'}) global_coarse",
                # NATIVE data (2026-07-04): no estimated_after_index — these are REAL partitions
                # (CMEMS or ECMWF-WAM), and stamping estimated_after_index=0 mis-labeled every native
                # hour. The basis rides along as fetch-method provenance; the normalizer derives the
                # truthful is_estimated=False / is_forecast_authoritative=True / source_dataset.
                estimate_basis=_basis
            )
            e_cnt = 0
            if _layer_gfs_ext:  # GFS days 10->14 (open-meteo hourly -> step=3)
                e_cnt = await normalize_and_save_loop(
                    scheduler.normalizer, scheduler.store, _layer_gfs_ext,
                    model="EURO", provider=_prov, domain="marine", layer=layer,
                    bbox=global_region, resolution=resolution, run_time=run_time,
                    region_id="global_coarse", coverage_mode="global_tile",
                    is_test_env=env["is_test_env"], step=3,
                    log_prefix=f"[Pipeline Scheduler] EURO {layer} (GFS 10-14d ext) global_coarse",
                    estimated_after_index=0, estimate_basis=_gfs_ext_basis
                )
            logger.info(f"[Pipeline Scheduler] Ingested EURO {layer}: {c} native + {e_cnt} GFS-ext global coarse files.")
            total_saved += c + e_cnt
            if (c + e_cnt) > 0:
                scheduler.store.prune_superseded_products("EURO", "marine", layer, "global_coarse", run_time)
        await scheduler._cleanup_and_pause(cop_results, 0)
        if ecmwf_waves:
            await scheduler._cleanup_and_pause(ecmwf_waves, 0)
        if gfs_ext_src:
            await scheduler._cleanup_and_pause(gfs_ext_src, 0)
        scheduler._gfs_coarse_marine_cache = None  # release the cross-job handoff (consumed above)
        return total_saved > 0

    # ══ FALLBACK: Copernicus unavailable -> existing open-meteo path (ecmwf_wam025 + cached GFS), no regression ══
    logger.warning("[Pipeline Scheduler] EURO Copernicus global-coarse unavailable; falling back to open-meteo (ecmwf_wam025 + GFS).")

    # 1. Fetch EURO waves results (real ECMWF WAM via open-meteo ecmwf_wam025)
    euro_results = await scheduler._fetch_or_mock(
        "EURO", "marine", "all_marine", global_region, resolution, forecast_days,
        env["is_test_env"],
        lambda: generate_mock_marine_results(scheduler.om_provider, global_region, resolution),
        "global_coarse"
    )

    # 2. GFS swell/wind_waves fallback — reuses the GFS-marine-global fetch via cache (see note above)
    gfs_results = await scheduler._fetch_or_mock(
        "GFS", "marine", "all_marine", global_region, resolution, gfs_forecast_days,
        env["is_test_env"],
        lambda: generate_mock_marine_results(scheduler.om_provider, global_region, resolution),
        "global_coarse"
    )

    if not euro_results and not gfs_results:
        logger.error("[Pipeline Scheduler] Both EURO and GFS marine global_coarse fetches failed. Skipping.")
        return False

    # Conformed global coarse open-meteo products must be labeled as estimated to meet capabilities contract
    euro_estimate_basis = {
        "type": "open_meteo_fallback",
        "method": "direct_global_fallback",
        "source_model": "ecmwf_wam025"
    }

    gfs_estimate_basis = {
        "type": "gfs_estimated_fallback",
        "method": "gfs_wave_fallback",
        "source_model": "ncep_gfswave025"
    }

    # CMEMS-hiccup WAVES consistency: on a Copernicus outage the swell layers KEEP their last-good
    # copernicus_native product (the GFS-swell fallback only supersedes when GFS data is present), so don't
    # DOWNGRADE `waves` to the open-meteo fallback either when a recent Copernicus-native waves was restored
    # from the prior manifest — otherwise you get the split "waves=open-meteo, swells=copernicus". It self-
    # heals on the next CMEMS-success cycle anyway; this just avoids the transient downgrade. Fail-safe (any
    # error → existing fallback). Kill switch: EURO_KEEP_NATIVE_WAVES=0.
    _keep_native_waves = False
    if euro_results and os.environ.get("EURO_KEEP_NATIVE_WAVES", "1") != "0":
        try:
            _man = scheduler.store.get_manifest()
            _now = datetime.now(timezone.utc)
            for _p in (getattr(_man, "products", None) or []):
                if (_p.model.upper() == "EURO" and _p.domain.lower() == "marine"
                        and _p.layer.lower() == "waves" and (_p.region_id or "") == "global_coarse"):
                    _src = (_p.source_dataset or "")
                    if not _src and isinstance(_p.estimate_basis, dict):
                        _src = _p.estimate_basis.get("type", "")
                    _rt = _p.run_time
                    if _rt is not None and _rt.tzinfo is None:
                        _rt = _rt.replace(tzinfo=timezone.utc)
                    if "copernicus" in _src.lower() and _rt is not None and (_now - _rt).total_seconds() <= 6 * 3600:
                        _keep_native_waves = True
                        break
        except Exception as _ke:
            logger.debug(f"[Pipeline Scheduler] keep-native-waves check failed (using open-meteo fallback): {_ke}")

    if _keep_native_waves:
        logger.info("[Pipeline Scheduler] EURO Copernicus down — KEEPING last-good copernicus_native waves "
                    "(skipped the open-meteo downgrade; consistent with the swell layers).")
    elif euro_results:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, euro_results,
            model="EURO", provider="copernicus", domain="marine", layer="waves",
            bbox=global_region, resolution=resolution, run_time=run_time,
            region_id="global_coarse", coverage_mode="global_tile",
            is_test_env=env["is_test_env"],
            log_prefix="[Pipeline Scheduler] EURO waves global_coarse",
            estimated_after_index=0,
            estimate_basis=euro_estimate_basis
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} EURO waves global coarse grid files.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", run_time)

    if gfs_results:
        for layer in ["swell_1", "swell_2", "wind_waves"]:
            count = await normalize_and_save_loop(
                scheduler.normalizer, scheduler.store, gfs_results,
                model="EURO", provider="copernicus", domain="marine", layer=layer,
                bbox=global_region, resolution=resolution, run_time=run_time,
                region_id="global_coarse", coverage_mode="global_tile",
                is_test_env=env["is_test_env"],
                log_prefix=f"[Pipeline Scheduler] EURO {layer} (GFS fallback) global_coarse",
                estimated_after_index=0,
                estimate_basis=gfs_estimate_basis
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} EURO {layer} (GFS fallback) global coarse grid files.")
            total_saved += count
            if count > 0:
                scheduler.store.prune_superseded_products("EURO", "marine", layer, "global_coarse", run_time)

    if euro_results:
        await scheduler._cleanup_and_pause(euro_results, 0)
    if gfs_results:
        await scheduler._cleanup_and_pause(gfs_results, 0)
    return total_saved > 0

