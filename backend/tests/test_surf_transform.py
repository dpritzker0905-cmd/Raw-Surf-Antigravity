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
    assert surf == pytest.approx(st.GAMMA * 2.0, rel=1e-6)   # capped at gamma * depth = 1.56 m


def test_depth_limit_is_independent_of_offshore_size():
    # THE key physics: on the same shallow shelf, a 5 m offshore swell breaks no taller than a 2 m one.
    surf_small, r1 = st.transform_surf(2.0, 12.0, 2.0)
    surf_big, r2 = st.transform_surf(5.0, 12.0, 2.0)
    assert r1 == r2 == 'breaking'
    assert surf_small == pytest.approx(surf_big)             # both depth-limited to gamma*depth
    assert surf_big < 5.0                                    # genuinely smaller than the offshore swell


def test_intermediate_depth_shoals_without_breaking():
    # Small swell over moderate depth: shoals but nowhere near the depth-limited cap.
    surf, regime = st.transform_surf(1.0, 14.0, 30.0)
    assert regime == 'shoaling'
    assert surf < st.GAMMA * 30.0                            # well below the breaking limit
    assert 0.8 < surf < 1.5                                  # near offshore, mild shoaling adjustment
