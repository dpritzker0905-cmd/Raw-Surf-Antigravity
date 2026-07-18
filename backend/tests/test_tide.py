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


# --- batch pre-warm (2026-07-18 RATING_TIDE flip: ~10 requests/run instead of ~900) ---

def test_prewarm_keys_dedupes_and_skips_fresh():
    T._reset_tide_cache_for_test()
    # 28.41/-80.59 rounds into the same 0.1° cell as 28.4/-80.6 → one key; None coords dropped.
    keys = T._prewarm_keys([(28.4, -80.6), (28.41, -80.59), (21.66, -158.05), (None, 5.0)])
    assert keys == [(28.4, -80.6), (21.7, -158.1)]
    # a cache-fresh cell is excluded from the work list
    import time as _time
    T._TIDE_CACHE[(28.4, -80.6)] = {"ts": _time.time(), "time": _TIMES, "level": _LEVELS}
    assert T._prewarm_keys([(28.4, -80.6), (21.66, -158.05)]) == [(21.7, -158.1)]
    T._reset_tide_cache_for_test()


@pytest.mark.asyncio
async def test_prewarm_tide_cache_batches_and_seeds():
    T._reset_tide_cache_for_test()
    calls = {"urls": []}

    class FakeResp:
        status_code = 200
        def json(self):
            # Open-Meteo multi-coordinate response: ARRAY of per-location results in request order.
            return [
                {"hourly": {"time": _TIMES, "sea_level_height_msl": _LEVELS}},
                {"hourly": {"time": _TIMES, "sea_level_height_msl": [v + 1.0 for v in _LEVELS]}},
            ]

    class FakeClient:
        async def get(self, url):
            calls["urls"].append(url)
            return FakeResp()

    n = await T.prewarm_tide_cache([(28.4, -80.6), (21.66, -158.05)], client=FakeClient())
    assert n == 2 and len(calls["urls"]) == 1                       # ONE batched request
    assert "latitude=28.4,21.7" in calls["urls"][0] and "longitude=-80.6,-158.1" in calls["urls"][0]
    # seeded entries serve fetch_tide_hourly without any further request
    a = await T.fetch_tide_hourly(28.4, -80.6, client=FakeClient())
    assert a["level"] == _LEVELS and len(calls["urls"]) == 1
    b = await T.fetch_tide_hourly(21.66, -158.05, client=FakeClient())
    assert b["level"][0] == pytest.approx(_LEVELS[0] + 1.0) and len(calls["urls"]) == 1
    T._reset_tide_cache_for_test()


@pytest.mark.asyncio
async def test_prewarm_tide_cache_single_object_and_failure():
    T._reset_tide_cache_for_test()

    class OneResp:
        status_code = 200
        def json(self):
            # a 1-coordinate batch comes back as a bare object, not an array
            return {"hourly": {"time": _TIMES, "sea_level_height_msl": _LEVELS}}

    class OneClient:
        async def get(self, url):
            return OneResp()

    assert await T.prewarm_tide_cache([(28.4, -80.6)], client=OneClient()) == 1
    T._reset_tide_cache_for_test()

    class BoomClient:
        async def get(self, url):
            raise RuntimeError("network down")

    # never raises; a failed chunk seeds nothing and leaves the per-spot fallback
    assert await T.prewarm_tide_cache([(28.4, -80.6)], client=BoomClient()) == 0
    assert await T.prewarm_tide_cache([], client=BoomClient()) == 0
    T._reset_tide_cache_for_test()
