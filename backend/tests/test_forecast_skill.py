"""Forecast skill ledger (2026-07-30): per-lead accuracy vs reality and vs a competitor.

Pins the ledger's honesty properties: the earliest forecast per (source, buoy, target, lead)
wins, scoring joins only within tolerance of real observations, unmatched rows expire instead of
lingering, and the summary reports independence (n_buoys) beside n."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from services.weather_pipeline.forecast_skill import (
    SOURCE_OM, SOURCE_OURS,
    fetch_om_forecast_rows, merge_pending, rows_from_calibration_report,
    score_pending, skill_summary,
)

NOW = datetime(2026, 7, 30, 18, 0, tzinfo=timezone.utc)


def _report(entries):
    return {"spots": entries}


def _entry(bid, model_hs=1.5, model_tp=10.0, buoy_time=None, buoy_wvht=None):
    res = {"model_hs_m": model_hs, "model_tp_s": model_tp}
    if buoy_wvht is not None:
        res["buoy_wvht_m"] = buoy_wvht
        res["buoy_dpd_s"] = 9.0
    e = {"buoy_id": bid, "residual": res}
    if buoy_time:
        e["buoy_time"] = buoy_time
    return e


def test_rows_from_report_one_per_buoy_and_no_coverage_holes():
    rep = _report([
        _entry("46012", model_hs=2.0),
        _entry("46012", model_hs=2.2),          # duplicate buoy (two spots share it) -> one row
        _entry("41009", model_hs=0.0),          # a 0.0 model value is a coverage hole, not skill
        _entry("51201", model_hs=1.1),
    ])
    rows = rows_from_calibration_report(rep, "2026-07-31T18:00:00Z", 24)
    assert [(r["buoy_id"], r["hs_m"]) for r in rows] == [("46012", 2.0), ("51201", 1.1)]
    assert all(r["source"] == SOURCE_OURS and r["lead_h"] == 24 for r in rows)


def test_merge_pending_earliest_forecast_wins_and_expires():
    early = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-31T18:00:00Z", "lead_h": 72.0, "hs_m": 1.0}
    later = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-31T18:00:00Z", "lead_h": 68.0, "hs_m": 1.4}
    stale = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-20T00:00:00Z", "lead_h": 24.0, "hs_m": 2.0}
    merged = merge_pending([early, stale], [later], now=NOW)
    assert merged == [early]                     # first (earliest) wins; the stale target expired


def test_score_pending_joins_within_tolerance_and_expires_the_rest():
    pending = [
        {"source": SOURCE_OURS, "buoy_id": "46012",
         "target_time": "2026-07-30T17:00:00Z", "lead_h": 24.0, "hs_m": 1.8},
        {"source": SOURCE_OM, "buoy_id": "46012",
         "target_time": "2026-07-30T17:00:00Z", "lead_h": 24.0, "hs_m": 2.4},
        {"source": SOURCE_OURS, "buoy_id": "46012",
         "target_time": "2026-08-01T18:00:00Z", "lead_h": 48.0, "hs_m": 1.2},  # future -> stays
        {"source": SOURCE_OURS, "buoy_id": "41009",
         "target_time": "2026-07-25T00:00:00Z", "lead_h": 24.0, "hs_m": 1.0},  # old, no obs -> drops
    ]
    rep = _report([_entry("46012", buoy_time="2026-07-30T17:40:00Z", buoy_wvht=2.0)])
    still, scored = score_pending(pending, rep, now=NOW)
    assert [r["target_time"] for r in still] == ["2026-08-01T18:00:00Z"]
    assert len(scored) == 2
    ours = next(r for r in scored if r["source"] == SOURCE_OURS)
    assert ours["obs_hs_m"] == 2.0 and ours["err_m"] == -0.2


def test_skill_summary_reports_independence():
    scored = [
        {"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.2},
        {"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 26.0, "err_m": -0.2},
        {"source": SOURCE_OURS, "buoy_id": "b", "lead_h": 24.0, "err_m": 0.4},
        {"source": SOURCE_OM, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.6},
    ]
    table = skill_summary(scored)
    ours = next(r for r in table if r["source"] == SOURCE_OURS)
    om = next(r for r in table if r["source"] == SOURCE_OM)
    assert ours["n"] == 3 and ours["n_buoys"] == 2
    assert ours["mae_m"] == round((0.2 + 0.2 + 0.4) / 3, 4)
    assert om["mae_m"] == 0.6


def test_fetch_om_forecast_rows_batches_and_slices_leads():
    times = [(NOW + timedelta(hours=k)).strftime("%Y-%m-%dT%H:00") for k in range(0, 96)]
    loc = {"hourly": {"time": times,
                      "wave_height": [1.0 + 0.01 * k for k in range(96)],
                      "swell_wave_period": [8.0] * 96}}
    payload = [loc, loc]

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps(payload).encode()

    with patch("services.weather_pipeline.forecast_skill.urllib.request.urlopen",
               return_value=_Resp()), \
         patch("services.weather_pipeline.forecast_skill.json.load",
               side_effect=lambda f: payload):
        rows = fetch_om_forecast_rows({"46012": (37.5, -122.5), "41009": (28.5, -80.2)}, NOW)
    assert len(rows) == 6                        # 2 buoys x 3 leads
    assert {r["lead_h"] for r in rows} == {24.0, 48.0, 72.0}
    r24 = next(r for r in rows if r["buoy_id"] == "46012" and r["lead_h"] == 24.0)
    assert r24["hs_m"] == 1.24 and r24["source"] == SOURCE_OM
    assert r24["target_time"].endswith(":00Z")
