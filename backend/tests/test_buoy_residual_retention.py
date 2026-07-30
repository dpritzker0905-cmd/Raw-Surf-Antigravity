"""Permanent forecast↔observation retention (2026-07-30 phase 5).

The hot residual archive is a ~14-day rolling window by bandwidth design (20k-entry cap, the
object rides every CI run). These tests pin the retention lane that turns it into permanent
monthly history: append-only, deduplicated, uncapped, daily-windowed, and never able to hurt the
calibration loop it rides on."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from services.weather_pipeline.buoy_residual_retention import (
    group_rows_by_month,
    history_key_for_month,
    maybe_roll_up_history,
    roll_up_history,
    should_roll_up,
)


def _row(bid, iso, wvht=1.0, model=1.1):
    return {"buoy_id": bid, "buoy_time": iso, "buoy_wvht_m": wvht, "model_hs_m": model,
            "height_err_m": round(model - wvht, 3)}


def test_group_rows_by_month_splits_cross_month_and_drops_unparseable():
    rows = [
        _row("41009", "2026-07-31T23:00:00Z"),
        _row("41009", "2026-08-01T01:00:00Z"),
        _row("46012", "2026-08-15T12:00:00Z"),
        {"buoy_id": "bad", "buoy_time": "not-a-time"},
    ]
    grouped = group_rows_by_month(rows)
    assert set(grouped) == {"2026-07", "2026-08"}
    assert len(grouped["2026-07"]) == 1
    assert len(grouped["2026-08"]) == 2


def test_should_roll_up_window():
    assert should_roll_up(datetime(2026, 8, 1, 3, 31, tzinfo=timezone.utc), window_h=6) is True
    assert should_roll_up(datetime(2026, 8, 1, 6, 42, tzinfo=timezone.utc), window_h=6) is False
    assert should_roll_up(datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc), window_h=6) is True


def test_roll_up_appends_only_new_rows_and_skips_untouched_months():
    existing_july = [_row("41009", "2026-07-30T00:00:00Z")]
    hot = [
        _row("41009", "2026-07-30T00:00:00Z"),   # duplicate — must not re-upload july alone
        _row("41009", "2026-07-30T01:00:00Z"),   # new july row
        _row("46012", "2026-08-01T00:00:00Z"),   # new august row
    ]
    uploads = {}

    def fake_load(key=None):
        return {history_key_for_month("2026-07"): list(existing_july)}.get(key, [])

    def fake_upload(store, obj, key):
        uploads[key] = obj

    with patch("services.weather_pipeline.buoy_calibration.load_calibration_l2", fake_load), \
         patch("services.weather_pipeline.buoy_calibration.upload_calibration_l2", fake_upload):
        touched = roll_up_history(MagicMock(), hot, now=datetime(2026, 8, 1, 3, 0, tzinfo=timezone.utc))

    assert touched == {"2026-07": {"before": 1, "after": 2},
                       "2026-08": {"before": 0, "after": 1}}
    assert len(uploads[history_key_for_month("2026-07")]) == 2
    assert len(uploads[history_key_for_month("2026-08")]) == 1


def test_roll_up_is_idempotent_no_upload_when_nothing_new():
    existing = [_row("41009", "2026-07-30T00:00:00Z"), _row("41009", "2026-07-30T01:00:00Z")]
    uploads = {}
    with patch("services.weather_pipeline.buoy_calibration.load_calibration_l2",
               lambda key=None: list(existing)), \
         patch("services.weather_pipeline.buoy_calibration.upload_calibration_l2",
               lambda store, obj, key: uploads.__setitem__(key, obj)):
        touched = roll_up_history(MagicMock(), list(existing),
                                  now=datetime(2026, 8, 1, 3, 0, tzinfo=timezone.utc))
    assert touched == {}
    assert uploads == {}


def test_history_never_prunes_beyond_the_hot_caps():
    """The hot archive caps at 20,000 entries and 90 days. History must keep everything: rows far
    older than 90 days and counts beyond the hot cap both survive a roll-up."""
    old = [_row(f"b{i}", f"2020-01-{(i % 27) + 1:02d}T{i % 24:02d}:00:00Z") for i in range(25000)]
    uploads = {}
    with patch("services.weather_pipeline.buoy_calibration.load_calibration_l2",
               lambda key=None: []), \
         patch("services.weather_pipeline.buoy_calibration.upload_calibration_l2",
               lambda store, obj, key: uploads.__setitem__(key, obj)):
        touched = roll_up_history(MagicMock(), old,
                                  now=datetime(2026, 8, 1, 3, 0, tzinfo=timezone.utc))
    total_after = sum(v["after"] for v in touched.values())
    # 25,000 generated keys collapse to the distinct (buoy_id, buoy_time) pairs — all in 2020-01,
    # all older than the hot archive's 90-day horizon, and far beyond its entry cap per month.
    assert total_after == len({(r["buoy_id"], r["buoy_time"]) for r in old})
    assert set(touched) == {"2020-01"}


def test_maybe_roll_up_respects_kill_switch_window_and_never_raises(monkeypatch):
    monkeypatch.setenv("BUOY_RESIDUAL_RETENTION", "0")
    assert maybe_roll_up_history(MagicMock(), [_row("41009", "2026-07-30T00:00:00Z")]) is None

    monkeypatch.delenv("BUOY_RESIDUAL_RETENTION", raising=False)
    outside_window = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
    assert maybe_roll_up_history(MagicMock(), [_row("41009", "2026-07-30T00:00:00Z")],
                                 now=outside_window) is None

    inside_window = datetime(2026, 8, 1, 3, 0, tzinfo=timezone.utc)
    with patch("services.weather_pipeline.buoy_calibration.load_calibration_l2",
               side_effect=RuntimeError("storage down")):
        # A storage failure must be swallowed — retention can never hurt the calibration loop.
        assert maybe_roll_up_history(MagicMock(), [_row("41009", "2026-07-30T00:00:00Z")],
                                     now=inside_window) is None
