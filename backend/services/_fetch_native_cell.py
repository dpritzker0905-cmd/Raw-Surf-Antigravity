"""_fetch_native_cell.py — the EXACT native cell at native resolution, through the production block reductions.

⛔ THE DEFECT (found 2026-09-29 by backend/scripts/same_model_parity_probe.py). The wave fetchers derive the block
half-width as `max(1, round(res / 0.25 / 2))`. At the native 0.25 deg that is round(0.5) = 0, clamped to 1, and the
block is rows [r-1, r+1) x cols [c-1, c+1): the 2x2 of native cells to the NORTH-WEST of the node (the GRIB rows
run north to south). So every "0.25-deg" regional node was a 2x2 energy mean placed half a cell (~14 km) south-east
of the water it described. Measured against Open-Meteo's GFS-Wave on the same 12Z cycle: our node matched the NW 2x2
mean to MAE 0.010 m on 72% of rows and its own cell on 14%.

⭐ THE FIX REUSES THE PRODUCTION REDUCTIONS, IT DOES NOT RE-DERIVE THEM. A native value is not only a height: each
layer also carries a direction and a render CONFIDENCE (resultant length x coverage) that the frozen production
frontend reads to fade crests, and the multi-tier total-sea direction has four branches. Re-deriving "the
single-cell answer" of five reductions by hand is exactly how a second composition gets born. Instead:

  * `Doubled(a)` presents the native grid at TWICE its resolution: every native cell is a 2x2 of itself. A block of
    half=1 centred on (2r+1, 2c+1) is then exactly the four copies of cell (r, c), and energy-weighted means,
    resultant lengths and coverage ratios are all invariant to duplication. So the batch reductions, run UNCHANGED
    on the view, return each cell's single-cell answer.
  * `one_cell(a, r, c)` is the 1x1 slice the SCALAR reductions see for the same cell: with wrap_cols=True their
    block at (0, 0, half=1) is that cell twice. It is the oracle the tests hold the view to, and the per-point path
    the scalar (non-vectorized) loop and the batch functions' edge fallback use.

Used by the three wave fetchers: noaa_gfs_wave_fetcher (GFS), dwd_gwam_fetcher (ICON) and ecmwf_opendata_fetcher
(EURO, whose heights alone were block-meaned: under the defect one EURO point carried a height from the NW 2x2
beside a direction and period from its own cell). ONE switch for all three, because the consensus averages them.
Gate: REGRID_NATIVE_CELL (default "0" = the legacy 2x2 NW block, byte-identical). Declared in the ingest lanes.
"""
import os

import numpy as np

NATIVE_RES_DEG = 0.25


def enabled() -> bool:
    return os.environ.get("REGRID_NATIVE_CELL", "0") == "1"


def is_native(resolution: float, native: float = NATIVE_RES_DEG) -> bool:
    """True when a target resolution IS the native grid, so a block would be one cell. PURE."""
    return float(resolution) <= native * (1.0 + 1e-6)


class Doubled:
    """A native grid seen at twice its resolution (see the module docstring). Supports what the batch reductions
    use: `.shape` and integer-array indexing `a[rr, cc]` (broadcast index arrays)."""
    __slots__ = ("a", "shape")

    def __init__(self, a):
        self.a = a
        self.shape = (a.shape[0] * 2, a.shape[1] * 2)

    def __getitem__(self, idx):
        rr, cc = idx
        return self.a[np.asarray(rr) // 2, np.asarray(cc) // 2]


def doubled_indices(rs, cs):
    """Native (r, c) -> the centre of that cell's 2x2 in the doubled view."""
    return np.asarray(rs, dtype=np.intp) * 2 + 1, np.asarray(cs, dtype=np.intp) * 2 + 1


def one_cell(a, r: int, c: int):
    """The 1x1 slice of native cell (r, c), for the scalar reductions."""
    return a[r:r + 1, c:c + 1]


# ── A LAND node answers from its centred 3x3 (2026-09-29) ───────────────────────────────────────────────────────────
# Measured on real GRIB before any flip (vector-blockmean-parity run 36622286406, Florida east coast, 0.25 deg):
# the exact cell alone left 20 of 425 coastal nodes (4.7%) with NO height, where the legacy NW 2x2 had caught a sea
# cell. Surf spots sit exactly there. A node whose own cell is LAND (its native total height is missing) therefore
# answers from the energy mean of the sea cells in its CENTRED 3x3: symmetric, so no shift, and a superset of the
# legacy 2x2, so no node the legacy block covered is left empty. In the Doubled view that is half=3 at (2r+1, 2c+1):
# rows 2r-2..2r+3 are native rows r-1..r+1, each twice. A SEA cell whose partition is absent is NOT land; "no train
# here" stays its answer rather than a neighbour's train.
LAND_HALF = 3


def views(r: int, c: int, hb: int, *arrays):
    """What the SCALAR reductions see for native cell (r, c) at doubled-view half `hb`, as (*views, rr, cc, half):
    hb=1 -> each array's 1x1 slice at (0, 0, half=1); hb=LAND_HALF -> each array's centred 3x3 (rows clamped at the
    grid edge, columns wrapped) DOUBLED, at its centre with half=3: the same cells, with the same weights, as the batch
    functions' block on the Doubled view. None passes through. PURE."""
    if hb == 1:
        return (*(None if a is None else a[r:r + 1, c:c + 1] for a in arrays), 0, 0, 1)
    nrows, ncols = next(a.shape for a in arrays if a is not None)
    rows = np.arange(max(0, r - 1), min(nrows, r + 2))
    cols = np.arange(c - 1, c + 2) % ncols
    win = [None if a is None else np.repeat(np.repeat(a[np.ix_(rows, cols)], 2, axis=0), 2, axis=1) for a in arrays]
    return (*win, 2 * (r - int(rows[0])) + 1, 3, LAND_HALF)


def native_first(run, rs, cs, land, at_land):
    """`run(R2, C2)` is the fetcher's OWN batch call on Doubled views at half=1, returning a tuple of per-point arrays:
    every point's exact native cell. A LAND point (`land`) is then answered by `at_land(r, c)`, the fetcher's own
    SCALAR reduction on its centred 3x3 (`views(..., LAND_HALF, ...)`) as a batch row (`batch_row`), so the vectorized
    and the per-point paths compute it with the SAME function.
    ⛔ Not a second batch pass at half=3: that summed the 36 duplicated subcells in a different order than the scalar
    form, and on real GRIB (quantized values land on rounding ties) it differed in 1 of 115,600 values
    (vector-blockmean-parity run 36624144116, wind_wave_period 3.6257 vs 3.6258). Land is ~5% of a regional tile."""
    R2, C2 = doubled_indices(rs, cs)
    out = [np.array(x, copy=True) for x in run(R2, C2)]
    for i in np.nonzero(np.asarray(land, dtype=bool))[0]:
        for o, v in zip(out, at_land(int(rs[i]), int(cs[i]))):
            o[i] = v
    return tuple(out)


def native_reduce(batch, fn, grids, rs, cs, land, kind="value"):
    """One variable at every point's exact native cell: the fetcher's batch reduction `batch` and its scalar form
    `fn`, which take the same arguments (the `grids`, then indices, half, wrap), handed in by the fetcher so it keeps
    calling its own functions. The batch runs on Doubled views at half=1; LAND points are answered by `fn` on their
    centred 3x3. Returns the batch's tuple of per-point arrays."""
    doubled = [Doubled(g) for g in grids]

    def run(R2, C2):
        out = batch(*doubled, R2, C2, 1, True, lambda r2, c2: fn(*views(r2 // 2, c2 // 2, 1, *grids), True))
        return out if isinstance(out, tuple) else (out,)
    return native_first(run, rs, cs, land,
                        lambda r, c: batch_row(fn(*views(r, c, LAND_HALF, *grids), True), kind))


def multi_conf_at(fn, r: int, c: int, hb: int, pairs, fallback_dir, total_h=None):
    """The multi-tier total-sea reduction `fn` (energy_mean_direction_block_multi_conf) on what native cell (r, c)'s
    block sees at doubled-view half `hb`."""
    flat = [x for pair in pairs for x in pair]
    v = views(r, c, hb, *flat, fallback_dir, total_h)
    n = len(flat)
    return fn([(v[i], v[i + 1]) for i in range(0, n, 2)], v[n], v[n + 2], v[n + 3], v[n + 4], True, v[n + 1])


def native_multi(batch, fn, pairs, fallback_dir, total_h, rs, cs, land, **kw):
    """`native_reduce` for the multi-tier total-sea direction: `batch` is multi_dir_conf_batch, `fn` its scalar form;
    `kw` passes the fetcher's ramp constants. Returns (directions, confidences, conf_present)."""
    dp = [(Doubled(d), Doubled(h)) for d, h in pairs]
    dt = Doubled(total_h) if total_h is not None else None

    def run(R2, C2):
        return batch(dp, Doubled(fallback_dir), R2, C2, 1, True,
                     lambda r2, c2: multi_conf_at(fn, r2 // 2, c2 // 2, 1, pairs, fallback_dir, total_h),
                     total_h_arr=dt, **kw)
    return native_first(run, rs, cs, land,
                        lambda r, c: batch_row(
                            multi_conf_at(fn, r, c, LAND_HALF, pairs, fallback_dir, total_h), "multi"))


def batch_row(result, kind: str):
    """A SCALAR reduction's answer as the row its batch form holds, by the batch functions' own `_finalize` rules:
    "multi" (direction, confidence or None) -> (d, conf or 0.0, conf is not None); "partition" -> (d, conf);
    anything else -> (value,). PURE."""
    if kind == "multi":
        x, conf = result
        return x, (float(conf) if conf is not None else 0.0), conf is not None
    if kind == "partition":
        return tuple(result)
    return (result,)
