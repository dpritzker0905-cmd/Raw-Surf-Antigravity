"""LIVE-02: dark direct-wave flux candidate; legacy is the null control."""
import math

import pytest

from services.weather_pipeline import surf_transform as ST, wave_physics as WP
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at


@pytest.mark.parametrize("angle", [0., 30., 60., 80., 90., 120., 180.])
def test_incoming_flux_projection_and_no_back_facing_floor(monkeypatch, angle):
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    expected = math.sqrt(math.cos(math.radians(angle))) if angle < 90 else 0.
    assert ST._height_exposure_factor(90. + angle, 90.) == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize("swell,normal", [(None, 90.), (90., None), (None, None)])
def test_unknown_geometry_does_not_invent_zero_arrival(monkeypatch, swell, normal):
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    assert ST._height_exposure_factor(swell, normal) == 1.
    assert WP.directional_conflict(swell, normal) is None


def test_existing_exposure_kill_switch_still_wins(monkeypatch):
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    monkeypatch.setenv("SURF_V3_EXPOSURE", "0")
    assert ST._height_exposure_factor(270., 90.) == 1.


@pytest.mark.parametrize("angle", [float("nan"), float("inf"), float("-inf")])
def test_unusable_bearing_does_not_publish_zero_as_a_physical_result(monkeypatch, angle):
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    assert ST._height_exposure_factor(angle, 90.) == 1.
    assert WP.directional_conflict(angle, 90.) is None


def test_default_off_retains_existing_real_height_and_old_reconciliation(monkeypatch):
    monkeypatch.delenv("SURF_EXPOSURE_FLUX", raising=False)
    monkeypatch.setenv("SURF_EXPOSURE_RECONCILED", "0")
    before = ST.estimate_surf(.5, 10., 25., swell_from_deg=210., shore_normal_deg=90.)
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "0")
    assert ST.estimate_surf(.5, 10., 25., swell_from_deg=210., shore_normal_deg=90.) == before
    assert ST._height_exposure_factor(210., 90.) == pytest.approx(.595)
    monkeypatch.setenv("SURF_EXPOSURE_RECONCILED", "1")
    assert ST._height_exposure_factor(210., 90.) == pytest.approx(math.sqrt(.1))


@pytest.mark.parametrize("mutant", [False, True])
def test_three_real_geometries_angle_jacobians_and_gain_mutant(monkeypatch, mutant):
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    original = ST._height_exposure_factor
    if mutant:
        def wrong(swell, normal):
            value = original(swell, normal)
            return value * 1.01 if abs(swell - normal) > 1 else value
        monkeypatch.setattr(ST, "_height_exposure_factor", wrong)

    def check():
        for lat, lng, hs, tp in ((-28.1677, 153.5504, .45, 8.),
                                 (28.3664, -80.6015, .8, 10.), (33.3825, -117.5886, .6, 12.)):
            geometry = resolve_surf_geometry(lat, lng)
            normal = geometry.shore_normal_deg
            def height(angle):
                return estimate_surf_at(lat, lng, hs, tp, swell_from_deg=normal + angle,
                                        geometry=geometry)[0]
            base = height(0.)
            assert base > 0
            for angle in (30., 60., 80.):
                theta = math.radians(angle)
                assert height(angle) / base == pytest.approx(math.sqrt(math.cos(theta)), rel=1e-10)
                derivative = (height(angle + .1) - height(angle - .1)) / .2
                expected = -base * math.sin(theta) / (2 * math.sqrt(math.cos(theta))) * math.pi / 180.
                assert derivative == pytest.approx(expected, rel=.0002)
            assert height(120.) == 0.
    if mutant:
        with pytest.raises(AssertionError):
            check()
    else:
        check()


def test_dark_back_facing_warning_is_truthful_and_default_warning_is_preserved(monkeypatch):
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "0")
    legacy = WP.directional_conflict(210., 90.)
    assert legacy["reason"] == "size_and_quality_disagree_on_swell_exposure"
    monkeypatch.setenv("SURF_EXPOSURE_FLUX", "1")
    warning = WP.directional_conflict(210., 90.)
    assert warning["reason"] == "swell_aimed_away"
    assert warning["height_exposure_factor"] == 0.
    assert "indirect" in warning["means"]
    assert WP.directional_conflict(90., 90.) is None
