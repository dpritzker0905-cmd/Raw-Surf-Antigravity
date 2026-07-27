"""
Unit tests for services/weather_pipeline/surf_transform.py — the bathymetry surf transform physics.

Pure math, no I/O — validates linear-wave-theory shoaling + depth-limited breaking, including the dominant
physical claim: on a shallow shelf the surf is DEPTH-LIMITED, so a bigger offshore swell does NOT produce a
proportionally bigger surf (the "Florida shrinks vs steep-shelf California keeps" effect).
"""
import math
import pytest

from services.weather_pipeline import surf_transform as st


def test_wavenumber_deep_and_shallow_limits():
    # Deep water: k -> omega^2/g  (tanh(kd) -> 1)
    T = 10.0
    omega = 2 * math.pi / T
    k_deep = st.wavenumber(T, 4000.0)
    assert k_deep == pytest.approx(omega * omega / st.G, rel=1e-3)
    # Shallow water: k -> omega / sqrt(g d)
    T2, d2 = 20.0, 2.0
    omega2 = 2 * math.pi / T2
    k_shallow = st.wavenumber(T2, d2)
    assert k_shallow == pytest.approx(omega2 / math.sqrt(st.G * d2), rel=0.05)
    assert st.wavenumber(0, 10) is None and st.wavenumber(10, 0) is None


def test_shoaling_coefficient_is_unity_in_deep_water():
    assert st.shoaling_coefficient(12.0, 3000.0) == pytest.approx(1.0, abs=0.02)


def test_shoaling_coefficient_no_overflow_on_deep_short_period():
    # Regression: a short period over a very deep cell gives huge kd → math.sinh(2kd) used to raise
    # `OverflowError: math range error` and abort the whole rating_transform_grid on the global-coarse
    # frame (a deep-ocean cell mis-classified as coastal). The kd>20 guard returns the deep-water Ks=1.0.
    assert st.shoaling_coefficient(4.0, 2000.0) == 1.0
    # And the real entry point (estimate_surf) over such a cell must not raise either.
    surf, regime = st.estimate_surf(2.0, 4.0, 2000.0, coastal=True, shelf_width_km=50.0)
    assert surf is not None and regime in ("shelf", "shoaling", "breaking")


def test_calm_and_unknown_inputs():
    assert st.transform_surf(0.0, 12.0, 5.0) == (0.0, 'calm')
    assert st.transform_surf(None, 12.0, 5.0) == (None, 'unknown')
    assert st.transform_surf(2.0, None, 5.0) == (None, 'unknown')
    assert st.transform_surf(2.0, 0.0, 5.0) == (None, 'unknown')


def test_deep_water_passes_offshore_through_unchanged():
    surf, regime = st.transform_surf(2.0, 12.0, 4000.0)
    assert regime == 'deep'
    assert surf == pytest.approx(2.0)
    # missing / non-positive depth (land or no-data) also passes through as 'deep'
    assert st.transform_surf(2.0, 12.0, None) == (2.0, 'deep')
    assert st.transform_surf(2.0, 12.0, 0.0) == (2.0, 'deep')


def test_shallow_water_is_depth_limited_breaking():
    surf, regime = st.transform_surf(2.0, 12.0, 2.0)
    assert regime == 'breaking'
    assert surf == pytest.approx(st.breaker_index(12.0) * 2.0, rel=1e-6)   # period-dependent cap


def test_depth_limit_is_independent_of_offshore_size():
    # THE key physics: on the same shallow shelf, a 5 m offshore swell breaks no taller than a 2 m one.
    surf_small, r1 = st.transform_surf(2.0, 12.0, 2.0)
    surf_big, r2 = st.transform_surf(5.0, 12.0, 2.0)
    assert r1 == r2 == 'breaking'
    assert surf_small == pytest.approx(surf_big)             # both depth-limited to gamma*depth
    assert surf_big < 5.0                                    # genuinely smaller than the offshore swell


def test_breaker_index_period_dependence():
    # gamma_b rises with period (long-period plunges taller; short-period spills lower), centred on the
    # legacy 0.78 at a typical ~10.5 s swell, and bounded.
    assert st.breaker_index(10.5) == pytest.approx(0.78, abs=1e-9)
    assert st.breaker_index(5.0) < st.breaker_index(10.5) < st.breaker_index(16.0)
    assert st.GAMMA_MIN <= st.breaker_index(2.0) <= st.GAMMA_MAX
    assert st.GAMMA_MIN <= st.breaker_index(25.0) <= st.GAMMA_MAX
    assert st.breaker_index(2.0) == st.GAMMA_MIN          # clamped low
    assert st.breaker_index(25.0) == st.GAMMA_MAX         # clamped high
    assert st.breaker_index(None) == st.GAMMA and st.breaker_index(0) == st.GAMMA  # unknown -> reference


def test_depth_limited_break_is_taller_for_longer_period():
    # NEW physics: on the SAME shallow shelf cell, a long-period groundswell breaks TALLER than short-period
    # windchop (the depth-limited cap is now period-dependent). Both still depth-limited (independent of size).
    short, r1 = st.transform_surf(3.0, 7.0, 2.0)
    long, r2 = st.transform_surf(3.0, 16.0, 2.0)
    assert r1 == r2 == 'breaking'
    assert long > short                                    # longer period -> taller break at same depth
    assert long == pytest.approx(st.breaker_index(16.0) * 2.0, rel=1e-6)


def test_iribarren_and_breaker_type():
    # ξ0 = slope / sqrt(Hs/L0). Steeper slope or longer period (smaller s0) -> higher ξ0.
    assert st.iribarren(None, 1.5, 12.0) is None
    assert st.iribarren(0.05, None, 12.0) is None
    assert st.iribarren(0.0, 1.5, 12.0) is None              # non-physical slope
    steep = st.iribarren(0.10, 1.5, 14.0)
    gentle = st.iribarren(0.005, 1.5, 14.0)
    assert steep > gentle > 0
    assert st.breaker_type(gentle) == "spilling" if gentle < 0.5 else True
    assert st.breaker_type(1.5) == "plunging"
    assert st.breaker_type(0.2) == "spilling"
    assert st.breaker_type(5.0) == "surging"
    assert st.breaker_type(None) == "unknown"
    # longer period raises ξ0 (lower steepness) for the same slope
    assert st.iribarren(0.05, 1.5, 18.0) > st.iribarren(0.05, 1.5, 8.0)


def test_intermediate_depth_shoals_without_breaking():
    # Small swell over moderate depth: shoals but nowhere near the depth-limited cap.
    surf, regime = st.transform_surf(1.0, 14.0, 30.0)
    assert regime == 'shoaling'
    assert surf < st.GAMMA * 30.0                            # well below the breaking limit
    assert 0.8 < surf < 1.5                                  # near offshore, mild shoaling adjustment


# ── shelf bottom-friction transform (the Option-2 primary entry estimate_surf) ──
def test_shelf_factor_deep_unity_and_shallow_attenuates():
    assert st.shelf_factor(12.0, 3000.0) == pytest.approx(1.0, abs=1e-6)
    kf = st.shelf_factor(10.0, 20.0)
    assert 0.3 < kf < 0.95                                   # a shallow shelf bleeds some energy
    assert st.shelf_factor(10.0, 5.0) < kf                  # shallower -> more loss (monotonic)
    assert st.shelf_factor(10.0, None) == 1.0 and st.shelf_factor(None, 20.0) == 1.0


def test_komar_breaker_height():
    # Komar & Gaughan: defined for valid input, monotonic in offshore height, and longer period (lower
    # steepness) gives a taller breaker for the same offshore height.
    assert st.komar_breaker_height(0.0, 10.0) is None
    assert st.komar_breaker_height(1.0, 0.0) is None
    assert st.komar_breaker_height(2.0, 12.0) > st.komar_breaker_height(1.0, 12.0)
    assert st.komar_breaker_height(1.0, 16.0) > st.komar_breaker_height(1.0, 8.0)


def test_shelf_dissipation():
    # deep water or zero shelf width -> no loss
    assert st.shelf_dissipation(12.0, 3000.0, 100.0) == pytest.approx(1.0, abs=1e-9)
    assert st.shelf_dissipation(10.0, 20.0, 0.0) == pytest.approx(1.0)
    # wider shelf -> more energy lost (monotonic decrease)
    narrow = st.shelf_dissipation(10.0, 25.0, 20.0)
    wide = st.shelf_dissipation(10.0, 25.0, 120.0)
    assert 0.0 < wide < narrow < 1.0
    # shallower shelf -> the wave feels the bed more -> more loss
    assert st.shelf_dissipation(10.0, 12.0, 80.0) < st.shelf_dissipation(10.0, 60.0, 80.0)


def test_estimate_surf_regimes():
    # open ocean (not coastal) -> offshore swell passes through, regime open_ocean (callers hide it)
    s, r = st.estimate_surf(2.0, 10.0, 2000.0, coastal=False)
    assert r == 'open_ocean' and s == pytest.approx(2.0)
    # WIDE SHALLOW shelf (Florida-class): friction still reduces relative to a steep coast, but the
    # v3 Komar breaker lets the surviving swell shoal back up at the break (the v2 "< 0.8x offshore"
    # pin was the same-day-forecaster-proven FL underread — see test_surf_v3.py FL knee anchor).
    s, r = st.estimate_surf(2.0, 10.0, 24.0, coastal=True, shelf_width_km=100.0)
    assert r in ('shelf', 'breaking', 'shoaling') and s <= 2.0 * 2.0
    # steep / deep coast, long-period: v3 JACKS above offshore (Komar reef shoaling — the exact
    # capability v2 lacked; bounded by SURF_V3_JACK_MAX). The old "never amplified" pin was the bug.
    s, r = st.estimate_surf(2.0, 12.0, 2000.0, coastal=True, shelf_width_km=0.0)
    assert 2.0 <= s <= 2.0 * 2.0 + 1e-9
    # very shallow + big swell -> depth-limited breaking cap binds (period+slope breaker index; the
    # cap carries the v3.2 shelf-slope proxy = depth/width — see test_breaker_index_slope below)
    s, r = st.estimate_surf(5.0, 14.0, 1.0, coastal=True, shelf_width_km=5.0)
    assert r == 'breaking' and s == pytest.approx(st.breaker_index(14.0, slope=1.0 / 5000.0) * 1.0, rel=1e-6)
    # calm / unknown
    assert st.estimate_surf(0.0, 10.0, 20.0) == (0.0, 'calm')
    assert st.estimate_surf(None, 10.0, 20.0) == (None, 'unknown')
    assert st.estimate_surf(2.0, 0.0, 20.0) == (None, 'unknown')


def test_breaker_index_slope():
    """v3.2 SLOPE-AWARE γ_b (Weggel 1972 b(m) center; lit: Harris 2018 reef γ>0.85, Lin 2017
    non-linear slope dependence): flat wide shelves keep the legacy calibration; steep shelves
    raise the depth-limited cap toward the plunging-reef range."""
    # No slope supplied -> exact legacy behavior (backward compatible).
    assert st.breaker_index(10.5) == pytest.approx(0.78, abs=1e-9)
    assert st.breaker_index(10.5, slope=None) == pytest.approx(0.78, abs=1e-9)
    # FLAT shelf proxy (Florida-class: ~25 m / 90 km ≈ 0.0003): b(m) → 0.78, legacy-equivalent.
    assert st.breaker_index(10.5, slope=0.0003) == pytest.approx(0.78, abs=0.005)
    # STEEP shelf proxy (volcanic reef coast: ~100 m / 3 km ≈ 0.033): cap raised meaningfully.
    steep = st.breaker_index(10.5, slope=0.033)
    assert steep > 0.90
    # Monotonic in slope; bounded by the widened steep ceiling.
    assert st.breaker_index(10.5, slope=0.1) >= steep
    assert st.breaker_index(20.0, slope=1.0) <= st.GAMMA_MAX_STEEP + 1e-9
    # Period term still applies on the slope path (long-period breaks taller).
    assert st.breaker_index(14.0, slope=0.033) > st.breaker_index(8.0, slope=0.033)
    # Kill switch restores the flat center even with a steep slope.
    import os
    os.environ["SURF_V3_SLOPE_GAMMA"] = "0"
    try:
        assert st.breaker_index(10.5, slope=0.033) == pytest.approx(0.78, abs=1e-9)
    finally:
        del os.environ["SURF_V3_SLOPE_GAMMA"]


def test_estimate_surf_steep_shelf_breaks_taller():
    """The user-visible v3.2 effect: at the same shallow depth, a STEEP-shelf break (reef-class)
    is allowed a taller depth-limited wave than a wide-flat-shelf beach break."""
    flat, rf = st.estimate_surf(5.0, 12.0, 2.0, coastal=True, shelf_width_km=90.0)   # FL-class
    steep, rs = st.estimate_surf(5.0, 12.0, 2.0, coastal=True, shelf_width_km=2.0)   # reef-class
    assert rf == 'breaking' and rs == 'breaking'
    assert steep > flat


def test_estimate_surf_wider_shelf_reduces_more():
    # THE key physics fix: a wider shelf (more cross-shelf friction) gives smaller surf for the same swell.
    narrow, _ = st.estimate_surf(2.0, 10.0, 25.0, coastal=True, shelf_width_km=20.0)
    wide, _ = st.estimate_surf(2.0, 10.0, 25.0, coastal=True, shelf_width_km=120.0)
    # monotonicity is the physics under test; the absolute value may exceed offshore under the v3
    # Komar jack (bounded by SURF_V3_JACK_MAX = 2x)
    assert wide < narrow <= 2.0 * 2.0 + 1e-9


def test_estimate_surf_open_ocean_passthrough():
    # no nearby shore -> swell, not surf: offshore height returned unchanged for any size
    for Hs in (1.0, 2.5, 4.0):
        s, r = st.estimate_surf(Hs, 11.0, 3000.0, coastal=False)
        assert r == 'open_ocean' and s == pytest.approx(Hs)


# ── /point wiring: resolve_point must attach surf fields to a successful marine response ──
@pytest.mark.asyncio
async def test_resolve_point_attaches_surf_for_marine(monkeypatch):
    from datetime import datetime, timezone
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.schemas import NormalizedPointResponse, NormalizedPointDetail

    svc = PointResolutionService()

    def _resp(domain, layer, lat, lng, Hs, Tp):
        return NormalizedPointResponse(
            model="GFS", provider="open-meteo", domain=domain, layer=layer,
            run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
            is_forecast_authoritative=True, is_estimated=False,
            point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                        sampled_lng=lng, speed=Hs, period=Tp, interpolation_method="t"),
            value_kind="wave_height", value_unit="m", display_unit_hint="ft",
            source_variables=["wave_height"], freshness_sec=1800)

    # Cape Canaveral marine waves: a WIDE SHALLOW shelf -> surf attached AND SMALLER than the offshore swell
    async def fake_marine(**kw):
        return _resp("marine", "waves", 28.4, -80.55, 2.0, 10.0)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_marine)
    r = await svc.resolve_point("GFS", "marine", "waves", 28.4, -80.55, "2026-06-28T00:00:00Z")
    assert r.surf_regime in ("shelf", "breaking")                    # friction-dominated coastal break
    assert r.surf_height_m is not None and 0 < r.surf_height_m < 2.0  # Florida shelf shrinks it (the fix)
    assert r.shelf_depth_m is not None and r.shelf_depth_m < 200

    # Deep open ocean (no nearby land) -> open_ocean, surf == offshore swell (hidden by the infobox)
    async def fake_deep(**kw):
        return _resp("marine", "waves", 30.0, -150.0, 2.0, 10.0)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_deep)
    r2 = await svc.resolve_point("GFS", "marine", "waves", 30.0, -150.0, "2026-06-28T00:00:00Z")
    assert r2.surf_regime == "open_ocean" and r2.surf_height_m == pytest.approx(2.0)

    # Wind domain -> NOT touched (surf stays None)
    async def fake_wind(**kw):
        return _resp("wind", "wind", 28.4, -80.55, 12.0, None)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_wind)
    r3 = await svc.resolve_point("GFS", "wind", "wind", 28.4, -80.55, "2026-06-28T00:00:00Z")
    assert r3.surf_height_m is None and r3.surf_regime is None


# ── grid transform (the Swell↔Surf coastal-band heatmap mode) ──
def test_surf_transform_grid_band_masks_open_ocean():
    import types
    mk = lambda lat, lng, sp, u, v, p: types.SimpleNamespace(lat=lat, lng=lng, speed=sp, u=u, v=v, period=p, is_valid=True)
    vecs = [
        mk(28.4, -80.5, 2.0, 1.0, -1.0, 10.0),    # coastal -> breaker height (stays valid/rendered)
        mk(30.0, -150.0, 2.0, 1.0, -1.0, 10.0),   # open ocean -> transparency-masked
        mk(28.4, -80.5, 0.0, 0.0, 0.0, 10.0),     # calm -> untouched
    ]
    depth_fn = lambda lat, lng: 20.0 if lat == 28.4 else 3000.0
    coastal_fn = lambda lat, lng: (lat == 28.4 and lng == -80.5)
    width_fn = lambda lat, lng: 100.0 if lat == 28.4 else 0.0   # wide FL-class shelf
    n_transformed, n_masked = st.surf_transform_grid(vecs, depth_fn, coastal_fn, width_fn)
    assert n_transformed == 1 and n_masked == 1
    # coastal cell: surf set BELOW the offshore swell (wide shelf reduces), still valid, u/v scaled by ratio
    # v3 Komar can lift the coastal cell above offshore (bounded 2x) — the masking is the physics here
    assert 0 < vecs[0].speed < 4.0 and vecs[0].is_valid is True
    assert vecs[0].u == pytest.approx(-vecs[0].v, abs=1e-9)   # was (1.0, -1.0) -> stays equal-and-opposite
    # open-ocean cell: transparency-masked (rendered transparent), offshore value left as-is
    assert vecs[1].is_valid is False
    # calm cell: untouched
    assert vecs[2].speed == 0.0 and vecs[2].is_valid is True


def test_surf_transform_grid_no_coastal_fn_treats_all_coastal():
    # Back-compat: without a coastal_fn nothing is masked (every cell treated as coastal).
    import types
    mk = lambda lat, lng, sp: types.SimpleNamespace(lat=lat, lng=lng, speed=sp, u=0.0, v=0.0, period=12.0, is_valid=True)
    vecs = [mk(28.4, -80.5, 2.0), mk(30.0, -150.0, 2.0)]
    n_transformed, n_masked = st.surf_transform_grid(vecs, lambda la, lo: 1000.0)
    assert n_masked == 0 and all(v.is_valid for v in vecs)


# ── nearshore break depth (2026-07-27) ──────────────────────────────────────────────────────────
def test_break_depth_caps_the_wave_where_the_shelf_depth_never_could():
    """H <= gamma*d is the most basic law in surf, and it was DEAD in production.

    `depth_m` is a ~139 km shelf median. Measured across 395 live spots the depth-limited cap bound
    on ZERO of them (median cap 107x the wave) because Santa Cruz's shelf median is 452 m — the
    Monterey Canyon. Passing the ETOPO nearshore depth (8.5 m there) makes the cap real again."""
    import os
    os.environ.pop("SURF_BREAK_DEPTH", None)
    big = dict(Hs_m=12.0, Tp_s=16.0, coastal=True, shelf_width_km=27.8)
    uncapped, _ = st.estimate_surf(depth_m=452.0, **big)
    capped, regime = st.estimate_surf(depth_m=452.0, break_depth_m=8.5, **big)
    assert capped < uncapped, "the nearshore depth must limit a big swell"
    assert capped <= 0.78 * 8.5 * 1.6, "capped height must be within breaker-index range of gamma*d"


def test_absent_break_depth_is_byte_identical_to_legacy():
    """The whole safety argument: no asset entry -> nothing changes."""
    args = dict(Hs_m=2.5, Tp_s=13.0, depth_m=452.0, coastal=True, shelf_width_km=27.8)
    assert st.estimate_surf(**args) == st.estimate_surf(break_depth_m=None, **args)


def test_break_depth_kill_switch_restores_legacy(monkeypatch):
    args = dict(Hs_m=12.0, Tp_s=16.0, depth_m=452.0, coastal=True, shelf_width_km=27.8)
    monkeypatch.setenv("SURF_BREAK_DEPTH", "0")
    assert st.estimate_surf(break_depth_m=8.5, **args) == st.estimate_surf(**args)


def test_break_depth_separates_two_spots_in_the_same_grid_cell():
    """Cowell's (8.5 m) and Steamer Lane (13.4 m) are 1.9 km apart and share every coarse input.
    The nearshore depth is what finally tells them apart on a big day."""
    import os
    os.environ.pop("SURF_BREAK_DEPTH", None)
    big = dict(Hs_m=16.0, Tp_s=16.0, depth_m=452.0, coastal=True, shelf_width_km=27.8)
    cowells, _ = st.estimate_surf(break_depth_m=8.5, **big)
    steamer, _ = st.estimate_surf(break_depth_m=13.4, **big)
    assert steamer > cowells, "the deeper break must hold a bigger wave"


def test_nonsense_break_depth_is_ignored():
    args = dict(Hs_m=2.0, Tp_s=12.0, depth_m=452.0, coastal=True, shelf_width_km=27.8)
    for bad in (0.0, -5.0):
        assert st.estimate_surf(break_depth_m=bad, **args) == st.estimate_surf(**args)
