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

    logger.info("Starting decoupled forecast ingestion (reusing production ingest_marine_forecast_task)...")
    from scheduler.forecast import ingest_marine_forecast_task
    ingest_marine_forecast_task()  # synchronous; manages its own event loop + per-job isolation

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
