"""Seam check at every source join in a target's ray domain (gate section 1a). Runs BEFORE any coefficient is frozen.

Both depths are in MSL first (datum.to_msl). Over the overlap (or across the join where the sources do not overlap)
the median and p95 of |depth_a - depth_b| are measured for water shallower than 30 m. The registered trigger is
p95 > 1.0 m: the target is tagged SEAM (its own reported stratum; coefficients are still computed). The median is
reported beside it; MEDIAN_REPORT_M (0.3 m) flags it in the table but does not tag (amendment question A1).
"""
import csv
import hashlib
import io
from dataclasses import dataclass

import numpy as np

SHALLOW_M = 30.0
P95_SEAM_M = 1.0
MEDIAN_REPORT_M = 0.3
JOIN_CELLS = 2             # non-overlap: nearest cells on each side within 2 cells of the finer source
SEAM = "SEAM"


@dataclass
class SeamRow:
    target: str
    join: str
    sources: str
    n_cells: int
    median_m: float
    p95_m: float
    tag: str                 # "SEAM" or ""
    median_over_report: bool

    def cells(self):
        return [self.target, self.join, self.sources, self.n_cells, f"{self.median_m:.4f}", f"{self.p95_m:.4f}",
                self.tag, "1" if self.median_over_report else "0"]


def stats(depth_a_msl, depth_b_msl):
    """(n, median, p95) of |a - b| over cells valid in both and shallower than SHALLOW_M in EITHER source's min."""
    a = np.asarray(depth_a_msl, dtype=float).ravel()
    b = np.asarray(depth_b_msl, dtype=float).ravel()
    ok = np.isfinite(a) & np.isfinite(b) & (np.minimum(a, b) > 0) & (np.minimum(a, b) < SHALLOW_M)
    n = int(ok.sum())
    if n == 0:
        return 0, float("nan"), float("nan")
    d = np.abs(a[ok] - b[ok])
    return n, float(np.median(d)), float(np.percentile(d, 95))


def edge_pairs(fine_msl, coarse_msl, cells=JOIN_CELLS):
    """Cross-join pairs for NON-overlapping sources on a common grid: for each fine-valid cell within `cells` of a
    coarse-valid, fine-NaN cell, pair it with the nearest coarse-valid cell across the join (4-neighbourhood walk).
    Returns (fine_values, coarse_values)."""
    f = np.asarray(fine_msl, dtype=float)
    c = np.asarray(coarse_msl, dtype=float)
    fv, cv = np.isfinite(f), np.isfinite(c)
    out_f, out_c = [], []
    ny, nx = f.shape
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        for step in range(1, cells + 1):
            # a fine cell whose neighbour `step` away (in this direction) is coarse-only: the join lies between
            ys, xs = np.nonzero(fv)
            yy, xx = ys + dy * step, xs + dx * step
            inb = (yy >= 0) & (yy < ny) & (xx >= 0) & (xx < nx)
            ys, xs, yy, xx = ys[inb], xs[inb], yy[inb], xx[inb]
            sel = (~fv[yy, xx]) & cv[yy, xx]
            out_f.extend(f[ys[sel], xs[sel]].tolist())
            out_c.extend(c[yy[sel], xx[sel]].tolist())
    return np.asarray(out_f), np.asarray(out_c)


def check_join(target, join, sources, depth_a_msl, depth_b_msl):
    n, med, p95 = stats(depth_a_msl, depth_b_msl)
    tag = SEAM if (n > 0 and p95 > P95_SEAM_M) else ""
    return SeamRow(target, join, sources, n, med, p95, tag, bool(n > 0 and med > MEDIAN_REPORT_M))


HEADER = ["target", "join", "sources", "n_cells", "median_m", "p95_m", "tag", "median_over_0.3m"]


def to_csv(rows):
    """The committed seam table, byte-stable (sorted by target, join) plus its sha256."""
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    for r in sorted(rows, key=lambda r: (r.target, r.join)):
        w.writerow(r.cells())
    text = buf.getvalue()
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def target_tags(rows):
    """{target: SEAM} for every target with at least one SEAM join."""
    return {r.target: SEAM for r in rows if r.tag == SEAM}
