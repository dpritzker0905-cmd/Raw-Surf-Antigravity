"""Audit #22 (2026-07-10): the DWD-direct ICON wind ingest now PRE-BAKES the 14d loop-extrapolated
tail (the extension previously ran only on the open-meteo fallback path), so far-hour ICON wind
serves from stored estimated products instead of the on-demand 629-pt dynamic build (measured >40s
cold on Render; open-meteo 503s under load). Natives stay authoritative; the tail saves 3-hourly,
estimated_after_index=0 — cf0b4b23's prune rule keeps the OLD tail serving until the new one lands.
Kill switch: ICON_WIND_EXTEND=0."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.weather_pipeline.wind_ingestion import (
    ingest_icon_wind_global_impl,
    _slice_hours_after,
    _parse_om_time,
)

NATIVE_HOURS = 180


def _dwd_results(points=3):
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(NATIVE_HOURS)]
    return [
        {
            "latitude": 10.0 * i, "longitude": 10.0 * i,
            "hourly": {
                "time": list(times),
                "wind_speed_10m": [5.0 + (h % 24) for h in range(NATIVE_HOURS)],
                "wind_direction_10m": [(h * 3) % 360 for h in range(NATIVE_HOURS)],
                "wind_gusts_10m": [7.0 + (h % 24) for h in range(NATIVE_HOURS)],
            },
        }
        for i in range(points)
    ]


def _scheduler():
    s = MagicMock()
    s.normalizer = MagicMock()
    s.store = MagicMock()
    s._cleanup_and_pause = AsyncMock()
    s._fetch_or_mock = AsyncMock(return_value=None)  # open-meteo fallback never used in these tests
    return s


@pytest.mark.asyncio
async def test_dwd_path_saves_natives_plus_extended_estimated_tail(monkeypatch):
    monkeypatch.delenv("ICON_WIND_EXTEND", raising=False)
    monkeypatch.setenv("ICON_WIND_DWD_DIRECT", "1")
    sched = _scheduler()
    save_calls = []

    async def record_save(normalizer, store, results, **kw):
        save_calls.append({"results": results, **kw})
        return len(results)

    with patch("services.dwd_wind_service.fetch_icon_wind_global_coarse", new=AsyncMock(return_value=_dwd_results())), \
         patch("services.weather_pipeline.wind_ingestion.normalize_and_save_loop", new=record_save):
        ok = await ingest_icon_wind_global_impl(sched)

    assert ok is True
    assert len(save_calls) == 2, "expected the native save AND the extended-tail save"

    native, tail = save_calls
    # Natives: authoritative (no estimation), hourly.
    assert native["estimated_after_index"] is None
    assert native["step"] == 1
    # Tail: estimated from index 0, 3-hourly, loop-extrapolation basis.
    assert tail["estimated_after_index"] == 0
    assert tail["step"] == 3
    assert tail["estimate_basis"]["type"] == "icon_loop_extrapolation"

    # The tail slice starts STRICTLY AFTER the native max and reaches ~336h.
    native_max = _parse_om_time(_dwd_results(1)[0]["hourly"]["time"][-1])
    tail_times = tail["results"][0]["hourly"]["time"]
    assert _parse_om_time(tail_times[0]) > native_max
    assert len(tail_times) >= (14 * 24 - NATIVE_HOURS) - 1  # ~156 hourly entries beyond the native max

    sched.store.prune_superseded_products.assert_called_once()  # one prune covering both saves


@pytest.mark.asyncio
async def test_kill_switch_restores_natives_only(monkeypatch):
    monkeypatch.setenv("ICON_WIND_EXTEND", "0")
    monkeypatch.setenv("ICON_WIND_DWD_DIRECT", "1")
    sched = _scheduler()
    save_calls = []

    async def record_save(normalizer, store, results, **kw):
        save_calls.append(kw)
        return len(results)

    with patch("services.dwd_wind_service.fetch_icon_wind_global_coarse", new=AsyncMock(return_value=_dwd_results())), \
         patch("services.weather_pipeline.wind_ingestion.normalize_and_save_loop", new=record_save):
        ok = await ingest_icon_wind_global_impl(sched)

    assert ok is True
    assert len(save_calls) == 1  # natives only — the pre-#22 behavior exactly


def test_slice_hours_after_trims_strictly_after():
    results = _dwd_results(1)
    cut = _parse_om_time(results[0]["hourly"]["time"][100])
    sliced = _slice_hours_after(results, cut)
    assert sliced is not None
    assert _parse_om_time(sliced[0]["hourly"]["time"][0]) > cut
    assert len(sliced[0]["hourly"]["time"]) == NATIVE_HOURS - 101
    assert len(sliced[0]["hourly"]["wind_speed_10m"]) == NATIVE_HOURS - 101
    # empty when nothing is after the cut
    assert _slice_hours_after(results, _parse_om_time(results[0]["hourly"]["time"][-1])) is None
