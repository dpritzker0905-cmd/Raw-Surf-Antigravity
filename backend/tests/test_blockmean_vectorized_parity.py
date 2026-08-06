"""The vectorized regrid must be bit-identical to the scalar form, or it is not an optimisation.

Every batch form in `services/_fetch_blockmean_vec.py` is differential-tested here against the
ORIGINAL `_fetch_common` function it replaces. The scalar functions are the ORACLE and are never
deleted: this suite is the only thing that makes the batch forms safe to wire in, and a speedup that
moves a served value is a regression wearing a benchmark.

⚠️ THE POPULATION IS ADVERSARIAL ON PURPOSE. A random-interior sample would pass while every
fallback stayed unexercised. Planted here:
  * ROW-EDGE points, where the scalar slice CLAMPS (`max(0,..)`/`min(nrows,..)`) and the block
    SHRINKS — the batch form must delegate these, not re-derive them.
  * COLUMN-WRAP points at c=0,1 and c=ncols-1, where the native global grid wraps (`% ncols`).
  * ALL-NaN blocks -> the point-sample fallback.
  * ZERO-HEIGHT blocks -> the 'no energy' fallback.
  * ANTIPODAL directions -> the resultant-(0,0) fallback. Without it `atan2(0,0)` returns 0.0, a
    real bearing, and the product would silently publish DUE NORTH for a cancelling sea.

⚠️ AND THE BLOCK IS `2*half` CELLS, NOT `2*half+1` — the scalar form's window is asymmetric
(for half=2: r-2,r-1,r,r+1). Centring it would change every value this product has ever served,
and would still pass a test that only compared the two implementations' *shapes*.

Measured at the documented global_mid scale (721x1440, 15,000 points, half=2, 30% NaN):
    height_block     21.9x     scalar_block     18.3x     direction_block     12.5x
with max|diff| 8.9e-16 / 7.1e-15 / 5.8e-13 and NaN agreement 4034/4034.
"""
import numpy as np
import pytest

from services._fetch_common import (
    energy_mean_direction_block, energy_mean_height_block, energy_mean_scalar_block)
from services._fetch_blockmean_vec import (
    direction_block_batch, height_block_batch, scalar_block_batch)

NROWS, NCOLS = 181, 360      # smaller than production; the EDGE/WRAP logic is what matters, not size
HALF = 2
TOL = 1e-12


@pytest.fixture(scope="module")
def fields():
    rng = np.random.default_rng(23)

    def field(lo, hi):
        a = rng.uniform(lo, hi, size=(NROWS, NCOLS)).astype(float)
        a[rng.uniform(size=a.shape) < 0.30] = np.nan
        return a

    h, d, per = field(0.0, 6.0), field(0.0, 360.0), field(3.0, 20.0)
    h[40:50, 60:70] = np.nan                       # all-NaN  -> point-sample fallback
    h[60:70, 60:70] = 0.0                          # no energy -> fallback
    d[80, 100], d[81, 100] = 0.0, 180.0            # antipodal -> resultant (0,0) fallback
    h[80, 100] = h[81, 100] = 1.0
    return h, d, per


@pytest.fixture(scope="module")
def points():
    rng = np.random.default_rng(24)
    rs = list(rng.integers(0, NROWS, size=800))
    cs = list(rng.integers(0, NCOLS, size=800))
    for r in (0, 1, 2, NROWS - 3, NROWS - 2, NROWS - 1):     # clamping row edges
        for c in (0, 1, 5, NCOLS - 2, NCOLS - 1):            # wrapping columns
            rs.append(r); cs.append(c)
    for r, c in ((45, 65), (65, 65), (80, 100), (81, 100)):  # the three fallbacks
        rs.append(r); cs.append(c)
    return np.array(rs, dtype=np.intp), np.array(cs, dtype=np.intp)


def _assert_identical(name, ref, got, n):
    both_nan = np.isnan(ref) & np.isnan(got)
    assert int((np.isnan(ref) == np.isnan(got)).sum()) == n, (
        f"{name}: NaN placement differs between batch and scalar — one of them is publishing a "
        "number where the other refuses, which is a data change, not a speedup")
    cmp = ~both_nan
    if cmp.any():
        maxd = float(np.max(np.abs(ref[cmp] - got[cmp])))
        assert maxd < TOL, f"{name}: max|diff| {maxd:.3e} exceeds {TOL:.0e} — values would change"


def test_height_block_batch_is_identical(fields, points):
    h, _d, _p = fields
    rs, cs = points
    ref = np.array([energy_mean_height_block(h, int(r), int(c), HALF, True) for r, c in zip(rs, cs)])
    got = height_block_batch(h, rs, cs, HALF, True,
                             lambda r, c: energy_mean_height_block(h, r, c, HALF, True))
    _assert_identical("height_block", ref, np.asarray(got), len(rs))


def test_scalar_block_batch_is_identical(fields, points):
    h, _d, per = fields
    rs, cs = points
    ref = np.array([energy_mean_scalar_block(per, h, int(r), int(c), HALF, True) for r, c in zip(rs, cs)])
    got = scalar_block_batch(per, h, rs, cs, HALF, True,
                             lambda r, c: energy_mean_scalar_block(per, h, r, c, HALF, True))
    _assert_identical("scalar_block", ref, np.asarray(got), len(rs))


def test_direction_block_batch_is_identical(fields, points):
    h, d, _p = fields
    rs, cs = points
    ref = np.array([energy_mean_direction_block(d, h, int(r), int(c), HALF, True) for r, c in zip(rs, cs)])
    got = direction_block_batch(d, h, rs, cs, HALF, True,
                                lambda r, c: energy_mean_direction_block(d, h, r, c, HALF, True))
    _assert_identical("direction_block", ref, np.asarray(got), len(rs))


def test_non_wrapping_grids_are_also_identical(fields, points):
    """Regional (non-global) products pass wrap_cols=False, where the column slice CLAMPS instead of
    wrapping — a different code path in both forms, and the one a global-only test would miss."""
    h, _d, _p = fields
    rs, cs = points
    ref = np.array([energy_mean_height_block(h, int(r), int(c), HALF, False) for r, c in zip(rs, cs)])
    got = height_block_batch(h, rs, cs, HALF, False,
                             lambda r, c: energy_mean_height_block(h, r, c, HALF, False))
    _assert_identical("height_block(wrap=False)", ref, np.asarray(got), len(rs))


def test_partition_dir_conf_batch_is_identical(fields, points):
    """Both outputs must match: the direction AND the R x coverage confidence.

    ⚠️ The confidence is the half that can regress silently — a batch form that dropped the coverage
    term would return byte-identical DIRECTIONS and still restore the measured defect where a block
    carrying the train in 1 of 64 subcells reports R = 1.00.
    """
    from services._fetch_common import energy_mean_direction_block_partition_conf
    from services._fetch_blockmean_vec import partition_dir_conf_batch

    h, d, _p = fields
    rs, cs = points
    ref = [energy_mean_direction_block_partition_conf(d, h, int(r), int(c), HALF, True)
           for r, c in zip(rs, cs)]
    ref_d = np.array([a for a, _ in ref])
    ref_c = np.array([b for _, b in ref])
    got_d, got_c = partition_dir_conf_batch(
        d, h, rs, cs, HALF, True,
        lambda r, c: energy_mean_direction_block_partition_conf(d, h, r, c, HALF, True))
    _assert_identical("partition_dir(direction)", ref_d, np.asarray(got_d), len(rs))
    _assert_identical("partition_dir(confidence)", ref_c, np.asarray(got_c), len(rs))


def test_partition_confidence_actually_varies(fields, points):
    """MUTATION CONTROL: if every confidence were 1.0 (or 0.0), the test above would pass while
    proving nothing about the coverage term it exists to protect."""
    from services._fetch_common import energy_mean_direction_block_partition_conf

    h, d, _p = fields
    rs, cs = points
    confs = np.array([energy_mean_direction_block_partition_conf(d, h, int(r), int(c), HALF, True)[1]
                      for r, c in zip(rs[:400], cs[:400])])
    assert confs.min() < 0.9 < confs.max(), (
        f"confidence range [{confs.min():.3f}, {confs.max():.3f}] is degenerate — the parity test "
        "above is not exercising the R x coverage computation")


@pytest.fixture(scope="module")
def multi_fields():
    """Fields for the two-tier total-sea reduction, with the RARE branches planted.

    ⚠️ MEASURED over 3,000 random blocks: mixed 63.1%, partition-only 36.9%, **total-only 0%,
    point-sample fallback 0%**. Random data reaches half the function. These plants are the only
    reason the parity assertions below mean anything for the other half.
    """
    rng = np.random.default_rng(41)

    def field(lo, hi):
        a = rng.uniform(lo, hi, size=(NROWS, NCOLS)).astype(float)
        a[rng.uniform(size=a.shape) < 0.30] = np.nan
        return a

    hs = [field(0.0, 6.0) for _ in range(3)]
    ds = [field(0.0, 360.0) for _ in range(3)]
    th, td = field(0.0, 8.0), field(0.0, 360.0)

    # PLANT 1 -> total-only: every partition empty, total field coherent (r_d > ramp_lo)
    for a in hs:
        a[30:40, 40:50] = 0.0
    th[30:40, 40:50] = 3.0
    td[30:40, 40:50] = 42.0                      # one bearing => r_d = 1.0 => w = 1.0

    # PLANT 2 -> point-sample fallback (conf is None): partitions empty AND total empty
    for a in hs:
        a[100:110, 140:150] = 0.0
    th[100:110, 140:150] = 0.0

    return list(zip(ds, hs)), td, th


def test_multi_dir_conf_batch_is_identical_including_the_planted_rare_branches(multi_fields):
    """All three outputs must match: direction, confidence, AND whether a confidence exists at all."""
    from services._fetch_common import energy_mean_direction_block_multi_conf as SC
    from services._fetch_blockmean_vec import multi_dir_conf_batch

    pairs, td, th = multi_fields
    rng = np.random.default_rng(42)
    rs = list(rng.integers(0, NROWS, size=600))
    cs = list(rng.integers(0, NCOLS, size=600))
    for r, c in ((35, 45), (36, 46), (105, 145), (106, 146)):    # the two planted branches
        rs.append(r); cs.append(c)
    for r in (0, 1, NROWS - 2, NROWS - 1):                        # clamping edges
        for c in (0, 1, NCOLS - 1):                               # wrapping columns
            rs.append(r); cs.append(c)
    rs = np.array(rs, dtype=np.intp); cs = np.array(cs, dtype=np.intp)

    ref = [SC(pairs, td, int(r), int(c), HALF, True, th) for r, c in zip(rs, cs)]
    ref_d = np.array([a for a, _ in ref])
    ref_present = np.array([b is not None for _, b in ref])
    ref_c = np.array([float(b) if b is not None else 0.0 for _, b in ref])

    got_d, got_c, got_p = multi_dir_conf_batch(
        pairs, td, rs, cs, HALF, True,
        lambda r, c: SC(pairs, td, r, c, HALF, True, th), total_h_arr=th)

    assert np.array_equal(ref_present, np.asarray(got_p)), (
        "conf_present disagrees — one form returns a confidence where the other returns None, "
        "which is the 'not sampled' vs 'computed' conflation this split exists to prevent")
    _assert_identical("multi(direction)", ref_d, np.asarray(got_d), len(rs))
    _assert_identical("multi(confidence)", ref_c, np.asarray(got_c), len(rs))


def test_multi_dir_conf_batch_honours_the_tier2_kill_switch(multi_fields):
    """total_h_arr=None is the NOAA_COARSE_DIR_TOTAL_FIELD=0 path — tier 2 must vanish entirely."""
    from services._fetch_common import energy_mean_direction_block_multi_conf as SC
    from services._fetch_blockmean_vec import multi_dir_conf_batch

    pairs, td, _th = multi_fields
    rng = np.random.default_rng(43)
    rs = rng.integers(0, NROWS, size=400).astype(np.intp)
    cs = rng.integers(0, NCOLS, size=400).astype(np.intp)
    ref = [SC(pairs, td, int(r), int(c), HALF, True, None) for r, c in zip(rs, cs)]
    ref_d = np.array([a for a, _ in ref])
    got_d, _c, _p = multi_dir_conf_batch(
        pairs, td, rs, cs, HALF, True,
        lambda r, c: SC(pairs, td, r, c, HALF, True, None), total_h_arr=None)
    _assert_identical("multi(kill-switch)", ref_d, np.asarray(got_d), len(rs))


def test_the_planted_rare_branches_are_genuinely_reached(multi_fields):
    """MUTATION CONTROL. Without this, the plants could silently stop working and the parity test
    above would keep passing while covering only the 2 branches random data reaches."""
    from services._fetch_common import energy_mean_direction_block_multi_conf as SC

    pairs, td, th = multi_fields
    _d_total, c_total = SC(pairs, td, 35, 45, HALF, True, th)
    assert c_total is not None, "PLANT 1 no longer reaches the total-only branch"

    _d_fb, c_fb = SC(pairs, td, 105, 145, HALF, True, th)
    assert c_fb is None, (
        "PLANT 2 no longer reaches the point-sample fallback — the conf=None path, the only one "
        "that distinguishes 'no blockwise evidence' from a computed zero, is untested")


def test_the_exact_zero_resultant_branch_is_unreachable_in_practice(fields):
    """A FINDING ABOUT THE ORIGINAL, recorded so nobody deletes the branch on coverage data.

    `energy_mean_direction_block` guards `if s == 0.0 and co == 0.0` before `atan2`, because
    `atan2(0, 0)` is 0.0 — a real bearing — and a perfectly cancelling sea would otherwise publish
    DUE NORTH. The batch form preserves it exactly.

    ⚠️ Measured 2026-08-06: that branch appears UNREACHABLE with real trig. Float `sin`/`cos` leave a
    ~1.2e-16 residue even on exact antipodes, and a random search over 200,000 four-direction blocks
    found **0** exact-(0, 0) resultants::

        0/180        s=+1.225e-16  c=+0.000e+00   -> does not fire
        90/270       s=+0.000e+00  c=-1.225e-16   -> does not fire
        0/90/180/270 s=+2.220e-16  c=-1.837e-16   -> does not fire

    ⇒ Coverage tools will report it dead. **Keep it anyway**: it is cheap, it is correct, and the
    cost of being wrong is a silent due-north bearing. What this test pins is that the two
    implementations agree on the NEAR-cancelling case, which is the one that actually occurs.
    """
    h, d, _p = fields
    rs = np.array([80], dtype=np.intp)
    cs = np.array([100], dtype=np.intp)
    ref = energy_mean_direction_block(d, h, 80, 100, HALF, True)
    got = float(np.asarray(direction_block_batch(
        d, h, rs, cs, HALF, True,
        lambda r, c: energy_mean_direction_block(d, h, r, c, HALF, True)))[0])
    assert (np.isnan(ref) and np.isnan(got)) or abs(ref - got) < TOL, (
        f"near-cancelling block diverges: scalar {ref!r} vs batch {got!r}")
