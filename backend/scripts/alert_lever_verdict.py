#!/usr/bin/env python3
"""alert_lever_verdict.py - apply the PRE-REGISTERED decision rule to alert_window_replay.py outputs. Offline.

    python scripts/alert_lever_verdict.py --rho08 runA.json --rho10 runB.json [--assumed runC.json] --out verdict.json

Rule (docs/weather-program/evidence/2026-11-04-alert-accuracy/PREREGISTRATION.md): a configuration passes only if
every class at sigma 1 under the measured model has precision >= 0.80, recall >= 0.85, max per user-day <= 2 and
0 outside the tier window, at rho_hs 0.8 AND (for configurations with L1) at rho_hs 1.0. Adoption order: L1, L2,
L2b, L3, L1+L2, L1+L3, L1+L2+L3; the first that passes is adopted. The bar is fixed here and nowhere else.
"""
import argparse
import json

BAR = {"precision": 0.80, "recall": 0.85, "max_per_user_day": 2, "outside_tier_window": 0}
ORDER = ["L1", "L2", "L2b", "L3", "L1+L2", "L1+L3", "L1+L2+L3"]
CLASSES = ["size_only_2_6ft", "morning_afternoon_offshore_light", "dawn_morning_clean_mid_high_tide"]


def rows(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["summary"]


def pick(summary, arm, alert, sigma=1.0):
    for r in summary:
        if r["arm"] == arm and r["alert"] == alert and r["sigma"] == sigma and not r["hysteresis"]:
            return r
    return None


def check(r):
    """(passes, shortfalls) for one class row."""
    if r is None:
        return False, ["missing"]
    short = []
    if (r["new_precision"] or 0) < BAR["precision"]:
        short.append(f"precision {r['new_precision']} < {BAR['precision']}")
    if (r["new_recall"] or 0) < BAR["recall"]:
        short.append(f"recall {r['new_recall']} < {BAR['recall']}")
    if r["max_per_user_day"] > BAR["max_per_user_day"]:
        short.append(f"max/day {r['max_per_user_day']}")
    if r["outside_tier_window"] > BAR["outside_tier_window"]:
        short.append(f"outside tier {r['outside_tier_window']}")
    return not short, short


def verdict(a, b):
    out = []
    for arm in ["baseline"] + ORDER:
        res = {"arm": arm, "classes": {}}
        ok = True
        for rho, summary in (("0.8", a), ("1.0", b)):
            if rho == "1.0" and "L1" not in arm:
                continue
            for c in CLASSES:
                r = pick(summary, arm, c)
                p, short = check(r)
                ok &= p
                res["classes"].setdefault(c, {})[rho] = {
                    "precision": r and r["new_precision"], "recall": r and r["new_recall"],
                    "max_per_user_day": r and r["max_per_user_day"], "outside": r and r["outside_tier_window"],
                    "fires_per_week": r and r["new_fires_per_week"], "pass": p, "short": short}
        res["pass"] = ok
        out.append(res)
    adopted = next((r["arm"] for r in out if r["arm"] in ORDER and r["pass"]), None)
    return {"bar": BAR, "order": ORDER, "configs": out, "adopted": adopted,
            "outcome": f"PASS ({adopted})" if adopted else "FAIL"}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rho08", required=True)
    ap.add_argument("--rho10", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    v = verdict(rows(a.rho08), rows(a.rho10))
    for r in v["configs"]:
        cells = []
        for c in CLASSES:
            x = r["classes"][c]["0.8"]
            y = r["classes"][c].get("1.0")
            cells.append(f"{x['precision']}/{x['recall']}" + (f" [{y['precision']}/{y['recall']}]" if y else ""))
        print(f"{r['arm']:10s} {'PASS' if r['pass'] else 'fail'} | " + " | ".join(cells))
    print("OUTCOME:", v["outcome"])
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(v, fh, indent=1)


if __name__ == "__main__":
    main()
