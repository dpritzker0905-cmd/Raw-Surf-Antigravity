"""wind_lr2_stats.py - statistics, families, gatekeeping, floors and controls for the long-range wind v2 registration.

Pure functions, unit-tested on synthetic rows; reads no data and scores nothing by itself. Registration sections 5-8:
moving 5-day blocks over valid dates, B = 10,000, seed 20261122, one-sided Holm-adjusted 0.025 (equivalent to the 95%
interval), families F1 (20 lines), F3 (6), F1c (CLIM_SERVE, gatekept), F6 (Holm across regions per arm/bin/comparator).
"""
import math
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

SEED = 20261122
REPS = 10_000
BLOCK_DAYS = 5
ALPHA_ONE_SIDED = 0.025
CAL_ARMS = ("GRAND_CAL", "AIGEFS_CAL")
SERVE_ARM = "CLIM_SERVE"
METRICS = ("M1", "M2")
# comparator-bin cells per tail: ICON tail is judged against LOOP_PROXY, the EURO tail against GFS (lead > 240 h only)
TAIL_CELLS = {"ICON": [("LOOP_PROXY", "B1"), ("LOOP_PROXY", "B2"), ("LOOP_PROXY", "B3")],
              "EURO": [("GFS", "B2>240"), ("GFS", "B3")]}


# ---------------------------------------------------------------------------------------------- bootstrap
def day_arrays(diff: np.ndarray, days: np.ndarray):
    """Per calendar valid day (contiguous from the first to the last): (sum of diff, count). NaN rows dropped."""
    ok = np.isfinite(diff)
    diff, days = np.asarray(diff)[ok], np.asarray(days)[ok].astype(int)
    if diff.size == 0:
        return np.zeros(0), np.zeros(0)
    lo, hi = int(days.min()), int(days.max())
    sums = np.zeros(hi - lo + 1)
    cnts = np.zeros(hi - lo + 1)
    np.add.at(sums, days - lo, diff)
    np.add.at(cnts, days - lo, 1.0)
    return sums, cnts


def moving_block_means(sums: np.ndarray, cnts: np.ndarray, reps: int = REPS, seed: int = SEED,
                       block: int = BLOCK_DAYS) -> np.ndarray:
    """Bootstrap distribution of the mean: moving (overlapping) blocks of `block` consecutive days, resampled with
    replacement until the original number of days is covered."""
    nd = len(sums)
    if nd == 0:
        return np.full(reps, np.nan)
    block = max(1, min(block, nd))
    ns = nd - block + 1
    draws = int(math.ceil(nd / block))
    cs, cc = np.concatenate([[0.0], np.cumsum(sums)]), np.concatenate([[0.0], np.cumsum(cnts)])
    bs, bc = cs[block:] - cs[:-block], cc[block:] - cc[:-block]       # per start day
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, ns, size=(reps, draws))
    tot_c = bc[pick].sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(tot_c > 0, bs[pick].sum(axis=1) / tot_c, np.nan)


def paired_line(diff: np.ndarray, days: np.ndarray, reps: int = REPS, seed: int = SEED) -> dict:
    """One tested line (arm minus comparator, negative = better). p is one-sided for 'mean < 0' with the +1 rule;
    ci is the two-sided 95% percentile interval (the reporting interval, equivalent to one-sided 0.025)."""
    sums, cnts = day_arrays(diff, days)
    n = int(cnts.sum())
    if n == 0:
        return {"mean": float("nan"), "ci": [float("nan")] * 2, "p": 1.0, "n": 0, "days": 0}
    boot = moving_block_means(sums, cnts, reps, seed)
    boot = boot[np.isfinite(boot)]
    mean = float(sums.sum() / cnts.sum())
    p = (float(np.sum(boot >= 0.0)) + 1.0) / (len(boot) + 1.0)
    return {"mean": mean, "ci": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))], "p": p, "n": n,
            "days": int((cnts > 0).sum())}


def holm_adjust(p: Sequence[float]) -> List[float]:
    """Holm step-down adjusted p-values (monotone, capped at 1), in the input order."""
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i])
    adj = [0.0] * m
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, (m - rank) * p[i])
        adj[i] = min(1.0, run)
    return adj


# ---------------------------------------------------------------------------------------------- families
def f1_lines(arms: Sequence[str] = CAL_ARMS) -> List[Tuple[str, str, str, str]]:
    """F1 (G1 + G2): (arm, metric, comparator, bin cell). 2 arms x 2 metrics x 5 cells = 20 lines."""
    cells = [c for tail in ("ICON", "EURO") for c in TAIL_CELLS[tail]]
    return [(a, m, comp, b) for a in arms for m in METRICS for comp, b in cells]


def f3_lines(arms: Sequence[str] = CAL_ARMS) -> List[Tuple[str, str]]:
    """F3 (G3): (arm, bin) on M1 against CLIM. B1/B2 'beat'; B3 is the reverse-direction line ('not worse')."""
    return [(a, b) for a in arms for b in ("B1", "B2", "B3")]


def f1c_lines(tail: str) -> List[Tuple[str, str, str, str]]:
    """F1c: CLIM_SERVE lines for ONE tail: 2 metrics x that tail's cells (ICON 6, EURO 4)."""
    return [(SERVE_ARM, m, comp, b) for m in METRICS for comp, b in TAIL_CELLS[tail]]


def adjust_family(lines: Dict[tuple, dict]) -> Dict[tuple, dict]:
    """Attach p_adj (Holm within the dict) and sig (p_adj <= 0.025) to each line result."""
    keys = list(lines)
    adj = holm_adjust([lines[k]["p"] for k in keys])
    return {k: dict(lines[k], p_adj=a, sig=bool(a <= ALPHA_ONE_SIDED)) for k, a in zip(keys, adj)}


def b3_not_worse(diff: np.ndarray, days: np.ndarray, reps: int = REPS, seed: int = SEED) -> dict:
    """F3's B3 line: the arm is NOT significantly worse than CLIM. One-sided test of 'mean > 0'; the line holds
    (ok) when that test is not significant."""
    r = paired_line(-np.asarray(diff, float), days, reps, seed)     # mean < 0 here means arm worse
    return dict(r, p=r["p"])


def tail_passes(arm: str, tail: str, f1: Dict[tuple, dict], f3: Dict[tuple, dict], g4: bool, g5: bool, g6: bool) -> bool:
    """A calibrated arm passes a tail when every F1 line of that tail is significant, all F3 lines hold (B1, B2
    significant; B3 not significantly worse), and G4-G6 hold."""
    for comp, b in TAIL_CELLS[tail]:
        for m in METRICS:
            r = f1.get((arm, m, comp, b))
            if r is None or not r.get("sig"):
                return False
    for b in ("B1", "B2"):
        r = f3.get((arm, b))
        if r is None or not r.get("sig"):
            return False
    r3 = f3.get((arm, "B3"))
    if r3 is None or r3.get("sig"):         # sig on the reverse-direction line = significantly worse
        return False
    return bool(g4 and g5 and g6)


def tail_decision(tail: str, calibrated: Dict[str, bool], clim_serve: Optional[bool]) -> str:
    """Per tail, order of preference GRAND_CAL, AIGEFS_CAL, then CLIM_SERVE (only if both calibrated arms fail).
    `clim_serve` is None when it was not tested (a calibrated arm passed): reported descriptively only."""
    if calibrated.get("GRAND_CAL"):
        return "GRAND_CAL"
    if calibrated.get("AIGEFS_CAL"):
        return "AIGEFS_CAL"
    if clim_serve is None:
        return "NONE"           # gatekeeping not opened by the caller: nothing passed, nothing ships
    return SERVE_ARM if clim_serve else "NONE"


def gate_open_for_clim_serve(calibrated: Dict[str, bool]) -> bool:
    """CLIM_SERVE is tested for a tail only when BOTH calibrated arms failed it."""
    return not any(calibrated.get(a) for a in CAL_ARMS)


# ---------------------------------------------------------------------------------------------- floors
MIN_TEST_RUNS = 80
MIN_VALID_DAYS = 45
MIN_BLOCKS = 9
MAX_DROPPED_FRAC = 0.10
TOTAL_TEST_RUNS = 90
MIN_STATIONS_PER_REGION = 10
MIN_REGIONS_WITH_STATIONS = 3
MIN_STATION_COVER = 0.70


def block_count(days: np.ndarray, block: int = BLOCK_DAYS) -> int:
    d = np.asarray(days).astype(int)
    return int(len(np.unique(d // block))) if d.size else 0


def check_floors(kept_runs: int, valid_days: np.ndarray, stations_by_region: Dict[str, int],
                 total_runs: int = TOTAL_TEST_RUNS) -> List[str]:
    """Reasons the run is VOID (empty = floors met). A missed floor is VOID, never FAIL."""
    out = []
    if kept_runs < MIN_TEST_RUNS:
        out.append(f"kept TEST runs {kept_runs} < {MIN_TEST_RUNS}")
    if (total_runs - kept_runs) / float(total_runs) > MAX_DROPPED_FRAC:
        out.append(f"more than {int(MAX_DROPPED_FRAC * 100)}% of TEST runs dropped ({total_runs - kept_runs}/{total_runs})")
    nd = len(np.unique(np.asarray(valid_days).astype(int)))
    if nd < MIN_VALID_DAYS:
        out.append(f"distinct valid days {nd} < {MIN_VALID_DAYS}")
    nb = block_count(valid_days)
    if nb < MIN_BLOCKS:
        out.append(f"five-day blocks {nb} < {MIN_BLOCKS}")
    ok_regions = sum(1 for n in stations_by_region.values() if n >= MIN_STATIONS_PER_REGION)
    if ok_regions < MIN_REGIONS_WITH_STATIONS:
        out.append(f"regions with >= {MIN_STATIONS_PER_REGION} covered stations: {ok_regions} < {MIN_REGIONS_WITH_STATIONS}")
    return out


# ---------------------------------------------------------------------------------------------- controls (pure)
def plant_speed(speed: np.ndarray, delta: float = 1.0) -> np.ndarray:
    return np.asarray(speed, float) + delta


def plant_direction(direction: np.ndarray, degrees: float, frac: float = 0.15, seed: int = SEED) -> Tuple[np.ndarray, np.ndarray]:
    """Rotate `degrees` on the same random `frac` of rows (fixed seed). Returns (new direction, mask)."""
    d = np.asarray(direction, float)
    rng = np.random.default_rng(seed)
    mask = rng.random(d.shape[0]) < frac
    return np.where(mask, (d + degrees) % 360.0, d), mask


def shuffled_pairing_index(init_days: np.ndarray, shift_days: int = 7) -> np.ndarray:
    """For each forecast row (by init day), the init day whose truth it is paired with: init + shift (within TEST; rows
    whose shifted init does not exist are marked -1 by the caller)."""
    return np.asarray(init_days).astype(int) + int(shift_days)


def signed_dir_me(fc_dir: np.ndarray, obs_dir: np.ndarray, obs_speed: np.ndarray, min_speed: float = 3.0) -> float:
    """Mean signed circular direction error (forecast minus observed, degrees) over rows with obs speed >= min."""
    fc, ob, sp = (np.asarray(a, float) for a in (fc_dir, obs_dir, obs_speed))
    ok = np.isfinite(fc) & np.isfinite(ob) & (sp >= min_speed)
    if not ok.any():
        return float("nan")
    return float(np.mean((fc[ok] - ob[ok] + 180.0) % 360.0 - 180.0))
