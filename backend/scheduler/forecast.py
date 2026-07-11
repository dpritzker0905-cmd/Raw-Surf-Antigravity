import logging
import asyncio
import gc
import os
from services.forecast_ingester import ingest_global_model

logger = logging.getLogger(__name__)

def ingest_marine_forecast_task():
    """
    Background job triggered by APScheduler.
    Since APScheduler runs functions synchronously but our service is async,
    we must run it in a dedicated event loop or using asyncio.run.
    """
    logger.info("[Scheduler] Executing ingest_marine_forecast_task...")
    try:
        # Run async function in a new loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        async def run_jobs():
            # Run legacy forecast ingesters
            try:
                logger.info("[Scheduler] Starting legacy wind ingestion...")
                await ingest_global_model('wind')
            except Exception as e:
                logger.error(f"[Scheduler] Legacy wind ingestion failed: {e}", exc_info=True)

            gc.collect()
            await asyncio.sleep(5.0)

            try:
                logger.info("[Scheduler] Starting legacy marine ingestion...")
                await ingest_global_model('marine')
            except Exception as e:
                logger.error(f"[Scheduler] Legacy marine ingestion failed: {e}", exc_info=True)

            gc.collect()

            # Run conformed global weather pipeline jobs
            from services.weather_pipeline.scheduler import WeatherPipelineScheduler
            from services.weather_pipeline.store import ProductStore
            
            store = ProductStore()
            weather_scheduler = WeatherPipelineScheduler(store=store)
            
            # Stagger the 3 heavy global-marine fetches. Doing GFS(14d) + EURO + ICON back-to-back in
            # ONE cycle exhausts open-meteo's rate budget (429) + peak memory by the 3rd fetch, so ICON
            # — always last — failed every run and went 4 days stale (run 06-22 while GFS/EURO refreshed
            # daily). Any scrubbed/viewed hour past ICON's stale coverage then had no manifest product →
            # fell to the OOM-prone on-demand dynamic /grid → worker died → CORS-less 500 → the frontend
            # committed a safe-zero → ICON heatmap CLEARED to blank at every zoom and on every path.
            # Forensics: 2 marine fetches succeed every run (GFS+EURO today); only the 3rd starves. So
            # keep GFS (the default model) fresh every run and ALTERNATE EURO/ICON — each cycle does at
            # most 2 heavy marine fetches (the proven-working count). Cadence: GFS ~3h, EURO/ICON ~6h —
            # well within their multi-day coverage. Trivially revertable to all-three if the box ever
            # gets more headroom or a keyed open-meteo plan.
            from datetime import datetime, timezone
            # The 1-CPU Render box ALTERNATES EURO/ICON marine (2 heavy fetches/cycle, note above) and
            # accumulates BOTH across cycles in its PERSISTENT store. The decoupled GitHub runner has an
            # EPHEMERAL store (empty each run) — alternating there yields a manifest MISSING one model every
            # run (e.g. EURO marine blank after Render restores the L2 manifest). So MARINE_INGEST_ALL=1
            # (set in CI) ingests BOTH every run. Marine is now off open-meteo (direct NOAA/Copernicus/DWD)
            # so the old 429 reason is moot; only the 1-CPU memory limit keeps the default alternation on Render.
            if os.environ.get("MARINE_INGEST_ALL", "").lower() in ("1", "true", "yes"):
                _marine_jobs = [
                    ("EURO Marine Global", weather_scheduler.ingest_euro_marine_global),
                    ("ICON Marine Global", weather_scheduler.ingest_icon_marine_global),
                ]
            else:
                _marine_jobs = [
                    ("EURO Marine Global", weather_scheduler.ingest_euro_marine_global)
                    if (datetime.now(timezone.utc).hour // 3) % 2 == 0
                    else ("ICON Marine Global", weather_scheduler.ingest_icon_marine_global)
                ]

            # INGEST_PILOTS: 'include' (default — the historical single-cycle behavior) | 'skip' |
            # 'only'. 2026-07-04 timeout forensics: the regional pilots consume ~67 min of a cycle
            # (GFS marine pilot 21m + wind pilots 46m, measured run 28673349217) on top of ~45 min
            # of core globals — full cycles brushed the 165-min workflow timeout and periodically
            # tripped it (GitHub reports a job timeout as "cancelled": the audited 2h45m runs).
            # Timed-out runs upload their early hours but never prune -> superseded-product debt.
            # The split: the CORE workflow runs with INGEST_PILOTS=skip (always finishes well under
            # budget — the global layers that feed every heatmap + /point can no longer be lost to
            # a timeout), and a companion workflow (forecast-ingest-pilots.yml) runs the pilots
            # with INGEST_PILOTS=only on an offset schedule with its own full budget.
            _pilots_mode = os.environ.get("INGEST_PILOTS", "include").lower()

            core_jobs = [
                # Wind global-coarse for ALL THREE models. GFS + EURO were missing here (only ICON was
                # scheduled), so their *_wind_global_coarse products went stale — EURO wind's last run
                # was 2 weeks old, leaving no current/forecast products, which is why the on-demand
                # dynamic-viewport fetch (the only thing still serving current EURO wind) intermittently
                # failed → 500/clear. These are COARSE (300 vec, 10°), the same weight as the ICON wind
                # job already here and far lighter than the marine jobs below, so the 1-CPU/memory cost
                # is minimal; each runs after a 30s stagger + gc.collect() like the rest.
                ("Icon Wind Global", weather_scheduler.ingest_icon_wind_global),
                ("GFS Wind Global", weather_scheduler.ingest_gfs_wind_global),
                ("EURO Wind Global", weather_scheduler.ingest_euro_wind_global),
                ("GFS Marine Global", weather_scheduler.ingest_gfs_marine_global),
                *_marine_jobs,  # both EURO+ICON in CI (MARINE_INGEST_ALL=1); alternated on the 1-CPU Render box

                ("GFS Pressure Global", weather_scheduler.ingest_gfs_pressure_global),
                ("ICON Pressure Global", weather_scheduler.ingest_icon_pressure_global),
                ("EURO Pressure Global", weather_scheduler.ingest_euro_pressure_global),

                # EURO marine 10->14d estimated extension (persistence + GFS-14d blend). EURO marine is
                # natively ~10d (240h), so without this the heatmap CLEARS when scrubbing past day 10. Runs
                # AFTER the marine globals (its GFS/EURO/ICON anchors) but BEFORE the slow regional pilots so
                # a CI timeout can't skip the fix. Compute-only (no GRIB fetch). Kill switch EURO_MARINE_EXTEND=0.
                ("EURO Marine Extended Estimates", weather_scheduler.ingest_euro_marine_extended_estimates),
                # ICON marine 168->336h estimates (persistence + GFS trend — the client's far-hour
                # blend baked server-side, strategy slice 1 second half). Compute-only, store-fed;
                # placed right after the EURO extension for the same timeout-safety reason.
                # Kill switch ICON_MARINE_EXTEND=0.
                ("ICON Marine Extended Estimates", weather_scheduler.ingest_icon_marine_extended_estimates),
            ]

            pilot_jobs = [
                # Marine MID-RES globals (z6-7 quality tier, 2026-07-05): ~2° globals served CLIPPED by
                # grid_resolver's Step 3.6 — kills the <1-cell coarse lattice + flat color at zoom-out.
                # MOVED to the PILOTS lane (2026-07-05): in the core cycle their ~45-55 min (GFS 14d
                # ~26 + ICON ~17) tipped run 28726329418 into the 165-min timeout DURING the
                # calibration/precompute tail (glyphs went stale). The pilots workflow has its own
                # 165-min budget (~67 min used). Dependency-safe: the resolver reads global_mid from
                # the L2-restored manifest, and the EURO extended-estimates job (core) picks up mid
                # targets on the NEXT core cycle — the same one-cycle lag every pilot product has.
                # GFS mid runs FIRST (its 14d fetch warms nothing downstream here, but EURO mid —
                # default OFF, a 2nd ~15-30min CMEMS fetch — must run AFTER it if enabled).
                # Kills: {GFS,ICON}_MARINE_MID_RES_INGEST=0; enable EURO_MARINE_MID_RES_INGEST=1.
                *([("GFS Marine Global Mid", weather_scheduler.ingest_gfs_marine_global_mid)]
                  if os.environ.get("GFS_MARINE_MID_RES_INGEST", "1") != "0" else []),
                *([("ICON Marine Global Mid", weather_scheduler.ingest_icon_marine_global_mid)]
                  if os.environ.get("ICON_MARINE_MID_RES_INGEST", "1") != "0" else []),
                *([("EURO Marine Global Mid", weather_scheduler.ingest_euro_marine_global_mid)]
                  if os.environ.get("EURO_MARINE_MID_RES_INGEST", "0") != "0" else []),
                # Regional GFS marine pilot (FL+SoCal 0.25°): slow NOAA-direct GRIB fetches (~5-15 min
                # x2 regions). No downstream dependents (unlike GFS Marine Global, whose _GRID_CACHE the
                # EURO Marine Global job reuses), so isolating it is dependency-safe.
                ("GFS Marine Pilot", weather_scheduler.ingest_gfs_marine_pilot),
            ]
            # Regional WIND pilots (0.25° coastal tiles, all 3 models) — the zoomed-in-wind fix. Wind ships
            # ONLY a 10° global product, so the serve box did a ~20s synchronous live viewport fetch per
            # request for any zoomed-in wind view ("wind takes minutes to load"). Slow regional
            # NOAA/DWD/ECMWF GRIB fetches with NO downstream dependents. Once a regional wind tile is in
            # the manifest, resolve_grid serves it (is_regional branch) instead of fetching upstream.
            # Kill switch: WIND_PILOT_INGEST=0.
            if os.environ.get("WIND_PILOT_INGEST", "1") != "0":
                pilot_jobs += [
                    ("GFS Wind Pilot", weather_scheduler.ingest_gfs_wind_pilot),
                    ("ICON Wind Pilot", weather_scheduler.ingest_icon_wind_pilot),
                    ("EURO Wind Pilot", weather_scheduler.ingest_euro_wind_pilot),
                ]

            if _pilots_mode == "only":
                jobs = pilot_jobs
            elif _pilots_mode == "skip":
                jobs = core_jobs
            else:  # 'include' — historical single-cycle behavior (Render box, local dev)
                jobs = core_jobs + pilot_jobs

            # Inter-job stagger lets the 1-CPU Render box settle (gc) between heavy jobs. The decoupled
            # GitHub runner (2 CPU, no serving contention) doesn't need it -> CI sets FORECAST_JOB_STAGGER_SEC=0
            # to shave ~4.5 min (9 jobs x 30s). Default 30 keeps Render behaviour unchanged.
            _stagger = float(os.environ.get("FORECAST_JOB_STAGGER_SEC", "30"))
            for name, job_func in jobs:
                await asyncio.sleep(_stagger)
                logger.info(f"[Scheduler] Starting scheduled job: {name}")
                try:
                    await job_func()
                    logger.info(f"[Scheduler] Completed scheduled job: {name}")
                except Exception as e:
                    logger.error(f"[Scheduler] Job '{name}' failed with error: {e}", exc_info=True)
                gc.collect()

            # Periodic manifest pruning: prune_old_products is otherwise never run on a cadence
            # (only superseded runs are pruned during active ingestion), so obsolete forecast
            # runs accumulate and re-bloat manifest.json -> startup/parse memory spikes -> OOM.
            # Prune everything whose valid time is >2 days old after each ingestion cycle.
            try:
                from datetime import datetime, timezone, timedelta
                cutoff = datetime.now(timezone.utc) - timedelta(days=2)
                logger.info(f"[Scheduler] Pruning products older than {cutoff.isoformat()}...")
                await asyncio.to_thread(store.prune_old_products, cutoff)
                logger.info("[Scheduler] Manifest pruning complete.")
            except Exception as e:
                logger.error(f"[Scheduler] Manifest pruning failed: {e}", exc_info=True)
            gc.collect()

        loop.run_until_complete(run_jobs())
        loop.close()
        logger.info("[Scheduler] Successfully completed forecast ingestion.")
    except Exception as e:
        logger.error(f"[Scheduler] Failed to ingest forecast: {e}", exc_info=True)
