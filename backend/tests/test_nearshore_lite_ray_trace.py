"""MOP-lite ray tracer on SYNTHETIC bathymetry with known answers (gate section 9: plane beach vs Snell's law).

A plane beach (straight, parallel contours) has an exact refraction answer:  sin(a)/c = const  along a ray, and for a
unidirectional wave Hs_t^2/Hs_b^2 = (Cg_b/Cg_t) * (cos a_b / cos a_t).  Land must block (zero energy)."""
import math

import numpy as np
import pytest

from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite import spectrum as sp
from services.weather_pipeline.nearshore_lite.dispersion import group_speed, phase_speed, wavenumber
from services.weather_pipeline.nearshore_lite.ray_trace import DepthGrid, trace_target

SLOPE, DX, NX, NY = 0.02, 25.0, 320, 440
FREQS = np.array([0.095, 0.100, 0.105])


def plane_beach():
    """Shore at the EAST edge (land x > X0), depth rising seaward to the west. Seaward normal = 270 deg."""
    x = np.arange(NX) * DX
    x0 = (NX - 6) * DX
    h = np.tile((SLOPE * (x0 - x))[None, :], (NY, 1))
    h[h < 0.5] = np.nan
    return DepthGrid(h, DX), x0


def target(grid, x0, depth=8.0):
    return x0 - depth / SLOPE, NY * DX / 2.0


def test_dispersion_matches_the_linear_relation():
    f, h = 0.1, 20.0
    k = float(wavenumber(f, h))
    assert 9.81 * k * math.tanh(k * h) == pytest.approx((2 * math.pi * f) ** 2, rel=1e-9)
    assert float(phase_speed(f, 5000.0)) == pytest.approx(9.81 / (2 * math.pi * f), rel=1e-6)   # deep: g/(2 pi f)


@pytest.mark.parametrize("from_deg", [250.0, 262.0, 270.0, 280.0, 292.0])
def test_snell_direction_and_energy_ratio_on_a_plane_beach(from_deg):
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    t = trace_target(g, xt, yt, freqs=FREQS, theta_step_deg=2.0)
    j = int(round(from_deg / 2.0))
    for fi, f in enumerate(FREQS):
        assert t["reached"][fi, j] == 0, "the ray must reach deep water inside the domain"
        h_t, h_b = t["depth_t_m"], float(t["depth_b_m"][fi, j])
        c_t, c_b = float(phase_speed(f, h_t)), float(phase_speed(f, h_b))
        a_t = math.radians(from_deg - 270.0)                       # angle from the seaward normal (270)
        a_b = math.asin(math.sin(a_t) * c_b / c_t)                 # Snell
        assert t["theta_b_from_deg"][fi, j] == pytest.approx(270.0 + math.degrees(a_b), abs=0.6)
        r_exp = c_b * float(group_speed(f, h_b)) / (c_t * float(group_speed(f, h_t)))
        assert t["R"][fi, j] == pytest.approx(r_exp, rel=0.02)


def test_unidirectional_hs_ratio_equals_shoaling_times_refraction():
    """Narrow-spread sea from 262 deg: Hs_t/Hs_b from the table equals the textbook Ks*Kr (energy-weighted over f)."""
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    tab = coef.Table(coef.build_payload("plane", trace_target(g, xt, yt, freqs=FREQS), {}))
    Tp, from_deg, s_big = 10.0, 262.0, 400.0
    S = sp.jonswap_shape(tab.f, Tp, 3.3)
    num = den = 0.0
    j = int(round(from_deg / 2.0))
    t = trace_target(g, xt, yt, freqs=FREQS)
    for fi, f in enumerate(FREQS):
        h_t, h_b = t["depth_t_m"], float(t["depth_b_m"][fi, j])
        a_t = math.radians(from_deg - 270.0)
        a_b = math.asin(math.sin(a_t) * float(phase_speed(f, h_b)) / float(phase_speed(f, h_t)))
        e = (float(group_speed(f, h_b)) / float(group_speed(f, h_t))) * math.cos(a_b) / math.cos(a_t)
        num += S[fi] * e
        den += S[fi]
    expected = math.sqrt(num / den)
    # a very narrow cos^2s spread centred on the BOUNDARY direction that maps to 262 at the target
    a_b0 = math.asin(math.sin(math.radians(-8.0)) * float(phase_speed(0.1, float(t["depth_b_m"][1, j])))
                     / float(phase_speed(0.1, t["depth_t_m"])))
    got = tab.apply_partition(1.0, Tp, 270.0 + math.degrees(a_b0), "swell", variant="base")
    assert got is not None
    assert got["ratio"] == pytest.approx(expected, rel=0.06)       # s=20 spreading smears the plane-beach answer a little


def test_waves_from_the_land_side_carry_no_energy():
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    t = trace_target(g, xt, yt, freqs=FREQS)
    from_land = int(round(90.0 / 2.0))                              # a wave from the east, i.e. from the shore
    assert np.all(t["R"][:, from_land] == 0.0) and np.all(t["blocked"][:, from_land])


def test_a_headland_shelters_the_lee_and_an_open_beach_does_not():
    """Land block to the west of the target casts a shadow on that bearing only."""
    g, x0 = plane_beach()
    h = g.h.copy()
    xt, yt = target(g, x0, depth=10.0)
    iy0 = int(yt / DX)
    ix0 = int(xt / DX)
    h[iy0 - 4:iy0 + 5, ix0 - 40:ix0 - 20] = np.nan                    # an island/headland 0.5-1 km seaward, on the beam
    shaded = trace_target(DepthGrid(h, DX), xt, yt, freqs=FREQS)
    open_ = trace_target(g, xt, yt, freqs=FREQS)
    j = int(round(270.0 / 2.0))                                       # head-on, through the block
    assert np.all(shaded["R"][:, j] == 0.0) and np.all(open_["R"][:, j] > 0.0)
    j2 = int(round(300.0 / 2.0))                                      # well off the block's bearing
    assert np.all(shaded["R"][:, j2] > 0.0)


def test_target_on_land_is_refused():
    g, x0 = plane_beach()
    with pytest.raises(ValueError):
        trace_target(g, x0 + 100.0, NY * DX / 2.0, freqs=FREQS)


def test_halving_the_step_converges_on_the_plane_beach():
    from services.weather_pipeline.nearshore_lite.ray_trace import convergence
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    full = trace_target(g, xt, yt, freqs=FREQS)
    half = trace_target(g, xt, yt, freqs=FREQS, step_factor=0.5)
    c = convergence(full, half)
    assert c["ok"] and c["median"] < 0.01 and c["p95"] < 0.03 and c["n"] > 100


def test_truncated_share_counts_lateral_shallow_exits_and_flags_over_20_percent():
    from services.weather_pipeline.nearshore_lite.ray_trace import TRUNCATED_FLAG_SHARE, truncated_share
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    wide = trace_target(g, xt, yt, freqs=FREQS)
    narrow_grid = DepthGrid(g.h[190:250, :], DX)                  # a 1.5 km wide strip: oblique rays leave the sides
    narrow = trace_target(narrow_grid, xt, 30 * DX, freqs=FREQS)
    assert truncated_share(narrow) > truncated_share(wide)
    assert truncated_share(narrow) > TRUNCATED_FLAG_SHARE == 0.20


def test_band_loss_is_reported_for_short_period_seas():
    from services.weather_pipeline.nearshore_lite import spectrum as sp
    assert sp.band_loss(14.0, 3.3) < 0.01          # groundswell sits inside 0.04-0.25 Hz
    assert sp.band_loss(3.0, 1.0) > 0.30           # a 3 s sea loses its tail above 0.25 Hz


def test_lite_arm_at_a_buoy_scores_in_the_serving_form():
    from services.weather_pipeline import surf_transform as st
    g, x0 = plane_beach()
    xt, yt = target(g, x0)
    tab = coef.Table(coef.build_payload("plane", trace_target(g, xt, yt, freqs=FREQS), {}))
    parts = [{"h": 2.0, "tp": 10.0, "dir": 270.0, "kind": "swell"}]
    at_target = coef.lite_buoy_hs(tab, parts, tab.depth_t_m, st.shoaling_coefficient)
    assert at_target == pytest.approx(tab.apply_partition(2.0, 10.0, 270.0, "swell")["hs_t_m"], rel=1e-9)
    deeper = coef.lite_buoy_hs(tab, parts, 30.0, st.shoaling_coefficient)
    assert 0 < deeper < at_target                  # same refraction factor, the chain's shoaling to the buoy depth
