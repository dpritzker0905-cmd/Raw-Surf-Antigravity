"""WHERE the same-model accuracy gap comes from (2026-09-27).

The accuracy monitor's paired head-to-head says our GFS lane loses to Open-Meteo's copy of the same model
(+48 h 0.302 vs 0.274 m, win rate 40%). Probed live: 9 of 51 calibration buoys are answered from the 2 deg
`global_mid` grid, which was a GFS cycle behind the regional tiles, and off-cycle hours are answered from the
nearest 3-hourly frame. Ledger rows now record which product, frame and cycle answered, and
`same_model_attribution` splits the paired gap along those axes.
"""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from services.weather_pipeline import buoy_calibration as bc
from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.skill_attribution import (
    SAME_MODEL_CONTROL, same_model_attribution, serving_provenance, tier_of)


@pytest.mark.parametrize("pid,tier", [
    ("gfs_marine_waves_hawaii_20260928T030000Z.json", "regional"),
    ("gfs_marine_waves_global_mid_20260928T000000Z.json", "global_mid"),
    ("gfs_marine_waves_global_coarse_20260928T000000Z.json", "global_coarse"),
    ("dyn_gfs_marine_waves_abc.json", "dynamic"),
    (None, None),
])
def test_the_tier_is_read_off_the_product_id(pid, tier):
    assert tier_of(pid) == tier


def test_provenance_names_the_frame_snap_and_the_cycle_age():
    p = serving_provenance("gfs_marine_waves_hawaii_20260928T030000Z.json", "2026-09-26T18:00:00Z",
                           "2026-09-28T04:00:00Z", 24.0)
    # 04Z answered from the 03Z frame; ledgered at 2026-09-27T04Z against the 26th's 18Z cycle.
    assert p == {"tier": "regional", "frame_off_h": 1.0, "cycle_age_h": 10.0}


def test_unknown_provenance_is_absent_never_guessed():
    assert serving_provenance(None, None, "2026-09-28T04:00:00Z", 24.0) == {}
    assert serving_provenance("no_timestamp_here", None, "2026-09-28T04:00:00Z", 24.0) == {"tier": "regional"}


def test_ledger_rows_carry_what_answered():
    report = {"spots": [{"buoy_id": "46232", "residual": {"model_hs_m": 1.04, "model_tp_s": 12.0},
                         "served": {"product": "gfs_marine_waves_global_mid_20260928T030000Z.json",
                                    "cycle": "2026-09-26T12:00:00Z"}}]}
    (row,) = fs.rows_from_calibration_report(report, "2026-09-28T03:00:00Z", 24.0)
    assert (row["tier"], row["frame_off_h"], row["cycle_age_h"]) == ("global_mid", 0.0, 15.0)


def _pair(bid, t, ours_err, ctl_err, **prov):
    obs = {"obs_time": f"{t}", "obs_hs_m": 1.0}
    base = {"buoy_id": bid, "target_time": t, "lead_h": 48.0, **obs}
    return [{**base, "source": "raw_surf", "err_m": ours_err, **prov},
            {**base, "source": SAME_MODEL_CONTROL, "err_m": ctl_err}]


def test_the_paired_gap_is_split_by_tier_frame_and_cycle():
    rows = []
    for i in range(10):     # regional, on-frame, fresh: we roughly tie
        rows += _pair(f"r{i}", "2026-09-28T03:00:00Z", 0.20, 0.19, tier="regional", frame_off_h=0.0, cycle_age_h=4.0)
    for i in range(5):      # global_mid, snapped, stale: this is where the gap lives
        rows += _pair(f"g{i}", "2026-09-28T04:00:00Z", -0.50, 0.20, tier="global_mid", frame_off_h=1.0, cycle_age_h=10.0)
    a = same_model_attribution(rows)
    assert a["n_paired"] == 15
    tiers = {g["group"]: g for g in a["by_tier"]}
    assert tiers["global_mid"]["delta_m"] == pytest.approx(0.30)
    assert tiers["global_mid"]["share_of_gap"] > 0.9
    assert {g["group"] for g in a["by_frame"]} == {"on_frame", "snapped"}
    assert {g["group"] for g in a["by_cycle"]} == {"fresh", "stale"}
    assert sum(g["share_of_gap"] for g in a["by_tier"]) == pytest.approx(1.0, abs=0.01)


def test_a_different_verifying_observation_is_not_a_pair():
    rows = _pair("b1", "2026-09-28T03:00:00Z", 0.3, 0.1, tier="regional")
    rows[1]["obs_time"] = "2026-09-28T03:30:00Z"
    assert same_model_attribution(rows)["n_paired"] == 0


def test_rows_from_before_the_provenance_read_as_unknown():
    a = same_model_attribution(_pair("b1", "2026-09-28T03:00:00Z", 0.3, 0.1))
    assert [g["group"] for g in a["by_tier"]] == ["unknown"]


def test_calibration_records_the_product_and_cycle_that_answered(monkeypatch):
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    monkeypatch.setenv("BUOY_WIND_RESIDUAL", "0")
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={"46232": (32.53, -117.43)}))
    monkeypatch.setattr(bc, "fetch_ndbc_latest", AsyncMock(return_value=None))

    class Resolver:
        async def resolve_point(self, **k):
            return NormalizedPointResponse(
                model="GFS", provider="open-meteo", domain="marine", layer="waves",
                run_time=datetime(2026, 9, 26, 22, tzinfo=timezone.utc),
                model_run_time=datetime(2026, 9, 26, 18, tzinfo=timezone.utc), model_run_time_status="known",
                valid_time=datetime(2026, 9, 28, 4, tzinfo=timezone.utc),
                product_id="gfs_marine_waves_us_west_coast_socal_20260928T030000Z.json",
                is_forecast_authoritative=True, is_estimated=False,
                point=NormalizedPointDetail(requested_lat=32.53, requested_lng=-117.43, sampled_lat=32.5,
                                            sampled_lng=-117.5, speed=1.04, direction=270.0, u=0.0, v=0.0,
                                            period=12.0, interpolation_method="nearest"),
                value_kind="wave_height", value_unit="m", display_unit_hint="ft",
                source_variables=["wave_height"], freshness_sec=1800)

    report = asyncio.run(bc.calibrate_spots(Resolver(), [{"id": "s1", "noaa_buoy_id": "46232"}], "GFS",
                                            "2026-09-28T04:00:00Z"))
    assert report["spots"][0]["served"] == {
        "product": "gfs_marine_waves_us_west_coast_socal_20260928T030000Z.json",
        "cycle": "2026-09-26T18:00:00Z"}


def test_the_report_publishes_the_attribution():
    report = {}
    fs.attach_to_report(report, {"summary": [], "same_model_attribution": {"n_paired": 3}})
    assert report["forecast_skill_same_model"] == {"n_paired": 3}


# ── BIG SWELLS, SEPARATELY (2026-09-27) ─────────────────────────────────────────────────────────────
# The MOS shadow's holdout: our GFS lane under-forecasts swells >= 3 m by ~0.2 m more than the same model via
# Open-Meteo, eight times the all-sea gap. The attribution now splits that population on its own.

def _pair_hs(bid, obs_hs, ours_err, ctl_err, **prov):
    base = {"buoy_id": bid, "target_time": "2026-09-28T03:00:00Z", "lead_h": 48.0,
            "obs_time": "2026-09-28T03:00:00Z", "obs_hs_m": obs_hs}
    return [{**base, "source": "raw_surf", "err_m": ours_err, **prov},
            {**base, "source": SAME_MODEL_CONTROL, "err_m": ctl_err}]


def test_big_swells_are_attributed_on_their_own():
    rows = []
    for i in range(20):                                   # everyday seas: we tie
        rows += _pair_hs(f"s{i}", 1.2, 0.10, 0.10, tier="regional", frame_off_h=0.0, cycle_age_h=4.0)
    for i in range(4):                                    # big swells: we under-read 0.3 m more, on global_mid
        rows += _pair_hs(f"b{i}", 3.6, -0.50, -0.20, tier="global_mid", frame_off_h=1.0, cycle_age_h=10.0)
    a = same_model_attribution(rows)
    big = a["big_swell"]
    assert big["threshold_m"] == 3.0 and big["n_paired"] == 4
    assert (big["gap_m"], big["bias_ours_m"], big["bias_control_m"]) == (pytest.approx(0.3), -0.5, -0.2)
    assert [g["group"] for g in big["by_tier"]] == ["global_mid"]
    assert a["gap_m"] == pytest.approx(0.05), "the all-sea gap dilutes what the big-swell split isolates"
    assert a["n_paired"] == 24 and "by_tier" in a, "the existing keys are unchanged"


def test_the_threshold_is_the_mos_shadows_and_inclusive():
    from services.weather_pipeline.skill_mos import BIG_SWELL_M
    rows = _pair_hs("a", BIG_SWELL_M, -0.4, -0.1) + _pair_hs("b", BIG_SWELL_M - 0.01, -0.4, -0.1)
    assert same_model_attribution(rows)["big_swell"]["n_paired"] == 1


def test_no_big_swell_is_an_empty_block_not_a_zero():
    big = same_model_attribution(_pair_hs("a", 1.0, 0.1, 0.1))["big_swell"]
    assert (big["n_paired"], big["gap_m"], big["bias_ours_m"]) == (0, None, None)
