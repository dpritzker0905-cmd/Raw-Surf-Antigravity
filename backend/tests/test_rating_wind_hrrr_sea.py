"""RATING_WIND_HRRR rework (2026-11-04): the nearest-HRRR-SEA-cell sampler and its pre-registered scorer.

Pre-registration: docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/rating-wind-hrrr-sea-preregistration.md
The sampler is pure numpy on the native 3 km grid; the scorer (scripts/rework_hrrr_score.py) is offline-only.
"""
import importlib.util
import math
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from services import _hrrr_grid as hg
from services.weather_pipeline import rating_wind as RW

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "scripts", "rework_hrrr_score.py")
DUCK = (36.18, -75.75)


def _load_scorer():
    spec = importlib.util.spec_from_file_location("rework_hrrr_score", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _fields():
    u = np.full((hg.NY, hg.NX), 3.0)
    v = np.full((hg.NY, hg.NX), -1.0)
    land = np.zeros((hg.NY, hg.NX))
    return u, v, land


def _ij(lat, lng):
    fi, fj = hg.grid_ij(lat, lng)
    return fi, fj, int(round(fi)), int(round(fj))


def test_nearest_is_the_spot_cell_when_it_is_water():
    u, v, land = _fields()
    fi, fj, ci, cj = _ij(*DUCK)
    u[cj, ci], v[cj, ci] = 7.0, 2.0
    assert RW.sea_sample(u, v, land, *DUCK, mode="sea_nearest") == (7.0, 2.0)


def test_nearest_skips_land_and_takes_the_closest_water_cell():
    u, v, land = _fields()
    fi, fj, ci, cj = _ij(*DUCK)
    land[cj - 3:cj + 4, ci - 3:ci + 4] = 1.0        # a 7x7 land block around the spot
    u[cj, ci + 4], v[cj, ci + 4] = 11.0, 5.0          # water due east, 4 cells
    land[cj, ci + 4] = 0.0
    for di in range(-4, 5):                           # make every other ring-4 cell land so (cj, ci+4) is unique
        for dj in range(-4, 5):
            if max(abs(di), abs(dj)) == 4 and (dj, di) != (0, 4):
                land[cj + dj, ci + di] = 1.0
    got = RW.sea_sample(u, v, land, *DUCK, mode="sea_nearest")
    assert got == (11.0, 5.0)


def test_nearest_ignores_non_finite_water_cells():
    u, v, land = _fields()
    fi, fj, ci, cj = _ij(*DUCK)
    u[cj, ci] = np.nan
    got = RW.sea_sample(u, v, land, *DUCK, mode="sea_nearest")
    assert got == (3.0, -1.0)


def test_nothing_within_radius_is_nan():
    u, v, land = _fields()
    land[:] = 1.0
    su, sv = RW.sea_sample(u, v, land, *DUCK, mode="sea_nearest")
    assert math.isnan(su) and math.isnan(sv)
    su, sv = RW.sea_sample(u, v, land, *DUCK, mode="sea_bilinear")
    assert math.isnan(su) and math.isnan(sv)


def test_bilinear_drops_land_weights_and_renormalises():
    u, v, land = _fields()
    fi, fj, _, _ = _ij(*DUCK)
    i0, j0 = int(math.floor(fi)), int(math.floor(fj))
    ti, tj = fi - i0, fj - j0
    vals = {(0, 0): 1.0, (0, 1): 2.0, (1, 0): 3.0, (1, 1): 4.0}
    for (dj, di), x in vals.items():
        u[j0 + dj, i0 + di] = x
        v[j0 + dj, i0 + di] = -x
    land[j0 + 1, i0 + 1] = 1.0                        # drop one corner
    w = {(0, 0): (1 - ti) * (1 - tj), (0, 1): ti * (1 - tj), (1, 0): (1 - ti) * tj}
    exp = sum(w[k] * vals[k] for k in w) / sum(w.values())
    su, sv = RW.sea_sample(u, v, land, *DUCK, mode="sea_bilinear")
    assert su == pytest.approx(exp, rel=1e-12) and sv == pytest.approx(-exp, rel=1e-12)


def test_bilinear_with_all_water_equals_plain_bilinear():
    u, v, land = _fields()
    rng = np.random.default_rng(4)
    fi, fj, _, _ = _ij(*DUCK)
    i0, j0 = int(math.floor(fi)), int(math.floor(fj))
    u[j0:j0 + 2, i0:i0 + 2] = rng.normal(size=(2, 2))
    ti, tj = fi - i0, fj - j0
    exp = (u[j0, i0] * (1 - ti) * (1 - tj) + u[j0, i0 + 1] * ti * (1 - tj) + u[j0 + 1, i0] * (1 - ti) * tj
           + u[j0 + 1, i0 + 1] * ti * tj)
    assert RW.sea_sample(u, v, land, *DUCK, mode="sea_bilinear")[0] == pytest.approx(exp, rel=1e-12)


def test_bilinear_all_land_stencil_falls_back_to_nearest_sea_cell():
    u, v, land = _fields()
    fi, fj, _, _ = _ij(*DUCK)
    i0, j0 = int(math.floor(fi)), int(math.floor(fj))
    land[j0 - 2:j0 + 4, i0 - 2:i0 + 4] = 1.0
    assert RW.sea_sample(u, v, land, *DUCK, mode="sea_bilinear") == \
        RW.sea_sample(u, v, land, *DUCK, mode="sea_nearest") == (3.0, -1.0)


def test_unknown_mode_raises():
    u, v, land = _fields()
    with pytest.raises(ValueError):
        RW.sea_sample(u, v, land, *DUCK, mode="lane")


def test_sea_wind_uses_the_lanes_weights():
    cyc = datetime(2024, 12, 1, 0, tzinfo=timezone.utc)
    got = RW.sea_wind(10.0, 0.0, *DUCK, cyc + timedelta(hours=3), 5.0, 180.0, cyc + timedelta(hours=48))
    assert got["weight"] == pytest.approx(1.0)
    assert got["speed_kt"] == pytest.approx(10.0) and got["from_deg"] == pytest.approx(270.0)
    # past the horizon: HRRR carries no weight -> None (keep the model wind)
    assert RW.sea_wind(10.0, 0.0, *DUCK, cyc + timedelta(hours=60), 5.0, 180.0, cyc + timedelta(hours=48)) is None
    # outside HRRR's domain (mid-Pacific)
    assert RW.sea_wind(10.0, 0.0, 20.0, -160.0, cyc + timedelta(hours=3), 5.0, 180.0, cyc + timedelta(hours=48)) is None
    # a missing sample
    assert RW.sea_wind(float("nan"), 0.0, *DUCK, cyc + timedelta(hours=3), 5.0, 180.0, cyc + timedelta(hours=48)) is None


def test_sea_wind_taper_matches_the_lane_time_weight():
    cyc = datetime(2024, 12, 1, 0, tzinfo=timezone.utc)
    hz = cyc + timedelta(hours=48)
    for h, w in ((45, 1.0), (46, 0.75), (47, 0.5), (48, 0.25)):
        got = RW.sea_wind(10.0, 0.0, *DUCK, cyc + timedelta(hours=h), 10.0, 90.0, hz)
        assert got["weight"] == pytest.approx(w)


def test_scorer_window_cycles_cover_each_valid_hour_once():
    S = _load_scorer()
    cyc = S.window_cycles("2024-12-01", "2024-12-02")
    hours = [c + timedelta(hours=f) for c in cyc for f in S.FH]
    lo, hi = datetime(2024, 12, 1, tzinfo=timezone.utc), datetime(2024, 12, 2, 23, tzinfo=timezone.utc)
    inside = [t for t in hours if lo <= t <= hi]
    assert len(inside) == len(set(inside)) == 48


def test_scorer_hourly_wind_vector_mean_and_buoy_height():
    S = _load_scorer()
    t = datetime(2024, 12, 1, 5, tzinfo=timezone.utc)
    obs = [{"time": t - timedelta(minutes=10), "wspd_ms": 5.0, "wdir_deg": 350.0},
           {"time": t + timedelta(minutes=10), "wspd_ms": 5.0, "wdir_deg": 10.0},
           {"time": t + timedelta(minutes=30), "wspd_ms": 99.0, "wdir_deg": 180.0}]   # mid-hour: dropped
    got = S.hourly_wind(obs, buoy=False)["2024-12-01T05:00:00Z"]
    assert got[0] == pytest.approx(5.0) and min(got[1], 360.0 - got[1]) == pytest.approx(0.0, abs=1e-6)
    gb = S.hourly_wind(obs, buoy=True)["2024-12-01T05:00:00Z"]
    assert gb[0] == pytest.approx(5.0 * S.BUOY_LOG)


def test_scorer_holm_step_down():
    S = _load_scorer()
    assert S.holm({"a": 0.01, "b": 0.02, "c": None}, 0.05) == {"a": True, "b": True, "c": False}
    assert S.holm({"a": 0.03, "b": 0.04}, 0.05) == {"a": False, "b": False}


def test_scorer_controls_and_refusal():
    S = _load_scorer()
    import random
    rng = random.Random(7)
    rows = []
    t0 = datetime(2024, 12, 1, tzinfo=timezone.utc)
    for d in range(16):
        for spot, _sid, la, lo, region, _b in S.STATIONS:
            for h in range(0, 24, 6):
                o = rng.uniform(20, 80)
                f = o + rng.gauss(0, 8)
                rows.append({"spot": spot, "t": (t0 + timedelta(days=d, hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                             "season": "W1", "region": region, "regime": "mod6-15|cross", "lat": la, "lng": lo,
                             "obs": {"score": o}, "gfs": {"score": f}})
    pos = S.gate_items(S.items_of(rows, "gfs", cand_fn=lambda o, f: o + 0.8 * (f - o)))
    neg = S.gate_items(S.items_of(rows, "gfs", cand_fn=lambda o, f: o + 1.25 * (f - o)))
    null = S.gate_items(S.items_of(rows, "gfs", cand_fn=lambda o, f: f))
    assert pos["twoway_ci"][0] > 0 and not pos["holm_worse"]
    assert neg["twoway_ci"][1] < 0 and neg["holm_worse"]
    assert null["verdict"].startswith("REFUSED")
    short = [r for r in rows if r["t"] < "2024-12-10"]
    assert S.gate_items(S.items_of(short, "gfs", cand_fn=lambda o, f: o))["verdict"].startswith("REFUSED")


def test_scorer_reads_only_the_hrrr_bucket():
    S = _load_scorer()
    with pytest.raises(PermissionError):
        S._get("https://example.com/hrrr.20241201/conus/x.grib2")


def test_scorer_null_control_is_the_baseline_bit_for_bit():
    """Run 41938532670: o + 1.0 * (f - o) != f in floating point moved 5,366 rows and the null read FAIL."""
    S = _load_scorer()
    import random
    rng = random.Random(11)
    pairs = [(rng.uniform(0, 100), rng.uniform(0, 100)) for _ in range(5000)]
    assert any(o + 1.0 * (f - o) != f for o, f in pairs)          # the trap is real
    assert all(S.control_fn(1.0)(o, f) == f for o, f in pairs)
    assert S.control_fn(0.8)(10.0, 20.0) == pytest.approx(18.0)
