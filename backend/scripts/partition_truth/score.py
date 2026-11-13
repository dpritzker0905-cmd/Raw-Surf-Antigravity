"""Pure scoring: observed trains vs model trains vs persistence, with day-block bootstrap intervals. No network."""
import math
from collections import defaultdict
from typing import Dict, List, Optional, Sequence

import numpy as np

from scripts.partition_truth.partitioner import angdiff

BLOCK_DAYS = 3
N_BOOT = 2000


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def station_blocks(pos: Dict[str, tuple], radius_km: float = 500.0) -> Dict[str, int]:
    """Complete-linkage clusters of stations: every pair inside a block is within radius_km. Swell is coherent over
    hundreds of km, so nearby buoys are NOT independent samples; the number of blocks is the honest station count."""
    ids = sorted(pos)
    clusters = [[s] for s in ids]
    while True:
        best = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = max(haversine_km(pos[a], pos[b]) for a in clusters[i] for b in clusters[j])
                if d <= radius_km and (best is None or d < best[0]):
                    best = (d, i, j)
        if best is None:
            break
        _, i, j = best
        clusters[i] += clusters[j]
        del clusters[j]
    return {s: k for k, c in enumerate(clusters) for s in c}


def _err(kind: str, model, obs) -> Optional[float]:
    """Signed error model - obs. Direction: signed circular difference in degrees; period seconds; height metres."""
    if model is None or obs is None:
        return None
    if kind == "dir":
        return float(angdiff(model, obs))
    return float(model - obs)


def block_bootstrap_ci(values: Sequence[float], days: Sequence[str], block: int = BLOCK_DAYS, n_boot: int = N_BOOT,
                       seed: int = 0, alpha: float = 0.05):
    """95% CI of the mean of `values`, resampling runs of `block` consecutive UTC days together (all stations on a day
    share the weather, so the day is the unit; consecutive days share swell trains, hence the block)."""
    v = np.asarray(values, float)
    uniq = sorted(set(days))
    if len(uniq) < 2 * block:
        return None
    by_day = defaultdict(list)
    for x, d in zip(v, days):
        by_day[d].append(x)
    n_blocks = len(uniq) - block + 1
    rng = np.random.default_rng(seed)
    need = int(math.ceil(len(uniq) / block))
    means = []
    for _ in range(n_boot):
        starts = rng.integers(0, n_blocks, size=need)
        samp = [x for s in starts for d in uniq[s:s + block] for x in by_day[d]]
        means.append(float(np.mean(samp)))
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def summarize(rows: List[Dict], metric: str, blocks: Dict[str, int]) -> Dict:
    """rows: {'station','day','model_err','persist_err'} absolute-error inputs are signed errors; MAE and the paired
    difference |model| - |persistence| (negative = model better) with a block-bootstrap interval."""
    if not rows:
        return {"n": 0}
    me = np.array([r["model_err"] for r in rows])
    pe = np.array([r["persist_err"] for r in rows])
    days = [r["day"] for r in rows]
    diff = np.abs(me) - np.abs(pe)
    out = {"n": len(rows), "n_stations": len({r["station"] for r in rows}),
           "n_station_blocks": len({blocks.get(r["station"]) for r in rows}), "n_days": len(set(days)),
           "mae_model": float(np.mean(np.abs(me))), "mae_persistence": float(np.mean(np.abs(pe))),
           "bias_model": float(np.mean(me)), "bias_persistence": float(np.mean(pe)),
           "mean_diff_model_minus_persistence": float(np.mean(diff)),
           "model_wins": float(np.mean(diff < 0)), "ci95_diff": block_bootstrap_ci(diff, days)}
    if metric == "dir":
        out["mae_model_if_flipped_180"] = float(np.mean(np.abs(angdiff(me + 180.0, 0.0))))
    return out
