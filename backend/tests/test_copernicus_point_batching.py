"""
Spatial batching for native CMEMS point fetches (2026-07-06, chip task_2d50cd81).

Batch lanes used to fire one CMEMS subset subprocess PER SPOT (throttled: 138×25s in run
28754458502); POINT_SKIP_NATIVE_COPERNICUS traded the volume away by dropping native authority.
Batching restores it: one subset per ~5° spot cluster, per-point BATCHED cache entries that
fetch_euro_marine consults for any layer subset / valid_time.
"""
import asyncio
import os
import time

import pytest

from services.copernicus_point_batching import (
    cluster_points_into_boxes,
    batched_point_cache_key,
    prewarm_euro_marine_point_cache,
    EURO_POINT_FORECAST_DAYS,
)
from services import copernicus_marine_service as cms


def _fake_result(lat, lng):
    return {
        "latitude": lat, "longitude": lng, "__provider": "copernicus",
        "hourly_units": {"time": "iso8601"},
        "hourly": {"time": ["2026-07-06T00:00:00Z"], "wave_height": [1.5]},
    }


@pytest.fixture(autouse=True)
def _clean_cache():
    cms._point_cache.clear()
    yield
    cms._point_cache.clear()


# ── clustering (pure) ────────────────────────────────────────────────────────────────────────
def test_clustering_groups_coastal_neighbors_and_splits_far_points():
    pts = [(33.62, -117.93), (33.65, -118.00), (34.01, -118.50),   # SoCal cluster
           (21.28, -157.84),                                       # Hawaii
           (-33.89, 151.27)]                                       # Sydney
    boxes = cluster_points_into_boxes(pts, 5.0)
    assert len(boxes) == 3
    sizes = sorted(len(b) for b in boxes)
    assert sizes == [1, 1, 3]
    for box in boxes:  # every box spans ≤ box_deg on each axis
        lats = [p[0] for p in box]; lons = [p[1] for p in box]
        assert max(lats) - min(lats) <= 5.0 and max(lons) - min(lons) <= 5.0


def test_clustering_dedupes_and_skips_invalid_coords():
    pts = [(33.62, -117.93), (33.621, -117.929),  # same 2dp point
           (None, -117.9), (float("nan"), 10.0), ("x", "y")]
    boxes = cluster_points_into_boxes(pts, 5.0)
    assert sum(len(b) for b in boxes) == 1


# ── batched lookup in fetch_euro_marine ──────────────────────────────────────────────────────
def test_single_point_layer_request_hits_batched_entry(monkeypatch):
    monkeypatch.setattr(cms, "is_test_environment", lambda: False)
    monkeypatch.setattr(cms, "_fetch_sync", lambda *a, **k: pytest.fail("must not fetch on batched hit"))
    lat, lng = 33.62, -117.93
    entry = [_fake_result(33.583, -117.917)]  # grid-snapped coords inside — keying is by REQUEST coords
    cms._point_cache[batched_point_cache_key(lat, lng, EURO_POINT_FORECAST_DAYS)] = (entry, time.time())

    out = asyncio.run(cms.fetch_euro_marine(
        latitudes=[lat], longitudes=[lng], forecast_days=EURO_POINT_FORECAST_DAYS,
        variables=["wave_height", "wave_direction", "wave_period"],   # the ladder's waves subset
        valid_time="2026-07-06T03:00:00Z",                            # any frame — full horizon supersets it
    ))
    assert out and out[0]["hourly"]["wave_height"] == [1.5]
    assert out[0] is not entry[0]  # deepcopy served


def test_batched_entry_respects_its_own_ttl(monkeypatch):
    monkeypatch.setattr(cms, "is_test_environment", lambda: False)
    called = {}
    monkeypatch.setattr(cms, "_fetch_sync", lambda *a, **k: called.setdefault("yes", True) and [])
    monkeypatch.setenv("POINT_BATCH_TTL_SEC", "60")
    lat, lng = 33.62, -117.93
    stale = time.time() - 120
    cms._point_cache[batched_point_cache_key(lat, lng, EURO_POINT_FORECAST_DAYS)] = ([_fake_result(lat, lng)], stale)
    asyncio.run(cms.fetch_euro_marine([lat], [lng], EURO_POINT_FORECAST_DAYS, ["wave_height"], None))
    assert called.get("yes")  # expired batched entry → real fetch path ran


# ── pre-warm ─────────────────────────────────────────────────────────────────────────────────
def test_prewarm_is_a_noop_without_the_flag(monkeypatch):
    monkeypatch.delenv("POINT_BATCH_NATIVE_COPERNICUS", raising=False)
    stats = asyncio.run(prewarm_euro_marine_point_cache([(33.6, -117.9)]))
    assert stats == {"enabled": False, "reason": "flag_off"}
    assert not cms._point_cache


def test_prewarm_is_a_noop_when_the_skip_flag_is_active(monkeypatch):
    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.setenv("POINT_SKIP_NATIVE_COPERNICUS", "1")
    stats = asyncio.run(prewarm_euro_marine_point_cache([(33.6, -117.9)]))
    assert stats == {"enabled": False, "reason": "skip_flag_active"}


def test_prewarm_fetches_one_box_per_cluster_and_caches_per_point(monkeypatch):
    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)
    calls = []

    async def fake_fetch(latitudes, longitudes, forecast_days, variables, valid_time):
        calls.append((tuple(latitudes), tuple(longitudes), forecast_days, variables, valid_time))
        return [_fake_result(la, lo) for la, lo in zip(latitudes, longitudes)]

    monkeypatch.setattr(cms, "fetch_euro_marine", fake_fetch)

    pts = [(33.62, -117.93), (33.65, -118.00), (21.28, -157.84)]
    stats = asyncio.run(prewarm_euro_marine_point_cache(pts))
    assert stats["enabled"] and stats["boxes"] == 2 and stats["fetched"] == 2
    assert stats["cached_points"] == 3
    assert len(calls) == 2                       # ONE fetch per cluster, not per point
    for _, _, days, variables, valid_time in calls:
        assert days == EURO_POINT_FORECAST_DAYS
        assert variables is None and valid_time is None   # full vars, full horizon
    for la, lo in pts:                           # every point individually addressable
        assert batched_point_cache_key(la, lo, EURO_POINT_FORECAST_DAYS) in cms._point_cache


def test_prewarm_does_not_evict_its_own_entries_when_cap_is_low(monkeypatch):
    """Regression (2026-07-08, runbook §11): the per-box eviction trims _point_cache to
    _point_cache_cap() (POINT_CACHE_MAX, default 100). A ~1000-spot pre-warm under the default cap
    silently evicted ~90% of its own entries BEFORE the consume pass → 0 batched hits → every point
    re-spawned a CMEMS subprocess (the forecast-ingest cron-hang). The self-correcting floor must
    keep the WHOLE batch addressable even when the env cap is left at the default. The existing
    tests used only 3 points so the cap never bit — this one crosses it."""
    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)
    monkeypatch.setenv("POINT_CACHE_MAX", "100")   # the default that caused the hang

    async def fake_fetch(latitudes, longitudes, forecast_days, variables, valid_time):
        return [_fake_result(la, lo) for la, lo in zip(latitudes, longitudes)]

    monkeypatch.setattr(cms, "fetch_euro_marine", fake_fetch)

    # 150 unique-at-2dp coastal points (> the 100 cap) in one 5° box.
    pts = [(round(30.0 + i * 0.02, 2), -80.0) for i in range(150)]
    stats = asyncio.run(prewarm_euro_marine_point_cache(pts))

    assert stats["cached_points"] == 150
    # EVERY pre-warmed point survives and is individually addressable (pre-fix: only ~100 did).
    for la, lo in pts:
        assert batched_point_cache_key(la, lo, EURO_POINT_FORECAST_DAYS) in cms._point_cache
    # The floor was raised above the default so the eviction can't trim the batch.
    assert int(os.environ["POINT_CACHE_MAX"]) >= 150


def test_prewarm_survives_a_failed_box_and_skips_error_stubs(monkeypatch):
    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)

    async def flaky_fetch(latitudes, longitudes, forecast_days, variables, valid_time):
        if len(latitudes) > 1:
            raise TimeoutError("CMEMS throttled")
        # single-point box answers with an ERROR STUB (empty time axis)
        return [{"latitude": latitudes[0], "longitude": longitudes[0],
                 "hourly_units": {"time": "iso8601"}, "hourly": {"time": []}}]

    monkeypatch.setattr(cms, "fetch_euro_marine", flaky_fetch)
    pts = [(33.62, -117.93), (33.65, -118.00), (21.28, -157.84)]
    stats = asyncio.run(prewarm_euro_marine_point_cache(pts))
    assert stats["failed"] == 1                  # the 2-point SoCal box raised
    assert stats["cached_points"] == 0           # the Hawaii stub was not cached
    assert not cms._point_cache


# ── degradation bounds (2026-07-14, run 29297471819: pre-warm alone ate the 75-min cap) ─────
@pytest.fixture
def _degraded_env(monkeypatch):
    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)
    # POINT_BATCH_DEGRADED is set by the CODE UNDER TEST via os.environ directly, so it must be
    # cleaned with a direct pop — a monkeypatch.delenv AFTER yield records the test-set "1" as
    # the original value and teardown RESTORES it, leaking degraded mode into every later EURO
    # point test (live-caught: test_point_estimate_blend failed suite-order-dependently).
    os.environ.pop("POINT_BATCH_DEGRADED", None)
    yield monkeypatch
    os.environ.pop("POINT_BATCH_DEGRADED", None)


def _far_apart_points(n):
    # one point per 5°-bucket → n boxes
    return [(round(-60 + i * 6.0, 2), round(-170 + i * 6.0, 2)) for i in range(n)]


def test_prewarm_circuit_breaker_stops_after_consecutive_failures(_degraded_env):
    calls = []

    async def dead_upstream(latitudes, longitudes, forecast_days, variables, valid_time):
        calls.append(1)
        raise TimeoutError("Fetcher subprocess timed out after 180.0 seconds")

    _degraded_env.setattr(cms, "fetch_euro_marine", dead_upstream)
    stats = asyncio.run(prewarm_euro_marine_point_cache(_far_apart_points(10)))

    assert stats["aborted"] == "consecutive_failures"
    assert len(calls) == 3                        # default breaker: stop paying after 3×180s
    assert stats["boxes_remaining"] == 7
    assert os.environ.get("POINT_BATCH_DEGRADED") == "1"   # rest of the run: fallback for cold points


def test_prewarm_breaker_resets_on_success_and_completes_clean(_degraded_env):
    seq = {"n": 0}

    async def two_fail_then_ok(latitudes, longitudes, forecast_days, variables, valid_time):
        seq["n"] += 1
        if seq["n"] in (1, 2, 4, 5):              # never 3 in a row
            raise TimeoutError("blip")
        return [_fake_result(la, lo) for la, lo in zip(latitudes, longitudes)]

    _degraded_env.setattr(cms, "fetch_euro_marine", two_fail_then_ok)
    stats = asyncio.run(prewarm_euro_marine_point_cache(_far_apart_points(6)))

    assert "aborted" not in stats                 # breaker never tripped
    assert stats["fetched"] == 2 and stats["failed"] == 4
    assert os.environ.get("POINT_BATCH_DEGRADED") is None  # clean completion sets nothing


def test_prewarm_wall_clock_budget_stops_the_loop(_degraded_env):
    _degraded_env.setenv("POINT_BATCH_PREWARM_BUDGET_S", "0.001")
    calls = []

    async def slow_ok(latitudes, longitudes, forecast_days, variables, valid_time):
        calls.append(1)
        time.sleep(0.01)                          # each box exceeds the whole budget
        return [_fake_result(la, lo) for la, lo in zip(latitudes, longitudes)]

    _degraded_env.setattr(cms, "fetch_euro_marine", slow_ok)
    stats = asyncio.run(prewarm_euro_marine_point_cache(_far_apart_points(5)))

    assert stats["aborted"] == "budget"
    assert len(calls) == 1                        # budget checked before every box
    assert stats["boxes_remaining"] == 4
    assert os.environ.get("POINT_BATCH_DEGRADED") == "1"
    # the box that DID land keeps native authority
    assert stats["cached_points"] == 1


def test_degraded_mode_routes_cold_points_to_fallback_but_keeps_warm_points_native():
    """point_resolution's EURO branch: POINT_BATCH_DEGRADED=1 + no batched entry → raise into the
    provider-fallback ladder; a warmed point must still reach fetch_euro_marine. Source-inspection
    pin (the pattern of test_point_skip_native_copernicus.py) — the branch is deep in resolve_point."""
    import inspect
    from services.weather_pipeline import point_resolution as pr
    src = inspect.getsource(pr)
    gate = src.find("POINT_BATCH_DEGRADED")
    assert gate != -1, "degraded-mode gate missing from point_resolution"
    window = src[gate - 1500:gate + 1500]
    assert "batched_point_cache_key(lat, lng, point_forecast_days) not in _point_cache" in window
    assert "raise RuntimeError" in window


# ── THE ABORT NAMES ITS OWN CAUSE (2026-08-07) ───────────────────────────────────────────────────
# ⛔⛔ WHY: over 8 consecutive production runs the budget abort fired on 7, ALWAYS at ~1205 s, with
# `failed: 0` and a per-box time of 10.0 s p50 — against the 10.5 s/box baseline this module's own
# bounds comment calls HEALTHY. The upstream was never degraded: the BOX COUNT grew 107 -> 179
# (+67%) while POINT_BATCH_PREWARM_BUDGET_S stayed at 1200 s, so 179 boxes now need ~1790 s and the
# breaker trips every run on a healthy provider. Naming the flag DEGRADED made that read as an
# upstream problem. These two tests keep the log honest about which of the two it is.

def _abort_with(monkeypatch, baseline_s, per_box_sleep=0.004, budget_s=0.05, n=40):
    """Run the pre-warm to a budget abort with a KNOWN per-box rate, varying only the healthy
    baseline. Holding the timing fixed and moving the baseline is what isolates the discriminator
    from the clock — a wall-clock test cannot produce a real 10 s/box."""
    import services.copernicus_point_batching as cpb
    monkeypatch.setattr(cpb, "_HEALTHY_S_PER_BOX", baseline_s)
    monkeypatch.setenv("POINT_BATCH_PREWARM_BUDGET_S", str(budget_s))

    async def fetch(latitudes, longitudes, forecast_days, variables, valid_time):
        time.sleep(per_box_sleep)
        return [_fake_result(la, lo) for la, lo in zip(latitudes, longitudes)]

    monkeypatch.setattr(cms, "fetch_euro_marine", fetch)
    stats = asyncio.run(prewarm_euro_marine_point_cache(_far_apart_points(n)))
    assert stats["aborted"] == "budget", "SETUP BROKEN: no budget abort"
    assert stats["fetched"] > 0, "SETUP BROKEN: no box completed, so there is no rate to judge"
    return stats


def test_a_budget_abort_at_a_HEALTHY_rate_is_named_STRUCTURAL(_degraded_env):
    """The production case: boxes arrive at the healthy rate, there is simply more work than budget.
    The operator must not go hunting for an upstream fault that does not exist."""
    stats = _abort_with(_degraded_env, baseline_s=10.5)     # observed rate << baseline
    cause = stats.get("abort_cause", "")
    assert "STRUCTURAL" in cause and "Nothing upstream is wrong" in cause, (
        f"a budget abort at a healthy per-box rate was not named structural: {cause!r} — the log "
        f"would send the next investigator after a provider fault that is not there")


def test_a_budget_abort_at_a_SLOW_rate_is_still_named_upstream(_degraded_env):
    """THE DISCRIMINATING CONTROL. Identical timing to the test above — only the baseline moves. If
    both branches said 'structural' the message would be a constant, and a genuinely sick provider
    would be waved through as a sizing problem."""
    stats = _abort_with(_degraded_env, baseline_s=0.0001)   # observed rate >> baseline
    cause = stats.get("abort_cause", "")
    assert "genuinely slow" in cause and "STRUCTURAL" not in cause, (
        f"a slow upstream was misnamed as a sizing problem: {cause!r}")
