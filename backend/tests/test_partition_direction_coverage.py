"""A partition's block direction must not sound confident about a train that barely exists.

USER REQUIREMENT (2026-07-31): "The other marine layers need their respective animation direction
to go with the type of marine layer they represent."

THE DEFECT, MEASURED ON THE SERVED 2 degree PRODUCTS (2026-07-31). `energy_mean_direction_block`
weights by energy, so it only ever sees subcells where the partition EXISTS (h > 0). A WW3
partition is exact-0 wherever that subcell's energy was classified to a different partition, so a
block can be almost empty of a train and still export a perfectly confident bearing for it:

    s_ocean    swell_2       1 contributing subcell of 64   -> resultant length R = 1.00
    s_pacific  swell_2       4 of 64                        -> R = 1.00
    n_pacific  wind_waves    1 of 64                        -> R = 1.00

Those cells paint ~200 km of ocean with a direction that exists in 2-6% of it, and R CANNOT catch
it: R measures agreement AMONG CONTRIBUTORS, and a handful of agreeing subcells agree perfectly.
The honest signal is R x coverage. The height half was already honest (`energy_mean_height_block`
includes genuine 0.0 subcells, so it reports a correctly small Hs) — only the direction spoke with
false confidence.

Nothing is dropped: the direction is still returned and the CONSUMER decides. The transport
already existed end to end — the normalizer reads `{direction_key}_confidence` generically and the
frontend carries `dir_confidence` into the texture encoder — so only the production was missing.
"""
import os
import sys

import numpy as np
import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services._fetch_common import (  # noqa: E402
    energy_mean_direction_block, energy_mean_direction_block_partition_conf,
    energy_mean_height_block)

HALF = 4                      # an 8x8 block, matching the 2 degree product on the 0.25 degree grid
N = 16                        # array big enough to hold the block with margin
CENTRE = (8, 8)


def _arrays(dirs_and_heights, fill_dir=0.0, fill_h=0.0):
    """Build (dir_arr, h_arr) where `dirs_and_heights` places (dir, h) at given (r, c)."""
    d = np.full((N, N), fill_dir, dtype=float)
    h = np.full((N, N), fill_h, dtype=float)
    for (r, c), (dv, hv) in dirs_and_heights.items():
        d[r, c] = dv
        h[r, c] = hv
    return d, h


def test_a_lone_contributing_subcell_is_reported_as_no_confidence():
    """s_ocean swell_2: 1 of 64. R alone says 1.00; R x coverage must say ~0."""
    d, h = _arrays({(8, 8): (205.0, 1.9)})
    direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert direction == pytest.approx(205.0, abs=0.1), "the direction itself is still reported"
    assert conf == pytest.approx(1.0 / 64.0, abs=1e-6), (
        "one contributing subcell of 64 must read as ~1.5% confidence, not 100%")


def test_four_of_sixty_four_is_still_near_zero_confidence():
    """s_pacific swell_2: 4 of 64, all in perfect agreement -> R=1.0, coverage=0.0625."""
    cells = {(8, 8): (119.0, 0.5), (8, 9): (120.0, 0.5),
             (9, 8): (119.5, 0.5), (9, 9): (120.5, 0.5)}
    d, h = _arrays(cells)
    direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert direction == pytest.approx(119.75, abs=1.0)
    assert conf < 0.07, f"4/64 agreeing subcells must not read as confident; got {conf}"


def test_a_fully_populated_coherent_block_keeps_full_confidence():
    """The total-sea case must be UNCHANGED: every subcell present and agreeing -> conf ~ 1."""
    d = np.full((N, N), 270.0, dtype=float)
    h = np.full((N, N), 2.0, dtype=float)
    direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert direction == pytest.approx(270.0, abs=0.01)
    assert conf == pytest.approx(1.0, abs=1e-6)


def test_a_fully_populated_but_OPPOSED_block_reads_incoherent():
    """Coverage alone is not enough — a full block of opposing systems must still read low."""
    d = np.full((N, N), 0.0, dtype=float)
    d[:, ::2] = 180.0                      # half the subcells point the opposite way
    h = np.full((N, N), 2.0, dtype=float)
    _direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert conf < 0.05, f"opposed systems must read incoherent; got {conf}"


def test_the_direction_matches_the_legacy_helper_exactly():
    """★ The VALUE must not move. This is additive confidence, not a physics change — any drift
    here would silently re-aim every partition arrow on the map."""
    rng = np.random.default_rng(1234)
    d = rng.uniform(0.0, 360.0, size=(N, N))
    h = rng.uniform(0.0, 3.0, size=(N, N))
    h[h < 0.5] = 0.0                       # realistic partition sparsity
    legacy = energy_mean_direction_block(d, h, *CENTRE, HALF, True)
    new, _conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    if legacy == legacy:                   # not NaN
        assert new == pytest.approx(legacy, abs=1e-9)


def test_an_empty_block_is_zero_confidence_and_never_raises():
    d = np.full((N, N), 0.0, dtype=float)
    h = np.zeros((N, N), dtype=float)
    direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert conf == 0.0
    assert direction == direction or True   # NaN or a point sample; must not raise


def test_nan_subcells_are_excluded_from_coverage_not_counted_against_it():
    """Land/ice NaN subcells are ABSENT, not 'missing the train' — coverage is over FINITE cells,
    so a coastal block that is half land can still be fully confident about the water half."""
    d = np.full((N, N), 300.0, dtype=float)
    h = np.full((N, N), 1.5, dtype=float)
    d[4:8, 4:12] = np.nan                  # half the block is land
    h[4:8, 4:12] = np.nan
    _direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert conf == pytest.approx(1.0, abs=1e-6), (
        "land must not be counted as a partition-free subcell")


def test_the_height_half_was_already_honest():
    """Pins the asymmetry this fix closes: with 4 of 64 subcells carrying the train, the HEIGHT
    already reported a correctly small block RMS (it includes genuine zeros) while the DIRECTION
    reported full confidence. Only the direction needed fixing."""
    cells = {(8, 8): (119.0, 2.0), (8, 9): (120.0, 2.0),
             (9, 8): (119.5, 2.0), (9, 9): (120.5, 2.0)}
    d, h = _arrays(cells)
    rms = energy_mean_height_block(h, *CENTRE, HALF, True)
    assert rms == pytest.approx(2.0 * np.sqrt(4.0 / 64.0), rel=1e-6), "height was already diluted"
    assert rms < 0.6, "the honest block height is small..."
    _direction, conf = energy_mean_direction_block_partition_conf(d, h, *CENTRE, HALF, True)
    assert conf < 0.07, "...and now the direction says so too"


# ── the fetcher wiring ──────────────────────────────────────────────────────────────────────────

def test_every_partition_direction_has_a_confidence_series_and_the_total_is_untouched():
    from services import noaa_gfs_wave_fetcher as F
    assert set(F.PARTITION_DIR_CONFIDENCE_OM) == {
        "wind_wave_direction", "swell_wave_direction", "secondary_swell_wave_direction"}, (
        "every partition direction must export its own confidence")
    assert "wave_direction" not in F.PARTITION_DIR_CONFIDENCE_OM, (
        "the TOTAL keeps its existing coherence-gated confidence — do not double-treat it")
    # The normalizer's generic reader is what carries these through; the names must match it.
    for dir_key, conf_key in F.PARTITION_DIR_CONFIDENCE_OM.items():
        assert conf_key == f"{dir_key}_confidence", (
            f"normalizer.py reads '{{direction_key}}_confidence' generically; {conf_key} breaks it")
