"""guardrail_null_rate.py - the D-065 member test's FALSE-WORSE rate on synthetic AR(1) nulls (SOTA researcher topic 5).

Offline and synthetic: no cache, no network, no Render. For each (rho, T) it simulates loss differentials
d_t = mu + AR(1)(rho) noise over T target hours, ONE member (one buoy, one lead), and counts how often
`guardrail_stats.two_way` + the WORSE rule fire, under:
  * null "no change":       mu = 0          (ON exactly as good as OFF);
  * null "at the margin":   mu = -margin    (ON worse by exactly the materiality margin: the least favourable null,
                                             where a correct one-sided 5% test fires at most ~5% of the time).
Rules compared: V1 (DM p AND moving-block CI, block from the first insignificant lag), V2 (circular-block bootstrap
with the Politis-White block; the default), and V2 with the block DOUBLED (the researcher's robustness check).

Items are built so the per-hour differential is exactly d_t: obs 0, OFF error +OFF_ERR, ON error OFF_ERR - d_t, so
|e_OFF| - |e_ON| = d_t while e_ON stays positive. OFF MAE = OFF_ERR sets the margin (max(0.005 m, 1% of OFF MAE)).
A single member is tested (no Holm family). Rates are per RUN: a run the rule declares untestable cannot kill a fix,
so it counts as not WORSE (that is the guardrail's real false-kill rate).

  python scripts/guardrail_null_rate.py --sims 300 --reps 400 --out rate.json
"""
import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
OFF_ERR = 0.40          # m: OFF's error, so OFF MAE 0.40 and margin = max(0.005, 0.004) = 0.005 m
SD = 0.05               # m: the stationary s.d. of the per-hour differential


def ar1(rng, n, rho, sd):
    innov = sd * math.sqrt(1.0 - rho * rho)
    x, prev = [], rng.gauss(0, sd)
    for _ in range(n):
        x.append(prev)
        prev = rho * prev + rng.gauss(0, innov)
    return x


PAIRS_PER_HOUR = 3     # a live target hour holds several buoy pairs (the panel form averages them into one d_t)


def items_from(d):
    return [{"t": T0 + timedelta(hours=12 * k), "buoy": f"b{j}", "lead": 24, "obs": 0.0, "f_ref": OFF_ERR,
             "f_cand": OFF_ERR - v} for k, v in enumerate(d) for j in range(PAIRS_PER_HOUR)]


def worse(m):
    return bool(m.get("testable")) and m["p_worse"] < gs.ALPHA and m["ci"][1] < -m["margin"]


def rate(rule, rho, n, mu, sims, reps, seed):
    rng = random.Random(seed)
    old_env, old_block = os.environ.get("GUARDRAIL_STATS_V2"), gs.optimal_block
    os.environ["GUARDRAIL_STATS_V2"] = "0" if rule == "v1" else "1"
    if rule == "v2_double":
        gs.optimal_block = lambda x: (lambda b: None if b is None else 2.0 * b)(old_block(x))
    try:
        hits = tested = 0
        blocks = []
        for i in range(sims):
            d = [mu + e for e in ar1(rng, n, rho, SD)]
            m = gs.two_way(items_from(d), reps=reps, seed=seed + i)
            if m.get("testable"):
                tested += 1
                hits += worse(m)
                blocks.append(m.get("block"))
    finally:
        gs.optimal_block = old_block
        if old_env is None:
            os.environ.pop("GUARDRAIL_STATS_V2", None)
        else:
            os.environ["GUARDRAIL_STATS_V2"] = old_env
    p = hits / sims                      # per RUN: an untestable run cannot kill a fix, so it counts as not WORSE
    se = math.sqrt(p * (1 - p) / sims)
    return {"rule": rule, "rho": rho, "T": n, "mu": mu, "sims": sims, "tested": tested, "worse": hits,
            "rate": p, "mc_se": se, "testable_share": tested / sims,
            "median_block": sorted(blocks)[len(blocks) // 2] if blocks else None}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--sims", type=int, default=300)
    p.add_argument("--reps", type=int, default=400)
    p.add_argument("--rhos", default="0,0.5,0.7,0.9,0.95")
    p.add_argument("--ts", default="28,84")
    p.add_argument("--rules", default="v1,v2,v2_double")
    p.add_argument("--seed", type=int, default=20261111)
    p.add_argument("--harm", type=float, default=None, help="also measure power: ON worse by this mean (m)")
    p.add_argument("--out", default="")
    a = p.parse_args(argv)
    margin = max(gs.MARGIN_ABS_M, gs.MARGIN_REL * OFF_ERR)
    nulls = [("no change", 0.0), ("at the margin", -margin)]
    if a.harm is not None:
        nulls.append((f"harm {a.harm}", -abs(a.harm)))
    rows = []
    for n in [int(x) for x in a.ts.split(",")]:
        for rho in [float(x) for x in a.rhos.split(",")]:
            for null, mu in nulls:
                for rule in a.rules.split(","):
                    r = dict(rate(rule, rho, n, mu, a.sims, a.reps, a.seed), null=null)
                    rows.append(r)
                    print(f"T {n:3d} rho {rho:.2f} {null:13s} {rule:9s} WORSE per run {r['rate']:.3f} "
                          f"(+/- {r['mc_se']:.3f}; testable {r['testable_share']:.2f}; median block "
                          f"{r['median_block']})", flush=True)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"alpha": gs.ALPHA, "margin_m": margin, "sd_m": SD, "off_err_m": OFF_ERR, "reps": a.reps,
                       "rows": rows}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
