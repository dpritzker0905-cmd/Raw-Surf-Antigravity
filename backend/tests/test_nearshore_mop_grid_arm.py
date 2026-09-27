"""The nearshore judge grades the ARCHIVED MOP sea+swell grid runs — the product stage 4 would serve.

#124's MOP arm grades CDIP's WW3-driven buoy series. What stage 4 would serve is the regional sea+swell
grid (ECMWF-driven), which holds only future hours; the ingest (#126) archives each run at a cell of each
buoy's own depth. This grades the archives as the forecast would have been served: each hour from the
latest run issued at or before it. First local grading (3 station-hours, 2026-09-27 21-22Z): grid MAE
0.118 m, bias +0.002, against the chain's 0.300 m. Far too few hours to decide; it accrues with the ingest.
"""
import json
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import nearshore_validation as NV

NOW = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)


def _blob(run, times, hs, station="153p1", grid="D_0.001_seaswellfc.nc"):
    return {"grids": {grid: {"run": run}},
            "stations": {station: {"grid": grid, "times": times, "hs": hs}}}


def test_each_hour_comes_from_the_latest_run_issued_at_or_before_it():
    older = _blob("2026-09-28T00:00:00Z", ["2026-09-28T06:00:00Z", "2026-09-28T12:00:00Z"], [1.0, 1.2])
    newer = _blob("2026-09-28T06:00:00Z", ["2026-09-28T06:00:00Z", "2026-09-28T12:00:00Z"], [1.1, 1.3])
    got = NV.mop_grid_hours([newer, older], "153p1", NOW, lookback_hours=24)
    assert got["2026-09-28T06:00:00Z"] == {"hs": 1.1, "run": "2026-09-28T06:00:00Z", "lead_h": 0.0}
    assert got["2026-09-28T12:00:00Z"] == {"hs": 1.3, "run": "2026-09-28T06:00:00Z", "lead_h": 6.0}


def test_a_run_issued_after_the_hour_never_answers_for_it():
    late = _blob("2026-09-28T09:00:00Z", ["2026-09-28T06:00:00Z", "2026-09-28T09:00:00Z"], [9.9, 1.4])
    got = NV.mop_grid_hours([late], "153p1", NOW, lookback_hours=24)
    assert "2026-09-28T06:00:00Z" not in got and got["2026-09-28T09:00:00Z"]["hs"] == 1.4


def test_future_hours_missing_values_and_other_buoys_are_left_out():
    b = _blob("2026-09-27T00:00:00Z", ["2026-09-27T12:00:00Z", "2026-09-28T06:00:00Z", "2026-09-28T09:00:00Z",
                                       "2026-09-28T18:00:00Z"], [0.5, None, 1.0, 1.1])
    got = NV.mop_grid_hours([b], "153p1", NOW, lookback_hours=12)
    assert list(got) == ["2026-09-28T09:00:00Z"]          # 27T12 is outside 12 h, 06Z null, 18Z future
    assert NV.mop_grid_hours([b], "254p1", NOW, lookback_hours=24) == {}


def test_archives_are_read_from_nested_artifact_dirs_and_junk_is_skipped(tmp_path):
    (tmp_path / "111").mkdir()
    (tmp_path / "111" / "mop_spot_series.json").write_text(json.dumps(_blob("2026-09-28T00:00:00Z", [], [])))
    (tmp_path / "222").mkdir()
    (tmp_path / "222" / "mop_spot_series.json").write_text("{not json")
    (tmp_path / "other.json").write_text(json.dumps({"stations": "not a dict"}))
    assert len(NV.load_mop_archives(str(tmp_path))) == 1
    assert NV.load_mop_archives("") == []


def test_the_report_carries_mop_grid_ab_only_when_rows_carry_the_grid():
    row = {"station": "153p1", "obs_time": "t", "model_hs_m": 0.6, "obs_hs_m": 0.75, "mop_grid_hs_m": 0.8}
    rep = NV.build_report([row], n_stations=1, n_obs=1, n_preds=1)
    assert rep["mop_grid_ab"]["arm"]["bias_m"] == pytest.approx(0.05)
    plain = {k: v for k, v in row.items() if k != "mop_grid_hs_m"}
    assert "mop_grid_ab" not in NV.build_report([plain], n_stations=1, n_obs=1, n_preds=1)
