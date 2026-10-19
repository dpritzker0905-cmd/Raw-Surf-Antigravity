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
