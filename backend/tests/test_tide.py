"""
Unit tests for services/weather_pipeline/tide.py — global tide level (Open-Meteo) + state helpers.
Pure helpers tested directly; the async fetch with an injected mock client (no network).
"""
import pytest

from services.weather_pipeline import tide as T

# A clean half-day tide curve: high at 04:00 (1.0 m), low at 10:00 (-0.6 m).
_TIMES = [f"2026-06-29T{h:02d}:00" for h in range(13)]
_LEVELS = [0.0, 0.3, 0.6, 0.9, 1.0, 0.9, 0.6, 0.3, 0.0, -0.3, -0.6, -0.3, 0.0]


def test_normalize_tide():
    assert T.normalize_tide(0.0, -1.0, 1.0) == pytest.approx(0.5)
    assert T.normalize_tide(1.0, -1.0, 1.0) == pytest.approx(1.0)
    assert T.normalize_tide(-1.0, -1.0, 1.0) == pytest.approx(0.0)
    assert T.normalize_tide(5.0, -1.0, 1.0) == 1.0          # clamped
    assert T.normalize_tide(0.5, 1.0, 1.0) == 0.5           # degenerate window -> neutral
    assert T.normalize_tide(None, 0, 1) == 0.5


def test_tide_state_at_high_and_low():
    high = T.tide_state_at(_TIMES, _LEVELS, "2026-06-29T04:00")
    assert high["height_m"] == pytest.approx(1.0)
    assert high["norm"] == pytest.approx(1.0, abs=0.01)     # top of the window
    assert high["trend"] == "falling"                       # just past high

    low = T.tide_state_at(_TIMES, _LEVELS, "2026-06-29T10:00")
    assert low["norm"] == pytest.approx(0.0, abs=0.01)
    assert low["trend"] == "rising"


def test_tide_state_at_mid_rising():
    mid = T.tide_state_at(_TIMES, _LEVELS, "2026-06-29T02:00")
    assert 0.6 < mid["norm"] < 0.85 and mid["trend"] == "rising"


def test_tide_state_at_bad_input():
    assert T.tide_state_at([], [], "2026-06-29T00:00") is None
    assert T.tide_state_at(_TIMES, _LEVELS, "not-a-time") is None
    assert T.tide_state_at(_TIMES, _LEVELS[:-1], "2026-06-29T00:00") is None  # length mismatch


@pytest.mark.asyncio
async def test_fetch_tide_hourly_caches(monkeypatch):
    T._reset_tide_cache_for_test()
    calls = {"n": 0}

    class FakeResp:
        status_code = 200
        def json(self):
            return {"hourly": {"time": _TIMES, "sea_level_height_msl": _LEVELS}}

    class FakeClient:
        async def get(self, url):
            calls["n"] += 1
            assert "sea_level_height_msl" in url and "latitude=28.4" in url
            return FakeResp()

    c = FakeClient()
    a = await T.fetch_tide_hourly(28.4, -80.6, client=c)
    assert a["level"] == _LEVELS and calls["n"] == 1
    # second call within TTL + same ~0.1° cell → served from cache (no extra fetch)
    await T.fetch_tide_hourly(28.41, -80.59, client=c)
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_tide_norm_at_end_to_end(monkeypatch):
    T._reset_tide_cache_for_test()

    class FakeResp:
        status_code = 200
        def json(self):
            return {"hourly": {"time": _TIMES, "sea_level_height_msl": _LEVELS}}

    class FakeClient:
        async def get(self, url):
            return FakeResp()

    st = await T.tide_norm_at(28.4, -80.6, "2026-06-29T04:00", client=FakeClient())
    assert st["norm"] == pytest.approx(1.0, abs=0.01) and st["trend"] == "falling"


@pytest.mark.asyncio
async def test_fetch_tide_hourly_handles_failure():
    T._reset_tide_cache_for_test()

    class FakeResp:
        status_code = 500
        def json(self):
            return {}

    class FakeClient:
        async def get(self, url):
            return FakeResp()

    assert await T.fetch_tide_hourly(0, 0, client=FakeClient()) is None
