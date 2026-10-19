"""Observe the actual full native cycle without replacing provider or math code."""
from datetime import datetime, timezone
from functools import wraps
import json
import threading

import logfire


def install_full_cycle_probe(run_id, data_dir):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    import scheduler
    import scheduler.forecast as forecast

    report = {"run_id": run_id, "status": "pending", "jobs": [], "mock_fallback": False}
    lock = threading.Lock()
    target = data_dir / "full-forecast-cycle.json"

    def save():
        # One writer under lock; atomic replace allows concurrent local readback.
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(report, indent=2), encoding="utf-8")
        temp.replace(target)

    def instrument(name, original):
        @wraps(original)
        async def observed(self, *args, **kwargs):
            row = {"job": name, "started_at": datetime.now(timezone.utc).isoformat(), "status": "running"}
            with lock:
                report["jobs"].append(row)
                save()
            with logfire.span("Full local forecast job {forecast_job}", forecast_job=name, forecast_cycle_id=run_id):
                try:
                    value = await original(self, *args, **kwargs)
                    row["status"] = "failed" if value is False else "returned"
                    row["returned"] = value if isinstance(value, (bool, int, str, type(None))) else type(value).__name__
                    logfire.info("Full forecast job result {forecast_job}", forecast_job=name,
                                 forecast_cycle_id=run_id, job_result=row["status"])
                    return value
                except Exception as exc:
                    row["status"] = "failed"
                    row["exception_type"] = type(exc).__name__
                    logfire.exception("Full forecast job error {forecast_job}", forecast_job=name, forecast_cycle_id=run_id)
                    raise
                finally:
                    row["finished_at"] = datetime.now(timezone.utc).isoformat()
                    with lock:
                        save()
        return observed

    for name, method in list(vars(WeatherPipelineScheduler).items()):
        if name.startswith("ingest_"):
            setattr(WeatherPipelineScheduler, name, instrument(name, method))

    original_cycle = forecast.ingest_marine_forecast_task

    @wraps(original_cycle)
    def cycle():
        report["status"] = "running"
        report["started_at"] = datetime.now(timezone.utc).isoformat()
        with lock:
            save()
        with logfire.span("Full local multi-model forecast cycle", forecast_cycle_id=run_id):
            try:
                original_cycle()
                failures = [j for j in report["jobs"] if j["status"] == "failed"]
                if failures or not report["jobs"]:
                    report["status"] = "partial"
                    raise RuntimeError(f"Native cycle has {len(failures)} failed conformed jobs; inspect local report")
                report["status"] = "finished_requires_product_validation"
                logfire.info("Full local forecast cycle finished", forecast_cycle_id=run_id,
                             jobs_observed=len(report["jobs"]))
            except Exception:
                if report["status"] != "partial":
                    report["status"] = "failed"
                raise
            finally:
                report["finished_at"] = datetime.now(timezone.utc).isoformat()
                with lock:
                    save()

    scheduler.ingest_marine_forecast_task = cycle
    with lock:
        save()
