"""The alert replay's MEASURED error generator (scripts/alert_window_replay.py MeasuredErrors / issue_measured,
2026-11-04). It must reproduce the structure it was fitted to (unit variance, the measured cross-cycle and
GFS-ECMWF correlations), keep sigma 0 a perfect forecast, and draw every arm's forecasts from the seed alone."""
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in (backend_dir, os.path.join(backend_dir, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

import alert_window_replay as R  # noqa: E402

T0 = datetime(2024, 10, 1, tzinfo=timezone.utc)
EM_PATH = R.DEFAULT_EM


@pytest.fixture(scope="module")
def em():
    with open(EM_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_committed_error_model_has_every_field_the_replay_reads(em):
    for lane in ("gfs", "ecmwf"):
        for st in ("TRDF1", "LJPC1", "DUKN7"):
            assert em[lane]["by_station"][st], (lane, st)
    assert 0 < em["gfs"]["rho_h"]["hourly"]["speed"] < 1 and 0 < em["gfs"]["cross_cycle"]["sep6_speed"] <= 1
    assert -1 <= em["gfs_ecmwf"]["speed_err_corr"] <= 1 and 0 < em["hs"]["rho_h"] < 1


def _corr(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return num / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


def test_errors_are_unit_variance_and_carry_the_measured_correlations(em):
    hours = [T0 + timedelta(hours=h) for h in range(24 * 60)]
    g = R.MeasuredErrors(em, hours, random.Random(1), rho_hs=0.8)
    issues = [g.issue(T0 + timedelta(hours=4 * k)) for k in range(300)]
    lead = 12
    a = [i["a"]["s"][lead] for i in issues]
    p = [i["p"]["s"][lead] for i in issues]
    assert sum(x * x for x in a) / len(a) == pytest.approx(1.0, abs=0.25)
    assert _corr(a, p) == pytest.approx(em["gfs_ecmwf"]["speed_err_corr"], abs=0.1)
    # one valid time seen by two issues 4 h apart (leads 16 and 12): correlated at about the cross-cycle value
    x = [issues[k]["a"]["s"][16] for k in range(len(issues) - 1)]
    y = [issues[k + 1]["a"]["s"][12] for k in range(len(issues) - 1)]
    assert _corr(x, y) == pytest.approx(em["gfs"]["cross_cycle"]["sep6_speed"], abs=0.12)
    hs_a = [i["a"]["h"][lead] for i in issues]
    hs_p = [i["p"]["h"][lead] for i in issues]
    assert _corr(hs_a, hs_p) == pytest.approx(0.8, abs=0.1)


def test_the_draws_depend_on_the_seed_only(em):
    hours = [T0 + timedelta(hours=h) for h in range(200)]
    one = R.MeasuredErrors(em, hours, random.Random(7), 0.8).issue(T0)
    two = R.MeasuredErrors(em, hours, random.Random(7), 0.8).issue(T0)
    three = R.MeasuredErrors(em, hours, random.Random(8), 0.8).issue(T0)
    assert one == two and one != three


def _obs():
    out = {}
    for h in range(100):
        out[T0 + timedelta(hours=h)] = {"WVHT": 1.2, "DPD": 11.0, "MWD": 90.0, "WDIR": 270.0, "WSPD": 3.0,
                                        "tide": None}
    return out


def test_sigma_zero_is_the_perfect_forecast_in_both_lanes(em):
    spot = R.SPOTS[0]
    geo = R.resolve_surf_geometry(spot["lat"], spot["lng"])
    obs = _obs()
    errs = R.MeasuredErrors(em, sorted(obs), random.Random(3), 0.8)
    hz = R.issue_measured(spot, geo, obs, T0, 0.0, errs, step=6)
    truth = R.rate(spot, geo, 1.2, 11.0, 90.0, 3.0, 270.0, None)
    assert hz["models"] == ["GFS", "EURO"] and hz["default_model"] == "GFS"
    for fr in hz["frames"]:
        s = fr["spots"][0]
        assert s["surf_height_m"] == truth["surf_height_m"] and s["inputs"]["wind_ms"] == 3.0


def test_sigma_one_moves_the_wind_by_the_fitted_bias_on_average(em):
    spot = R.SPOTS[0]
    geo = R.resolve_surf_geometry(spot["lat"], spot["lng"])
    obs = _obs()
    fit = R._station_fit(em["gfs"], spot["wind"], "light")
    winds = []
    for seed in range(40):
        errs = R.MeasuredErrors(em, sorted(obs), random.Random(seed), 0.8)
        hz = R.issue_measured(spot, geo, obs, T0, 1.0, errs, step=12, peer=False)
        winds += [f["spots"][0]["inputs"]["wind_ms"] for f in hz["frames"]]
    mean_err = sum(w - 3.0 for w in winds) / len(winds)
    assert mean_err == pytest.approx(fit["bias"][0] + fit["bias"][1] * 36, abs=0.45)
