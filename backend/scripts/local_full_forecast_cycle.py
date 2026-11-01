"""Observe the actual full native cycle without replacing provider or math code."""
from datetime import datetime, timezone
from functools import wraps
import asyncio
import json
import math
import os
import threading

import logfire


def _verified_euro_extension_noop(store):
    """Fail closed unless this fresh coarse-only input already has every real GFS tail frame."""
    try:
        rows = [p for p in store.get_manifest().products if p.model in ("EURO", "GFS") and p.domain == "marine"]
        if not rows or any(p.region_id != "global_coarse" for p in rows):
            return None
        checks = []
        for layer in ("waves", "swell_1", "swell_2", "wind_waves"):
            euro = [p for p in rows if p.model == "EURO" and p.layer == layer]
            native = [p for p in euro if not p.is_estimated and not p.is_test_fixture]
            gfs = [p for p in rows if p.model == "GFS" and p.layer == layer]
            if not native or not gfs or any(p.is_estimated or p.is_test_fixture or not p.is_forecast_authoritative for p in gfs):
                return None
            native_end = max(p.valid_time_start for p in native)
            targets = [p for p in gfs if p.valid_time_start > native_end]
            by_time = {p.valid_time_start: p for p in euro}
            if not targets or max(by_time) < max(p.valid_time_start for p in gfs):
                return None
            for parent in targets:
                item = by_time.get(parent.valid_time_start)
                if item is None:
                    return None
                product, source = store.load_product(item.filename), store.load_product(parent.filename)
                if not product or not source or product.is_test_fixture or source.is_test_fixture:
                    return None
                if (product.model, product.domain, product.layer, product.region_id, product.valid_time) != (
                        "EURO", "marine", layer, "global_coarse", parent.valid_time_start):
                    return None
                if (source.model, source.domain, source.layer, source.region_id, source.valid_time) != (
                        "GFS", "marine", layer, "global_coarse", parent.valid_time_start):
                    return None
                if not product.is_estimated or product.is_forecast_authoritative or source.is_estimated or not source.is_forecast_authoritative:
                    return None
                if not product.grid or not source.grid or product.grid.vectors != source.grid.vectors:
                    return None
                valid = [v for v in product.grid.vectors if v.is_valid]
                if not valid or any(v.speed is None or not math.isfinite(v.speed) for v in valid):
                    return None
            checks.append({"layer": layer, "native_end": native_end.isoformat(),
                           "latest_euro": max(by_time).isoformat(),
                           "latest_gfs": max(p.valid_time_start for p in gfs).isoformat(),
                           "remaining_extension_targets": 0, "tail_products_checked": len(targets)})
        return {"classification": "verified_complete_parent_backed_tail_noop", "read_only_check": True,
                "checks": checks, "tail_products_checked": sum(c["tail_products_checked"] for c in checks)}
    except Exception:
        return None


def _completed_job_status(name, value, store):
    if value is not False:
        return "returned", None
    if name == "ingest_euro_marine_extended_estimates" and os.environ.get("EURO_MARINE_NATIVE_TAIL_CADENCE", "0") == "1":
        proof = _verified_euro_extension_noop(store)
        if proof:
            return "no_op", proof
    return "failed", None


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
                    row["status"], proof = await asyncio.to_thread(_completed_job_status, name, value, self.store)
                    row["returned"] = value if isinstance(value, (bool, int, str, type(None))) else type(value).__name__
                    if proof:
                        row["verified_noop"] = proof
                        (data_dir / "extension-noop-proof.json").write_text(json.dumps(
                            {"cycle_id": run_id, "raw_returned": False, **proof}, indent=2), encoding="utf-8")
                    logfire.info("Full forecast job result {forecast_job}", forecast_job=name,
                                 forecast_cycle_id=run_id, job_result=row["status"],
                                 job_returned_bool=value if isinstance(value, bool) else None,
                                 verified_tail_noop=proof is not None)
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
