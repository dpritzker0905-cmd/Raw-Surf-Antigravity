"""
Guards the EURO/GFS wind staleness fix: the 3-hourly forecast task must ingest wind global-coarse
for ALL THREE models. Previously only ICON wind was scheduled (GFS/EURO marine + pressure were, but
wind only had ICON), so GFS/EURO *_wind_global_coarse products went stale — EURO's last run was ~2
weeks old. A typo in a scheduler method name would be swallowed by the task's per-job try/except and
silently skip the job, so we lock the method names AND that all three are referenced in the task.
"""
import inspect

from services.weather_pipeline.scheduler import WeatherPipelineScheduler
from scheduler import forecast


def test_weather_scheduler_exposes_all_global_wind_methods():
    for name in ("ingest_gfs_wind_global", "ingest_euro_wind_global", "ingest_icon_wind_global"):
        m = getattr(WeatherPipelineScheduler, name, None)
        assert m is not None, f"WeatherPipelineScheduler is missing {name}"
        assert inspect.iscoroutinefunction(m), f"{name} must be async"


def test_forecast_task_schedules_all_three_wind_models():
    src = inspect.getsource(forecast.ingest_marine_forecast_task)
    for fn in ("ingest_icon_wind_global", "ingest_gfs_wind_global", "ingest_euro_wind_global"):
        assert fn in src, f"{fn} is not scheduled in ingest_marine_forecast_task (wind would go stale)"


def test_weather_scheduler_exposes_all_global_marine_methods():
    for name in ("ingest_gfs_marine_global", "ingest_euro_marine_global", "ingest_icon_marine_global"):
        m = getattr(WeatherPipelineScheduler, name, None)
        assert m is not None, f"WeatherPipelineScheduler is missing {name}"
        assert inspect.iscoroutinefunction(m), f"{name} must be async"


def test_forecast_task_staggers_marine_globals_keeping_all_three_referenced():
    """ICON marine global went 4 days stale: all three heavy global-marine fetches ran in ONE cycle,
    open-meteo 429'd the 3rd (ICON, always last) every run, so hours past its stale coverage fell to
    the OOM-prone dynamic /grid -> CORS-less 500 -> blank ICON heatmap. The fix keeps GFS every-run and
    ALTERNATES EURO/ICON (<=2 heavy marine fetches per cycle). Guard both halves of that fix."""
    src = inspect.getsource(forecast.ingest_marine_forecast_task)
    for fn in ("ingest_gfs_marine_global", "ingest_euro_marine_global", "ingest_icon_marine_global"):
        assert fn in src, f"{fn} is not referenced in ingest_marine_forecast_task (marine would go stale)"
    assert "_marine_alt" in src, "marine stagger (_marine_alt) missing — all-three-per-cycle starves ICON (429)"
