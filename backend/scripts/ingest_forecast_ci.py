"""
Decoupled forecast-ingestion entrypoint for the GitHub Action (.github/workflows/forecast-ingest.yml).

This is the "strengthen the spine" move: the heavy GRIB-decode + nearest-neighbor ingestion runs HERE
(an ephemeral GitHub runner) instead of on the 1-CPU Render web box, and persists to Supabase L2. The
Render box then restores from L2 and only SERVES — so ingestion compute never again contends with
request latency (the root of the recurring scrub/model-switch/heatmap-blank bugs).

It reuses the EXACT production ingestion (scheduler.forecast.ingest_marine_forecast_task) — same jobs,
same staggering, same direct-source (NOAA/DWD/Copernicus) + open-meteo-fallback wiring — so there is no
behavioural drift between in-process and decoupled ingestion. After the cycle it prints the L2
persistence diagnostics so a run self-verifies the Supabase round-trip (the decoupling's prerequisite).

ENV (set by the workflow from repo secrets):
  NODE_ENV=production, RENDER=true        -> real ingestion (not the test mock), production grid res
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY -> L2 upload target (required)
  COPERNICUSMARINE_SERVICE_USERNAME/PASSWORD (or your Render names) -> EURO marine; optional
  WEATHER_PROXY_URL                       -> open-meteo fallback proxy; optional

Exit code: 0 if the cycle ran AND at least one L2 upload was recorded; 1 otherwise (so a failed
round-trip fails the Action loudly during the verification phase).
"""
import os
import sys
import logging

# Run as if from backend/ (the production trigger runs from ~/project/src/backend).
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("ingest_forecast_ci")


def main() -> int:
    if not (os.environ.get("SUPABASE_URL") and
            (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))):
        logger.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required — without "
                     "them the run produces nothing durable (the runner's disk is ephemeral). Set them "
                     "as Action secrets.")
        return 1

    # ── Restore the previous cycle's manifest from L2 BEFORE ingesting ──────────────────────────────
    # The ephemeral runner starts with an empty store. Without this, the manifest is rebuilt from ZERO and
    # uploaded progressively over the ~60-90 min cycle, so Render's periodic L2 restore catches PARTIAL
    # snapshots — layers that ingest late (EURO marine components save after EURO waves; ICON marine; the
    # pressure trio) transiently DISAPPEAR from the served manifest mid-cycle even though they were complete
    # last cycle (the "EURO components / ICON marine intermittently won't load" bug). Restoring first means
    # each job's prune_superseded swaps only its OWN layer in place; every other layer keeps last cycle's
    # products (≤3h old, still valid) so the manifest is NEVER emptier than last-complete. Manifest-only
    # (product grids stay lazy in L2 via load_product) -> cheap. No-op on the first ever run (empty L2).
    from services.weather_pipeline.store import ProductStore
    try:
        restored, restore_errors = ProductStore().restore_from_supabase()
        logger.info("Pre-ingest L2 restore: %d products carried over from last cycle%s",
                    restored, f" (errors: {restore_errors})" if restore_errors else "")
    except Exception as _re:
        logger.warning("Pre-ingest L2 restore failed (continuing from empty store): %s", _re)

    logger.info("Starting decoupled forecast ingestion (reusing production ingest_marine_forecast_task)...")
    from scheduler.forecast import ingest_marine_forecast_task
    ingest_marine_forecast_task()  # synchronous; manages its own event loop + per-job isolation

    # ── P1 increment 3: precompute per-spot surf ratings → L2 (off the 1-CPU serve box) ──────────────────
    # AFTER ingestion (so the store holds fresh marine + wind products), rate every active surf spot for the
    # current frame and upload a small JSON object to L2; the serve box reads it (source="precomputed") and
    # falls back to live compute otherwise. Flag-gated OFF by default + fully guarded so it can NEVER fail the
    # ingest cycle (the products are already persisted above). Enable with SPOT_RATINGS_PRECOMPUTE=1.
    if os.environ.get("SPOT_RATINGS_PRECOMPUTE", "0") == "1":
        try:
            from services.weather_pipeline.spot_ratings import run_spot_ratings_precompute
            n_spots, n_frames = run_spot_ratings_precompute()
            logger.info("Spot-ratings precompute complete: %d spots × %d frames → L2.", n_spots, n_frames)
        except Exception as _spe:
            logger.warning("Spot-ratings precompute skipped (non-fatal, ingestion already persisted): %s", _spe)

    # The store records L2 outcomes at class level, so a fresh instance reads this process's results.
    from services.weather_pipeline.store import ProductStore
    diag = ProductStore().get_persistence_diagnostics()
    logger.info("L2 DIAGNOSTICS: %s", diag)

    if not diag.get("last_upload_time"):
        logger.error("No L2 upload was recorded this run — Supabase creds missing or every upload failed. "
                     "Check SUPABASE_* secrets + last_upload_errors above.")
        return 1
    if diag.get("last_upload_errors"):
        logger.warning("Some L2 uploads failed: %s", diag.get("last_upload_errors"))
    logger.info("Decoupled ingestion complete — products are in Supabase L2 for the Render box to restore.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        import traceback
        logger.error("Fatal error in decoupled ingestion: %s", e)
        traceback.print_exc()
        sys.exit(1)
