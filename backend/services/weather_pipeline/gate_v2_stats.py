"""gate_v2_stats.py - the statistics of validation gates v2. PURE, stdlib only (the gate job installs nothing).

Every function REFUSES (returns None) rather than inventing a number from too little data: a p-value from four hours
or a variance of zero is indistinguishable from a real result, which is the ledger's oldest rule (forecast_skill).

Contents, with the reference each follows:
  * point metrics: bias, MAE, RMSE, the ledger's de-biased scatter index SI = rms(e - bias) / mean(obs)
    (forecast_skill.verification_metrics), and the Hanna & Heinold (1985) HH = sqrt(sum e^2 / sum f*o), which
    Mentaschi et al. (2013) recommend because RMSE and NRMSE can favour a forecast biased low;
  * CRPS: the ensemble form (Gneiting & Raftery 2007, eq. 21) and the Gaussian closed form; a point forecast's CRPS
    is its absolute error, so CRPS and MAE share units and compare directly;
  * the loss-differential SERIES: per target hour, the mean over buoys of loss(ref) - loss(cand);
  * the dependence rule (autocorrelation band), the Newey-West HAC variance (Bartlett), the Diebold-Mariano (1995)
    test with the Harvey-Leybourne-Newbold (1997) factor;
  * the moving-block bootstrap (Kunsch 1989), seeded;
  * Holm (1979) step-down and Benjamini-Hochberg (1995) step-up adjustments.
"""
import math
import random
from typing import Callable, Dict, List, Optional, Sequence


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


# ---- point metrics ------------------------------------------------------------------------------------------------
def point_metrics(fc: Sequence[float], obs: Sequence[float], min_shape_n: int = 10) -> Optional[dict]:
    """bias, mae, rmse, si, hh, nbias over finite (fc, obs) pairs. Shape metrics (si, hh) are None below
    `min_shape_n` or on a zero denominator, never 0."""
    fo = [(f, o) for f, o in zip(fc, obs) if _num(f) and _num(o)]
    n = len(fo)
    if n == 0:
        return None
    e = [f - o for f, o in fo]
    bias = mean(e)
    mo = mean([o for _, o in fo])
    out = {"n": n, "mean_obs": mo, "bias": bias, "mae": mean([abs(x) for x in e]),
           "rmse": math.sqrt(mean([x * x for x in e])), "si": None, "hh": None,
           "nbias": bias / mo if mo > 0 else None}
    if n >= min_shape_n:
        if mo > 0:
            out["si"] = math.sqrt(mean([(x - bias) ** 2 for x in e])) / mo
        fo_sum = sum(f * o for f, o in fo)
        if fo_sum > 0:
            out["hh"] = math.sqrt(sum(x * x for x in e) / fo_sum)
    return out


def crps_ensemble(members: Sequence[float], obs: float) -> Optional[float]:
    """CRPS of an equally weighted ensemble: mean|x_i - y| - 0.5 * mean|x_i - x_j|. One member = absolute error."""
    xs = [x for x in members if _num(x)]
    if not xs or not _num(obs):
        return None
    m = len(xs)
    spread = sum(abs(a - b) for a in xs for b in xs) / (m * m)
    return mean([abs(x - obs) for x in xs]) - 0.5 * spread


def crps_gaussian(mu: float, sigma: float, obs: float) -> Optional[float]:
    """Closed-form CRPS of N(mu, sigma^2) at y (Gneiting & Raftery 2007). sigma <= 0 is the point forecast |mu - y|."""
    if not (_num(mu) and _num(sigma) and _num(obs)):
        return None
    if sigma <= 0:
        return abs(mu - obs)
    z = (obs - mu) / sigma
    pdf = math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    return sigma * (z * (2 * normal_cdf(z) - 1) + 2 * pdf - 1 / math.sqrt(math.pi))


# ---- losses and the differential series ----------------------------------------------------------------------------
LOSSES: Dict[str, Callable[[float], float]] = {"abs": abs, "sq": lambda e: e * e}


def differential_series(items: Sequence[dict], loss: str = "abs") -> List[float]:
    """Per target hour (sorted), the mean over that hour's pairs of loss(e_ref) - loss(e_cand). Positive = the
    candidate is closer. Averaging across buoys first is the panel form of the DM test: the cross-sectional mean
    carries the hour's common weather, and the HAC variance then handles the serial dependence between hours."""
    fn = LOSSES[loss]
    by_t: Dict[object, List[float]] = {}
    for it in items:
        by_t.setdefault(it["t"], []).append(fn(it["f_ref"] - it["obs"]) - fn(it["f_cand"] - it["obs"]))
    return [mean(v) for _, v in sorted(by_t.items(), key=lambda kv: kv[0])]


def series_by_time(items: Sequence[dict], value: Callable[[dict], float]) -> List[float]:
    """Per target hour (sorted), the mean of value(item) over that hour's pairs."""
    by_t: Dict[object, List[float]] = {}
    for it in items:
        by_t.setdefault(it["t"], []).append(value(it))
    return [mean(v) for _, v in sorted(by_t.items(), key=lambda kv: kv[0])]


# ---- dependence --------------------------------------------------------------------------------------------------
def autocorr(x: Sequence[float], k: int) -> Optional[float]:
    n = len(x)
    if k <= 0 or k >= n:
        return None
    m = mean(x)
    den = sum((v - m) ** 2 for v in x)
    if den <= 0:
        return None
    return sum((x[i] - m) * (x[i + k] - m) for i in range(n - k)) / den


def first_insignificant_lag(x: Sequence[float], max_frac: float = 0.25) -> int:
    """The first lag k >= 1 whose |autocorrelation| sits inside the white-noise band 2/sqrt(T). A flat series (no
    variance) or one that never enters the band returns the search cap."""
    n = len(x)
    cap = max(1, int(n * max_frac))
    band = 2.0 / math.sqrt(n) if n else 1.0
    for k in range(1, cap + 1):
        r = autocorr(x, k)
        if r is None:
            return k
        if abs(r) < band:
            return k
    return cap


def dependence(x: Sequence[float], max_frac: float = 0.25) -> dict:
    """{k, block, hac_lag, T, rule}: the stated rule (gate_v2_config) applied to series x."""
    n = len(x)
    k = first_insignificant_lag(x, max_frac)
    cap = max(1, int(n * max_frac))
    block = min(cap, max(k, math.ceil(n ** (1.0 / 3.0)) if n else 1))
    hac = max(k - 1, int(math.floor(4 * (n / 100.0) ** (2.0 / 9.0)))) if n else 0
    return {"T": n, "k": k, "block": block, "hac_lag": min(hac, max(0, n - 2)),
            "rule": "k = first lag with |acf| < 2/sqrt(T); block = max(k, ceil(T^(1/3))) <= T/4; "
                    "HAC lag = max(k-1, floor(4 (T/100)^(2/9)))"}


def newey_west_lrv(x: Sequence[float], lag: int) -> Optional[float]:
    """Long-run variance of x with Bartlett weights 1 - j/(lag+1): gamma_0 + 2 sum w_j gamma_j. None if <= 0."""
    n = len(x)
    if n < 2:
        return None
    m = mean(x)
    d = [v - m for v in x]

    def gamma(j):
        return sum(d[i] * d[i + j] for i in range(n - j)) / n

    lrv = gamma(0) + 2 * sum((1 - j / (lag + 1)) * gamma(j) for j in range(1, min(lag, n - 1) + 1))
    return lrv if lrv > 0 else None


def normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def diebold_mariano(d: Sequence[float], lag: int, min_len: int = 20) -> Optional[dict]:
    """DM test on the loss differential d (positive = candidate better), HAC variance with `lag`, HLN factor with
    h = lag + 1, normal reference (T is in the hundreds where this gate decides; the HLN factor carries the small-T
    correction). Returns {stat, p_better (one-sided: E d > 0), p_worse (E d < 0), p_two, mean, T, lag}."""
    n = len(d)
    if n < min_len:
        return None
    lrv = newey_west_lrv(d, lag)
    if lrv is None:
        return None
    h = lag + 1
    hln_sq = (n + 1 - 2 * h + h * (h - 1) / n) / n
    if hln_sq <= 0:
        return None
    stat = mean(d) / math.sqrt(lrv / n) * math.sqrt(hln_sq)
    p_better = 1.0 - normal_cdf(stat)
    p_worse = normal_cdf(stat)
    return {"stat": stat, "p_better": p_better, "p_worse": p_worse, "p_two": min(1.0, 2 * min(p_better, p_worse)),
            "mean": mean(d), "T": n, "lag": lag}


def block_bootstrap(x: Sequence[float], block: int, reps: int = 2000, seed: int = 0, level: float = 0.95,
                    stat: Callable[[Sequence[float]], float] = mean, min_len: int = 20) -> Optional[dict]:
    """Moving-block bootstrap of stat(x): blocks of `block` consecutive values, starts uniform on [0, T - block],
    concatenated and cut to T. Percentile CI at `level`; `share_le_0` = the share of resampled stats <= 0."""
    n = len(x)
    if n < min_len or block < 1:
        return None
    block = min(block, n)
    rng = random.Random(seed)
    starts = n - block + 1
    vals = []
    for _ in range(reps):
        out: List[float] = []
        while len(out) < n:
            s = rng.randrange(starts)
            out.extend(x[s:s + block])
        vals.append(stat(out[:n]))
    vals.sort()
    a = (1.0 - level) / 2.0
    lo = vals[max(0, int(math.floor(a * reps)))]
    hi = vals[min(reps - 1, int(math.ceil((1.0 - a) * reps)) - 1)]
    return {"estimate": stat(x), "lo": lo, "hi": hi, "level": level, "block": block, "reps": reps,
            "share_le_0": sum(1 for v in vals if v <= 0) / reps}


# ---- multiple comparisons ----------------------------------------------------------------------------------------
def holm(pvals: Sequence[float]) -> List[float]:
    """Holm step-down adjusted p-values (family-wise error), in input order."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    adj = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvals[i]))
        adj[i] = running
    return adj


def benjamini_hochberg(pvals: Sequence[float]) -> List[float]:
    """BH step-up q-values (false discovery rate), in input order."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i], reverse=True)
    adj = [0.0] * m
    running = 1.0
    for idx, i in enumerate(order):
        rank = m - idx
        running = min(running, pvals[i] * m / rank)
        adj[i] = min(1.0, running)
    return adj
