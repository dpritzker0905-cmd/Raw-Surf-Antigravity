"""eval_twoway.py - the flip gate's BINDING uncertainty rule: a two-way (spatial block x UTC day) bootstrap of the
mean loss gain, and the null-calibration self-test without which the harness refuses to run. PURE (stdlib only).

WHY (D-066; research round 6 item 1, 2026-11-03): daily gains at nearby buoys are strongly correlated (rho 0.72-0.75;
the 11 SoCal Bight NDBC buoys behave like ~1.3 independent stations). On 400 sign-flip null sets the station-cluster
bootstrap the gate used (binding at >= 10 stations, CLUSTER_BINDING_MIN) falsely PASSED 31-35% of the time (nominal
2.5% one-sided); a two-way spatial block x day bootstrap falsely passed 0-6.3%. Stations are not the independent
unit; days and regions are.

THE RULE
  gain row   d = |served - obs| - |candidate - obs|        (positive = candidate better; the CRPS of a point forecast)
  blocks     complete-linkage clustering of the station coordinates (haversine km): start from singletons, merge the
             pair of clusters whose FARTHEST members are closest, while that distance is <= BLOCK_KM (100 km); ties by
             the clusters' first station id. Deterministic and order-free; every block's diameter is <= 100 km (single
             linkage would chain the whole coast into one block). A block is named by its first station id.
  days       the UTC date of the target (valid) time. Leads 24-72 h of one valid hour share its weather, so they
             share its day.
  bootstrap  pigeonhole (Owen 2007): block weights ~ Multinomial(G_b) and day weights ~ Multinomial(G_d), drawn
             independently; a row counts w_block x w_day times (exact through the block x day cell sums). SE = the SD
             of the replicate means.
  interval   mean +/- t(0.975, G_d - 1) * sqrt(G_d / (G_d - 1)) * SE: the small-sample correction on the day factor
             (with one block it is exactly the Student t interval of the day means). The percentile interval of the
             same replicates is reported too (it under-covers at 14 days: 5.3-6.3% false pass in round 6). A
             Satterthwaite df over both factors was tried in the build and rejected: with the two blocks of an arm
             scoped to the Bight it collapses to df ~1.4 (t ~7), so no regional fix could ever pass.
  scope      stations where the candidate changes no row are left out (their gain is 0 by construction).
  binding    PASS needs the interval's lower bound > 0 over at least MIN_DAYS (14) distinct UTC target days; fewer
             days = not computable = REFUSED (never PASS). The station-cluster CI stays in the scorecard, advisory.

SELF-TEST (`null_calibration`, `self_test`): synthetic random-effects nulls with mean 0 - DAY shocks shared by every
station (the measured failure), BLOCK x DAY shocks, a DAILY smooth field (station correlation exp(-d / BLOCK_KM)) and
a MIXED time-varying one - each must falsely pass <= MAX_FALSE_PASS (5%), and a known positive effect
(POWER_EFFECT_SD x the SD of the mixed null mean) must pass >= MIN_POWER (80%). Persistent nulls (a fixed block or
station effect, a persistent smooth field) are reported as advisory_nulls (see PERSISTENT). `self_test` runs on a
canonical 12-station / 4-block / 14-day layout, once per process; `eval_harness.run` refuses (CalibrationFailed)
before any download if it fails. The harness also calibrates each run's OWN layout (blocks, days, row counts) and
makes the controls fail (every verdict INVALID) if that fails.

LIMIT (stated, not hidden): a PERSISTENT spatially smooth effect longer than the blocks (one sign over a whole coast,
fixed across days) is indistinguishable from a real regional improvement at these stations; the rule treats it as
the estimand. Measured in the build: a persistent exp(-d/250 km) field falsely passes 15-20% at 100 km blocks and
7-9% at 250 km blocks; a daily one 0.25-1.5% at either. `null_calibration` reports it as `advisory_nulls`.
"""
import functools
import math
import operator
import random
from typing import Dict, List, Optional, Sequence, Tuple

BLOCK_KM = 100.0
MIN_DAYS = 14
LEVEL = 0.95
MAX_FALSE_PASS = 0.05
MIN_POWER = 0.80
POWER_EFFECT_SD = 4.0
EARTH_KM = 6371.0088
UNLOCATED = "unlocated"


class CalibrationFailed(ValueError):
    """The two-way rule did not hold its false-pass rate (or its power) on synthetic nulls: the gate cannot run."""


# ---- geometry ---------------------------------------------------------------------------------------------------
def hav_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    la1, lo1 = map(math.radians, a)
    la2, lo2 = map(math.radians, b)
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return EARTH_KM * 2 * math.asin(math.sqrt(min(1.0, h)))


def spatial_blocks(coords: Dict[str, Tuple[float, float]], km: float = BLOCK_KM) -> Dict[str, str]:
    """{station: block} by complete linkage at `km` (see the module doc). Stations without coordinates share the
    block UNLOCATED (one block: the conservative choice)."""
    located = {s: c for s, c in coords.items() if c is not None and None not in c}
    cl = [[s] for s in sorted(located)]
    dist = {}

    def d(a, b):
        k = (a, b) if a < b else (b, a)
        if k not in dist:
            dist[k] = hav_km(located[a], located[b])
        return dist[k]
    while True:
        best = None
        for i in range(len(cl)):
            for j in range(i + 1, len(cl)):
                far = max(d(a, b) for a in cl[i] for b in cl[j])
                key = (far, cl[i][0], cl[j][0])
                if far <= km and (best is None or key < best[0]):
                    best = (key, i, j)
        if best is None:
            break
        _, i, j = best
        cl[i] = sorted(cl[i] + cl[j])
        del cl[j]
    out = {s: c[0] for c in cl for s in c}
    out.update({s: UNLOCATED for s in coords if s not in located})
    return out


# ---- Student t quantile (no scipy in the harness) ---------------------------------------------------------------
def _betacf(a, b, x):
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 400):
        m2 = 2 * m
        for aa in (m * (b - m) * x / ((qam + m2) * (a + m2)), -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))):
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + aa / (c if abs(c) > tiny else tiny)
            h *= d * c
        if abs(d * c - 1.0) < 1e-15:
            break
    return h


def t_cdf(t: float, df: float) -> float:
    x = df / (df + t * t)
    a, b = df / 2.0, 0.5
    lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x) if 0 < x < 1 else None
    if lb is None:
        ib = 0.0 if x <= 0 else 1.0
    elif x < (a + 1) / (a + b + 2):
        ib = math.exp(lb) * _betacf(a, b, x) / a
    else:
        ib = 1.0 - math.exp(lb) * _betacf(b, a, 1.0 - x) / b
    return 1.0 - 0.5 * ib if t > 0 else 0.5 * ib


@functools.lru_cache(maxsize=512)
def t_quantile(p: float, df: float) -> float:
    """The p-quantile (p > 0.5) of Student t with df degrees of freedom, by bisection on t_cdf."""
    lo, hi = 0.0, 1000.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---- the bootstrap ----------------------------------------------------------------------------------------------
def _cells_ci(cells: Dict[tuple, Tuple[float, float]], reps: int, rng: random.Random, level: float = LEVEL) -> dict:
    """The two-way interval from {(block, day): (sum of d, rows)}."""
    B = sorted({b for b, _ in cells})
    D = sorted({d for _, d in cells})
    S = [[cells.get((b, d), (0.0, 0))[0] for d in D] for b in B]
    N = [[float(cells.get((b, d), (0.0, 0))[1]) for d in D] for b in B]
    nb, nd = len(B), len(D)
    tot_s, tot_n = sum(map(sum, S)), sum(map(sum, N))
    m = tot_s / tot_n
    mul = operator.mul
    vals = []
    for _ in range(reps):
        wb = [0] * nb
        for _ in range(nb):
            wb[rng.randrange(nb)] += 1
        wd = [0] * nd
        for _ in range(nd):
            wd[rng.randrange(nd)] += 1
        num = den = 0.0
        for i in range(nb):
            if wb[i]:
                num += wb[i] * sum(map(mul, wd, S[i]))
                den += wb[i] * sum(map(mul, wd, N[i]))
        if den > 0:
            vals.append(num / den)
    mu = sum(vals) / len(vals)
    se = math.sqrt(sum((v - mu) ** 2 for v in vals) / len(vals))

    # Small-sample correction on the DAY factor (14-21 days; the percentile interval under-covers there: 5.3-6.3%
    # false pass in round 6): Student t with G_d - 1 df and the G_d / (G_d - 1) variance factor. The block factor's
    # variance is in SE (the pigeonhole draws resample blocks), uncorrected: see PERSISTENT below.
    df = float(max(nd - 1, 1))
    fac = nd / (nd - 1) if nd > 1 else 1.0
    k = t_quantile(1 - (1 - level) / 2, df) * math.sqrt(fac)
    vals.sort()
    a = (1 - level) / 2
    pct = [vals[int(a * len(vals))], vals[min(len(vals) - 1, int((1 - a) * len(vals)))]]
    return {"mean": m, "se": se, "df": df, "factor": fac, "t": k / math.sqrt(fac),
            "ci": [m - k * se, m + k * se], "ci_percentile": pct, "blocks": nb, "days": nd, "reps": len(vals)}


def _gain(i: dict) -> float:
    return abs(i["f_ref"] - i["obs"]) - abs(i["f_cand"] - i["obs"])


def _day(t) -> str:
    return t.strftime("%Y-%m-%d") if hasattr(t, "strftime") else str(t)[:10]


def item_blocks(items: Sequence[dict], km: float = BLOCK_KM) -> Dict[str, str]:
    coords = {}
    for i in items:
        lat, lng = i.get("lat"), i.get("lng")
        coords.setdefault(i["buoy"], (lat, lng) if lat is not None and lng is not None else None)
    return spatial_blocks(coords, km)


def two_way_ci(items: Sequence[dict], reps: int = 2000, seed: int = 20261103, level: float = LEVEL,
               min_days: Optional[int] = None, km: float = BLOCK_KM) -> dict:
    """The BINDING interval of the mean gain over gate items (buoy, t, obs, f_ref, f_cand, lat, lng)."""
    min_days = MIN_DAYS if min_days is None else min_days
    # A station whose every row the candidate leaves unchanged (f_cand == f_ref) says nothing about the change: its
    # gain is 0 by construction. Kept, it would read as regional heterogeneity (an arm scoped to one region could
    # never pass); dropped before the blocks are formed. The scope is fixed by the INPUT change, not the outcome.
    moved = {i["buoy"] for i in items if i["f_cand"] != i["f_ref"]}
    untouched = sorted({i["buoy"] for i in items} - moved)
    items = [i for i in items if i["buoy"] in moved]
    blk = item_blocks(items, km)
    cells: Dict[tuple, list] = {}
    for i in items:
        c = cells.setdefault((blk[i["buoy"]], _day(i["t"])), [0.0, 0])
        c[0] += _gain(i)
        c[1] += 1
    days = sorted({d for _, d in cells})
    out = {"rule": f"two-way block x day, blocks complete-linkage <= {km:g} km, >= {min_days} UTC days",
           "binding": True, "computable": False, "n": len(items), "days": len(days), "min_days": min_days,
           "blocks": len(set(blk.values())), "block_of": blk, "ci": None, "mean": None,
           "unlocated": sorted(s for s, b in blk.items() if b == UNLOCATED), "untouched_stations": untouched}
    if not items:
        out["reason"] = "no paired items"
        return out
    if len(days) < min_days:
        out["reason"] = f"{len(days)} UTC target days < {min_days}: the two-way CI cannot be binding"
        return out
    r = _cells_ci({k: (v[0], v[1]) for k, v in cells.items()}, reps, random.Random(seed), level)
    out.update(r, computable=True, blocks=r["blocks"], reason="")
    return out


# ---- null calibration -------------------------------------------------------------------------------------------
NULLS = {   # sd of: day shock (all stations), block effect, station effect, block x day shock, daily smooth field, row
    "day": (1.0, 0.0, 0.0, 0.0, 0.0, 1.5),
    "block_x_day": (0.0, 0.0, 0.0, 1.0, 0.0, 1.5),
    "daily_field": (0.0, 0.0, 0.0, 0.0, 1.0, 1.5),
    "mixed": (0.7, 0.0, 0.0, 0.4, 0.3, 1.5),
    "block": (0.0, 1.0, 0.2, 0.0, 0.0, 1.5),
}
# TIME-VARYING nulls bind on every layout: noise that the next 14 days would not repeat. PERSISTENT ones (a fixed
# effect per block / station, or a persistent smooth field) are reported, advisory: the gate's estimand is the
# candidate's effect AT THESE STATIONS over future days, so a fixed regional difference is part of what is measured,
# not noise (a candidate that helps three blocks and hurts one has a real mean effect here). The block resampling
# still widens the interval for it; it does not make it a test of other regions. Measured in the build: the
# canonical 4-block layout falsely passes a pure persistent-block null ~4-9% (no day variance at all).
PERSISTENT = ("block",)
ADVISORY_NULLS = {"persistent_field": 1.0}       # a persistent exp(-d/BLOCK_KM) field (the stated LIMIT)


def _chol(A: List[List[float]]) -> List[List[float]]:
    n = len(A)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = A[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            L[i][j] = math.sqrt(max(s, 1e-12)) if i == j else s / L[j][j]
    return L


def _field(L, rng) -> List[float]:
    z = [rng.gauss(0.0, 1.0) for _ in L]
    return [sum(L[i][k] * z[k] for k in range(i + 1)) for i in range(len(L))]


class Layout:
    """A run's structure: rows per (station, day), each station's block and coordinates."""

    def __init__(self, rows: Dict[Tuple[str, str], int], block_of: Dict[str, str],
                 coords: Dict[str, Optional[Tuple[float, float]]]):
        self.rows, self.block_of = rows, block_of
        self.stations = sorted({s for s, _ in rows})
        self.days = sorted({d for _, d in rows})
        self.blocks = sorted({block_of[s] for s in self.stations})
        loc = [coords.get(s) for s in self.stations]
        C = [[(math.exp(-hav_km(a, b) / BLOCK_KM) if a and b else float(i == j)) for j, b in enumerate(loc)]
             for i, a in enumerate(loc)]
        self.chol = _chol(C)

    @classmethod
    def from_items(cls, items: Sequence[dict]) -> "Layout":
        rows: Dict[Tuple[str, str], int] = {}
        coords = {}
        for i in items:
            k = (i["buoy"], _day(i["t"]))
            rows[k] = rows.get(k, 0) + 1
            if i.get("lat") is not None and i.get("lng") is not None:
                coords[i["buoy"]] = (i["lat"], i["lng"])
        return cls(rows, item_blocks(items), coords)


def synth_cells(layout: Layout, comp: Tuple[float, ...], mu: float, rng: random.Random,
                persistent_field: float = 0.0) -> Dict[tuple, Tuple[float, float]]:
    """Block x day cell sums of one synthetic gain panel: mean mu plus mean-zero random effects (sds in comp)."""
    sa, sb, ss, sbd, sf, se = comp
    a = {d: rng.gauss(0, sa) for d in layout.days}
    b = {x: rng.gauss(0, sb) for x in layout.blocks}
    u = {x: rng.gauss(0, ss) for x in layout.stations}
    bd = {(x, d): rng.gauss(0, sbd) for x in layout.blocks for d in layout.days}
    idx = {s: k for k, s in enumerate(layout.stations)}
    pf = _field(layout.chol, rng) if persistent_field else None
    fields = {d: _field(layout.chol, rng) for d in layout.days} if sf else {}
    cells: Dict[tuple, list] = {}
    for (s, d), n in layout.rows.items():
        bl = layout.block_of[s]
        eff = mu + a[d] + b[bl] + u[s] + bd[(bl, d)]
        if sf:
            eff += sf * fields[d][idx[s]]
        if pf:
            eff += persistent_field * pf[idx[s]]
        c = cells.setdefault((bl, d), [0.0, 0])
        c[0] += n * eff + math.sqrt(n) * se * rng.gauss(0, 1)
        c[1] += n
    return {k: (v[0], v[1]) for k, v in cells.items()}


def null_calibration(layout: Layout, n_sets: int = 400, reps: int = 200, seed: int = 20261103,
                     n_power: int = 200, persistent_binding: bool = False) -> dict:
    """False-pass rate (lower bound > 0) of the binding interval on each null, and its power at a known effect.
    persistent_binding False = the PERSISTENT nulls are reported under advisory_nulls instead of binding."""
    rng = random.Random(seed)
    out = {"layout": {"stations": len(layout.stations), "blocks": len(layout.blocks), "days": len(layout.days),
                      "rows": sum(layout.rows.values())},
           "n_sets": n_sets, "reps": reps, "seed": seed, "max_false_pass": MAX_FALSE_PASS, "min_power": MIN_POWER,
           "false_pass": {}, "advisory_nulls": {}, "persistent_binding": persistent_binding}
    sd_mixed = None
    for name, comp in NULLS.items():
        fp, means = 0, []
        for _ in range(n_sets):
            r = _cells_ci(synth_cells(layout, comp, 0.0, rng), reps, rng)
            fp += r["ci"][0] > 0
            means.append(r["mean"])
        (out["false_pass"] if persistent_binding or name not in PERSISTENT else out["advisory_nulls"])[name] = fp / n_sets
        if name == "mixed":
            mu = sum(means) / len(means)
            sd_mixed = math.sqrt(sum((x - mu) ** 2 for x in means) / len(means))
    for name, amp in ADVISORY_NULLS.items():
        fp = 0
        for _ in range(n_sets // 2):
            r = _cells_ci(synth_cells(layout, (0, 0, 0, 0, 0, 1.5), 0.0, rng, persistent_field=amp), reps, rng)
            fp += r["ci"][0] > 0
        out["advisory_nulls"][name] = fp / (n_sets // 2)
    effect = POWER_EFFECT_SD * sd_mixed
    hits = sum(_cells_ci(synth_cells(layout, NULLS["mixed"], effect, rng), reps, rng)["ci"][0] > 0
               for _ in range(n_power))
    out["power"] = {"effect": effect, "effect_in_null_sd": POWER_EFFECT_SD, "n_sets": n_power, "rate": hits / n_power}
    worst = max(out["false_pass"].values())
    out["worst_false_pass"] = worst
    out["ok"] = worst <= MAX_FALSE_PASS and out["power"]["rate"] >= MIN_POWER
    out["reasons"] = ([f"null {k} falsely passes {v:.1%} > {MAX_FALSE_PASS:.0%}" for k, v in out["false_pass"].items()
                       if v > MAX_FALSE_PASS]
                      + ([f"power {out['power']['rate']:.1%} < {MIN_POWER:.0%} at {POWER_EFFECT_SD:g} null SD"]
                         if out["power"]["rate"] < MIN_POWER else []))
    return out


def canonical_layout(days: int = MIN_DAYS, rows_per_day: int = 12) -> Layout:
    """12 stations in 4 groups ~300 km apart (3 stations within ~30 km each): the shortest window the rule admits."""
    coords = {}
    for g, (la, lo) in enumerate(((32.8, -117.3), (34.0, -120.0), (36.0, -122.0), (38.0, -123.5))):
        for k in range(3):
            coords[f"G{g}S{k}"] = (la + 0.1 * k, lo + 0.1 * k)
    blk = spatial_blocks(coords)
    rows = {(s, f"2026-01-{d + 1:02d}"): rows_per_day for s in coords for d in range(days)}
    return Layout(rows, blk, coords)


@functools.lru_cache(maxsize=1)
def self_test() -> dict:
    """The pinned canonical calibration (seeded; computed once per process)."""
    return null_calibration(canonical_layout())


def require_calibrated() -> dict:
    r = self_test()
    if not r["ok"]:
        raise CalibrationFailed("the two-way gate failed its null self-test: " + "; ".join(r["reasons"]))
    return r


def calibrate_items(items: Sequence[dict], n_sets: int = 300, reps: int = 200) -> Optional[dict]:
    """The same calibration on a run's own layout; None when the binding CI is not computable there."""
    if len({_day(i["t"]) for i in items}) < MIN_DAYS:
        return None
    return null_calibration(Layout.from_items(items), n_sets=n_sets, reps=reps)
