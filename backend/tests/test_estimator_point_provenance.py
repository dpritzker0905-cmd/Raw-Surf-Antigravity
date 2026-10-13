"""Real point resolution must serialize donor time/cycle identity without changing physics."""
from datetime import timedelta, timezone

import pytest

from tests.test_estimator_direction_support import NOW, prepare_point


def stamp(date):
    return date.strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
@pytest.mark.parametrize("offset", [-3, -1, 0, 1, 3])
def test_real_serving_preserves_ask_and_exposes_selected_frame(monkeypatch, layer, offset):
    rows, _, resolve, target = prepare_point(monkeypatch, layer=layer)
    rows["GFS"]["hourly"]["time"][-1] = stamp(target + timedelta(hours=offset))
    result = resolve()
    body = result.model_dump(mode="json")
    assert body["valid_time"] == target.isoformat().replace("+00:00", "Z")
    assert body["served_valid_time"] == stamp(target + timedelta(hours=offset))
    assert body["frame_offset_hours"] == offset
    assert body["frame_substituted"] is (offset != 0)
    assert body["estimate_basis"]["target_time_status"] == "known"
    assert result.point.speed == 2.4
    assert result.point.direction == 90.0
    assert result.point.period == 12.0
    assert result.is_estimated and not result.is_forecast_authoritative
    assert result.source == "backend_direct_point" and result.grid_parity is False


@pytest.mark.parametrize("minutes,substituted", [(30, False), (31, True)])
def test_existing_thirty_minute_honesty_threshold(monkeypatch, minutes, substituted):
    rows, _, resolve, target = prepare_point(monkeypatch)
    rows["GFS"]["hourly"]["time"][-1] = stamp(target + timedelta(minutes=minutes))
    result = resolve()
    assert result.frame_substituted is substituted
    assert result.frame_offset_hours == round(minutes / 60, 2)


@pytest.mark.parametrize("offset", [-1, 1])
def test_active_icon_with_different_target_has_no_fabricated_common_frame(monkeypatch, offset):
    rows, _, resolve, target = prepare_point(monkeypatch, icon=True)
    rows["ICON"]["hourly"]["time"][-1] = stamp(target + timedelta(hours=offset))
    result = resolve()
    assert result.estimate_basis["weights"]["icon"] == .1
    assert result.served_valid_time is None
    assert result.frame_substituted is True
    assert result.frame_offset_hours == 0.0  # no single signed offset; warning makes this explicit
    assert result.estimate_basis["target_time_status"] == "mixed"
    assert any("estimate_target_times_mixed" in w for w in result.warnings)
    sources = {s["role"]: s for s in result.estimate_basis["cycle_sources"]}
    assert sources["gfs_target"]["sampled_valid_time"] == stamp(target)
    assert sources["icon_target"]["sampled_valid_time"] == stamp(target + timedelta(hours=offset))
    assert result.point.speed == 2.8


def test_actual_independent_same_cycle_survives_point_serialization(monkeypatch):
    rows, _, resolve, _ = prepare_point(monkeypatch, icon=True)
    for raw in rows.values():
        raw["__model_run_time"] = (NOW - timedelta(hours=6)).isoformat()
    result = resolve()
    assert result.model_run_time == NOW - timedelta(hours=6)
    assert result.model_run_time_status == "known"
    basis = result.model_dump(mode="json")["estimate_basis"]
    assert basis["cycle_semantics"] == "shared_contributor_cycle"
    assert {s["role"] for s in basis["cycle_sources"]} == {
        "native_anchor", "gfs_anchor", "gfs_target", "icon_anchor", "icon_target"}
    assert {s["provider"] for s in basis["cycle_sources"]} == {"copernicus", "open-meteo"}
    assert result.run_time != result.model_run_time


@pytest.mark.parametrize("model", ["EURO", "GFS", "ICON"])
@pytest.mark.parametrize("bad,expected", [
    (None, "incomplete"), ("2026-09-20T00:00:00", "invalid"),
    ("garbage", "invalid"), ("2026-09-19T12:00:00Z", "conflicting"),
])
def test_each_used_raw_contributor_governs_cycle_claim(monkeypatch, model, bad, expected):
    rows, _, resolve, _ = prepare_point(monkeypatch, icon=True)
    for raw in rows.values():
        raw["__model_run_time"] = stamp(NOW)
    rows[model]["__model_run_time"] = bad
    result = resolve()
    assert result.model_run_time is None
    assert result.model_run_time_status == expected
    assert result.point.speed == 2.8


def test_missing_raw_cycles_are_not_inferred_from_receipt_or_forecast(monkeypatch):
    _, _, resolve, target = prepare_point(monkeypatch)
    result = resolve()
    assert result.model_run_time is None and result.model_run_time_status == "missing"
    assert result.served_valid_time == stamp(target)
    assert len(result.estimate_basis["cycle_sources"]) == 3


def test_unavailable_icon_does_not_poison_time_or_cycle_provenance(monkeypatch):
    rows, _, resolve, target = prepare_point(monkeypatch, icon=True)
    rows["ICON"]["hourly"]["wave_height"][-1] = None
    rows["ICON"]["hourly"]["time"][-1] = stamp(target + timedelta(hours=1))
    rows["ICON"]["__model_run_time"] = "garbage"
    for model in ("EURO", "GFS"):
        rows[model]["__model_run_time"] = stamp(NOW)
    result = resolve()
    assert result.model_run_time_status == "known"
    assert result.served_valid_time == stamp(target) and not result.frame_substituted
    assert len(result.estimate_basis["cycle_sources"]) == 3


def test_offsets_still_refuse_outside_existing_three_hour_guard(monkeypatch):
    rows, _, resolve, target = prepare_point(monkeypatch)
    rows["GFS"]["hourly"]["time"][-1] = stamp(target + timedelta(hours=3, minutes=1))
    assert resolve().status_code == 404


def test_shared_cycles_normalize_real_timezone_offsets(monkeypatch):
    rows, _, resolve, _ = prepare_point(monkeypatch)
    rows["EURO"]["__model_run_time"] = NOW.astimezone(timezone(timedelta(hours=-4))).isoformat()
    rows["GFS"]["__model_run_time"] = stamp(NOW)
    result = resolve()
    assert result.model_run_time_status == "known" and result.model_run_time == NOW
