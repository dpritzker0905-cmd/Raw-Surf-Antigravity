"""
Spatial batching for native CMEMS point fetches (2026-07-06, chip task_2d50cd81).

Batch lanes used to fire one CMEMS subset subprocess PER SPOT (throttled: 138×25s in run
28754458502); POINT_SKIP_NATIVE_COPERNICUS traded the volume away by dropping native authority.
Batching restores it: one subset per ~5° spot cluster, per-point BATCHED cache entries that
fetch_euro_marine consults for any layer subset / valid_time.
"""
import asyncio
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
