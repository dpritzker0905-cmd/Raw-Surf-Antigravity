"""Mid-tier time identity: exact estimates beat distant native frames locally."""
from types import SimpleNamespace

import pytest

from services.weather_pipeline.mid_res_tier import pick_mid_item


@pytest.mark.parametrize("auth_diff,est_diff,estimated", [
    (10800, 0, True), (10800, 1800, True),
    (1800, 0, False), (0, 0, False), (0, 10800, False),
    (10800, 1801, False),
])
def test_mid_time_priority(monkeypatch, auth_diff, est_diff, estimated):
    monkeypatch.setenv("MID_RES_EXACT_TIME_ESTIMATE", "1")
    native = SimpleNamespace(product_id="native")
    estimate = SimpleNamespace(product_id="estimate")
    assert pick_mid_item([(native, auth_diff)], [(estimate, est_diff)]) is (
        estimate if estimated else native)


def test_mid_legacy_default_and_rollback(monkeypatch):
    native, estimate = object(), object()
    for value in (None, "0"):
        monkeypatch.delenv("MID_RES_EXACT_TIME_ESTIMATE", raising=False)
        if value is not None:
            monkeypatch.setenv("MID_RES_EXACT_TIME_ESTIMATE", value)
        assert pick_mid_item([(native, 10800)], [(estimate, 0)]) is native


def test_mid_missing_classes_and_nearest(monkeypatch):
    monkeypatch.setenv("MID_RES_EXACT_TIME_ESTIMATE", "1")
    near, far = object(), object()
    assert pick_mid_item([], []) is None
    assert pick_mid_item([(far, 10800), (near, 0)], []) is near
    assert pick_mid_item([], [(far, 10800), (near, 0)]) is near


@pytest.mark.parametrize("enabled,mid_diff,current_diff,estimated,loads", [
    ("1", 10800, 0, True, 0),
    ("1", 1801, 0, True, 0),
    ("1", 10800, 1800, True, 0),
    ("1", 1800, 0, True, 1),
    ("1", 0, 0, True, 1),
    ("1", 10800, 1801, True, 1),
    ("1", 10800, 0, False, 1),
    ("0", 10800, 0, True, 1),
])
@pytest.mark.asyncio
async def test_mid_upgrade_keeps_near_exact_coarse_estimate(
        monkeypatch, enabled, mid_diff, current_diff, estimated, loads):
    from datetime import datetime, timedelta, timezone
    from unittest.mock import Mock
    from services.weather_pipeline import mid_res_tier as tier

    monkeypatch.setenv("MID_RES_EXACT_TIME_ESTIMATE", enabled)
    monkeypatch.setattr(tier, "_CLIP_CACHE", {}, raising=False)
    import asyncio
    monkeypatch.setattr(tier, "_LOAD_SEM", asyncio.Semaphore(1), raising=False)
    target = datetime(2026, 10, 29, 3, tzinfo=timezone.utc)
    bounds = SimpleNamespace(west=-180, east=180, south=-80, north=85)
    coarse = SimpleNamespace(grid=SimpleNamespace(bounds=bounds),
                             valid_time=target + timedelta(seconds=current_diff),
                             is_estimated=estimated)
    mid = SimpleNamespace(filename="mid-neighbour.json", coverage=bounds,
                          valid_time_start=target - timedelta(seconds=mid_diff))
    store = SimpleNamespace(load_product=Mock(return_value=None))
    result = await tier.try_serve_mid_res_tier(
        store, model="EURO", domain="marine", layer="waves",
        bbox="-180,-80,180,85", req_w=-180, req_s=-80, req_e=180, req_n=85,
        mid_auth=[(mid, mid_diff)], mid_est=[], current_product=coarse,
        target_dt=target)
    assert result is None
    assert store.load_product.call_count == loads
