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
