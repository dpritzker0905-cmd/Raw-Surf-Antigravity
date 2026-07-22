"""Enclosed-sea coarse-cell HEIGHT survival (2026-07-22).

ROOT: the ICON (GWAM), EURO (ECMWF Open-Data), and EURO-fallback (CMEMS) coarse fetchers POINT-SAMPLED the
wave height at the coarse cell centre (arr[r,c] / a[:, row, col]). A 10° cell whose centre lands on a masked
native cell — a coastline, the Mississippi delta at (30,-90), an enclosed-sea edge — sampled NaN and the whole
cell was DROPPED. So the Gulf of Mexico / Mediterranean / Gulf of California / Black Sea / Baltic / … rendered
BLANK for EURO+ICON worldwide, while GFS was fine (it already block-means heights). The heatmap then filled the
Gulf from distant cells, showing ~4-5 ft off Texas where reality (all models at the analysis hour) is ~1.5 ft.

FIX: the two full-array fetchers now block-mean the height (energy_mean_height_block, RMS over the block's
finite/ocean subcells); the thin-band CMEMS fetcher longitudinally means it (energy_mean_height_lonspan). A
cell survives iff ANY ocean subcell exists in its block; an all-NaN (true land) block still drops → land-safe.
"""
import numpy as np
import pytest

from services._fetch_common import energy_mean_height_block, energy_mean_height_lonspan


class TestBlockHeightSurvival:
    def test_center_masked_but_ocean_neighbours_survives(self):
        # 10° coarse cell whose exact centre native cell is land (NaN) but the block is otherwise ocean.
        a = np.full((41, 41), 1.5)
        a[20, 20] = np.nan  # the centre (Mississippi-delta class) is masked
        out = energy_mean_height_block(a, 20, 20, 10, True)
        assert np.isfinite(out) and abs(out - 1.5) < 1e-6, "cell must SURVIVE on its ocean subcells"

    def test_all_land_block_still_drops(self):
        allnan = np.full((41, 41), np.nan)
        assert np.isnan(energy_mean_height_block(allnan, 20, 20, 10, True)), "true land must stay empty"

    def test_calm_zero_ocean_is_included_not_dropped(self):
        # a genuinely calm ocean block (0.0 everywhere) must read 0.0, not fall back / drop.
        calm = np.zeros((41, 41))
        assert energy_mean_height_block(calm, 20, 20, 10, True) == 0.0

    def test_rms_is_energy_honest(self):
        # Hs² ∝ energy: RMS of {1,3} = sqrt((1+9)/2) = sqrt(5) ≈ 2.236, not the mean 2.0. half=1 samples
        # rows/cols [c-half, c+half) = {19,20}; place both finite cells inside that window.
        a = np.full((41, 41), np.nan)
        a[20, 19] = 1.0
        a[20, 20] = 3.0
        out = energy_mean_height_block(a, 20, 20, 1, True)
        assert abs(out - np.sqrt(5.0)) < 1e-6


class TestLonspanHeightSurvival:
    def test_center_column_masked_survives_per_timestep(self):
        h = np.full((3, 3, 41), 2.0)  # (T=3, Y=3, X=41)
        h[:, :, 20] = np.nan          # the sampled column is masked land
        out = energy_mean_height_lonspan(h, 20, 10)
        assert out.shape == (3,)
        assert np.all(np.isfinite(out)) and np.allclose(out, 2.0)

    def test_all_land_window_drops(self):
        h = np.full((2, 3, 41), np.nan)
        assert np.all(np.isnan(energy_mean_height_lonspan(h, 20, 10)))

    def test_calm_zero_included(self):
        h = np.zeros((2, 3, 41))
        assert np.allclose(energy_mean_height_lonspan(h, 20, 10), 0.0)


class TestFetchersWireTheHeightBlockmean:
    """Structural: every non-GFS coarse fetcher must declare its HEIGHT_VARS so the block-mean actually
    fires for the height (a regression here silently reintroduces the enclosed-sea dropout)."""

    def test_gwam_declares_height_vars_matching_its_product(self):
        from services.dwd_gwam_fetcher import HEIGHT_VARS, VAR_MAP
        product_heights = {om for _, om, _ in VAR_MAP if "height" in om}
        assert product_heights and product_heights <= HEIGHT_VARS

    def test_copernicus_declares_height_vars_matching_its_product(self):
        from services.copernicus_global_fetcher import HEIGHT_VARS, VARIABLE_MAP
        product_heights = {om for _, om, _ in VARIABLE_MAP if "height" in om}
        assert product_heights and product_heights <= HEIGHT_VARS

    def test_ecmwf_fetcher_imports_the_height_blockmean(self):
        import services.ecmwf_opendata_fetcher as m
        assert hasattr(m, "energy_mean_height_block")
