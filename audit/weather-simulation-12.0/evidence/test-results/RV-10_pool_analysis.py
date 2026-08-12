# -*- coding: utf-8 -*-
"""RV-10 -- pool the model_skill_census runs and separate what pooling CAN and CANNOT settle.

⛔ THE STATISTICAL POINT THAT GOVERNS THIS WHOLE FILE. `model_skill_census.py` says "run it
repeatedly and pool", and that is right, but N runs 45 minutes apart are NOT N independent samples.
Significant wave height is strongly autocorrelated -- at a 1 h lag typically r > 0.95, and a swell
event persists for days. Eight runs over ~5 h sample ONE synoptic situation. Pooling them tightens
the estimate of THAT situation and says almost nothing about the next one.

So the pooled output is split in two, and the split is the point:

  STRUCTURAL   properties that are not weather: which upstream provider actually serves each model,
               the pairing rate, how many sites the EURO lane routes away from ECMWF. These change
               on deploys and coverage, not on sea state, so a handful of runs genuinely settles
               them. THIS is what the pool can decide.

  WEATHER      MAE and bias, per band and overall. Correlated across runs by construction. The
               pool reports the spread so the reader can see how little it moves -- which is
               evidence about autocorrelation, NOT about confidence.

★ Reporting a tight spread across correlated runs as if it were a confidence interval is precisely
the "parity of statistic is not parity of population" error this repo has already paid for. The
spread here is labelled RANGE ACROSS CORRELATED RUNS and must never be read as +/- anything.

ASCII stdout only (cp1252).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JSONL = os.path.join(HERE, "RV-09_model_skill_census.jsonl")
MODELS = ("GFS", "ICON", "EURO")
BANDS = ("flat <0.5m", "small 0.5-1.5m", "rideable 1.5-3m", "big >3m")


def load():
    rows = []
    with open(JSONL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def rng(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return None
    return min(vals), max(vals), sum(vals) / len(vals)


def main():
    runs = load()
    if not runs:
        print("no runs yet")
        return 1
    print("=" * 98)
    print("RV-10  POOLED MODEL SKILL CENSUS -- %d run(s)" % len(runs))
    print("=" * 98)
    print("valid_times: %s" % ", ".join(r["valid_time"][11:16] for r in runs))
    span = "%s -> %s" % (runs[0]["valid_time"][:16], runs[-1]["valid_time"][:16])
    print("span: %s   (~%d distinct hours)" % (span, len({r["valid_time"][:13] for r in runs})))

    # ---------------- STRUCTURAL ----------------
    print("\n" + "=" * 98)
    print("STRUCTURAL -- not weather. A handful of runs DOES settle these.")
    print("=" * 98)
    print("  pairing rate: %s" % sorted({r["pairing_rate"] for r in runs}))
    for m in MODELS:
        provs = {}
        for r in runs:
            for p in r["provider_by_model"].get(m, []):
                provs.setdefault(p, 0)
                provs[p] += 1
        print("  %-5s providers seen: %s" % (m, ", ".join("%s (%d/%d runs)" % (k, v, len(runs))
                                                          for k, v in sorted(provs.items()))))

    print("\n  ** THE DECOMPOSITION THAT OVERTURNED THE HEADLINE **")
    print("  %-30s %6s %9s %14s %10s" % ("EURO served by", "n", "EURO mae", "GFS same sites", "better by"))
    for key in sorted({k for r in runs for k in r["by_model_and_provider"] if k.startswith("EURO/")}):
        ns, em, gm = [], [], []
        for r in runs:
            v = r["by_model_and_provider"].get(key)
            if not v or v.get("mae_m") is None or v.get("gfs_mae_same_sites") is None:
                continue
            ns.append(v["n"]); em.append(v["mae_m"]); gm.append(v["gfs_mae_same_sites"])
        if not em:
            continue
        adv = [100 * (1 - e / g) for e, g in zip(em, gm) if g]
        print("  %-30s %6s %9.4f %14.4f %9.1f%%"
              % (key, "%d-%d" % (min(ns), max(ns)), sum(em) / len(em), sum(gm) / len(gm),
                 sum(adv) / len(adv) if adv else float("nan")))

    hn = [sum(v["n"] for k, v in r["by_model_and_provider"].items()
              if k.startswith("EURO/") and k != "EURO/ecmwf") for r in runs]
    en = [r["by_model_and_provider"].get("EURO/ecmwf", {}).get("n", 0) for r in runs]
    print("\n  sites routed AWAY from ecmwf by the EURO lane: %s of 60   (ecmwf-served: %s)"
          % ("-".join(map(str, sorted(set(hn)))), "-".join(map(str, sorted(set(en))))))

    # ---------------- WEATHER ----------------
    print("\n" + "=" * 98)
    print("WEATHER -- correlated across runs. RANGE ACROSS CORRELATED RUNS, never a confidence bound.")
    print("=" * 98)
    print("  %-6s %10s %10s %10s | %s" % ("model", "mae min", "mae max", "mae mean", "bias min..max"))
    for m in MODELS:
        r1 = rng([r["by_model"][m]["mae_m"] for r in runs])
        b1 = rng([r["by_model"][m]["bias_m"] for r in runs])
        if not r1:
            continue
        print("  %-6s %10.4f %10.4f %10.4f | %+.4f .. %+.4f" % (m, r1[0], r1[1], r1[2], b1[0], b1[1]))

    wins = {m: [r["by_model"][m]["closest_at_n_buoys"] for r in runs] for m in MODELS}
    print("\n  closest-at-n-buoys (of 60): " + " | ".join(
        "%s %s" % (m, "-".join(map(str, sorted(set(v))))) for m, v in wins.items()))
    print("  best_model per run: %s" % ", ".join(r["best_model"] for r in runs))

    print("\n  PER BAND (mean across runs; n is the per-run range)")
    print("  %-17s %9s | %9s %9s | %9s %9s | %s"
          % ("band", "n/run", "GFS mae", "GFS bias", "EURO mae", "EURO bias", "EURO wins"))
    for b in BANDS:
        ns, g, gb, e, eb, w = [], [], [], [], [], 0
        for r in runs:
            cell = r["by_obs_band"].get(b) or {}
            gg, ee = cell.get("GFS") or {}, cell.get("EURO") or {}
            if gg.get("mae_m") is None or ee.get("mae_m") is None:
                continue
            ns.append(gg["n"]); g.append(gg["mae_m"]); gb.append(gg["bias_m"])
            e.append(ee["mae_m"]); eb.append(ee["bias_m"])
            w += 1 if ee["mae_m"] < gg["mae_m"] else 0
        if not g:
            print("  %-17s %9s | %s" % (b, "0", "NOT SAMPLED in any run"))
            continue
        print("  %-17s %9s | %9.3f %+9.3f | %9.3f %+9.3f | %d/%d runs"
              % (b, "%d-%d" % (min(ns), max(ns)), sum(g) / len(g), sum(gb) / len(gb),
                 sum(e) / len(e), sum(eb) / len(eb), w, len(g)))

    print("\n" + "=" * 98)
    print("READ THIS BEFORE QUOTING ANY NUMBER ABOVE")
    print("=" * 98)
    hours = len({r["valid_time"][:13] for r in runs})
    print("  %d runs over ~%d distinct hour(s) sample ONE synoptic situation. Hs autocorrelation at"
          % (len(runs), hours))
    print("  a 1 h lag is typically r > 0.95, so the effective independent sample size is closer to")
    print("  1-2 than to %d. Days, not hours, is what would change that." % len(runs))
    print("  STRUCTURAL rows are safe to act on. WEATHER rows are not, until the pool spans days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
