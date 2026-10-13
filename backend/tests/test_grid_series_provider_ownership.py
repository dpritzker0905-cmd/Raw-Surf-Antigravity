"""Exercise real series builders through their provider boundary after caller timeout."""
import asyncio
import gc
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_series_helper as series
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct


def _stored(model, base):
    bounds = CoverageBounds(west=-81, south=27, east=-80.5, north=27.5)
    return NormalizedProduct(
        model=model, provider="stored-control", domain="marine", layer="waves",
        run_time=base, valid_time=base, is_forecast_authoritative=True, is_estimated=False,
        coverage=bounds, grid=NormalizedGrid(bounds=bounds, cols=2, rows=2,
            vectors=[GridVector(lat=27, lng=-81, speed=1.0)]),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id="stored-control.json",
    )


@pytest.mark.parametrize("model", ["GFS", "ICON", "EURO"])
@pytest.mark.parametrize("late,fail", [(False, False), (False, True), (True, False), (True, True)])
def test_provider_completion_is_owned_after_series_fallback(monkeypatch, caplog, model, late, fail):
    """Timeout must still warm the cache, but a later refusal must have an owner."""
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH_WAIT_SEC", "0.05")
    monkeypatch.setenv("EURO_SERIES_LIVE_COPERNICUS", "1")
    monkeypatch.setattr(series, "EURO_SERIES_TIMEOUT", 0.05)
    caplog.set_level(logging.WARNING)

    async def exercise():
        base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        entered, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        if not late:
            release.set()
        calls, normalized, resolved, unhandled = [], [], [], []
        cached = []
        loop = asyncio.get_running_loop()
        prior = loop.get_exception_handler()
        loop.set_exception_handler(lambda loop, context: unhandled.append(context.get("message")))

        async def fetch(self, **kwargs):
            calls.append(kwargs)
            entered.set()
            if cached:
                return cached[0]
            await release.wait()
            try:
                if fail:
                    raise RuntimeError("synthetic breaker refusal")
                lats, lons = kwargs["precomputed_coords"]
                raw = [{"latitude": lat, "longitude": lon, "hourly": {
                    "time": [base.strftime("%Y-%m-%dT%H:%M")],
                    "wave_height": [1.5], "wave_direction": [90.0], "wave_period": [10.0],
                }} for lat, lon in zip(lats, lons)]
                cached.append(raw)
                return raw
            finally:
                completed.set()

        async def resolve(**kwargs):
            resolved.append(kwargs)
            return _stored(model, base)

        normalizer = WeatherNormalizer()
        async def normalize(**kwargs):
            normalized.append(kwargs)
            return await normalizer.normalize_async(**kwargs)

        vp = SimpleNamespace(normalizer=SimpleNamespace(normalize_async=normalize))
        cls = CopernicusProvider if model == "EURO" else OpenMeteoProvider
        monkeypatch.setattr(cls, "fetch_grid", fetch)
        try:
            result = await asyncio.wait_for(series.build_grid_series(
                resolve, vp, model, "marine", "waves", "-81,27,-80.5,27.5", "0"), timeout=3)
            assert entered.is_set() and len(calls) == 1
            if late:
                assert not completed.is_set(), "provider was cancelled or awaited past the fallback budget"
                assert not normalized, "timed-out data was normalized into the abandoned request"
                assert result["frame_count"] == (0 if model == "EURO" else 1)
                release.set()
                await asyncio.wait_for(completed.wait(), timeout=1)
            elif fail:
                assert result["frame_count"] == (0 if model == "EURO" else 1)
            else:
                assert result["frame_count"] == 1 and not resolved
                assert result["frames"][0]["provider"] == ("copernicus" if model == "EURO" else "open-meteo")
            for _ in range(5):
                await asyncio.sleep(0)
            gc.collect()
            await asyncio.sleep(0)
            assert not unhandled, f"provider completion lost its owner: {unhandled}"
            from services.weather_pipeline.provider_fetches import _background_fetches
            assert not _background_fetches, "completed fetches retained by their owner"
            if late and fail:
                assert any("provider fetch" in r.getMessage() and "RuntimeError" in r.getMessage()
                           for r in caplog.records), "detached provider failure was silently discarded"
            if not fail:
                assert cached, "timeout lost the historical cache-warming behavior"
                if late:
                    warm = await series.build_grid_series(resolve, vp, model, "marine", "waves",
                                                          "-81,27,-80.5,27.5", "0")
                    assert warm["frame_count"] == 1 and normalized
                    assert warm["frames"][0]["vectors"]
            return result
        finally:
            release.set()
            for _ in range(5):
                await asyncio.sleep(0)
            loop.set_exception_handler(prior)

    asyncio.run(exercise())


@pytest.mark.parametrize("provider_outcome", ["success", "failure", "cancelled"])
def test_caller_cancellation_preserves_warming_and_retires_owner(provider_outcome):
    from services.weather_pipeline.provider_fetches import await_provider_fetch, _background_fetches

    async def exercise():
        entered, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        unhandled = []
        loop = asyncio.get_running_loop()
        prior = loop.get_exception_handler()
        loop.set_exception_handler(lambda loop, context: unhandled.append(context.get("message")))

        async def fetch():
            entered.set()
            await release.wait()
            try:
                if provider_outcome == "cancelled":
                    raise asyncio.CancelledError()
                if provider_outcome == "failure":
                    raise RuntimeError("synthetic provider error")
                return "cached"
            finally:
                completed.set()

        try:
            caller = asyncio.create_task(await_provider_fetch(fetch(), provider="control"))
            await entered.wait()
            assert len(_background_fetches) == 1
            caller.cancel()
            with pytest.raises(asyncio.CancelledError):
                await caller
            assert not completed.is_set()
            release.set()
            await asyncio.wait_for(completed.wait(), timeout=1)
            for _ in range(5):
                await asyncio.sleep(0)
            gc.collect()
            assert not _background_fetches and not unhandled
        finally:
            release.set()
            for _ in range(5):
                await asyncio.sleep(0)
            loop.set_exception_handler(prior)

    asyncio.run(exercise())
