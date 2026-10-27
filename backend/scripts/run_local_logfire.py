"""Run the real backend with Logfire and an isolated local SQLite database.

From the repository root: .venv/Scripts/python backend/scripts/run_local_logfire.py
Requires the backend dependencies plus aiosqlite and truststore. By default
TESTING=1 keeps scheduler/ingestion jobs off. --enable-jobs enables the scheduler
after lifespan, disables mock fallback, and schedules bounded live forecast jobs.
This process never loads application .env files or inherits provider credentials.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import sys
from uuid import uuid4


async def main(port, enable_jobs=False, full_forecast_cycle=False, enable_gateway=False, enable_forecast_recovery=False,
               enable_copernicus=False):
    root = Path(__file__).resolve().parents[2]
    data_dir = root / ".logfire"
    data_dir.mkdir(exist_ok=True)
    # Preserve only Windows runtime/certificate locations, not service credentials.
    keep = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "COMMONPROGRAMFILES",
            "COMSPEC", "SSL_CERT_FILE", "SSL_CERT_DIR"}
    for key in list(os.environ):
        if key.upper() not in keep:
            del os.environ[key]
    run_id = str(uuid4())
    instance = "local-logfire-" + run_id
    os.environ.update({
        "DATABASE_URL": "sqlite+aiosqlite:///" + (data_dir / "local-backend.sqlite3").as_posix(),
        "ENV": "local", "TESTING": "1", "LOGFIRE_ENABLED": "1",
        "LOGFIRE_ENVIRONMENT": "local", "OTEL_METRIC_EXPORT_INTERVAL": "5000",
        "OTEL_RESOURCE_ATTRIBUTES": "service.instance.id=" + instance,
        "SECRET_KEY": secrets.token_urlsafe(48),
        "L2_WRITER": "0", "WORKFLOW_DISPATCH": "0", "PREFETCH_DISABLED": "1",
        "FORECAST_STARTUP_DELAY_SEC": "0",
    })
    if enable_forecast_recovery:
        os.environ.update(MARINE_EMPTY_FRAME_FALLBACK="1", EURO_MARINE_FALLBACK_CACHE_REUSE="1",
                          NOAA_WAVE_INDEX_RETRY="1", EURO_MARINE_LATTICE_VALIDATION="1",
                          INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS="1",
                          LATTICE_FILL_AFTER_PILOTS="1", LATTICE_REGIONAL_WIND_FILL="1",
                          MID_RES_EXACT_TIME_ESTIMATE="1", EURO_MARINE_NATIVE_TAIL_CADENCE="1")
    if full_forecast_cycle:
        os.environ.update({"MARINE_INGEST_ALL": "1", "INGEST_PILOTS": "include",
                           "ECMWF_OPENDATA_SOURCE": "google"})
        # Fetcher subprocesses inherit TLS verification, dotenv isolation and private temp.
        bootstrap = data_dir / "fetcher-bootstrap"
        bootstrap.mkdir(exist_ok=True)
        (bootstrap / "sitecustomize.py").write_text(
            "import os\nos.environ.pop('PYDANTIC_AI_GATEWAY_API_KEY', None)\n"
            "import truststore, dotenv\ntruststore.inject_into_ssl()\n"
            "dotenv.load_dotenv = lambda *a, **k: False\n", encoding="utf-8")
        os.environ["PYTHONPATH"] = str(bootstrap)
        private_temp = data_dir / "forecast-temp"
        private_temp.mkdir(exist_ok=True)
        os.environ["TEMP"] = os.environ["TMP"] = str(private_temp)
    import dotenv
    import truststore
    truststore.inject_into_ssl()
    if enable_gateway:
        # Opt in to Gateway only; never load unrelated application credentials.
        for name, value in dotenv.dotenv_values(root / "backend" / ".env").items():
            if name.startswith("PYDANTIC_AI_GATEWAY_") and value:
                os.environ[name] = value
    # The app's pinned dotenv version lacks PYTHON_DOTENV_DISABLED support.
    dotenv.load_dotenv = lambda *args, **kwargs: False
    sys.path.insert(0, str(root / "backend"))
    if enable_copernicus:
        from scripts.local_copernicus_auth import enable_local_copernicus
        enable_local_copernicus(root)
    os.chdir(root / "backend")
    # Route every default store instance to private data; retain real store methods.
    from services.weather_pipeline.store import ProductStore
    original_store_init = ProductStore.__init__

    def local_store_init(self, cache_dir=None):
        original_store_init(self, cache_dir=cache_dir or data_dir / "weather_products")

    ProductStore.__init__ = local_store_init
    from services import forecast_ingester
    forecast_ingester.CACHE_DIR = data_dir / "forecast_cache"
    import logfire
    import uvicorn
    from server import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, loop="asyncio"))

    async def receipt_when_ready():
        while not server.started and not server.should_exit:
            await asyncio.sleep(0.1)
        if not server.started:
            return
        if enable_jobs:
            # Lifespan's TESTING switch suppresses uncontrolled boot ingestion only.
            # Turn it off before any real forecast runs: no mock fallback permitted.
            os.environ["TESTING"] = "0"
            from scheduler import start_scheduler, scheduler
            from scripts.local_forecast_jobs import register_local_forecast_jobs
            if full_forecast_cycle:
                from scripts.local_full_forecast_cycle import install_full_cycle_probe
                install_full_cycle_probe(run_id, data_dir)
            start_scheduler()
            # Full multi-model GRIB/Copernicus runs need separate credentials/runtime.
            if full_forecast_cycle:
                from datetime import datetime, timedelta, timezone
                scheduler.modify_job("ingest_marine_forecast", next_run_time=datetime.now(timezone.utc) + timedelta(seconds=3))
            else:
                scheduler.pause_job("ingest_marine_forecast")
                register_local_forecast_jobs(scheduler, run_id, data_dir)
        logfire.info("Local backend started {local_startup_run_id}", local_startup_run_id=run_id)
        receipt = {"local_startup_run_id": run_id, "service_instance_id": instance,
                   "pid": os.getpid(), "url": f"http://127.0.0.1:{port}",
                   "routes": len(app.routes), "database": "isolated local SQLite",
                   "gateway_enabled": enable_gateway,
                   "copernicus_credentials_enabled": enable_copernicus,
                   "forecast_recovery_enabled": enable_forecast_recovery,
                   "external_jobs": "scheduler enabled; full native forecast cycle" if full_forecast_cycle
                   else "scheduler enabled; bounded live wind/marine jobs" if enable_jobs
                   else "disabled by TESTING=1",
                   "aggregate_forecast_job": "enabled full native cycle" if full_forecast_cycle
                   else ("paused" if enable_jobs else "not registered")}
        (data_dir / "local-backend-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
        print(json.dumps(receipt), flush=True)

    watcher = asyncio.create_task(receipt_when_ready())
    try:
        await server.serve()
    finally:
        watcher.cancel()
        logfire.force_flush(timeout_millis=10000)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--enable-jobs", action="store_true", help="Enable scheduler and bounded live forecast jobs")
    parser.add_argument("--full-forecast-cycle", action="store_true", help="Run the actual full native multi-model cycle")
    parser.add_argument("--enable-gateway", action="store_true", help="Read only Gateway variables from backend/.env")
    parser.add_argument("--enable-copernicus", action="store_true", help="Read only the ignored local Marine Toolbox file")
    parser.add_argument("--enable-forecast-recovery", action="store_true", help="Arm default-off ingestion recovery flags locally")
    args = parser.parse_args()
    asyncio.run(main(args.port, args.enable_jobs or args.full_forecast_cycle, args.full_forecast_cycle,
                     args.enable_gateway, args.enable_forecast_recovery, args.enable_copernicus))
