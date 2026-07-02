"""Energy-weighted circular-mean direction for the NOAA coarse product (vortex root fix, 2026-07-02).

The coarse fetcher used to POINT-SAMPLE DIRPW every 10 deg; the dominant-partition direction switches
discontinuously between neighbouring sample points (live grid: mean adjacent delta 41 deg, p90 117 deg,
near-180 flips inside 2-4 m swell), and that aliased field advected crests in a rotating pattern at z4-6
(the vortex). energy_mean_direction_block replaces the point sample with the standard spectral mean wave
direction theta_m = atan2(sum(E sin), sum(E cos)), E ~ H^2, over the 10-deg block of 0.25-deg cells.
"""
import math

import numpy as np
import pytest

from services.noaa_gfs_wave_fetcher import energy_mean_direction_block, DIR_TO_HEIGHT, IDX_TO_OM
from services._fetch_common import energy_mean_direction_lonspan


def _grid(shape, direction, height):
    d = np.full(shape, float(direction))
    h = np.full(shape, float(height))
    return d, h


def test_uniform_field_returns_that_direction():
    d, h = _grid((80, 80), 137.0, 2.0)
    out = energy_mean_direction_block(d, h, 40, 40, 20, False)
    assert out == pytest.approx(137.0, abs=1e-6)


def test_circular_mean_across_north_no_180_garbage():
    # 350 deg and 10 deg with equal energy must average to 0/360, NEVER 180 (the arithmetic-mean bug).
    d = np.full((80, 80), 350.0)
    d[:, 40:] = 10.0
    h = np.full((80, 80), 2.0)
    out = energy_mean_direction_block(d, h, 40, 40, 20, False)
    assert min(out, 360.0 - out) < 1e-6


def test_energy_weighting_follows_the_dominant_partition():
    # Half the block: 3 m swell from 90; other half: 1 m windsea from 0. E ~ H^2 => 9:1 -> mean pulls near 90.
    d = np.full((80, 80), 90.0)
    d[:, :40] = 0.0
    h = np.full((80, 80), 3.0)
    h[:, :40] = 1.0
    out = energy_mean_direction_block(d, h, 40, 40, 20, False)
    assert 70.0 < out < 90.0  # dominated by, but not equal to, the high-energy half


def test_partition_flip_aliasing_is_smoothed_between_neighbours():
    # The vortex driver: adjacent POINT samples flip ~180 deg where partitions switch. Block means of two
    # OVERLAPPING-statistics neighbourhoods must differ far less than the raw point samples do.
    rng = np.random.default_rng(7)
    d = np.where(rng.random((100, 200)) < 0.5, 20.0, 200.0)   # two partitions interleaved
    h = np.full((100, 200), 2.0)
    p1 = energy_mean_direction_block(d, h, 50, 60, 20, False)
    p2 = energy_mean_direction_block(d, h, 50, 100, 20, False)
    delta = abs(p1 - p2) % 360.0
    delta = min(delta, 360.0 - delta)
    raw1, raw2 = d[50, 60], d[50, 100]
    raw_delta = abs(raw1 - raw2) % 360.0
    raw_delta = min(raw_delta, 360.0 - raw_delta)
    # raw points can flip 180; block means of 50/50 mixtures agree closely
    assert delta < 30.0


def test_longitude_wrap_uses_cells_across_the_antimeridian():
    d = np.full((80, 80), 45.0)
    d[:, 0:5] = 45.0     # cells reached only via wrap
    d[:, 5:] = np.nan    # everything east is invalid
    h = np.full((80, 80), 2.0)
    h[:, 5:] = np.nan
    out = energy_mean_direction_block(d, h, 40, 78, 20, True)  # block spans the wrap
    assert out == pytest.approx(45.0, abs=1e-6)


def test_nan_and_zero_energy_fall_back_to_the_point_sample():
    d = np.full((40, 40), np.nan)
    d[10, 10] = 123.0
    h = np.zeros((40, 40))
    out = energy_mean_direction_block(d, h, 10, 10, 5, False)
    assert out == pytest.approx(123.0)
    out2 = energy_mean_direction_block(np.full((40, 40), np.nan), np.zeros((40, 40)), 10, 10, 5, False)
    assert math.isnan(out2)


def test_dir_to_height_covers_every_direction_variable_in_the_product():
    om_dirs = {om for _, om, unit in IDX_TO_OM if unit == "°"}
    assert om_dirs == set(DIR_TO_HEIGHT.keys())
    om_all = {om for _, om, _ in IDX_TO_OM}
    for h in DIR_TO_HEIGHT.values():
        assert h in om_all


def test_gwam_and_copernicus_pairings_cover_their_direction_variables():
    from services.dwd_gwam_fetcher import VAR_MAP as GWAM_MAP, DIR_TO_HEIGHT as GWAM_D2H
    from services.copernicus_global_fetcher import VARIABLE_MAP as COP_MAP, DIR_TO_HEIGHT as COP_D2H
    gwam_dirs = {om for _, om, unit in GWAM_MAP if unit == "°"}
    assert gwam_dirs == set(GWAM_D2H.keys())
    gwam_all = {om for _, om, _ in GWAM_MAP}
    assert set(GWAM_D2H.values()) <= gwam_all
    cop_dirs = {om for _, om, unit in COP_MAP if unit == "°"}
    assert cop_dirs == set(COP_D2H.keys())
    cop_all = {om for _, om, _ in COP_MAP}
    assert set(COP_D2H.values()) <= cop_all


class TestLonspan:
    """energy_mean_direction_lonspan — the thin-band (Copernicus) longitudinal variant."""

    def test_uniform_field_per_timestep(self):
        d = np.full((3, 2, 100), 210.0)
        h = np.full((3, 2, 100), 2.0)
        out = energy_mean_direction_lonspan(d, h, 50, 30)
        assert out.shape == (3,)
        assert np.allclose(out, 210.0)

    def test_circular_mean_across_north(self):
        d = np.full((1, 1, 100), 350.0)
        d[:, :, 50:] = 10.0
        h = np.full((1, 1, 100), 2.0)
        out = energy_mean_direction_lonspan(d, h, 50, 50)[0]
        assert min(out, 360.0 - out) < 1e-6

    def test_energy_weighting_pulls_toward_the_big_swell(self):
        d = np.full((1, 1, 100), 90.0)
        d[:, :, :50] = 0.0
        h = np.full((1, 1, 100), 3.0)
        h[:, :, :50] = 1.0
        out = energy_mean_direction_lonspan(d, h, 50, 50)[0]
        assert 70.0 < out < 90.0

    def test_window_clamps_at_the_band_edge(self):
        d = np.full((2, 1, 20), 45.0)
        h = np.full((2, 1, 20), 1.0)
        out = energy_mean_direction_lonspan(d, h, 1, 10)  # window pokes past col 0
        assert np.allclose(out, 45.0)

    def test_no_energy_falls_back_to_the_point_sample_per_timestep(self):
        d = np.full((2, 1, 10), np.nan)
        d[1, 0, 4] = 77.0
        h = np.zeros((2, 1, 10))
        out = energy_mean_direction_lonspan(d, h, 4, 3)
        assert math.isnan(out[0])
        assert out[1] == pytest.approx(77.0)
