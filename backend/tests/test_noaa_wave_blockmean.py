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

from services.noaa_gfs_wave_fetcher import (
    energy_mean_direction_block, DIR_TO_HEIGHT, IDX_TO_OM, TOTAL_SEA_PARTITIONS,
)
from services._fetch_common import (
    energy_mean_direction_lonspan, energy_mean_direction_block_multi,
    energy_mean_direction_block_multi_conf,
)


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


class TestBlockMulti:
    """energy_mean_direction_block_multi — total-sea direction from partitions (the bimodality fix)."""

    def test_bimodal_peak_direction_is_stabilized_by_partition_blend(self):
        # The residual-flip mechanism: DIRPW flips ~180° between cells where windsea and swell trade
        # dominance, so its single-field block mean is unstable. The partitions themselves are stable:
        # windsea from 90° (H 1.9-2.1m), swell from 250° (H 1.9-2.1m). The partition blend of two
        # ADJACENT blocks must agree closely even though DIRPW point samples flip.
        rng = np.random.default_rng(3)
        ww_d = np.full((100, 200), 90.0)
        sw_d = np.full((100, 200), 250.0)
        ww_h = 2.0 + 0.1 * rng.standard_normal((100, 200))
        sw_h = 2.0 + 0.1 * rng.standard_normal((100, 200))
        dirpw = np.where(ww_h > sw_h, ww_d, sw_d)   # peak direction flips cell-to-cell
        pairs = [(ww_d, ww_h), (sw_d, sw_h)]
        a = energy_mean_direction_block_multi(pairs, dirpw, 50, 60, 20, False)
        b = energy_mean_direction_block_multi(pairs, dirpw, 50, 100, 20, False)
        delta = abs(a - b) % 360.0
        assert min(delta, 360.0 - delta) < 5.0     # adjacent blocks agree
        # and the result is the circular blend of 90/250 at equal energy (≈170° ±360-wrap side), not either peak
        assert 120.0 < a < 220.0

    def test_dominant_partition_wins_when_energy_is_lopsided(self):
        big = np.full((80, 80), 300.0)
        small = np.full((80, 80), 90.0)
        pairs = [(big, np.full((80, 80), 3.0)), (small, np.full((80, 80), 0.5))]
        out = energy_mean_direction_block_multi(pairs, big, 40, 40, 20, False)
        d = abs(out - 300.0) % 360.0
        assert min(d, 360.0 - d) < 10.0            # 36:1 energy ratio → hugs the big swell

    def test_no_partition_energy_falls_back_to_the_peak_point_sample(self):
        nanarr = np.full((40, 40), np.nan)
        zeros = np.zeros((40, 40))
        dirpw = np.full((40, 40), 123.0)
        out = energy_mean_direction_block_multi([(nanarr, zeros), (nanarr, zeros)], dirpw, 10, 10, 5, False)
        assert out == pytest.approx(123.0)

    def test_trimodal_cancellation_defers_to_coherent_dirpw(self):
        # THE BAJA CASE (2026-07-02, live): three partitions whose energy vectors mutually cancel —
        # swell1 1.0m FROM 343 (TO 163) vs swell2 0.8m FROM 152 (TO 332) annihilate, leaving the
        # windwave 1.1m FROM 77 (TO 257) as the blend's residual winner → crests animated E→W. The
        # model's OWN total (DIRPW) is stably FROM ~186 (TO ~6) across the block. With total_h_arr
        # passed, the coherence gate must return ≈DIRPW's mean, not the partition residual.
        shape = (80, 80)
        s1d, s1h = np.full(shape, 343.0), np.full(shape, 1.0)
        s2d, s2h = np.full(shape, 152.0), np.full(shape, 0.8)
        wwd, wwh = np.full(shape, 77.0), np.full(shape, 1.1)
        dirpw = np.full(shape, 186.0)
        total_h = np.full(shape, 1.96)
        pairs = [(wwd, wwh), (s1d, s1h), (s2d, s2h)]
        out = energy_mean_direction_block_multi(pairs, dirpw, 40, 40, 20, False, total_h)
        d = abs(out - 186.0) % 360.0
        assert min(d, 360.0 - d) < 5.0, f"expected ≈DIRPW 186, got {out}"
        # and WITHOUT the total field (legacy signature) the residual-winner behavior is preserved
        legacy = energy_mean_direction_block_multi(pairs, dirpw, 40, 40, 20, False)
        dl = abs(legacy - 77.0) % 360.0
        assert min(dl, 360.0 - dl) < 30.0, f"legacy path should land near the windwave, got {legacy}"

    def test_bimodal_flip_zone_still_uses_the_partition_blend_with_total_h(self):
        # DIRPW flipping cell-to-cell between two systems (the N-Atl regime the partition blend was
        # built for): its block resultant R_d is LOW → the gate must keep the partition blend even
        # when total_h_arr is provided.
        rng = np.random.default_rng(3)
        ww_d = np.full((100, 200), 90.0)
        sw_d = np.full((100, 200), 250.0)
        ww_h = 2.0 + 0.1 * rng.standard_normal((100, 200))
        sw_h = 2.0 + 0.1 * rng.standard_normal((100, 200))
        dirpw = np.where(ww_h > sw_h, ww_d, sw_d)
        total_h = np.hypot(ww_h, sw_h)
        pairs = [(ww_d, ww_h), (sw_d, sw_h)]
        gated = energy_mean_direction_block_multi(pairs, dirpw, 50, 60, 20, False, total_h)
        legacy = energy_mean_direction_block_multi(pairs, dirpw, 50, 60, 20, False)
        d = abs(gated - legacy) % 360.0
        assert min(d, 360.0 - d) < 10.0, f"low-coherence DIRPW must not hijack the blend: {gated} vs {legacy}"

    def test_total_sea_partitions_reference_real_product_variables(self):
        om_all = {om for _, om, _ in IDX_TO_OM}
        for d, h in TOTAL_SEA_PARTITIONS:
            assert d in om_all and h in om_all
        # every pair must also be internally consistent with DIR_TO_HEIGHT
        for d, h in TOTAL_SEA_PARTITIONS:
            assert DIR_TO_HEIGHT[d] == h


class TestConfidenceExport:
    """energy_mean_direction_block_multi_conf — §0B-a render-confidence (2026-07-03).

    The confidence is the resultant length of whatever estimator produced the direction: LOW exactly
    where the exported direction is a cancellation residual with no stable truth (the (20,-120)
    class), HIGH where a single coherent system (or a coherent DIRPW field) drives it."""

    def test_uniform_single_system_is_fully_confident(self):
        d, h = _grid((80, 80), 137.0, 2.0)
        out, conf = energy_mean_direction_block_multi_conf([(d, h)], d, 40, 40, 20, False)
        assert out == pytest.approx(137.0, abs=1e-6)
        assert conf == pytest.approx(1.0, abs=1e-6)

    def test_bimodal_5050_residual_direction_is_low_confidence(self):
        # 90° vs 250° at equal energy: the blend lands on a residual (~170°) that is NOT a real
        # system's direction — R_p ≈ 0.17. This is precisely the cell class the crest fade must catch.
        ww_d, ww_h = _grid((80, 80), 90.0, 2.0)
        sw_d, sw_h = _grid((80, 80), 250.0, 2.0)
        pairs = [(ww_d, ww_h), (sw_d, sw_h)]
        _out, conf = energy_mean_direction_block_multi_conf(pairs, ww_d, 40, 40, 20, False)
        assert conf is not None and conf < 0.35

    def test_trimodal_partition_annihilation_flags_low_confidence_when_dirpw_incoherent(self):
        # The live (20,-120) regime: three partitions partially cancel (R_p ≈ 0.48) AND the model's
        # own DIRPW is flip-zone bimodal (R_d ≈ 0) → the gate keeps the partition blend and the
        # exported confidence must sit below the ~0.65 fade threshold.
        shape = (80, 80)
        s1d, s1h = np.full(shape, 163.0), np.full(shape, 1.0)
        s2d, s2h = np.full(shape, 332.0), np.full(shape, 0.8)
        wwd, wwh = np.full(shape, 257.0), np.full(shape, 1.1)
        dirpw = np.full(shape, 20.0)
        dirpw[:, ::2] = 200.0                      # alternating anti-parallel → R_d ≈ 0
        total_h = np.full(shape, 1.96)
        pairs = [(wwd, wwh), (s1d, s1h), (s2d, s2h)]
        _out, conf = energy_mean_direction_block_multi_conf(pairs, dirpw, 40, 40, 20, False, total_h)
        assert conf is not None and conf < 0.65

    def test_coherent_dirpw_tier_reports_the_gate_r_d(self):
        # The Baja FIX regime: partitions cancel but DIRPW is uniform (R_d = 1.0) → the gate serves
        # DIRPW's mean and the confidence is R_d-high (the direction IS stable truth).
        shape = (80, 80)
        s1d, s1h = np.full(shape, 343.0), np.full(shape, 1.0)
        s2d, s2h = np.full(shape, 152.0), np.full(shape, 0.8)
        wwd, wwh = np.full(shape, 77.0), np.full(shape, 1.1)
        dirpw = np.full(shape, 186.0)
        total_h = np.full(shape, 1.96)
        pairs = [(wwd, wwh), (s1d, s1h), (s2d, s2h)]
        out, conf = energy_mean_direction_block_multi_conf(pairs, dirpw, 40, 40, 20, False, total_h)
        d = abs(out - 186.0) % 360.0
        assert min(d, 360.0 - d) < 5.0
        assert conf is not None and conf > 0.9

    def test_point_sample_fallback_has_no_confidence(self):
        nanarr = np.full((40, 40), np.nan)
        zeros = np.zeros((40, 40))
        dirpw = np.full((40, 40), 123.0)
        out, conf = energy_mean_direction_block_multi_conf(
            [(nanarr, zeros), (nanarr, zeros)], dirpw, 10, 10, 5, False)
        assert out == pytest.approx(123.0)
        assert conf is None

    def test_direction_wrapper_is_byte_identical_to_the_conf_variant(self):
        # The wrapper keeps every existing caller/test contract: same direction, no tuple.
        ww_d, ww_h = _grid((80, 80), 90.0, 2.0)
        sw_d, sw_h = _grid((80, 80), 250.0, 3.0)
        pairs = [(ww_d, ww_h), (sw_d, sw_h)]
        a = energy_mean_direction_block_multi(pairs, ww_d, 40, 40, 20, False)
        b, _ = energy_mean_direction_block_multi_conf(pairs, ww_d, 40, 40, 20, False)
        assert a == b


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


# ─────────── scalar block aggregation (wind_waves tri-model forensics, 2026-07-04) ───────────
# PARTITIONED WW3 fields (WVHGT/SWELL_2) are exact-0.0 wherever a subcell classifies to another
# partition, and that classification flickers per forecast hour. Center-point sampling turned
# partially-windsea 10-deg blocks into flickering 0.0 heatmap pixels (live: cell (-60,-50) read
# 0.0@T00 / 4.7@T12 in our product while open-meteo AND our own /point direct ladder read 7.64 m;
# 9/629 cells contradicted the reference). Heights now block-RMS; periods H^2-weighted block mean.
from services._fetch_common import energy_mean_height_block, energy_mean_scalar_block


def test_height_block_rms_recovers_partial_windsea_block():
    # Center subcell classified to swell (0.0) but half the block carries 4 m windsea:
    # the point sample said 0.0; the block RMS must report the block's real energy.
    h = np.zeros((80, 80))
    h[:, 40:] = 4.0
    out = energy_mean_height_block(h, 40, 39, 20, False)  # center on a 0.0 subcell
    assert h[40, 39] == 0.0
    # window cols 19..58 -> 19 of 40 columns carry 4 m: RMS = sqrt(19*16/40) ≈ 2.76
    assert out == pytest.approx(math.sqrt(19 * 16.0 / 40.0), rel=1e-6)
    assert out > 2.5  # the point sample said 0.0; the block reports real energy


def test_height_block_rms_keeps_calm_blocks_honest_zero():
    h = np.zeros((80, 80))
    assert energy_mean_height_block(h, 40, 40, 20, False) == 0.0


def test_height_block_rms_excludes_masked_land_but_counts_calm_ocean():
    h = np.full((80, 80), 2.0)
    h[:, :40] = np.nan  # land-masked half must NOT drag the RMS toward zero
    out = energy_mean_height_block(h, 40, 40, 20, False)
    assert out == pytest.approx(2.0, rel=1e-6)


def test_height_block_all_nan_falls_back_to_point_sample_nan():
    h = np.full((80, 80), np.nan)
    out = energy_mean_height_block(h, 40, 40, 20, False)
    assert out != out  # NaN -> caller serializes None


def test_height_block_uniform_field_equals_point_sample():
    # Smooth fields (total waves, EURO/ICON-like) must be unchanged by the aggregation.
    h = np.full((80, 80), 2.37)
    assert energy_mean_height_block(h, 40, 40, 20, False) == pytest.approx(2.37, rel=1e-9)


def test_period_block_energy_weighted_mean_follows_dominant_energy():
    # Half the block: 4 m @ 14 s; other half: 1 m @ 4 s. E ~ H^2 = 16:1 -> mean pulls near 14 s.
    p = np.full((80, 80), 14.0)
    p[:, :40] = 4.0
    h = np.full((80, 80), 4.0)
    h[:, :40] = 1.0
    out = energy_mean_scalar_block(p, h, 40, 40, 20, False)
    assert 13.0 < out < 14.0


def test_period_block_no_energy_falls_back_to_point_sample():
    p = np.full((80, 80), 9.0)
    h = np.zeros((80, 80))
    out = energy_mean_scalar_block(p, h, 40, 40, 20, False)
    assert out == pytest.approx(9.0)


def test_period_block_wraps_longitude_on_global_grid():
    p = np.full((10, 20), 8.0)
    p[:, :3] = 12.0
    h = np.full((10, 20), 2.0)
    # centered at the wrap seam: window spans the array edge without clamping
    out = energy_mean_scalar_block(p, h, 5, 0, 4, True)
    assert 8.0 < out < 12.0
