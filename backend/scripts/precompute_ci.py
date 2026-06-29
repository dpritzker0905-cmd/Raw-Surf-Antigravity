"""
Decoupled PRECOMPUTE + CALIBRATION entrypoint (.github/workflows/precompute.yml).

Why this exists separately from ingest_forecast_ci.py: precompute/calibration are cheap (~minutes) but the
HIGHEST-value step (they make the per-spot rating glyphs serve INSTANTLY worldwide). In the combined ingest
script they run DEAD LAST — after the entire heavy ingestion incl. the slow, deliberately-sacrificial
regional/worldwide pilots — so a long cycle (observed: run 28399884489 took 2h42m vs the 2h45m job timeout)
can starve or hard-kill them. This entrypoint RESTORES the freshly-ingested products from Supabase L2 (the
exact serve-box pattern) and runs precompute + calibration on their OWN runner/timeout, so they can never be
starved by a slow ingest. Safe to run any time after an ingest cycle has populated L2; dispatch on demand.

ENV (from repo secrets, same as forecast-ingest):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  -> L2 source + PostgREST spots read (REQUIRED)
  SPOT_RATINGS_PRECOMPUTE / BUOY_CALIBRATION / REPORT_CALIBRATION = 1 to enable each step
  WEATHER_PROXY_URL, COPERNICUS* -> only for any live point-resolution fallback; optional

Exit: 0 if every ENABLED step succeeded; 1 if L2 had nothing to restore or any enabled step raised. Unlike
the ingest tail (which SWALLOWS these as non-fatal because ingestion is the primary job), here precompute IS
the job — a failure should turn the run RED so it's visible.
"""
import os
import sys
import logging

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("precompute_ci")


def main() -> int:
    if not (os.environ.get("SUPABASE_URL") and
            (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))):
        logger.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required.")
        return 1

    # Restore the latest manifest + lazy products from L2 (same as the Render serve box does on boot). This
    # gives the point resolver the freshly-ingested marine/wind products without re-running ingestion.
    from services.weather_pipeline.store import ProductStore
    try:
        restored, restore_errors = ProductStore().restore_from_supabase()
        logger.info("L2 restore: %d products carried in%s", restored,
                    f" (errors: {restore_errors})" if restore_errors else "")
    except Exception as e:
        logger.error("L2 restore failed — cannot precompute without products: %s", e)
        return 1
    if not restored:
        logger.error("No products restored from L2 — nothing to rate (has an ingest cycle run yet?). Aborting.")
        return 1

    # restore_from_supabase loads the MANIFEST ONLY (lazy products). The point resolver samples GRID FILES
    # from local L1, so on a fresh runner every resolve_point hits an empty cache and returns None → all-null
    # ratings (the in-process ingest path doesn't need this because ingestion already wrote the grids to L1).
    # Warm the near-term grids L2→L1 first — the exact serve-box boot pattern (prefetch_supabase_products).
    import asyncio
    try:
        from services.weather_pipeline.prefetcher import prefetch_supabase_products
        asyncio.run(prefetch_supabase_products())
        logger.info("Grid prewarm (L2→L1) complete — point resolver can now sample real grids.")
    except Exception as e:
        logger.error("Grid prewarm FAILED — ratings would be null without it; aborting: %s", e, exc_info=True)
        return 1

    rc = 0

    if os.environ.get("SPOT_RATINGS_PRECOMPUTE", "0") == "1":
        try:
            from services.weather_pipeline.spot_ratings import run_spot_ratings_precompute
            n_spots, n_frames = run_spot_ratings_precompute()
            logger.info("Spot-ratings precompute complete: %d spots × %d frames → L2.", n_spots, n_frames)
        except Exception as e:
            logger.error("Spot-ratings precompute FAILED: %s", e, exc_info=True)
            rc = 1

    if os.environ.get("BUOY_CALIBRATION", "0") == "1":
        try:
            from services.weather_pipeline.buoy_calibration import run_buoy_calibration
            n_buoys, mae = run_buoy_calibration()
            logger.info("Buoy calibration complete: %d buoy spots, height MAE %s m → L2.", n_buoys, mae)
        except Exception as e:
            logger.error("Buoy calibration FAILED: %s", e, exc_info=True)
            rc = 1

    if os.environ.get("REPORT_CALIBRATION", "0") == "1":
        try:
            from services.weather_pipeline.report_calibration import run_report_calibration
            n_arch, n_match = run_report_calibration()
            logger.info("Report calibration complete: archived %d predictions, matched %d reports → L2.",
                        n_arch, n_match)
        except Exception as e:
            logger.error("Report calibration FAILED: %s", e, exc_info=True)
            rc = 1

    logger.info("Decoupled precompute/calibration done (rc=%d).", rc)
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        import traceback
        logger.error("Fatal error in decoupled precompute: %s", e)
        traceback.print_exc()
        sys.exit(1)
