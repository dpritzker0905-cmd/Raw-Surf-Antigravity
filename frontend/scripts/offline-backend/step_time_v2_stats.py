"""Statistics for scn_scrub_step_time_v2.js, as pre-registered (late-wash log section 6, amendments 6a and 6b). Standard library only.

    python step_time_v2_stats.py AA.json [AB.json [report.json]]

Per (device, cadence): frame-changing steps paired across adjacent blocks of one ABBA group (A1-B1, B2-A2) on the key index; a
censored step (not drawn within the window) enters as the window. Paired difference = A minus B. Bootstrap over ABBA groups (2,000,
seed 20261116) for: the paired median, the p95 difference, the long-task p95 difference, and the censored-share difference.
AA sets the resolution R (half-widths). AB per cell: WORSE / NOT WORSE / UNRESOLVED; the test: any WORSE = FAIL, no WORSE and >= 5 of
6 NOT WORSE = PASS, else UNRESOLVED (6b). Outliers kept; also reported without steps > 1,000 ms. The first frame-changing step of each
block is reported apart once (it stays in the statistics).
"""
import json
import random
import statistics
import sys

SEED, B, OUT_MS = 20261116, 2000, 1000.0
LINE_MED, LINE_P95, LINE_LONG, LINE_CENS_PP, CENS_P95_MAX, PASS_CELLS = 5.0, 15.0, 15.0, 2.0, 0.05, 5


def p95(xs):
    v = sorted(xs)
    return v[min(len(v) - 1, int(0.95 * len(v)))] if v else float("nan")


def pairs_by_group(rows, drop_outliers=False, first_only=False):
    """{group: [(a_ms, b_ms, a_long, b_long, a_cens, b_cens), ...]}: frame-changing steps measured (or censored) in both blocks."""
    by, first = {}, {}
    for r in rows:
        if r.get("changing") and r.get("stepMs") is not None:
            by[(r["group"], r["block"], r["k"])] = r
            first[(r["group"], r["block"])] = min(first.get((r["group"], r["block"]), 99), r["k"])
    blocks = {}
    for r in rows:
        blocks.setdefault(r["group"], {})[r["block"]] = r["pos"]
    out = {}
    for g, bl in blocks.items():
        order = sorted(bl)                       # 4 blocks: A B B A
        if len(order) < 4:
            continue
        for a, b in ((order[0], order[1]), (order[3], order[2])):
            for k in range(64):
                x, y = by.get((g, a, k)), by.get((g, b, k))
                if not x or not y:
                    continue
                if first_only and k != first.get((g, a)):
                    continue
                if drop_outliers and (x["stepMs"] > OUT_MS or y["stepMs"] > OUT_MS):
                    continue
                out.setdefault(g, []).append((x["stepMs"], y["stepMs"], x["longMs"], y["longMs"], bool(x.get("censored")), bool(y.get("censored"))))
    return out


def stats_of(sample):
    a = [p[0] for p in sample]; b = [p[1] for p in sample]
    return {"med": statistics.median([x - y for x, y in zip(a, b)]), "p95": p95(a) - p95(b),
            "long": p95([p[2] for p in sample]) - p95([p[3] for p in sample]),
            "cens": 100.0 * (sum(p[4] for p in sample) - sum(p[5] for p in sample)) / len(sample)}


def ci(vals):
    v = sorted(vals)
    return [round(v[int(0.025 * len(v))], 1), round(v[int(0.975 * len(v)) - 1], 1)]


def counts(rows):
    """6a: per arm position: frame-changing steps, censored, superseded; no-change keys apart."""
    c = {}
    for r in rows:
        d = c.setdefault(r["pos"], {"changing": 0, "censored": 0, "superseded": 0, "no_change_keys": 0})
        if not r.get("changing"):
            d["no_change_keys"] += 1
            continue
        d["changing"] += 1
        d["censored"] += bool(r.get("censored"))
        d["superseded"] += bool(r.get("superseded"))
    return c


def summarise(rows, drop_outliers=False, first_only=False):
    pg = pairs_by_group(rows, drop_outliers, first_only)
    flat = [p for v in pg.values() for p in v]
    if not flat:
        return None
    point = stats_of(flat)
    rng = random.Random(SEED)
    groups = sorted(pg)
    boot = {k: [] for k in point}
    for _ in range(B):
        sample = [p for g in (rng.choice(groups) for _ in groups) for p in pg[g]]
        for k, v in stats_of(sample).items():
            boot[k].append(v)
    cis = {k: ci(v) for k, v in boot.items()}
    n = len(flat)
    cens_a = sum(p[4] for p in flat) / n; cens_b = sum(p[5] for p in flat) / n
    return {"n_pairs": n, "groups": len(groups),
            "median_diff": round(point["med"], 1), "median_ci": cis["med"], "R_median": round((cis["med"][1] - cis["med"][0]) / 2, 1),
            "p95_A": round(p95([p[0] for p in flat]), 1), "p95_B": round(p95([p[1] for p in flat]), 1),
            "p95_diff": round(point["p95"], 1), "p95_ci": cis["p95"], "R_p95": round((cis["p95"][1] - cis["p95"][0]) / 2, 1),
            "long_p95_diff": round(point["long"], 1), "long_ci": cis["long"],
            "censored_A": round(cens_a, 3), "censored_B": round(cens_b, 3), "censored_diff_pp": round(point["cens"], 2), "censored_ci_pp": cis["cens"],
            "p95_evaluable": cens_a < CENS_P95_MAX and cens_b < CENS_P95_MAX,
            "over_1s": sum(1 for p in flat if p[0] > OUT_MS or p[1] > OUT_MS), "counts": counts(rows)}


def cell_verdict(m, aa):
    """6b: WORSE / NOT WORSE / UNRESOLVED for one cell, with the reasons."""
    worse = []
    if m["median_ci"][0] > LINE_MED:
        worse.append("median")
    if m["p95_evaluable"] and m["p95_ci"][0] > LINE_P95:
        worse.append("p95")
    if m["long_ci"][0] > LINE_LONG:
        worse.append("long tasks")
    if m["censored_ci_pp"][0] > 0:
        worse.append("censored share")
    if worse:
        return "WORSE", worse
    resolves = aa is not None and aa["R_median"] <= LINE_MED and aa["R_p95"] <= LINE_P95
    ok = (m["median_ci"][1] <= LINE_MED and m["p95_evaluable"] and m["p95_ci"][1] <= LINE_P95 and m["long_ci"][1] <= LINE_LONG
          and m["censored_ci_pp"][1] <= LINE_CENS_PP)
    if resolves and ok:
        return "NOT WORSE", []
    why = []
    if not resolves:
        why.append(f"A/A resolution R {aa and aa['R_median']} ms median / {aa and aa['R_p95']} ms p95")
    if not m["p95_evaluable"]:
        why.append("p95 not evaluable (censored >= 5 %)")
    if not ok:
        why.append("an interval's upper end is over the line")
    return "UNRESOLVED", why


def cells(path):
    out = {}
    for s in json.load(open(path, encoding="utf-8")):
        key = f"{s['device']} {s['cadence']}ms"
        if "error" in s:
            out[key] = {"error": s["error"]}
            continue
        out[key] = {"with": summarise(s["rows"]), "without": summarise(s["rows"], drop_outliers=True),
                    "first_step": summarise(s["rows"], first_only=True)}
    return out


def fmt(m):
    return (f"median {m['median_diff']} {m['median_ci']} | p95 {m['p95_A']} vs {m['p95_B']} d {m['p95_diff']} {m['p95_ci']}"
            f"{'' if m['p95_evaluable'] else ' (NOT evaluable)'} | long d {m['long_p95_diff']} {m['long_ci']} | censored A {m['censored_A']:.1%} "
            f"B {m['censored_B']:.1%} d {m['censored_diff_pp']} pp {m['censored_ci_pp']} | n {m['n_pairs']}, >1s {m['over_1s']}")


def main():
    aa = cells(sys.argv[1])
    ab = cells(sys.argv[2]) if len(sys.argv) > 2 else {}
    report, verdicts = {}, []
    for key, a in aa.items():
        res = a.get("with")
        print(f"\n{key}\n  A/A  " + (fmt(res) + f" | R median {res['R_median']}, R p95 {res['R_p95']} | counts {res['counts']}" if res else f"unusable {a}"))
        line = {"AA": a}
        if key in ab and ab[key].get("with"):
            m = ab[key]["with"]
            v, why = cell_verdict(m, res)
            verdicts.append(v)
            print("  A/B  " + fmt(m) + f" | counts {m['counts']}")
            if ab[key]["without"]:
                print("       without >1s: " + fmt(ab[key]["without"]))
            if ab[key]["first_step"]:
                print("       first step of each block only: " + fmt(ab[key]["first_step"]))
            print(f"  -> {v}" + (f" ({'; '.join(why)})" if why else ""))
            line.update({"AB": ab[key], "verdict": v, "why": why})
        report[key] = line
    if verdicts:
        overall = "FAIL" if "WORSE" in verdicts else ("PASS" if verdicts.count("NOT WORSE") >= PASS_CELLS else "UNRESOLVED")
        print(f"\nOVERALL (6b): {overall}  [{', '.join(verdicts)}]")
        report["overall"] = overall
    if len(sys.argv) > 3:
        json.dump(report, open(sys.argv[3], "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
