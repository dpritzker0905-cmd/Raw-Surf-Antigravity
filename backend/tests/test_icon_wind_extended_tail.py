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
    # Tail: estimated from index 0, loop-extrapolation basis, pre-aligned to the 3h lattice and
    # saved entry-by-entry (step=1 over 3-hourly entries). The old blind step=3 from the slice
    # start produced native_max+1h/+4h/+7h — permanently off the scrub lattice (2026-07-30:
    # all 52 live tail products sat at :13/:16/:19/:22, so every slot served a substituted
    # neighbour forever).
    assert tail["estimated_after_index"] == 0
    assert tail["step"] == 1
    assert tail["estimate_basis"]["type"] == "icon_loop_extrapolation"

    # The tail starts STRICTLY AFTER the native max, lands ON the 3-hourly UTC lattice within one
    # lattice step, and reaches ~336h at 3-hourly cadence.
    native_max = _parse_om_time(_dwd_results(1)[0]["hourly"]["time"][-1])
    tail_times = [_parse_om_time(t) for t in tail["results"][0]["hourly"]["time"]]
    assert tail_times[0] > native_max
    assert (tail_times[0] - native_max).total_seconds() <= 3 * 3600
    assert all(t.minute == 0 and t.hour % 3 == 0 for t in tail_times)
    assert len(tail_times) >= (14 * 24 - NATIVE_HOURS) // 3 - 1  # ~52 lattice entries beyond the native max

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


def test_slice_hours_after_lattice_alignment():
    """align_step_h=3 keeps only entries ON the 3-hourly UTC lattice — re-enacts the off-lattice
    defect: a native end at ..T14:00 used to yield a tail at 15:00 via +1h then blind step-3 from
    wherever the slice began; with an end at ..T12:00 it yielded 13:00/16:00/19:00 forever."""
    results = _dwd_results(1)
    # Cut at an off-lattice hour (base+14h = 14:00 UTC since base is midnight-aligned)
    cut = _parse_om_time(results[0]["hourly"]["time"][14])
    sliced = _slice_hours_after(results, cut, align_step_h=3)
    assert sliced is not None
    times = [_parse_om_time(t) for t in sliced[0]["hourly"]["time"]]
    assert times[0].hour == 15  # next lattice hour after 14:00, NOT 15:00-shifted-off-grid
    assert all(t.minute == 0 and t.hour % 3 == 0 for t in times)
    assert all(t > cut for t in times)
    # spacing is exactly 3h — entry-by-entry save (step=1) preserves the lattice
    assert all((b - a).total_seconds() == 3 * 3600 for a, b in zip(times, times[1:]))
    # cut exactly ON the lattice: first kept entry is the NEXT lattice hour, not the cut itself
    cut_on = _parse_om_time(results[0]["hourly"]["time"][12])
    sliced_on = _slice_hours_after(results, cut_on, align_step_h=3)
    assert _parse_om_time(sliced_on[0]["hourly"]["time"][0]) == cut_on + timedelta(hours=3)
