"""Live local forecast qualification via the real scheduler tracking wrapper.

No mock providers or synthetic forecasts. The native multi-model aggregate is
not qualified here; two bounded legacy ingestion functions run once for real.
"""
from datetime import datetime, timedelta, timezone
import json

import logfire
from scheduler.base import tracked
from services.forecast_ingester import ingest_global_model


def register_local_forecast_jobs(scheduler, run_id, data_dir):
    for offset, domain in enumerate(("wind", "marine")):
        async def run(domain=domain):
            with logfire.span("Local scheduled forecast {domain}", domain=domain, local_startup_run_id=run_id):
                try:
                    success = await ingest_global_model(domain)
                    if success is not True:
                        raise RuntimeError(f"Live {domain} ingestion returned no data; no fallback accepted")
                    path = data_dir / "forecast_cache" / f"{domain}_global.json"
                    rows = json.loads(path.read_text(encoding="utf-8"))
                    if not rows or not all(row.get("hourly", {}).get("time") for row in rows):
                        raise RuntimeError(f"Live {domain} cache is empty or missing hourly forecast times")
                    logfire.info("Local forecast verified {domain}", domain=domain, points=len(rows),
                                 local_startup_run_id=run_id, forecast_source="live-provider")
                except Exception:
                    logfire.exception("Local forecast failed {domain}", domain=domain,
                                      local_startup_run_id=run_id)
                    raise

        job_id = f"local_forecast_{domain}"
        scheduler.add_job(tracked(job_id, f"Local live {domain} qualification", "One-shot", run),
                          "date", run_date=datetime.now(timezone.utc) + timedelta(seconds=2 + offset * 5),
                          id=job_id, replace_existing=True)
