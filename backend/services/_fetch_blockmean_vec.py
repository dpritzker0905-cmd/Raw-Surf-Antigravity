"""Vectorized batch forms of the per-point GRIB regrid block reductions.

WHY THIS EXISTS (measured 2026-08-06, MASTER-AUDIT-9.0 Phase 2). The fetchers regrid each decoded
GRIB message with a PER-POINT python loop::

    for om in OM_ORDER:                 # 12 variables
        for rid, rmap in idx_by.items():
            for pi, (r, c) in enumerate(rmap):        # ~15,000 points
                energy_mean_*_block(arr, ..., r, c, half, wrap)

Measured against the REAL functions at global_mid scale (721x1440 native, 15,000 points, half=2,
30% NaN mask), per 113-step run:

    ..._direction_block_multi_conf      1/pt   89.72 us   152.1 s   31.0%
    ..._direction_block_partition_conf  3/pt   26.25 us   133.5 s   27.2%
    energy_mean_scalar_block            4/pt   17.55 us   119.0 s   24.3%
    energy_mean_height_block            4/pt   12.61 us    85.5 s   17.5%
    ---------------------------------------------------------------- 490.0 s / run

against a `global_mid` pass whose observed range is 1198-1879 s. So this loop is roughly a quarter
of the tightest lane in the system, and the DIRECTION reductions dominate it -- not the heights.

⛔ THE AUDIT'S FIRST ESTIMATE (212 s) WAS WRONG BY 2.3x AND NAMED THE WRONG TARGET, because it
benchmarked `energy_mean_height_block` alone and multiplied by 12. That function is the CHEAPEST of
the four and only 17.5% of the cost. Measuring one member of a set is not measuring the set.

────────────────────────────────────────────────────────────────────────────────────────────────
THE TWO SEMANTICS THAT DECIDE CORRECTNESS, both easy to get subtly wrong:

  1. THE BLOCK IS `2*half` CELLS, NOT `2*half+1`. The scalar form slices
     `r0,r1 = max(0,r-half), min(nrows,r+half)` and `np.arange(c-half, c+half)` -- an ASYMMETRIC
     window (for half=2: r-2,r-1,r,r+1). Centring a symmetric window here would change every value
     the product has ever served.

  2. THE BLOCK SHRINKS AT ROW EDGES. `max(0,...)`/`min(nrows,...)` clamp, so points within `half`
     rows of the pole see fewer rows. Columns WRAP instead (`% ncols`) when wrap_cols.

⭐ HOW THIS STAYS BIT-IDENTICAL RATHER THAN NEARLY-IDENTICAL: it vectorizes only the INTERIOR, where
every window is full-size, and delegates edge rows to the ORIGINAL scalar function. The edge is
~4 of 721 rows (0.55% of points) so the win is unaffected, and the clamp logic is never
reimplemented -- it is called. A reimplementation that agrees on a random sample is not a proof;
delegation is.

⚠️ NaN HANDLING IS NOT `np.nanmean`. The scalar forms use an explicit `ok` mask and fall back to the
POINT SAMPLE when nothing is valid -- `nanmean` of an all-NaN slice warns and returns NaN, which is
a different value AND a different contract. The masks here mirror the originals exactly.
"""
from __future__ import annotations

import numpy as np


def _interior_mask(rs, cs, nrows, ncols, half, wrap_cols):
    """True where the scalar form's row/col slices are FULL-SIZE, so a uniform gather is exact."""
    ok = (rs - half >= 0) & (rs + half <= nrows)
    if not wrap_cols:
        ok &= (cs - half >= 0) & (cs + half <= ncols)
    return ok


def _gather(arr, rs, cs, half, ncols, wrap_cols):
    """(N, 2*half, 2*half) windows matching the scalar slice exactly: rows r-half..r+half-1,
    cols c-half..c+half-1, columns wrapped when the native grid is global."""
    dr = np.arange(-half, half)
    dc = np.arange(-half, half)
    rr = rs[:, None, None] + dr[None, :, None]
    cc = cs[:, None, None] + dc[None, None, :]
    cc = (cc % ncols) if wrap_cols else cc
    return arr[rr, cc]


def _finalize(out, interior, rs, cs, scalar_fn):
    """Fill the non-interior points by CALLING the original scalar function — never by re-deriving
    its clamp logic. This is what makes the result identical rather than merely close."""
    for i in np.nonzero(~interior)[0]:
        out[i] = scalar_fn(int(rs[i]), int(cs[i]))
    return out


def height_block_batch(h_arr, rs, cs, half, wrap_cols, scalar_fn):
    """Batch `energy_mean_height_block`: RMS over finite subcells, point-sample fallback."""
    rs = np.asarray(rs, dtype=np.intp)
    cs = np.asarray(cs, dtype=np.intp)
    nrows, ncols = h_arr.shape
    out = np.empty(rs.shape[0], dtype=float)
    interior = _interior_mask(rs, cs, nrows, ncols, half, wrap_cols)
    if interior.any():
        h = _gather(h_arr, rs[interior], cs[interior], half, ncols, wrap_cols)
        ok = np.isfinite(h)
        n = ok.sum(axis=(1, 2))
        sq = np.where(ok, h * h, 0.0).sum(axis=(1, 2))
        vals = np.sqrt(sq / np.maximum(n, 1))
        pt = h_arr[rs[interior], cs[interior]]          # fallback: the point sample (may be NaN)
        out[interior] = np.where(n > 0, vals, pt)
    return _finalize(out, interior, rs, cs, scalar_fn)


def scalar_block_batch(x_arr, h_arr, rs, cs, half, wrap_cols, scalar_fn):
    """Batch `energy_mean_scalar_block`: energy-weighted (E = H^2) mean over subcells with h > 0."""
    rs = np.asarray(rs, dtype=np.intp)
    cs = np.asarray(cs, dtype=np.intp)
    nrows, ncols = x_arr.shape
    out = np.empty(rs.shape[0], dtype=float)
    interior = _interior_mask(rs, cs, nrows, ncols, half, wrap_cols)
    if interior.any():
        xs = _gather(x_arr, rs[interior], cs[interior], half, ncols, wrap_cols)
        h = _gather(h_arr, rs[interior], cs[interior], half, ncols, wrap_cols)
        ok = np.isfinite(xs) & np.isfinite(h) & (h > 0.0)
        e = np.where(ok, h * h, 0.0)
        num = (e * np.where(ok, xs, 0.0)).sum(axis=(1, 2))
        den = e.sum(axis=(1, 2))
        pt = x_arr[rs[interior], cs[interior]]
        with np.errstate(invalid="ignore", divide="ignore"):
            vals = num / den
        out[interior] = np.where(ok.any(axis=(1, 2)), vals, pt)
    return _finalize(out, interior, rs, cs, scalar_fn)


def direction_block_batch(dir_arr, h_arr, rs, cs, half, wrap_cols, scalar_fn):
    """Batch `energy_mean_direction_block`: energy-weighted CIRCULAR mean, degrees in [0, 360).

    ⚠️ Two distinct fallbacks in the original, both preserved: no valid subcell, AND a resultant of
    exactly (0, 0) — antipodal energies that cancel. The second cannot be folded into the first;
    atan2(0, 0) is 0.0, a real bearing, and would silently publish due north.
    """
    rs = np.asarray(rs, dtype=np.intp)
    cs = np.asarray(cs, dtype=np.intp)
    nrows, ncols = dir_arr.shape
    out = np.empty(rs.shape[0], dtype=float)
    interior = _interior_mask(rs, cs, nrows, ncols, half, wrap_cols)
    if interior.any():
        d = _gather(dir_arr, rs[interior], cs[interior], half, ncols, wrap_cols)
        h = _gather(h_arr, rs[interior], cs[interior], half, ncols, wrap_cols)
        ok = np.isfinite(d) & np.isfinite(h) & (h > 0.0)
        e = np.where(ok, h * h, 0.0)
        rad = np.deg2rad(np.where(ok, d, 0.0))
        s = (e * np.sin(rad)).sum(axis=(1, 2))
        co = (e * np.cos(rad)).sum(axis=(1, 2))
        vals = np.rad2deg(np.arctan2(s, co)) % 360.0
        pt = dir_arr[rs[interior], cs[interior]]
        usable = ok.any(axis=(1, 2)) & ~((s == 0.0) & (co == 0.0))
        out[interior] = np.where(usable, vals, pt)
    return _finalize(out, interior, rs, cs, scalar_fn)
