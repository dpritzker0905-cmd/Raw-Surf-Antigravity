"""rating_truth_mop_core.py - PURE core of the MOP rating-truth check that gates #771 (JAC-2, RATING_REF_PRIOR).

THE QUESTION. #771 changes one thing: the size YARDSTICK a spot with no size climatology is graded against. OFF, the
legacy absolute curve (size gate linear to 1.0 at 1.2 m; oversize taper 8 -> 14 m). ON, the catalogue reference prior
(1.142 m) through the curves every known spot uses. Which yardstick puts a reference-less spot-hour in the size category
that measured nearshore water says it is in?

THE CATEGORY IS THE RATING'S OWN. No new thresholds: the category is read off the two size gates of `surf_rating`
(`size_score`, `oversize_gate`) as they stand for a given breaking height and yardstick:
    flat      size_gate == 0                    (at or below the 0.2 m rideability floor)
    small     0 < size_gate < 0.6               (below the anchor: under this spot's typical day)
    fun       0.6 <= size_gate < 1.0            (typical day up to the 2.5x saturation)
    solid     size_gate == 1, oversize_gate == 1 (saturated: "as good as it gets here")
    overhead  OVERSIZE_FLOOR < oversize_gate < 1 (the closeout taper)
    big       oversize_gate == OVERSIZE_FLOOR   (past what the spot can hold)
0.6 is `surf_rating._REF_ANCHOR_SCORE` and the floor is `surf_rating.OVERSIZE_FLOOR`; both are read, not copied.

THREE GRADERS, ONE HEIGHT. Every grader sees the same MOP-derived breaking height (`eval_scoring.hb_proxy`, the #773
nearshore arm's frozen Komar-Gaughan operator on MOP Hs/Tp at the MOP point depth), so only the yardstick differs:
    truth   the spot's own typical day from MEASURED-WATER climatology: `spot_size_climatology.reference_from_hist`
            (clamped p50 of surfable-day heights, the statistic the served reference uses) over MOP heights from
            reference years that are disjoint from the scored years;
    legacy  reference None with RATING_REF_PRIOR off (the OFF arm);
    prior   the leave-one-out catalogue prior: the median of the committed baseline's per-spot references with this
            spot's own entry removed (each spot is treated as reference-less).
Truth is invariant to a constant scale on the height operator (a ratio to the spot's own median); the two arms are
not, so the runner repeats the comparison under the served H1/10 convention (x1.27) and the rule must hold under both.

Everything here is pure: no network, no file I/O, no environment writes. The runner owns I/O.
"""
import math
import re
import statistics
from typing import Dict, Iterable, List, Optional, Sequence

import numpy as np

from services.weather_pipeline import surf_rating as SR
from services.weather_pipeline import spot_size_climatology as SC
from services.weather_pipeline.eval_scoring import hb_proxy

CATEGORIES = ("flat", "small", "fun", "solid", "overhead", "big")
ARMS = ("legacy", "prior")
SEASONS = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM",
           6: "JJA", 7: "JJA", 8: "JJA", 9: "SON", 10: "SON", 11: "SON"}
_EPS = 1e-9


class PriorLeak(RuntimeError):
    """The legacy arm read the prior: RATING_REF_PRIOR is on in this process, so OFF is not OFF."""


# ---- OPeNDAP ASCII (pure parse; the runner does the fetch) ---------------------------------------------------------
def parse_ascii(text: str) -> dict:
    """OPeNDAP ASCII -> {var: list of floats}. Arrays read `name[N]` then values; scalars read `name, value`."""
    body = text.split("-" * 20, 1)[-1]
    out, cur = {}, None
    for line in body.splitlines():
        line = line.strip()
        if not line:
            cur = None
            continue
        m = re.match(r"^(\w+)\[\d+\]$", line)
        if m:
            cur = m.group(1)
            out[cur] = []
            continue
        m = re.match(r"^(\w+),\s*(\S+)$", line)
        if m and cur is None:
            out[m.group(1)] = [float(m.group(2))]
            continue
        if cur:
            out[cur].extend(float(x) for x in line.split(",") if x.strip())
    return out


# ---- the category (the rating's own gates) -------------------------------------------------------------------------
def size_category(size_gate: float, oversize: float) -> int:
    """Index into CATEGORIES for a pair of gate values."""
    if size_gate <= 0.0:
        return 0
    if oversize <= SR.OVERSIZE_FLOOR + _EPS:
        return 5
    if oversize < 1.0 - _EPS:
        return 4
    if size_gate >= 1.0 - _EPS:
        return 3
    if size_gate >= SR._REF_ANCHOR_SCORE - _EPS:
        return 2
    return 1


def category(h_m: float, reference_m: Optional[float]) -> int:
    """The size category the rating implies for breaking height `h_m` graded against `reference_m` (None = legacy).
    Break depth is unknown here (None) for every grader, so the oversize tier is reference -> prior -> absolute."""
    sg = SR.size_score(h_m, reference_m)
    og = SR.oversize_gate(h_m, reference_m, enabled=True, break_depth_m=None)
    return size_category(sg, og)


def assert_legacy_is_legacy() -> None:
    """Refuse to run when the OFF arm would read the prior. The legacy curve saturates at 1.2 m (2.0 m -> 1.0) and its
    taper starts at 8 m (5 m -> inert); with the prior those read 0.71 and 0.47."""
    if SR.size_score(2.0, None) != 1.0 or SR.oversize_gate(5.0, None, enabled=True) != 1.0:
        raise PriorLeak("RATING_REF_PRIOR is on: set it to 0 before importing the rating")


# ---- yardsticks -----------------------------------------------------------------------------------------------------
def loo_prior(references: Dict[str, float], spot_id: Optional[str]) -> float:
    """Median of the baseline's per-spot references without this spot's own (leave-one-out)."""
    vals = [float(v) for k, v in references.items() if k != spot_id and v is not None]
    return float(statistics.median(vals))


def truth_reference(hb_samples: Iterable[float]) -> Optional[float]:
    """The spot's typical day from measured-water heights, by the served reference's own statistic."""
    hist = SC.merge_samples(SC.empty_hist(), [float(h) for h in hb_samples if h is not None and math.isfinite(h)])
    return SC.reference_from_hist(hist)


def breaking_heights(hs: Sequence[float], tp: Sequence[float], depth_m: float, scale: float = 1.0) -> np.ndarray:
    """hb_proxy per sample (NaN where undefined), times `scale` (1.0 = the frozen operator; 1.27 = H1/10)."""
    out = np.full(len(hs), np.nan)
    for i, (h, t) in enumerate(zip(hs, tp)):
        if h is None or t is None or not (math.isfinite(h) and math.isfinite(t)) or h <= 0 or t <= 0:
            continue
        v = hb_proxy(float(h), float(t), float(depth_m))
        if v is not None and math.isfinite(v):
            out[i] = v * scale
    return out


# ---- per-spot rows --------------------------------------------------------------------------------------------------
def grade_spot(hb_scored: np.ndarray, truth_ref: float, prior_ref: float, wrong_ref: float) -> Dict[str, np.ndarray]:
    """Category arrays (truth, legacy, prior, wrong) over the scored hours; NaN heights are dropped by the caller."""
    t = np.array([category(h, truth_ref) for h in hb_scored], dtype=np.int8)
    lg = np.array([category(h, None) for h in hb_scored], dtype=np.int8)
    pr = np.array([category(h, prior_ref) for h in hb_scored], dtype=np.int8)
    wr = np.array([category(h, wrong_ref) for h in hb_scored], dtype=np.int8)
    return {"truth": t, "legacy": lg, "prior": pr, "wrong": wr}


# ---- paired day-block bootstrap -------------------------------------------------------------------------------------
def day_sums(day: np.ndarray, a: np.ndarray, b: np.ndarray):
    """Per-day sums of a and b and per-day counts, for the days present (sorted)."""
    days, inv = np.unique(day, return_inverse=True)
    sa = np.bincount(inv, weights=a.astype(float), minlength=len(days))
    sb = np.bincount(inv, weights=b.astype(float), minlength=len(days))
    n = np.bincount(inv, minlength=len(days)).astype(float)
    return sa, sb, n


def paired_diff(day: np.ndarray, a: np.ndarray, b: np.ndarray, reps: int = 2000, seed: int = 20261112,
                level: float = 0.95) -> dict:
    """Agreement of a and b (0/1 arrays), their difference a - b, and a percentile CI of the difference from a
    bootstrap that resamples whole UTC days (every spot on a resampled day comes with it: shared swell)."""
    n_rows = len(a)
    if n_rows == 0:
        return {"n_hours": 0, "n_days": 0, "a": None, "b": None, "diff": None, "ci": [None, None]}
    sa, sb, n = day_sums(day, a, b)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(n), size=(reps, len(n)))
    tot = n[idx].sum(axis=1)
    boot = (sa[idx].sum(axis=1) - sb[idx].sum(axis=1)) / tot
    lo, hi = np.quantile(boot, [(1 - level) / 2, 1 - (1 - level) / 2])
    return {"n_hours": int(n_rows), "n_days": int(len(n)), "a": round(float(a.mean()), 4), "b": round(float(b.mean()), 4),
            "diff": round(float(a.mean() - b.mean()), 4), "ci": [round(float(lo), 4), round(float(hi), 4)]}


def swap_null(day: np.ndarray, a: np.ndarray, b: np.ndarray, seed: int = 20261113, **kw) -> dict:
    """NULL CONTROL: on a random half of the days the two arms' labels are exchanged. The arms are then exchangeable,
    so the difference must sit near 0 and its CI must contain 0, or the CI machinery is broken."""
    days = np.unique(day)
    flip_days = days[np.random.default_rng(seed).random(len(days)) < 0.5]
    f = np.isin(day, flip_days)
    return paired_diff(day, np.where(f, b, a), np.where(f, a, b), **kw)


def shifted_truth_agreement(day: np.ndarray, spot: np.ndarray, truth: np.ndarray, arm: np.ndarray,
                            seed: int = 20261114) -> float:
    """DESCRIPTIVE null: each spot's truth labels rotated by a random whole number of its days (keeps the label mix
    and the autocorrelation, breaks the timing). Agreement left over is what the label MIX alone buys."""
    rng = np.random.default_rng(seed)
    hit, tot = 0, 0
    for s in np.unique(spot):
        m = spot == s
        t, a = truth[m], arm[m]
        k = int(rng.integers(len(t) // 4, 3 * len(t) // 4 + 1)) if len(t) > 3 else 0
        hit += int((np.roll(t, k) == a).sum())
        tot += len(t)
    return round(hit / tot, 4) if tot else float("nan")


# ---- the pre-registered rule ----------------------------------------------------------------------------------------
PASS, FAIL, INVALID = "PASS", "FAIL", "INVALID"


def judge_variant(v: dict) -> dict:
    """One operator variant: pooled prior >= legacy with CI lower bound >= 0, and no region whose CI of (prior - legacy)
    lies wholly below 0. Controls: the swap null's CI contains 0; the wrong yardstick loses to the prior (CI < 0)."""
    p = v["pooled"]
    pooled_ok = p["diff"] is not None and p["a"] >= p["b"] and p["ci"][0] >= 0
    worse = sorted(r for r, x in v["regions"].items() if x["ci"][1] is not None and x["ci"][1] < 0)
    nl, pc = v["null_swap"], v["positive_control"]
    null_ok = nl["ci"][0] is not None and nl["ci"][0] <= 0 <= nl["ci"][1]
    pos_ok = pc["ci"][1] is not None and pc["ci"][1] < 0
    return {"pooled_ok": bool(pooled_ok), "regions_worse": worse, "null_ok": bool(null_ok), "positive_ok": bool(pos_ok)}


def verdict(variants: Dict[str, dict]) -> dict:
    """PASS only if every variant passes; INVALID (no verdict, #771 stays held) if any control misbehaves."""
    j = {k: judge_variant(v) for k, v in variants.items()}
    if not j:
        return {"verdict": INVALID, "why": ["no variant scored"], "checks": j}
    bad_controls = [k for k, x in j.items() if not (x["null_ok"] and x["positive_ok"])]
    if bad_controls:
        return {"verdict": INVALID, "why": [f"control failed in {k}: {j[k]}" for k in bad_controls], "checks": j}
    why = []
    for k, x in j.items():
        if not x["pooled_ok"]:
            why.append(f"{k}: pooled prior - legacy not >= 0 with CI lower bound >= 0")
        if x["regions_worse"]:
            why.append(f"{k}: prior significantly worse in {', '.join(x['regions_worse'])}")
    return {"verdict": FAIL if why else PASS, "why": why, "checks": j}


# ---- one variant end to end (pure: the runner hands it arrays) ------------------------------------------------------
def score_variant(rows: List[dict], reps: int = 2000, min_days: int = 30) -> dict:
    """rows: one dict per spot with keys spot, region, day (int array, UTC day number), month (int array) and the
    category arrays from grade_spot. Returns pooled / region / season results plus controls and descriptives."""
    cat = {k: np.concatenate([r[k] for r in rows]) for k in ("truth", "legacy", "prior", "wrong", "day", "month")}
    spot = np.concatenate([np.full(len(r["day"]), r["spot"], dtype=object) for r in rows])
    region = np.concatenate([np.full(len(r["day"]), r["region"], dtype=object) for r in rows])
    agree = {k: (cat[k] == cat["truth"]).astype(np.int8) for k in ("legacy", "prior", "wrong")}
    day = cat["day"]

    def block(mask):
        return paired_diff(day[mask], agree["prior"][mask], agree["legacy"][mask], reps=reps)

    allm = np.ones(len(day), bool)
    out = {"pooled": block(allm), "regions": {}, "seasons": {}, "spots": {}}
    for r in sorted(set(region)):
        out["regions"][r] = block(region == r)
    season = np.array([SEASONS[int(m)] for m in cat["month"]], dtype=object)
    for s in ("DJF", "MAM", "JJA", "SON"):
        m = season == s
        if len(np.unique(day[m])) >= min_days:
            out["seasons"][s] = block(m)
    for s in sorted(set(spot)):
        m = spot == s
        out["spots"][s] = {"n_hours": int(m.sum()), "legacy": round(float(agree["legacy"][m].mean()), 4),
                           "prior": round(float(agree["prior"][m].mean()), 4)}
    out["null_swap"] = swap_null(day, agree["prior"], agree["legacy"], reps=reps)
    out["positive_control"] = paired_diff(day, agree["wrong"], agree["prior"], reps=reps)
    surf = cat["truth"] > 0
    out["surfable_only"] = block(surf)
    out["adjacent"] = {k: round(float((np.abs(cat[k].astype(int) - cat["truth"]) <= 1).mean()), 4) for k in ARMS}
    out["shifted_truth"] = {k: shifted_truth_agreement(day, spot, cat["truth"], cat[k]) for k in ARMS}
    out["confusion"] = {k: confusion(cat["truth"], cat[k]) for k in ("legacy", "prior")}
    out["truth_mix"] = {CATEGORIES[i]: int((cat["truth"] == i).sum()) for i in range(len(CATEGORIES))}
    return out


def confusion(truth: np.ndarray, arm: np.ndarray) -> Dict[str, Dict[str, int]]:
    """truth category -> arm category -> hours (zeros omitted)."""
    m = {}
    for i, ti in enumerate(CATEGORIES):
        row = {CATEGORIES[j]: int(((truth == i) & (arm == j)).sum()) for j in range(len(CATEGORIES))}
        row = {k: v for k, v in row.items() if v}
        if row:
            m[ti] = row
    return m
