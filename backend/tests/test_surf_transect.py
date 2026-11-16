"""Arm A1, the cross-shore breaking transect (scripts/surf_transect.py). Offline, model only.

These pin the equations as read from the SWAN technical documentation (2.65, 2.66, H_max = gamma d), the energy-flux
march derived from them, the guardrails the gate set for every arm (monotone in the offshore height, no wind input,
outside the serving import path), and the bed profile's coverage rules."""
import inspect
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import surf_transect as st  # noqa: E402

BACKEND = os.path.join(os.path.dirname(__file__), "..")


def planar(slope, out_m=3000, step=20):
    return [(x, x * slope) for x in range(step, out_m + 1, step)]


def test_linear_theory_matches_its_deep_and_shallow_limits():
    c, cg = st.celerities(10.0, 5000.0)
    assert c == pytest.approx(st.G * 10.0 / (2 * math.pi), rel=1e-6) and cg == pytest.approx(c / 2, rel=1e-6)
    c, cg = st.celerities(20.0, 1.0)
    assert c == pytest.approx(math.sqrt(st.G * 1.0), rel=0.01) and cg == pytest.approx(c, rel=0.02)
    k = st.wavenumber(8.0, 12.0)
    assert (2 * math.pi / 8.0) ** 2 == pytest.approx(st.G * k * math.tanh(k * 12.0), rel=1e-9)


def test_the_breaking_fraction_solves_equation_2_66():
    for beta in (0.3, 0.5, 0.7, 0.9, 0.99):
        q = st.breaking_fraction(beta * beta / 8.0, 1.0)                     # H_rms = beta, H_max = 1
        assert 0.0 < q < 1.0 and (1.0 - q) / math.log(q) == pytest.approx(-8.0 * (beta * beta / 8.0) / 1.0, rel=1e-6)
    qs = [st.breaking_fraction(b * b / 8.0, 1.0) for b in (0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 1.5)]
    assert qs == sorted(qs) and qs[0] < 1e-40 and qs[-2:] == [1.0, 1.0]     # rises with H_rms / H_max, saturates at 1
    assert st.breaking_fraction(0.09 ** 2 / 8.0, 1.0) == 0.0                # below a tenth of the limit: exactly none
    assert st.breaking_fraction(0.005 ** 2 / 8.0, 1.0) == 0.0               # far below the limit: exactly none
    assert st.breaking_fraction(0.0, 1.0) == 0.0 and st.breaking_fraction(1.0, 0.0) == 1.0


def test_the_dissipation_is_equation_2_65_with_alpha_one_and_gamma_times_depth():
    e, d, t, gamma = 0.05, 2.0, 8.0, 0.73
    h_max = gamma * d
    q = st.breaking_fraction(e, h_max)
    assert st.dissipation(e, d, t, gamma) == pytest.approx(-1.0 * q * (2 * math.pi / t) * h_max ** 2 / (8 * math.pi))
    assert st.dissipation(1e-6, 50.0, t) == 0.0                              # far from breaking: nothing is removed
    assert st.dissipation(e, d, t, gamma, alpha=0.0) == 0.0
    assert st.GAMMA_BS == 0.73 and st.ALPHA_BJ == 1.0 and st.H110_OVER_HS == 1.27


def test_without_breaking_the_march_is_linear_shoaling_and_conserves_flux():
    # a tiny wave over a bed that stops in 8 m of water never breaks: its height must follow c_g alone
    bed = [(x, 8.0 + x * 0.004) for x in range(100, 3001, 100)]
    r = st.march(0.1, 10.0, 0.0, 20.0, bed)
    assert r["broke"] is False and r["wet_samples"] == 30
    x_end, d_end, hs_end = r["profile"][-1]
    _c0, cg0 = st.celerities(10.0, 20.0)
    _c1, cg1 = st.celerities(10.0, d_end)
    assert hs_end == pytest.approx(0.1 * math.sqrt(cg0 / cg1), rel=3e-3)        # the profile is printed to 4 decimals
    assert r["surf_m"] == pytest.approx(1.27 * max(h for _x, _d, h in r["profile"]), rel=2e-3)


def test_breaking_takes_height_off_and_the_inner_surf_zone_is_depth_limited():
    with_b, without = st.march(1.5, 12.0, 0.0, 20.0, planar(0.01)), st.march(1.5, 12.0, 0.0, 20.0, planar(0.01), alpha=0.0)
    assert with_b["broke"] and with_b["surf_m"] < without["surf_m"]          # dissipation lowers the breaker height
    inner = [(d, h) for _x, d, h in with_b["profile"] if d < 1.0]
    assert inner and all(h / math.sqrt(2) <= 0.73 * d + 0.01 for d, h in inner)     # H_rms <= gamma d: saturated
    # the control the advisor asked for, in model form: with alpha = 0 the only limit left is saturation
    assert max(h / math.sqrt(2) / d for _x, d, h in without["profile"]) <= 0.73 + 0.01   # depth printed to 2 decimals
    assert with_b["surf_depth_m"] > 1.0 and 0 < with_b["surf_at_m"] < 3000


def test_the_surf_never_drops_as_the_offshore_height_rises():
    # a gentle beach, a steep one, and a barred one (the bar is where a non-monotone answer would hide)
    for bed in (planar(0.005), planar(0.1), [(x, 0.5 + 3.0 * math.sin(x / 300.0) ** 2 + x * 0.006) for x in range(20, 3001, 20)]):
        for tp in (5.0, 7.28, 14.0):
            prev = 0.0
            for i in range(1, 31):
                surf = st.march(0.2 * i, tp, 0.0, 20.0, bed)["surf_m"]
                assert surf >= prev - 1e-9, (tp, 0.2 * i, prev, surf)
                prev = surf


def test_oblique_waves_refract_and_arrive_smaller():
    head_on = st.march(1.5, 12.0, 0.0, 20.0, planar(0.02))["surf_m"]
    oblique = st.march(1.5, 12.0, 60.0, 20.0, planar(0.02))["surf_m"]
    assert oblique < head_on and st.march(1.5, 12.0, -60.0, 20.0, planar(0.02))["surf_m"] == pytest.approx(oblique)


def test_unusable_inputs_and_a_thin_bed_give_no_number():
    assert st.march(1.0, 8.0, 0.0, 20.0, planar(0.02)[:4])["surf_m"] is None          # under MIN_WET_SAMPLES
    for hs, tp in ((None, 8.0), (1.0, None), (0.0, 8.0), (1.0, 0.0), (-1.0, 8.0)):
        assert st.march(hs, tp, 0.0, 20.0, planar(0.02))["surf_m"] is None
    assert st.march(1.0, 8.0, 0.0, 20.0, [])["surf_m"] is None and st.MIN_WET_SAMPLES == 5


def test_the_bed_profile_finds_the_shoreline_and_reports_its_coverage():
    # a coast running east-west at lat 30.0: land (positive up) to the south, a 1:50 bed to the north
    def elev(lat, lng):
        north_m = (lat - 30.0) * 111_195.0
        return 2.0 if north_m <= 0 else -north_m / 50.0
    out = st.bed_from_grid(29.999, -81.0, 0.0, elev)                         # the spot is 111 m inland
    # 1:50 reaches the 20 m limit 1,000 m out, so about ten 100 m samples are wet
    assert 9 <= out["wet"] <= 11 and out["slope"] == pytest.approx(1 / 50.0, rel=0.02) and out["reached_max_depth"] is True
    assert out["bed"][0][0] <= 100.0 and out["bed"][0][1] > 0 and out["deepest_m"] >= 20.0
    assert [x for x, _d in out["bed"]] == sorted(x for x, _d in out["bed"])
    surf = st.march(1.12, 7.28, 0.0, 21.0, out["bed"])
    assert surf["surf_m"] is not None and surf["wet_samples"] == out["wet"]
    no_data = st.bed_from_grid(29.999, -81.0, 0.0, lambda lat, lng: None)
    assert no_data["bed"] == [] and no_data["known"] == 0 and no_data["slope"] is None
    all_land = st.bed_from_grid(29.999, -81.0, 0.0, lambda lat, lng: 5.0)
    assert all_land["bed"] == [] and all_land["wet"] == 0
    all_water = st.bed_from_grid(30.01, -81.0, 0.0, elev)
    assert all_water["wet"] >= 5 and all_water["bed"][0][0] > 0


def test_the_arm_takes_no_wind_and_is_outside_the_serving_import_path():
    assert "wind" not in inspect.signature(st.march).parameters and "wind" not in " ".join(inspect.signature(st.dissipation).parameters)
    src = open(st.__file__, encoding="utf-8").read()
    assert "import os" not in src and "environ" not in src and "requests" not in src       # pure: no flags, no network
    assert [line for line in src.splitlines() if line.startswith(("import ", "from "))] == ["import math"]
    hits = []
    for root in ("services", "routes"):
        for folder, _dirs, files in os.walk(os.path.join(BACKEND, root)):
            for name in files:
                if name.endswith(".py"):
                    with open(os.path.join(folder, name), encoding="utf-8", errors="replace") as f:
                        if "surf_transect" in f.read():
                            hits.append(os.path.join(folder, name))
    assert hits == [], "the offline transect arm must not be imported by the serving path"
    assert "surf_transect" not in open(os.path.join(BACKEND, "server.py"), encoding="utf-8", errors="replace").read()
