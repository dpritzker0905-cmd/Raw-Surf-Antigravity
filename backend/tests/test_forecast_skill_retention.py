"""Offline storage-boundary checks: an unread archive is never an empty archive.

Real loader, serializer, ledger and ProductStore upload; only HTTP and forecast
providers are fake. Captured storage enforces create-only conflicts.
"""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import requests

from services.weather_pipeline import buoy_calibration as bc, forecast_skill as fs
from services.weather_pipeline import store as storage

NOW = datetime(2026, 9, 1, 0, 15, tzinfo=timezone.utc)
PENDING = fs.SKILL_PENDING_L2_KEY
MONTH = fs.SKILL_SCORED_PREFIX + "2026-09.json"
PREVIOUS = fs.SKILL_SCORED_PREFIX + "2026-08.json"


def row(buoy="new", target="2026-09-01T00:00:00Z"):
    return {"source": fs.SOURCE_OURS, "buoy_id": buoy, "target_time": target,
            "lead_h": 24, "hs_m": 1.6, "tp_s": 12.0}


@pytest.fixture
def wire(monkeypatch):
    objects = {PENDING: [row()], MONTH: [{**row("old"), "obs_hs_m": 1.5,
                                        "obs_time": NOW.isoformat(), "err_m": .1}]}
    state = SimpleNamespace(objects=objects, reads=[], writes=[], read_modes={}, write_modes={}, conflict_status=409)
    monkeypatch.setenv("SUPABASE_URL", "https://offline-retention.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "offline-test-only")
    monkeypatch.setenv("FORECAST_SKILL", "1")
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.setenv("FORECAST_SKILL_OM_CONTROL", "0")
    monkeypatch.setattr(bc, "calibrate_spots", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={}))
    monkeypatch.setattr(fs, "fetch_om_forecast_rows", lambda *args, **kwargs: [])
    monkeypatch.setattr(storage, "_get_supabase_storage", lambda: object())

    def response(status, payload):
        def decode():
            if payload == "bad_json":
                raise ValueError("synthetic invalid JSON")
            return deepcopy(payload)
        return SimpleNamespace(status_code=status, json=decode, text="synthetic response")

    def object_key(url):
        assert url.startswith("https://offline-retention.invalid/storage/v1/object/")
        return url.split(f"/{storage.WEATHER_BUCKET}/", 1)[1]

    def get(url, **kwargs):
        key = object_key(url)
        state.reads.append(key)
        mode = state.read_modes.get(key)
        if mode == "timeout":
            raise requests.Timeout("synthetic timeout")
        if mode == "503":
            return response(503, {})
        if mode == "bad_json":
            return response(200, "bad_json")
        if mode in ("NoSuchKey", "NoSuchBucket", "TenantNotFound", "not_found"):
            return response(404, {"code": mode})
        if mode == "404_html":
            return response(404, "bad_json")
        if mode == "403":
            return response(403, {"code": "AccessDenied"})
        return response(200, objects[key]) if key in objects else response(404, {"code": "NoSuchKey"})

    def post(url, *, headers, data, **kwargs):
        key = object_key(url)
        payload = json.loads(data)  # the real upload_calibration_l2 serializer produced these bytes
        state.writes.append((key, deepcopy(payload), headers["x-upsert"]))
        mode = state.write_modes.get(key)
        if mode == "timeout":
            raise requests.Timeout("synthetic timeout")
        if mode == "503":
            return response(503, {})
        if headers["x-upsert"] == "false" and key in objects:
            return response(state.conflict_status, {"code": "KeyAlreadyExists"})
        objects[key] = payload
        if mode == "timeout_after_commit":
            raise requests.Timeout("synthetic lost acknowledgment")
        return response(201, {})

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(requests, "post", post)
    state.store = storage.ProductStore.__new__(storage.ProductStore)

    def run():
        report = {"spots": [{"buoy_id": bid, "buoy_time": NOW.isoformat(),
                              "residual": {"buoy_wvht_m": 1.5, "buoy_dpd_s": 12.0}}
                             for bid in ("new", "prior")]}
        return asyncio.run(fs.run_skill_ledger(state.store, None, [], "GFS", report, now=NOW))
    state.run = run
    return state


@pytest.mark.parametrize("key", [PENDING, MONTH])
@pytest.mark.parametrize("mode", ["503", "timeout", "bad_json", "NoSuchBucket",
                                  "TenantNotFound", "404_html", "403"])
def test_unreadable_history_aborts_without_any_write(wire, key, mode):
    before = deepcopy(wire.objects)
    wire.read_modes[key] = mode
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.writes == []
    assert wire.objects == before


@pytest.mark.parametrize("key", [PENDING, MONTH])
@pytest.mark.parametrize("invalid", [None, {}, [None], 42, "rows"])
def test_invalid_archive_shape_aborts_without_any_write(wire, key, invalid):
    wire.objects[key] = invalid
    before = deepcopy(wire.objects)
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.writes == []
    assert wire.objects == before


@pytest.mark.parametrize("absence_code", ["NoSuchKey", "not_found"])
def test_missing_month_is_created_before_pending_is_consumed(wire, absence_code):
    del wire.objects[MONTH]
    wire.read_modes[MONTH] = absence_code
    result = wire.run()
    assert result["scored"] == 1
    assert wire.objects[PENDING] == []
    assert [r["buoy_id"] for r in wire.objects[MONTH]] == ["new"]
    assert [(key, upsert) for key, _, upsert in wire.writes] == [(MONTH, "false"), (PENDING, "true")]


@pytest.mark.parametrize("absence_code", ["NoSuchKey", "not_found"])
def test_missing_pending_is_created_without_upsert(wire, absence_code):
    del wire.objects[PENDING]
    wire.read_modes[PENDING] = absence_code
    wire.run()
    assert wire.writes == [(PENDING, [], "false")]


@pytest.mark.parametrize("key", [PENDING, MONTH])
@pytest.mark.parametrize("conflict_status", [400, 409])
@pytest.mark.parametrize("absence_code", ["NoSuchKey", "not_found"])
def test_false_missing_cannot_overwrite_an_existing_object(wire, key, conflict_status, absence_code):
    wire.conflict_status = conflict_status
    before = deepcopy(wire.objects)
    wire.read_modes[key] = absence_code
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.objects == before
    assert wire.writes[-1][0] == key and wire.writes[-1][2] == "false"


@pytest.mark.parametrize("mode", ["503", "timeout"])
def test_failed_archive_write_preserves_pending_for_retry(wire, mode):
    before = deepcopy(wire.objects)
    wire.write_modes[MONTH] = mode
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.objects == before
    assert [key for key, _, _ in wire.writes] == [MONTH]
    wire.write_modes.clear()
    wire.run()
    assert len(wire.objects[MONTH]) == 2
    assert wire.objects[PENDING] == []


def test_success_preserves_old_rows_and_repeated_run_does_not_duplicate(wire):
    old = deepcopy(wire.objects[MONTH][0])
    wire.run()
    assert wire.objects[MONTH][0] == old
    assert len(wire.objects[MONTH]) == 2
    wire.run()
    assert len(wire.objects[MONTH]) == 2
    assert sum(key == MONTH for key, _, _ in wire.writes) == 1


def test_lost_archive_acknowledgment_is_retryable_without_duplicate(wire):
    before_pending = deepcopy(wire.objects[PENDING])
    wire.write_modes[MONTH] = "timeout_after_commit"
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.objects[PENDING] == before_pending
    assert len(wire.objects[MONTH]) == 2
    wire.write_modes.clear()
    wire.run()
    assert wire.objects[PENDING] == [] and len(wire.objects[MONTH]) == 2
    assert sum(key == MONTH for key, _, _ in wire.writes) == 1


@pytest.mark.parametrize("mode", ["503", "timeout"])
def test_failed_pending_write_retries_without_duplicate_archive(wire, mode):
    before_pending = deepcopy(wire.objects[PENDING])
    wire.write_modes[PENDING] = mode
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.objects[PENDING] == before_pending
    assert len(wire.objects[MONTH]) == 2
    wire.write_modes.clear()
    wire.run()
    assert wire.objects[PENDING] == [] and len(wire.objects[MONTH]) == 2
    assert sum(key == MONTH for key, _, _ in wire.writes) == 1


def test_all_month_reads_finish_before_any_write(wire):
    wire.objects[PENDING].append(row("prior", "2026-08-31T23:00:00Z"))
    wire.read_modes[MONTH] = "503"  # merge_pending orders August before September
    before = deepcopy(wire.objects)
    with pytest.raises(RuntimeError):
        wire.run()
    assert wire.writes == [] and wire.objects == before


def test_month_boundary_partial_success_is_retryable(wire):
    wire.objects[PENDING].append(row("prior", "2026-08-31T23:00:00Z"))
    before_pending = deepcopy(wire.objects[PENDING])
    wire.write_modes[MONTH] = "503"
    with pytest.raises(RuntimeError):
        wire.run()
    assert len(wire.objects[MONTH]) == 1
    assert len(wire.objects[PREVIOUS]) == 1
    assert wire.objects[PENDING] == before_pending
    wire.write_modes.clear()
    wire.run()
    assert len(wire.objects[MONTH]) == 2 and len(wire.objects[PREVIOUS]) == 1
    assert wire.objects[PENDING] == []
    assert sum(key == PREVIOUS for key, _, _ in wire.writes) == 1


@pytest.mark.parametrize("ack", [None, False, 1])
def test_strict_serializer_requires_explicit_upload_acknowledgment(ack):
    store = SimpleNamespace(_upload_to_supabase=lambda *args, **kwargs: ack)
    with pytest.raises(RuntimeError):
        bc.upload_calibration_l2(store, [], MONTH, strict=True)


def test_unconfigured_strict_read_refuses_but_legacy_read_stays_optional(wire, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    assert bc.load_calibration_l2(MONTH) is None
    with pytest.raises(RuntimeError):
        bc.load_calibration_l2(MONTH, strict=True)
    assert wire.reads == [] and wire.writes == []


def test_strict_upload_unavailable_storage_cannot_acknowledge(wire, monkeypatch):
    monkeypatch.setattr(storage, "_get_supabase_storage", lambda: None)
    assert wire.store._upload_to_supabase(MONTH, b"[]") is None
    with pytest.raises(RuntimeError):
        bc.upload_calibration_l2(wire.store, [], MONTH, strict=True)
    assert wire.writes == []


def test_legacy_upload_failure_stays_best_effort(wire):
    before = deepcopy(wire.objects)
    wire.write_modes[MONTH] = "503"
    assert bc.upload_calibration_l2(wire.store, [], MONTH) is None
    assert wire.objects == before


def test_legacy_read_failure_stays_optional(wire):
    wire.read_modes[MONTH] = "503"
    assert bc.load_calibration_l2(MONTH) is None


def residual(buoy, when="2026-09-01T00:00:00Z"):
    return {"buoy_id": buoy, "buoy_time": when, "buoy_wvht_m": 1.5,
            "model_hs_m": 1.6, "height_err_m": .1}


@pytest.fixture
def residual_writer(wire, monkeypatch):
    from services.weather_pipeline import buoy_residual_retention as retention
    from services.weather_pipeline import spot_ratings_precompute as precompute

    class FixedCalibrationClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz is not None else NOW.replace(tzinfo=None)

    monkeypatch.setattr(bc, "datetime", FixedCalibrationClock)
    report = {"spots": [{"buoy_id": "new", "buoy_time": "2026-09-01T00:00:00Z",
                          "residual": {"buoy_wvht_m": 1.5, "model_hs_m": 1.6,
                                       "height_err_m": .1}}],
              "summary": {"height_mae_m": .1}}
    monkeypatch.setenv("FORECAST_SKILL", "0")
    monkeypatch.setenv("BUOY_RESIDUAL_ARCHIVE", "1")
    monkeypatch.setenv("BUOY_RESIDUAL_RETENTION", "0")
    monkeypatch.setattr(bc, "fetch_buoy_spots_via_rest", lambda: [{"id": "spot"}])
    monkeypatch.setattr(bc, "calibrate_spots", AsyncMock(side_effect=lambda *args: deepcopy(report)))
    monkeypatch.setattr(precompute, "_make_point_resolver", lambda: None)
    monkeypatch.setattr(precompute, "_top_of_hour_utc", lambda: NOW)
    monkeypatch.setattr(storage.ProductStore, "__init__", lambda self: None)

    def configure(kind):
        key = bc.BUOY_RESIDUAL_ARCHIVE_KEY if kind == "hot" else retention.history_key_for_month("2026-09")
        wire.objects[key] = [residual("old")]
        action = bc.run_buoy_calibration if kind == "hot" else lambda: retention.roll_up_history(
            wire.store, [residual("new")], now=NOW)
        return key, action
    return configure


@pytest.mark.parametrize("kind", ["hot", "monthly"])
@pytest.mark.parametrize("mode", ["503", "bad_json", "null", "wrong_shape"])
def test_residual_writers_never_replace_unread_history(wire, residual_writer, kind, mode):
    key, action = residual_writer(kind)
    if mode in ("null", "wrong_shape"):
        wire.objects[key] = None if mode == "null" else [None]
    else:
        wire.read_modes[key] = mode
    before = deepcopy(wire.objects[key])
    if kind == "monthly":
        with pytest.raises(RuntimeError):
            action()
        assert wire.writes == []
    else:
        assert action() == (1, .1), "a skipped archive must not suppress the report"
        assert [k for k, _, _ in wire.writes] == [bc.BUOY_CALIBRATION_L2_KEY]
        assert "archive" not in wire.objects[bc.BUOY_CALIBRATION_L2_KEY]
    assert wire.objects[key] == before


@pytest.mark.parametrize("kind", ["hot", "monthly"])
@pytest.mark.parametrize("exists", [False, True])
def test_residual_writers_acknowledge_append_or_create(wire, residual_writer, kind, exists):
    key, action = residual_writer(kind)
    if not exists:
        del wire.objects[key]
    elif kind == "hot":
        wire.objects[key].append(residual("expired", "2020-01-01T00:00:00Z"))
    action()
    assert {r["buoy_id"] for r in wire.objects[key]} == ({"old", "new"} if exists else {"new"})
    assert next(upsert for k, _, upsert in wire.writes if k == key) == ("true" if exists else "false")
    if kind == "hot":
        assert wire.objects[bc.BUOY_CALIBRATION_L2_KEY]["archive"]["n_entries"] == (2 if exists else 1)


@pytest.mark.parametrize("kind", ["hot", "monthly"])
@pytest.mark.parametrize("failure", ["false_missing", "write_503"])
def test_residual_archive_failure_never_claims_persistence(wire, residual_writer, kind, failure):
    key, action = residual_writer(kind)
    before = deepcopy(wire.objects[key])
    if failure == "false_missing":
        wire.read_modes[key] = "NoSuchKey"
    else:
        wire.write_modes[key] = "503"
    if kind == "monthly":
        with pytest.raises(RuntimeError):
            action()
    else:
        assert action() == (1, .1)
        assert "archive" not in wire.objects[bc.BUOY_CALIBRATION_L2_KEY]
    assert wire.objects[key] == before


def test_residual_months_are_preflighted_before_writes(wire):
    from services.weather_pipeline import buoy_residual_retention as retention
    later = retention.history_key_for_month("2026-09")
    wire.read_modes[later] = "503"
    with pytest.raises(RuntimeError):
        retention.roll_up_history(wire.store, [residual("prior", "2026-08-31T23:00:00Z"),
                                              residual("new")], now=NOW)
    assert wire.writes == []


def test_partial_residual_rollup_is_retryable(wire):
    from services.weather_pipeline import buoy_residual_retention as retention
    earlier = retention.history_key_for_month("2026-08")
    later = retention.history_key_for_month("2026-09")
    hot = [residual("prior", "2026-08-31T23:00:00Z"), residual("new")]
    wire.write_modes[later] = "503"
    with pytest.raises(RuntimeError):
        retention.roll_up_history(wire.store, hot, now=NOW)
    assert len(wire.objects[earlier]) == 1 and later not in wire.objects
    wire.write_modes.clear()
    touched = retention.roll_up_history(wire.store, hot, now=NOW)
    assert touched == {"2026-09": {"before": 0, "after": 1}}
    assert len(wire.objects[earlier]) == len(wire.objects[later]) == 1
