"""Known spot metadata must survive an unavailable optional forecast, without invented readings."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from routes.explore_discover import spot_details as route


def database(spot_exists=True):
    spot = SimpleNamespace(id="deadline-spot", name="Known beach", region="Test coast",
                           difficulty="intermediate", image_url=None, latitude=28.4,
                           longitude=-80.6, description="Known metadata", best_tide=None)
    first = Mock()
    first.scalar_one_or_none.return_value = spot if spot_exists else None
    empty = Mock()
    empty.scalars.return_value.all.return_value = []
    return SimpleNamespace(execute=AsyncMock(side_effect=[first, empty, empty, empty, empty]))


async def read(db):
    return await route.get_spot_details("deadline-spot", subscription_tier="premium", model="ICON", db=db)


@pytest.mark.asyncio
async def test_stalled_forecast_is_cancelled_and_known_spot_survives(monkeypatch):
    cancelled = asyncio.Event()

    async def stall(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(route, "SPOT_FORECAST_TIMEOUT_SECONDS", 0.01, raising=False)
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", stall)
    db = database()
    result = await asyncio.wait_for(read(db), timeout=1)
    assert cancelled.is_set()
    assert result["id"] == "deadline-spot" and result["name"] == "Known beach"
    assert result["forecast_status"] == "unavailable"
    assert result["current_conditions"] is None and result["forecast"] == []
    assert result["active_photographers"] == [] and result["recent_posts"] == []
    assert db.execute.await_count == 5


@pytest.mark.asyncio
async def test_ready_forecast_keeps_composition_and_request_identity(monkeypatch):
    conditions = {"current_conditions": {"wave_height_ft": 2.3, "quality": 71},
                  "forecast": [{"date": "2026-10-17", "wave_height_max": 3.1}]}
    resolver = AsyncMock(return_value=conditions)
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    result = await read(database())
    assert result["current_conditions"] == conditions["current_conditions"]
    assert result["forecast"] == conditions["forecast"] and result["forecast_status"] == "ready"
    resolver.assert_awaited_once_with(model="ICON", lat=28.4, lng=-80.6, forecast_days=11, spot_id="deadline-spot")


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [TimeoutError(), RuntimeError("upstream unavailable")])
async def test_failed_forecast_does_not_erase_spot_or_invent_zero(monkeypatch, failure):
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", AsyncMock(side_effect=failure))
    result = await read(database())
    assert result["name"] == "Known beach" and result["forecast_status"] == "unavailable"
    assert result["current_conditions"] is None and result["forecast"] == []


@pytest.mark.asyncio
async def test_missing_spot_still_has_original_not_found_contract(monkeypatch):
    resolver = AsyncMock()
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    assert await read(database(False)) == {"error": "Spot not found"}
    resolver.assert_not_called()


@pytest.mark.asyncio
async def test_request_cancellation_propagates_without_optional_queries(monkeypatch):
    started = asyncio.Event()

    async def stall(**kwargs):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", stall)
    db = database()
    task = asyncio.create_task(read(db))
    await asyncio.wait_for(started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert db.execute.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("conditions,status", [
    (None, "unavailable"), ({}, "unavailable"),
    ({"current_conditions": None, "forecast": []}, "unavailable"),
    ({"forecast": [{"date": "2026-10-17"}]}, "ready"),
])
async def test_empty_or_partial_forecast_is_labelled_honestly(monkeypatch, conditions, status):
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", AsyncMock(return_value=conditions))
    result = await read(database())
    assert result["forecast_status"] == status
    assert result["current_conditions"] is None
