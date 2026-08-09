"""
test_wave_wrapping.py -- the guards for the headland wrapping term.

ASCII only. No network, no fixtures, no DB. Every number here is either a published literature value
or a measurement recorded in the module's own docstring.

THE FIVE THINGS THIS SUITE HAS TO PROVE
  1. head-on is an exact identity, and the snap that makes it exact is not hiding a broken formula
  2. the factor is monotone non-increasing in dtheta, for every geometry, densely
  3. WITH NO HEADLAND the term is never more generous than the SHIPPED exposure floor, at any angle
     -- asserted against the live `surf_rating.swell_exposure`, not a copy of it, and separately
     against the literal 0.10 at dtheta 120
  4. J-Bay with its measured headland lands inside the band the literature independently derived
  5. the suite has TEETH: an EXECUTED mutation that deletes the geometry dependence must turn (4)
     red. A test that cannot tell "not measured" from "broken" is worthless here.
"""
import math
import os

import pytest

from services.weather_pipeline import wave_wrapping as ww
from services.weather_pipeline.surf_rating import swell_exposure

# --- the J-Bay case, exactly as measured on 2026-08-09 --------------------------------------------
# served sea: Hs 3.91 m, Tp 11.93 s, swell FROM 229.5 deg
# resolved shore normals across the cluster: 102.9 - 107.6 deg (audited correct)
JBAY_SWELL_FROM = 229.5
JBAY_SHORE_NORMAL = 105.0
JBAY_DTHETA = 124.5
# relief from the 463 m shore-normal asset within 25 km (n=12 neighbours); the Cape St Francis entry
# faces 147.8, i.e. 81.7 deg to a swell Supertubes itself sees at 124.5
JBAY_ROTATION = 42.8

# The literature agent's independent derivation for J-Bay, from Goda/Takayama/Suzuki's directional
# random-wave diffraction (ICCE 1978): Kd_eff 0.23-0.50 in HEIGHT, i.e. 0.053-0.245 in ENERGY,
# against the shipped 0.595 height / 0.100 energy floor. This band was produced WITHOUT reference to
# the model in `wave_wrapping.py`, which is what makes it a check rather than a restatement.
JBAY_ENERGY_LO, JBAY_ENERGY_HI = 0.053, 0.245
JBAY_HEIGHT_LO, JBAY_HEIGHT_HI = 0.23, 0.50

STATUS_QUO_FLOOR = 0.10  # surf_rating.swell_exposure past dtheta 90, the number this must not raise


def factor(dtheta, rot=0.0, **kw):
    """The term at a misalignment, on a coast facing JBAY_SHORE_NORMAL."""
    return ww.wrap_energy_factor(JBAY_SHORE_NORMAL + dtheta, JBAY_SHORE_NORMAL, rot, **kw)


# ==================================================================================================
# 1. HEAD-ON IDENTITY
# ==================================================================================================

def test_head_on_returns_exactly_one_for_every_geometry():
    for rot in (0.0, 10.0, 42.8, 60.0, 90.0):
        assert factor(0.0, rot) == 1.0, "head-on must be an exact identity at rot=%s" % rot


def test_head_on_snap_is_not_hiding_a_broken_formula():
    """The exact 1.0 at dtheta == 0 is an early return. If the general integral did not ALSO land on
    1.0, that snap would be papering over a bug -- so grade the general path just off head-on."""
    for rot in (0.0, 42.8):
        general = factor(1e-6, rot)
        assert abs(general - 1.0) < 1e-9, (
            "general path off head-on gave %.15f at rot=%s -- the head-on snap is masking it"
            % (general, rot))


def test_unknown_geometry_fails_open_like_the_shipped_factors():
    assert ww.wrap_energy_factor(None, JBAY_SHORE_NORMAL) == 1.0
    assert ww.wrap_energy_factor(JBAY_SWELL_FROM, None) == 1.0
    assert swell_exposure(None, JBAY_SHORE_NORMAL) == 1.0  # the behaviour being mirrored


def test_range_is_bounded_to_unit_interval():
    for rot in (0.0, 20.0, 42.8, 90.0):
        for i in range(0, 361):
            v = factor(i / 2.0, rot)
            assert 0.0 <= v <= 1.0, "out of [0,1] at dtheta=%.1f rot=%.1f: %r" % (i / 2.0, rot, v)


# ==================================================================================================
# 2. MONOTONICITY
# ==================================================================================================

@pytest.mark.parametrize("rot", [0.0, 5.0, 10.0, 20.0, 30.0, 42.8, 60.0, 75.0, 90.0])
def test_monotone_non_increasing_in_dtheta(rot):
    """Dense: 0 to 180 in 0.25 deg steps. An earlier formulation that treated the direct and wrap
    capture routes as EXCLUSIVE rather than alternatives put a step of up to 0.5 into the integrand
    at dtheta 90 and failed this at rot 60 -- so this sweep is not decorative."""
    previous = factor(0.0, rot)
    for i in range(1, 721):
        dtheta = i / 4.0
        value = factor(dtheta, rot)
        assert value <= previous + 1e-12, (
            "rose at dtheta=%.2f rot=%.1f: %.12g -> %.12g" % (dtheta, rot, previous, value))
        previous = value


def test_sign_of_the_misalignment_does_not_matter():
    for dtheta in (30.0, 90.0, 124.5, 170.0):
        assert factor(dtheta, 42.8) == pytest.approx(factor(-dtheta, 42.8), rel=1e-12)


def test_bearing_wrap_is_handled():
    """350 deg from a coast facing 10 deg is a 20 deg misalignment, not 340."""
    assert ww.wrap_energy_factor(350.0, 10.0) == pytest.approx(factor(20.0), rel=1e-12)


# ==================================================================================================
# 3. THE STRAIGHT-BEACH CONSTRAINT -- the most important assertion in this file
# ==================================================================================================

def test_straight_beach_is_never_more_generous_than_the_shipped_exposure():
    """Graded against the LIVE `surf_rating.swell_exposure`, imported, not copied: if the shipped
    floor ever moves, this test moves with it instead of grading a stale mirror.

    Raising the floor everywhere is THE failure mode this term exists to avoid -- at dtheta 120 on a
    straight beach the real shoreward flux is far below 0.10, so a term that lifts the floor to
    unlock J-Bay makes every straight beach on the planet more wrong."""
    for i in range(0, 1801):
        dtheta = i / 10.0
        mine = factor(dtheta, 0.0)
        shipped = swell_exposure(JBAY_SHORE_NORMAL + dtheta, JBAY_SHORE_NORMAL)
        assert mine <= shipped + 1e-12, (
            "straight beach at dtheta=%.1f: %.9g > shipped %.9g" % (dtheta, mine, shipped))


def test_straight_beach_at_120_is_at_or_below_the_literal_floor():
    """The constraint stated as a bare number, so it survives any refactor of `swell_exposure`."""
    assert factor(120.0, 0.0) <= STATUS_QUO_FLOOR
    # and by a wide margin, not by a hair -- the flux there is genuinely tiny
    assert factor(120.0, 0.0) < STATUS_QUO_FLOOR / 100.0


def test_the_spread_cannot_be_widened_out_from_under_the_guarantee():
    """The straight-beach guarantee was measured to hold up to sigma 13.70 deg and to FAIL above it
    (near dtheta 90 the honest spectral flux exceeds the shipped 0.10 floor). The module clamps at
    SPREAD_SIGMA_MAX_DEG = 13.0. Prove BOTH halves: the clamp holds the guarantee, AND the bound
    actually binds -- an unclamped 25 deg windsea spread really would break it."""
    assert ww.SPREAD_SIGMA_MAX_DEG < 13.70
    for i in range(0, 1801):
        dtheta = i / 10.0
        mine = factor(dtheta, 0.0, spread_sigma_deg=999.0)  # asks for a huge spread, gets the clamp
        shipped = swell_exposure(JBAY_SHORE_NORMAL + dtheta, JBAY_SHORE_NORMAL)
        assert mine <= shipped + 1e-12, "clamped spread still breached at dtheta=%.1f" % dtheta
    # positive control: without the clamp the bound is real, not defensive
    unclamped = ww._directional_flux(90.0, 0.0, 25.0, ww.CELERITY_RATIO_DEFAULT) / \
        ww._directional_flux(0.0, 0.0, 25.0, ww.CELERITY_RATIO_DEFAULT)
    assert unclamped > STATUS_QUO_FLOOR, (
        "a 25 deg windsea spread was expected to breach the 0.10 floor at dtheta 90; got %.6f"
        % unclamped)


# ==================================================================================================
# 4. J-BAY -- the case the term exists for
# ==================================================================================================

def _jbay_energy():
    return ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, JBAY_ROTATION)


def _assert_jbay_is_unlocked():
    """The claim, factored out so the mutation control below can run the SAME assertions against a
    crippled module and require them to fail."""
    energy = _jbay_energy()
    height = ww.wrap_height_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, JBAY_ROTATION)
    straight = ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 0.0)

    # (a) inside the band the literature derived independently
    assert JBAY_ENERGY_LO <= energy <= JBAY_ENERGY_HI, (
        "J-Bay energy %.6f outside the literature band [%.3f, %.3f]"
        % (energy, JBAY_ENERGY_LO, JBAY_ENERGY_HI))
    assert JBAY_HEIGHT_LO <= height <= JBAY_HEIGHT_HI, (
        "J-Bay height %.4f outside the literature band [%.2f, %.2f]"
        % (height, JBAY_HEIGHT_LO, JBAY_HEIGHT_HI))
    # (b) the headland is what unlocks it -- the same coast without one gets essentially nothing
    assert energy > 1000.0 * straight, (
        "headland bought only %.1fx over the straight beach (%.3e vs %.3e)"
        % (energy / straight if straight else float("inf"), energy, straight))
    # (c) and the straight-beach reading of the SAME angle stays under the shipped floor
    assert straight < STATUS_QUO_FLOOR


def test_jbay_headland_unlocks_defensible_energy():
    _assert_jbay_is_unlocked()


def test_jbay_beats_the_florida_controls_at_the_same_swell():
    """Same swell bearing, real measured reliefs from the 463 m asset (2026-08-09). If the term fired
    on any coast with a couple of degrees of wobble it would be a floor-raiser in disguise."""
    jbay = ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, JBAY_ROTATION)
    controls = {  # spot: (own shore normal, measured relief)
        "new_smyrna": (64.9, 6.7),
        "sebastian": (68.4, 8.3),
        "cocoa_beach": (99.5, 11.2),
    }
    for name, (normal, relief) in controls.items():
        value = ww.wrap_energy_factor(JBAY_SWELL_FROM, normal, relief)
        assert value < STATUS_QUO_FLOOR, "%s got %.6f, above the shipped floor" % (name, value)
        assert value < jbay / 100.0, "%s (%.3e) is not separated from J-Bay (%.3e)" % (
            name, value, jbay)


def test_rotation_monotonically_unlocks_energy_over_the_measured_range():
    previous = -1.0
    for rot in (0.0, 5.0, 10.0, 20.0, 30.0, 42.8):
        value = ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, rot)
        assert value > previous, "rotation %.1f did not increase the factor" % rot
        previous = value


def test_a_rotation_of_ninety_degrees_delivers_nothing_across_the_corner():
    """cos(rot) is the flux projection across the corner; at 90 deg the sheltering face is edge-on to
    this spot and can hand over nothing, so the term must fall back to the straight-beach value."""
    assert ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 90.0) == pytest.approx(
        ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 0.0), rel=1e-9)


def test_negative_and_oversized_rotations_are_clamped_not_trusted():
    straight = ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 0.0)
    assert ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, -30.0) == straight
    assert ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 400.0) == pytest.approx(
        ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, 90.0), rel=1e-12)


# ==================================================================================================
# 5. THE MUTATION CONTROL -- does this suite have teeth?
# ==================================================================================================

def test_removing_the_headland_dependence_turns_the_jbay_test_red(monkeypatch):
    """EXECUTED mutation, not a comment claiming one.

    Delete the geometry dependence -- make `_aim` ignore `rot`, which is precisely "a pure function
    of dtheta", the thing the module's header says cannot be the answer -- and the J-Bay assertions
    must FAIL. If they still pass, `headland_rotation_deg` is decorative and every claim in this
    file about geometry is unearned.
    """
    _assert_jbay_is_unlocked()  # green before

    original_aim = ww._aim
    monkeypatch.setattr(ww, "_aim",
                        lambda d, rot, cr: original_aim(d, 0.0, cr))  # geometry deleted

    with pytest.raises(AssertionError) as caught:
        _assert_jbay_is_unlocked()
    # and it must die on the PHYSICS claim, not incidentally on some unrelated assert -- a control
    # that cannot say WHY it went red is the same defect as an instrument that cannot tell
    # "not measured" from "broken"
    assert "outside the literature band" in str(caught.value), str(caught.value)


def test_neutralising_the_rotation_clamp_also_turns_it_red(monkeypatch):
    """A second, independent mutation at a different seam: zero the resolved rotation instead of the
    aim function. Two seams, because a single mutation point can be routed around."""
    _assert_jbay_is_unlocked()
    monkeypatch.setattr(ww, "_resolve_rot", lambda rot: 0.0)
    with pytest.raises(AssertionError) as caught:
        _assert_jbay_is_unlocked()
    assert "outside the literature band" in str(caught.value), str(caught.value)


def test_the_mutation_control_is_reversible(monkeypatch):
    """monkeypatch unwinds per test, but assert it here too: if the mutants leaked, every later test
    in this file would be grading a crippled module and the whole suite would be theatre."""
    assert ww._aim(80.0, 42.8, ww.CELERITY_RATIO_DEFAULT) > ww._aim(80.0, 0.0,
                                                                    ww.CELERITY_RATIO_DEFAULT)
    assert ww._resolve_rot(42.8) == 42.8
    _assert_jbay_is_unlocked()


# ==================================================================================================
# LITERATURE REPRODUCTION -- grade the machinery against a published number before trusting it
# ==================================================================================================

def test_reproduces_godas_published_shadow_boundary_coefficient():
    """Goda, Takayama & Suzuki (ICCE 1978 ch. 35): for directional random waves the diffraction
    coefficient is about 0.7 along the geometric shadow boundary, "about 1.4 times" the
    monochromatic value. Penney & Price (1952) give exactly 0.5 there for monochromatic waves.

    The model's `lit_energy_fraction` is the large-kr closed form of that quantity, so on the shadow
    boundary it must be exactly one half of the directional energy -- independently of the spread,
    by symmetry. That invariance is the control: a spread-dependent answer here would mean the
    integral is measuring something other than the lit half-plane."""
    monochromatic = 0.5
    for sigma in (5.0, 9.3, 13.0):
        energy = ww.lit_energy_fraction(JBAY_SHORE_NORMAL + 90.0, JBAY_SHORE_NORMAL, 0.0,
                                        spread_sigma_deg=sigma)
        assert energy == pytest.approx(0.5, abs=1e-6), "sigma=%.1f gave %.9f" % (sigma, energy)
        height = ww.diffraction_coefficient(JBAY_SHORE_NORMAL + 90.0, JBAY_SHORE_NORMAL, 0.0,
                                            spread_sigma_deg=sigma)
        assert height == pytest.approx(0.707, abs=0.005)          # Goda's "about 0.7"
        assert height / monochromatic == pytest.approx(1.41, abs=0.01)  # his "about 1.4 times"


def test_snell_refraction_is_the_published_form_and_dies_at_ninety():
    """Kr^2 = cos(phi0) / cos(phi_b), sin(phi_b) = (Cb/C0) sin(phi0) -- Bosboom & Stive 5.2.3.
    It is EXACTLY zero at 90 deg and has no solution beyond: a domain boundary, not a soft limit."""
    assert ww.refraction_kr_sq(0.0) == 1.0
    assert ww.refraction_kr_sq(90.0) == 0.0
    assert ww.refraction_kr_sq(120.0) == 0.0
    assert ww.refraction_kr_sq(180.0) == 0.0
    # the breaking-angle saturation is what makes a plain cosine such a good stand-in inside the
    # regime: phi_b tops out at asin(0.2912) = 16.93 deg, so Kr^2 never exceeds 1.045 * cos(phi0)
    ratio_cap = 1.0 / math.cos(math.asin(ww.CELERITY_RATIO_DEFAULT))
    for deg in (10.0, 45.0, 75.0, 89.0):
        ratio = ww.refraction_kr_sq(deg) / math.cos(math.radians(deg))
        assert 1.0 <= ratio <= ratio_cap + 1e-12, "deg=%.1f ratio=%.6f" % (deg, ratio)


def test_gauss_legendre_nodes_are_the_real_ones():
    """The quadrature is the numerical spine of every number above; a mistyped node would bias the
    whole module quietly. 16-point Gauss-Legendre is exact to degree 31."""
    weights = sum(w for _, w in ww._GL_NODES)
    assert weights == pytest.approx(2.0, abs=1e-14)
    for power in (2, 10, 30):
        quadrature = sum(w * (x ** power) for x, w in ww._GL_NODES)
        assert quadrature == pytest.approx(2.0 / (power + 1), rel=1e-12), "degree %d" % power


def test_the_spectrum_integrates_to_one():
    """The wrapped-Gaussian density, integrated over the same +/-6 sigma window the flux uses, must
    carry essentially all the energy -- otherwise the normalisation is silently lossy."""
    for sigma in (5.0, 9.3, 13.0):
        mass = ww.lit_energy_fraction(0.0, 0.0, 0.0, spread_sigma_deg=sigma)
        assert mass == pytest.approx(1.0, abs=1e-8), "sigma=%.1f carried %.12f" % (sigma, mass)


def test_the_coarse_flux_quadrature_is_good_enough_to_rely_on():
    """The per-cell path applies ONE 16-point rule per smooth segment, which is a performance choice.
    Grade it: rebuild the same integral with the segments subdivided 60-fold and require agreement.
    Without this, every number in this file rests on an untested assumption about the quadrature."""
    def refined(dtheta, rot, sigma, cr, pieces=60):
        edges = ww._breakpoints(dtheta, rot, sigma)
        total = 0.0
        for i in range(len(edges) - 1):
            lo, hi = edges[i], edges[i + 1]
            if hi <= lo:
                continue
            step = (hi - lo) / pieces
            for k in range(pieces):
                a = lo + k * step
                half, mid = 0.5 * step, a + 0.5 * step
                total += sum(w * ww._gaussian(mid + half * x, sigma)
                             * ww._aim(dtheta + mid + half * x, rot, cr)
                             for x, w in ww._GL_NODES) * half
        return total

    sigma, cr = ww.SPREAD_SIGMA_DEG, ww.CELERITY_RATIO_DEFAULT
    for dtheta, rot in ((45.0, 0.0), (90.0, 0.0), (124.5, 0.0),
                        (90.0, 42.8), (124.5, 42.8), (150.0, 42.8)):
        coarse = ww._directional_flux(dtheta, rot, sigma, cr)
        fine = refined(dtheta, rot, sigma, cr)
        assert coarse == pytest.approx(fine, rel=1e-6), (
            "quadrature drift at dtheta=%.1f rot=%.1f: %.12e vs %.12e" % (dtheta, rot, coarse, fine))


# ==================================================================================================
# THE GATE AND THE RESOLVER
# ==================================================================================================

def test_the_flag_is_off_by_default_and_the_resolver_refuses_while_it_is():
    os.environ.pop("SURF_WAVE_WRAPPING", None)
    assert ww.is_enabled() is False
    assert ww.resolve_headland_rotation(-34.05, 24.9333, JBAY_SWELL_FROM, JBAY_SHORE_NORMAL) is None
    assert ww.wrap_energy_factor_at(-34.05, 24.9333, JBAY_SWELL_FROM, JBAY_SHORE_NORMAL) is None


def test_the_physics_is_callable_without_the_flag():
    """The gate covers the geometry lookups, not the arithmetic -- otherwise the term could never be
    A/B'd or graded without setting a production flag."""
    os.environ.pop("SURF_WAVE_WRAPPING", None)
    assert ww.wrap_energy_factor(JBAY_SWELL_FROM, JBAY_SHORE_NORMAL, JBAY_ROTATION) > 0.0


def test_resolver_measures_the_jbay_relief_when_enabled(monkeypatch):
    monkeypatch.setenv("SURF_WAVE_WRAPPING", "1")
    relief = ww.resolve_headland_rotation(-34.05, 24.9333, JBAY_SWELL_FROM, JBAY_SHORE_NORMAL)
    if relief is None:
        pytest.skip("shore_normals.json asset not available in this environment")
    assert relief == pytest.approx(42.8, abs=1.0), "J-Bay relief drifted: %.2f" % relief


def test_resolver_refuses_rather_than_returning_zero_when_undersampled(monkeypatch):
    """A 0.0 would be indistinguishable from "measured, straight beach". 4 of 10 known point breaks
    read relief 0 at this radius purely from having 1-3 asset neighbours, so an undersampled lookup
    must say "not measured" and let the caller keep the status quo."""
    monkeypatch.setenv("SURF_WAVE_WRAPPING", "1")
    # mid-Pacific: no coastline within 25 km, so no entries at all
    assert ww.resolve_headland_rotation(0.0, -140.0, JBAY_SWELL_FROM, JBAY_SHORE_NORMAL) is None
    # and a real coordinate with the neighbour bar raised above what the asset can supply
    assert ww.resolve_headland_rotation(-34.05, 24.9333, JBAY_SWELL_FROM, JBAY_SHORE_NORMAL,
                                        min_neighbours=10_000) is None


def test_resolver_never_returns_a_negative_rotation(monkeypatch):
    """Relief is own-minus-best; a spot better aimed than every neighbour must read 0, not a negative
    'anti-headland' that would silently subtract energy."""
    monkeypatch.setenv("SURF_WAVE_WRAPPING", "1")
    for swell in (0.0, 90.0, 180.0, 229.5, 300.0):
        relief = ww.resolve_headland_rotation(-34.05, 24.9333, swell, JBAY_SHORE_NORMAL)
        if relief is not None:
            assert relief >= 0.0
