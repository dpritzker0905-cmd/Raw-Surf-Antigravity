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


# ══ VERIFICATION METRICS (MASTER AUDIT 1.0 §8.1) ═══════════════════════════════════════════════
#
# The ledger reported BIAS and MAE and nothing else, and the archive's first reading gave ours MAE
# 0.304 vs Open-Meteo 0.199 at ~ZERO BIAS ON BOTH SIDES. That is a SCATTER gap — and the two
# reported numbers are exactly the pair that cannot see one. These tests pin the arithmetic against
# hand-computed values, and the first one is the whole argument in a single assertion.

from services.weather_pipeline.forecast_skill import (  # noqa: E402
    MIN_N_FOR_SHAPE, obs_band, verification_metrics,
)


def test_scatter_and_offset_are_INDISTINGUISHABLE_by_mae_and_rmse_but_not_by_si():
    """⭐ THE POINT OF THIS WHOLE CHANGE.

    Two forecasts, twelve points each, observed 1.0 m throughout:
      A  alternates +0.5 / -0.5   -> pure SCATTER, zero bias
      B  is always  +0.5          -> pure OFFSET,  zero scatter
    Both have MAE 0.5 and RMSE 0.5 — the old summary graded them identically. The de-biased
    scatter index separates them completely (0.5 vs 0.0), which is the difference between "a
    constant can fix this" and "no constant can".
    """
    obs = [1.0] * 12
    a = verification_metrics([(1.0 + (0.5 if i % 2 == 0 else -0.5), o) for i, o in enumerate(obs)])
    b = verification_metrics([(o + 0.5, o) for o in obs])

    assert a["mae_m"] == b["mae_m"] == 0.5
    assert a["rmse_m"] == b["rmse_m"] == 0.5          # identical under the OLD instrument
    assert a["bias_m"] == 0.0 and b["bias_m"] == 0.5
    assert a["si"] == 0.5 and b["si"] == 0.0          # and completely separated by the new one
    assert b["sym_slope"] == 1.5                      # B over-reads amplitude by 50%


def test_a_perfect_forecast_is_the_known_good_control():
    """An instrument that cannot come back 'this is fine' is not evidence."""
    obs = [0.4 + 0.2 * i for i in range(12)]
    m = verification_metrics([(o, o) for o in obs])
    assert m["bias_m"] == 0.0 and m["mae_m"] == 0.0 and m["rmse_m"] == 0.0
    assert m["si"] == 0.0 and m["corr"] == 1.0 and m["sym_slope"] == 1.0


def test_shape_metrics_REFUSE_below_min_n_rather_than_report_an_unstable_number():
    """A correlation from n=2 is always +/-1. Reporting it would read as excellence."""
    obs = [0.5 * (i + 1) for i in range(MIN_N_FOR_SHAPE - 1)]
    m = verification_metrics([(o, o) for o in obs])
    assert m["n_paired"] == MIN_N_FOR_SHAPE - 1
    assert m["mae_m"] == 0.0 and m["rmse_m"] == 0.0          # these are stable at any n
    assert m["si"] is None and m["corr"] is None and m["sym_slope"] is None


def test_correlation_refuses_on_zero_variance_instead_of_reporting_zero():
    """A flat sea gives a zero denominator. `0.0` would read as 'the forecast tracks nothing'."""
    m = verification_metrics([(1.0, 1.0)] * 12)
    assert m["corr"] is None, "reported a correlation with no variance to correlate"
    assert m["si"] == 0.0 and m["sym_slope"] == 1.0


def test_si_refuses_when_there_is_no_sea_to_normalise_by():
    """SI divides by mean observed. At mean 0 the honest answer is None, not 0.0 (= perfect)."""
    m = verification_metrics([(0.1, 0.0)] * 12)
    assert m["si"] is None, "divided by an empty sea and called the result perfect"
    assert m["sym_slope"] is None                            # sum(obs^2) == 0 too
    assert m["mae_m"] == 0.1                                 # the plain metrics still work


def test_empty_and_unpaired_input_yield_None_not_a_zero_row():
    assert verification_metrics([]) is None
    assert verification_metrics([(None, 1.0), (1.0, None)]) is None


def test_summary_adds_metrics_without_changing_the_existing_series():
    """⚠️ The archive is one continuous series. Rows that carry only `err_m` — every row written
    before this change — must keep their exact n/bias/mae and gain NO fabricated shape metrics."""
    legacy = [{"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.2},
              {"source": SOURCE_OURS, "buoy_id": "b", "lead_h": 24.0, "err_m": 0.4}]
    row = skill_summary(legacy)[0]
    assert row["n"] == 2 and row["mae_m"] == 0.3
    assert "si" not in row and "by_obs_band" not in row, "invented metrics from unpaired rows"

    paired = [{"source": SOURCE_OURS, "buoy_id": f"b{i}", "lead_h": 24.0,
               "hs_m": 1.0 + 0.5, "obs_hs_m": 1.0, "err_m": 0.5} for i in range(12)]
    prow = skill_summary(paired)[0]
    assert prow["n"] == 12 and prow["n_paired"] == 12
    assert prow["si"] == 0.0 and prow["bias_m"] == 0.5       # pure offset, correctly separated


def test_obs_band_stratification_splits_flat_water_from_rideable_surf():
    """A single MAE hides the shape: measured at 60 buoys GFS's error was concentrated on FLAT
    seas (0.616 vs EURO's 0.263). Over-reading a calm day is the app inventing surf."""
    flat = [{"source": SOURCE_OURS, "buoy_id": f"f{i}", "lead_h": 24.0,
             "hs_m": 1.1, "obs_hs_m": 0.2, "err_m": 0.9} for i in range(12)]
    rideable = [{"source": SOURCE_OURS, "buoy_id": f"r{i}", "lead_h": 24.0,
                 "hs_m": 2.1, "obs_hs_m": 2.0, "err_m": 0.1} for i in range(12)]
    row = skill_summary(flat + rideable)[0]
    bands = row["by_obs_band"]
    assert bands["flat <0.5m"]["mae_m"] == 0.9
    assert bands["rideable 1.5-3m"]["mae_m"] == 0.1
    assert row["mae_m"] == 0.5, "the pooled average hides both"
    assert obs_band(0.2) == "flat <0.5m" and obs_band(2.0) == "rideable 1.5-3m"
    assert obs_band(None) is None


def test_the_band_table_is_not_a_second_copy():
    """`scripts/model_skill_census.py` must IMPORT the bands, not redefine them — a duplicated
    constant diverges only on a boundary, and this repo has already paid for seven copies of one."""
    import importlib.util
    from pathlib import Path
    from services.weather_pipeline.forecast_skill import OBS_BANDS
    spec = importlib.util.spec_from_file_location(
        "_census", Path(__file__).resolve().parents[1] / "scripts" / "model_skill_census.py")
    census = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(census)
    assert census.BANDS is OBS_BANDS, "the census redefined the bands instead of importing them"
