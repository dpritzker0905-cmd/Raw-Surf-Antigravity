"""Scalar/partition parity and tide Jacobian at a shallow reef; the flag stays dark by default."""
import math

import pytest
from services.weather_pipeline import surf_transform as transform


@pytest.fixture(autouse=True)
def tide_configuration(monkeypatch):
    monkeypatch.setenv('SURF_TIDE_DEPTH', '1')
    monkeypatch.setenv('SURF_BREAK_DEPTH', '1')


@pytest.mark.parametrize('tide', [-2.0, 0.0, 1.0, 2.0])
def test_one_partition_equals_same_scalar_sea_at_every_tide(tide):
    kwargs = dict(coastal=True, shelf_width_km=25.8, shore_normal_deg=0,
                  break_depth_m=3.5, water_level_m=tide)
    scalar = transform.estimate_surf(4.0, 16.0, 2534.5, swell_from_deg=0, **kwargs)[0]
    spectral = transform.estimate_surf_partitioned(
        [{'h': 4.0, 'tp': 16.0, 'dir': 0, 'kind': 'swell'}], 2534.5, **kwargs)[0]
    assert spectral == pytest.approx(scalar, abs=1e-12)


@pytest.mark.parametrize('tide,cap', [(-2.0, 1.215), (0.0, 2.835), (1.0, 3.645), (2.0, 4.455)])
def test_recombined_sea_respects_tide_adjusted_cap(tide, cap):
    height = transform.estimate_surf_partitioned(
        [{'h': math.sqrt(8), 'tp': 16.0, 'dir': 0, 'kind': 'swell'}] * 2,
        2534.5, coastal=True, shelf_width_km=25.8, shore_normal_deg=0,
        break_depth_m=3.5, water_level_m=tide)[0]
    assert height == pytest.approx(cap, abs=1e-12)


def test_spectral_tide_jacobian_at_binding_cap():
    def height(tide):
        return transform.estimate_surf_partitioned(
            [{'h': 8.0, 'tp': 16.0, 'dir': 0, 'kind': 'swell'}],
            2534.5, coastal=True, shelf_width_km=25.8, shore_normal_deg=0,
            break_depth_m=3.5, water_level_m=tide)[0]
    # Hand-derived: d(gamma*(depth+eta))/deta = 0.81, on either side of zero.
    assert (height(1.01) - height(0.99)) / 0.02 == pytest.approx(0.81, abs=1e-10)
    assert (height(-0.99) - height(-1.01)) / 0.02 == pytest.approx(0.81, abs=1e-10)


def test_disabled_tide_is_inert(monkeypatch):
    monkeypatch.setenv('SURF_TIDE_DEPTH', '0')
    parts = [{'h': 4.0, 'tp': 16.0, 'dir': 0, 'kind': 'swell'}]
    heights = [transform.estimate_surf_partitioned(
        parts, 2534.5, coastal=True, shelf_width_km=25.8, shore_normal_deg=0,
        break_depth_m=3.5, water_level_m=tide)[0] for tide in (-2, 0, 2)]
    assert heights == [2.835, 2.835, 2.835]
