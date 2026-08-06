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


def multi_dir_conf_batch(pairs, fallback_dir_arr, rs, cs, half, wrap_cols, scalar_fn,
                         total_h_arr=None, ramp_lo=0.35, ramp_hi=0.65):
    """Batch `energy_mean_direction_block_multi_conf` -> (directions, confidences, conf_present).

    ⭐ THREE ARRAYS, NOT TWO, BECAUSE THE SCALAR RETURNS `None` FOR THE CONFIDENCE — not NaN, not 0.0
    — in the point-sample fallback, meaning "no blockwise evidence either way". Folding that into NaN
    would make "not sampled" indistinguishable from "computed and undefined", which is the exact
    conflation this repo's refusal rules exist to prevent. `conf_present` is False there and the
    caller writes `None`.

    ⚠️ THE BRANCH ORDER IS LOAD-BEARING AND IS NOT `if/elif`. In the scalar, the mixed branch can be
    ENTERED and then DECLINED (when the two unit vectors cancel to mx == my == 0), and control falls
    through to the partition-only return — it does not fall to the total-only one. Reproduced exactly:

        MIXED       = have_partition & have_total & (mx != 0 | my != 0)
        TOTAL_ONLY  = have_total & ~have_partition
        PARTITION   = have_partition & ~MIXED          <- catches the declined-mix case
        FALLBACK    = ~have_partition & ~have_total

    ⚠️ MEASURED BRANCH FREQUENCY over 3,000 random blocks: mixed 63.1%, partition-only 36.9%,
    **total-only 0%, fallback 0%**. The two rare branches are unreachable from random data, so the
    parity suite PLANTS them. A test that only sampled randomly would cover half the function and
    look complete.

    `total_h_arr=None` disables tier 2 entirely — the callers' NOAA_COARSE_DIR_TOTAL_FIELD=0
    kill-switch path.
    """
    rs = np.asarray(rs, dtype=np.intp)
    cs = np.asarray(cs, dtype=np.intp)
    nrows, ncols = fallback_dir_arr.shape
    n = rs.shape[0]
    out_d = np.empty(n, dtype=float)
    out_c = np.empty(n, dtype=float)
    out_p = np.zeros(n, dtype=bool)
    interior = _interior_mask(rs, cs, nrows, ncols, half, wrap_cols)

    if interior.any():
        ri, ci = rs[interior], cs[interior]
        m = ri.shape[0]
        s = np.zeros(m); co = np.zeros(m); e_sum_p = np.zeros(m)
        any_ok = np.zeros(m, dtype=bool)
        for dir_arr, h_arr in pairs:
            d = _gather(dir_arr, ri, ci, half, ncols, wrap_cols)
            h = _gather(h_arr, ri, ci, half, ncols, wrap_cols)
            ok = np.isfinite(d) & np.isfinite(h) & (h > 0.0)
            any_ok |= ok.any(axis=(1, 2))
            e = np.where(ok, h * h, 0.0)
            rad = np.deg2rad(np.where(ok, d, 0.0))
            s += (e * np.sin(rad)).sum(axis=(1, 2))
            co += (e * np.cos(rad)).sum(axis=(1, 2))
            e_sum_p += e.sum(axis=(1, 2))

        w = np.zeros(m); r_d = np.zeros(m); ds = np.zeros(m); dco = np.zeros(m)
        if total_h_arr is not None:
            dt = _gather(fallback_dir_arr, ri, ci, half, ncols, wrap_cols)
            ht = _gather(total_h_arr, ri, ci, half, ncols, wrap_cols)
            okt = np.isfinite(dt) & np.isfinite(ht) & (ht > 0.0)
            et = np.where(okt, ht * ht, 0.0)
            radt = np.deg2rad(np.where(okt, dt, 0.0))
            ds = (et * np.sin(radt)).sum(axis=(1, 2))
            dco = (et * np.cos(radt)).sum(axis=(1, 2))
            e_sum = et.sum(axis=(1, 2))
            live = okt.any(axis=(1, 2)) & (e_sum > 0.0)
            with np.errstate(invalid="ignore", divide="ignore"):
                r_d = np.where(live, np.hypot(ds, dco) / np.where(e_sum > 0.0, e_sum, 1.0), 0.0)
            w = np.clip((r_d - ramp_lo) / (ramp_hi - ramp_lo), 0.0, 1.0)
            w = np.where(live, w, 0.0)
            ds = np.where(live, ds, 0.0)
            dco = np.where(live, dco, 0.0)

        with np.errstate(invalid="ignore", divide="ignore"):
            r_p = np.where(e_sum_p > 0.0, np.hypot(s, co) / np.where(e_sum_p > 0.0, e_sum_p, 1.0), 0.0)

        have_p = any_ok & ~((s == 0.0) & (co == 0.0))
        have_t = (w > 0.0) & ~((ds == 0.0) & (dco == 0.0))

        pm = np.hypot(s, co); pm = np.where(pm == 0.0, 1.0, pm)
        tm = np.hypot(ds, dco); tm = np.where(tm == 0.0, 1.0, tm)
        mx = (1.0 - w) * (s / pm) + w * (ds / tm)
        my = (1.0 - w) * (co / pm) + w * (dco / tm)

        use_mixed = have_p & have_t & ((mx != 0.0) | (my != 0.0))
        use_total = have_t & ~have_p
        use_part = have_p & ~use_mixed              # includes the ENTERED-then-DECLINED mix

        d_mixed = np.rad2deg(np.arctan2(mx, my)) % 360.0
        c_mixed = np.clip(((1.0 - w) * r_p + w * r_d) * np.hypot(mx, my), 0.0, 1.0)
        d_total = np.rad2deg(np.arctan2(ds, dco)) % 360.0
        d_part = np.rad2deg(np.arctan2(s, co)) % 360.0
        pt = fallback_dir_arr[ri, ci]

        dirs = np.where(use_mixed, d_mixed,
                        np.where(use_total, d_total,
                                 np.where(use_part, d_part, pt)))
        confs = np.where(use_mixed, c_mixed,
                         np.where(use_total, np.clip(r_d, 0.0, 1.0),
                                  np.where(use_part, np.clip(r_p, 0.0, 1.0), 0.0)))
        out_d[interior] = dirs
        out_c[interior] = confs
        out_p[interior] = use_mixed | use_total | use_part

    for i in np.nonzero(~interior)[0]:
        dv, cv = scalar_fn(int(rs[i]), int(cs[i]))
        out_d[i] = dv
        out_p[i] = cv is not None
        out_c[i] = float(cv) if cv is not None else 0.0
    return out_d, out_c, out_p


def partition_dir_conf_batch(dir_arr, h_arr, rs, cs, half, wrap_cols, scalar_fn):
    """Batch `energy_mean_direction_block_partition_conf` -> (directions, confidences).

    ⚠️ THE CONFIDENCE IS `R x coverage`, AND THE COVERAGE TERM IS THE WHOLE POINT. R alone measures
    agreement AMONG CONTRIBUTORS, so a block where 1 of 64 subcells carries the train yields R = 1.00
    — a perfectly confident bearing for a partition that exists in 2% of the water (measured live on
    the served 2 deg products, 2026-07-31). `coverage = ok / finite` collapses to 1 on a fully
    populated block and to ~0 exactly where the layer is claiming a train it does not have.
    Dropping it would restore a measured, user-visible defect while every direction stayed identical.
    """
    rs = np.asarray(rs, dtype=np.intp)
    cs = np.asarray(cs, dtype=np.intp)
    nrows, ncols = dir_arr.shape
    n = rs.shape[0]
    out_d = np.empty(n, dtype=float)
    out_c = np.empty(n, dtype=float)
    interior = _interior_mask(rs, cs, nrows, ncols, half, wrap_cols)
    if interior.any():
        ri, ci = rs[interior], cs[interior]
        d = _gather(dir_arr, ri, ci, half, ncols, wrap_cols)
        h = _gather(h_arr, ri, ci, half, ncols, wrap_cols)
        finite = np.isfinite(d) & np.isfinite(h)
        ok = finite & (h > 0.0)
        e = np.where(ok, h * h, 0.0)
        rad = np.deg2rad(np.where(ok, d, 0.0))
        s = (e * np.sin(rad)).sum(axis=(1, 2))
        co = (e * np.cos(rad)).sum(axis=(1, 2))
        tot_e = e.sum(axis=(1, 2))
        n_finite = finite.sum(axis=(1, 2))
        n_ok = ok.sum(axis=(1, 2))

        usable = ok.any(axis=(1, 2)) & ~((s == 0.0) & (co == 0.0)) & (tot_e > 0.0)
        with np.errstate(invalid="ignore", divide="ignore"):
            resultant = np.hypot(s, co) / np.where(tot_e > 0.0, tot_e, 1.0)
            coverage = np.where(n_finite > 0, n_ok / np.maximum(n_finite, 1), 0.0)
            direction = np.rad2deg(np.arctan2(s, co)) % 360.0
        pt = dir_arr[ri, ci]
        out_d[interior] = np.where(usable, direction, pt)
        out_c[interior] = np.where(usable, np.clip(resultant * coverage, 0.0, 1.0), 0.0)

    for i in np.nonzero(~interior)[0]:
        dv, cv = scalar_fn(int(rs[i]), int(cs[i]))
        out_d[i], out_c[i] = dv, cv
    return out_d, out_c


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
