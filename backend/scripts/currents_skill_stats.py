"""currents_skill_stats.py - bootstrap, Holm, TOST, labels and floors of the currents-skill-v1 registration (sections 5, 6).
Serves nothing. Pure: no I/O.

BOOTSTRAP. Paired moving-block bootstrap over the ORDERED list of kept valid dates (gaps skipped, not padded), 5-day blocks,
B = 10,000, seed 20261122, 95% percentile intervals. Whole dates are resampled (every row of a date kept together). Each
metric is a ratio of per-date sums (RMSE = sqrt(sum e^2 / n); mean separation = sum / n), so one replicate is a count vector
over dates and every arm on a line is recomputed on the SAME replicate (paired).

LINES. A line compares an arm with CMEMS_025 on the paired rows: d = metric(arm) - metric(base), r = metric(arm) /
metric(base) - 1.
  p_better = share of replicates with d* >= 0    p_worse = share with d* <= 0
  TOST     = max(share r* <= -0.10, share r* >= +0.10)
Holm (step-down) within each family; one-sided significance at Holm p < 0.025, equivalence at Holm p < 0.05.

LABELS. BETTER (Holm p_better < 0.025 AND both halves of TEST show the same sign with at least half the pooled effect),
else COMPARABLE (Holm TOST < 0.05), else WORSE (Holm p_worse < 0.025), else NOT SHOWN. A cell can hold both an equivalence and
a significant worse line: COMPARABLE before WORSE, `worse_significant` beside every label, and such a cell worded "within 10%,
measurably worse" (amendment 1, A7).
"""
import math
from typing import Dict, List, Optional, Sequence

import numpy as np

B_DEFAULT = 10000
SEED = 20261122
BLOCK_DAYS = 5
SENSITIVITY_BLOCKS = (3, 10)
ALPHA_ONE_SIDED = 0.025
ALPHA_TOST = 0.05
MARGIN = 0.10
FLOOR_INITS = 50
FLOOR_VALID_DAYS = 50
FLOOR_BLOCKS = 10
FLOOR_CELLS = 100
FLOOR_DRIFTER_INITS = 200
TEST_INITS = 60
MAX_DROPPED_SHARE = 0.15


def block_counts(n: int, B=B_DEFAULT, block=BLOCK_DAYS, seed=SEED) -> np.ndarray:
    """C[b, i]: how many times date i (of n ordered dates) appears in replicate b. Moving blocks of `block` consecutive
    positions, ceil(n / block) blocks, truncated to n."""
    if n == 0:
        return np.zeros((B, 0))
    block = min(block, n)
    k = -(-n // block)
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, n - block + 1, size=(B, k))
    idx = (starts[:, :, None] + np.arange(block)).reshape(B, k * block)[:, :n]
    C = np.zeros((B, n))
    np.add.at(C, (np.repeat(np.arange(B), n), idx.ravel()), 1.0)
    return C


def per_date(dates, values, weights=None):
    """(ordered unique dates, per-date sum of values, per-date count) over finite values."""
    dates = np.asarray(dates)
    values = np.asarray(values, float)
    ok = np.isfinite(values)
    u, inv = np.unique(dates[ok], return_inverse=True)
    s = np.bincount(inv, weights=values[ok], minlength=u.size)
    c = np.bincount(inv, minlength=u.size).astype(float)
    return u, s, c


def holm(pvals: Sequence[float]) -> List[float]:
    p = np.asarray(pvals, float)
    m = p.size
    if m == 0:
        return []
    order = np.argsort(p, kind="stable")
    adj = np.empty(m)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p[i]))
        adj[i] = running
    return adj.tolist()


def _metric(kind, s, c):
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.sqrt(s / c) if kind == "rmse" else s / c


def paired_line(dates, arm_vals, base_vals, kind="rmse", B=B_DEFAULT, block=BLOCK_DAYS, seed=SEED, margin=MARGIN):
    """One line on rows where both values are finite. `arm_vals`, `base_vals`: squared errors (kind rmse) or the values whose
    mean is the metric (kind mean). Returns point estimates, CIs, one-sided p-values and the TOST p-value."""
    dates = np.asarray(dates)
    a, b = np.asarray(arm_vals, float), np.asarray(base_vals, float)
    ok = np.isfinite(a) & np.isfinite(b)
    dates, a, b = dates[ok], a[ok], b[ok]
    days = np.unique(dates)
    n = days.size
    if n == 0:
        return {"rows": 0, "dates": 0}
    pos = np.searchsorted(days, dates)
    sa = np.bincount(pos, weights=a, minlength=n)
    sb = np.bincount(pos, weights=b, minlength=n)
    cn = np.bincount(pos, minlength=n).astype(float)
    ma, mb = _metric(kind, sa.sum(), cn.sum()), _metric(kind, sb.sum(), cn.sum())
    C = block_counts(n, B, block, seed)
    ra, rb = _metric(kind, C @ sa, C @ cn), _metric(kind, C @ sb, C @ cn)
    d = ra - rb
    with np.errstate(invalid="ignore", divide="ignore"):
        r = ra / rb - 1.0
    lo, hi = np.percentile(d, [2.5, 97.5])
    rlo, rhi = np.nanpercentile(r, [2.5, 97.5]) if np.isfinite(r).any() else (float("nan"),) * 2
    return {"rows": int(a.size), "dates": int(n), "blocks": int(n // block), "arm": float(ma), "base": float(mb),
            "diff": float(ma - mb), "diff_ci": [float(lo), float(hi)],
            "ratio": float(ma / mb - 1.0) if mb else float("nan"), "ratio_ci": [float(rlo), float(rhi)],
            "p_better": float(np.mean(d >= 0)), "p_worse": float(np.mean(d <= 0)),
            "p_tost": float(max(np.mean(r <= -margin), np.mean(r >= margin)))}


def halves_ok(dates, init_index, arm_vals, base_vals, kind="rmse", test_inits=TEST_INITS):
    """BETTER's stability rule: the effect has the pooled sign with at least half its size in both halves of TEST (inits
    0-29 and 30-59 of the 60 calendar inits; descriptive, no test)."""
    a, b = np.asarray(arm_vals, float), np.asarray(base_vals, float)
    ii = np.asarray(init_index)
    ok = np.isfinite(a) & np.isfinite(b)
    m = lambda x: _metric(kind, np.nansum(x), np.isfinite(x).sum())
    pooled = m(a[ok]) - m(b[ok])
    if not np.isfinite(pooled) or pooled == 0:
        return False
    for half in (ii < test_inits // 2, ii >= test_inits // 2):
        k = ok & half
        if not k.any():
            return False
        e = m(a[k]) - m(b[k])
        if not (np.sign(e) == np.sign(pooled) and abs(e) >= 0.5 * abs(pooled)):
            return False
    return True


def label_family(cells: Dict[str, dict]) -> Dict[str, dict]:
    """Holm within the arm's families (better, worse, equivalence) over `cells` {key: line + {"halves": bool,
    "insufficient": bool}}; adds holm_* and the label. Insufficient cells take no part in the families."""
    keys = [k for k, c in cells.items() if not c.get("insufficient") and c.get("dates")]
    hb = dict(zip(keys, holm([cells[k]["p_better"] for k in keys])))
    hw = dict(zip(keys, holm([cells[k]["p_worse"] for k in keys])))
    he = dict(zip(keys, holm([cells[k]["p_tost"] for k in keys])))
    out = {}
    for k, c in cells.items():
        c = dict(c)
        if k not in hb:
            c["label"] = "NOT SHOWN"
            out[k] = c
            continue
        c.update(holm_better=hb[k], holm_worse=hw[k], holm_tost=he[k], worse_significant=hw[k] < ALPHA_ONE_SIDED)
        if hb[k] < ALPHA_ONE_SIDED and c.get("halves"):
            c["label"] = "BETTER"
        elif he[k] < ALPHA_TOST:
            c["label"] = "COMPARABLE"
            if c["worse_significant"]:              # amendment 1 (A7): the credit words it this way
                c["wording"] = "within 10%, measurably worse"
        elif hw[k] < ALPHA_ONE_SIDED:
            c["label"] = "WORSE"
        else:
            c["label"] = "NOT SHOWN"
        out[k] = c
    return out


def skill_family(cells: Dict[str, dict]) -> Dict[str, dict]:
    """G3: "forecast skill" at a cell only where the arm beats its own PERSIST_<src> (Holm p_better < 0.025 in the arm's
    own family per metric)."""
    keys = [k for k, c in cells.items() if not c.get("insufficient") and c.get("dates")]
    hb = dict(zip(keys, holm([cells[k]["p_better"] for k in keys])))
    return {k: dict(c, holm_better=hb.get(k), skilful=bool(k in hb and hb[k] < ALPHA_ONE_SIDED)) for k, c in cells.items()}


def floors(kept_inits: int, valid_days: Dict[str, int], units: Optional[int], unit_floor: int, block=BLOCK_DAYS):
    """Which floors a region/zone cell misses (empty = all met). `valid_days` per lead day; `units` = qualifying cells or
    drifter-inits."""
    miss = []
    if kept_inits < FLOOR_INITS:
        miss.append(f"kept inits {kept_inits} < {FLOOR_INITS}")
    for lead, nd in valid_days.items():
        if nd < FLOOR_VALID_DAYS:
            miss.append(f"{lead}: valid days {nd} < {FLOOR_VALID_DAYS}")
        if nd // block < FLOOR_BLOCKS:
            miss.append(f"{lead}: {nd // block} five-day blocks < {FLOOR_BLOCKS}")
    if units is not None and units < unit_floor:
        miss.append(f"units {units} < {unit_floor}")
    return miss


def run_void(dropped_inits: int, total=TEST_INITS) -> Optional[str]:
    if dropped_inits > MAX_DROPPED_SHARE * total:
        return f"{dropped_inits} of {total} inits dropped after pass 2 (> {int(MAX_DROPPED_SHARE * 100)}%): run VOID"
    return None


def arm_void(kept_inits: int) -> Optional[str]:
    if kept_inits < FLOOR_INITS:
        return f"{kept_inits} kept inits < {FLOOR_INITS}: arm VOID (other arms unaffected)"
    return None


def mean_ci(dates, values, B=B_DEFAULT, block=BLOCK_DAYS, seed=SEED):
    """Mean and its block-bootstrap 95% CI over dates (the speed-ME and direction-error tests of the controls)."""
    u, s, c = per_date(dates, values)
    if u.size == 0:
        return float("nan"), [float("nan"), float("nan")]
    C = block_counts(u.size, B, block, seed)
    with np.errstate(invalid="ignore", divide="ignore"):
        reps = (C @ s) / (C @ c)
    lo, hi = np.nanpercentile(reps, [2.5, 97.5])
    return float(s.sum() / c.sum()), [float(lo), float(hi)]


def ci_excludes_zero(ci) -> bool:
    return (ci[0] > 0 and ci[1] > 0) or (ci[0] < 0 and ci[1] < 0)


def ci_contains(ci, x, tol=1e-9) -> bool:
    return ci[0] - tol <= x <= ci[1] + tol


def is_finite(x) -> bool:
    return x is not None and math.isfinite(x)
