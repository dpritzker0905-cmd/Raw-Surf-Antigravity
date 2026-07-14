"""
§0B-a render-confidence export for EURO/ICON coarse (2026-07-15).

The FE fades crest rendering below ~0.65 dir_confidence — but only when the field is present;
absent means full confidence. NOAA/GFS coarse has exported it since 2026-07-03; the Copernicus
(EURO) and DWD GWAM (ICON) coarse fetchers did not, so their bimodal-water cells rendered crests
confidently WRONG (the 2026-07-14 "EURO waves going the wrong direction / GFS looks right"
report — live probe: EURO coarse 289° vs EURO mid 93° vs GFS coarse 79° at the same FL cell,
11% of shared basin cells >135° apart). These goldens pin the helper math both fetchers now use.
"""
import numpy as np

from services._fetch_common import (
    energy_mean_direction_block,
    energy_mean_direction_block_multi_conf,
    energy_mean_direction_lonspan,
    energy_mean_direction_lonspan_conf,
)


def _tyx(dirs, heights):
    """Shape (T=1, Y=1, X=n) arrays from flat lists."""
    return (np.asarray([[dirs]], dtype=float), np.asarray([[heights]], dtype=float))


# ── lonspan conf (the Copernicus/EURO path) ─────────────────────────────────────────────────
def test_lonspan_coherent_window_is_full_confidence():
    d, h = _tyx([90.0] * 8, [2.0] * 8)
    dirs, conf = energy_mean_direction_lonspan_conf(d, h, col=4, half_cols=4)
    assert abs(dirs[0] - 90.0) < 1e-6
    assert conf[0] > 0.999


def test_lonspan_bimodal_annihilation_is_low_confidence():
    # Two equal-energy opposed systems: the mean direction is a meaningless residual — the
    # exact class the FE must fade instead of animating confidently wrong.
    d, h = _tyx([0.0, 180.0] * 4, [2.0] * 8)
    _dirs, conf = energy_mean_direction_lonspan_conf(d, h, col=4, half_cols=4)
    assert conf[0] < 0.05


def test_lonspan_empty_window_falls_back_with_nan_confidence():
    # No energy anywhere: direction = point sample (row 0), confidence = NaN (no windowed
    # evidence either way — the normalizer serializes it as null, FE default applies).
    d = np.asarray([[[45.0, 45.0, 45.0]]], dtype=float)
    h = np.zeros((1, 1, 3), dtype=float)
    dirs, conf = energy_mean_direction_lonspan_conf(d, h, col=1, half_cols=1)
    assert abs(dirs[0] - 45.0) < 1e-6
    assert np.isnan(conf[0])


def test_lonspan_wrapper_direction_parity():
    # The legacy direction-only helper must stay byte-identical (it now wraps the conf variant).
    d, h = _tyx([10.0, 350.0, 20.0, 340.0, 15.0, 30.0, 355.0, 5.0], [1.0, 2.0, 1.5, 0.5, 2.5, 1.0, 3.0, 2.0])
    legacy = energy_mean_direction_lonspan(d, h, col=4, half_cols=4)
    dirs, conf = energy_mean_direction_lonspan_conf(d, h, col=4, half_cols=4)
    assert abs(legacy[0] - dirs[0]) < 1e-9
    # near-parallel systems around north: high coherence
    assert conf[0] > 0.9


# ── single-pair multi_conf parity (the DWD/ICON swap) ───────────────────────────────────────
def test_dwd_single_pair_swap_preserves_direction_exactly():
    # The GWAM fetcher swapped energy_mean_direction_block → multi_conf with ONE pair for the
    # wave_direction channel. Direction must be IDENTICAL; conf must be the resultant length.
    rng = np.random.default_rng(7)
    d = rng.uniform(0, 360, size=(6, 6))
    h = rng.uniform(0.1, 4.0, size=(6, 6))
    for (r, c) in [(0, 0), (2, 3), (5, 5), (3, 1)]:
        legacy = energy_mean_direction_block(d, h, r, c, half=2, wrap_cols=True)
        x, conf = energy_mean_direction_block_multi_conf([(d, h)], d, r, c, half=2, wrap_cols=True)
        assert abs(legacy - x) < 1e-9
        assert conf is None or 0.0 <= conf <= 1.0
