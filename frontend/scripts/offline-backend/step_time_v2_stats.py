"""Statistics for scn_scrub_step_time_v2.js, exactly as pre-registered (late-wash log section 6). Standard library only.

    python step_time_v2_stats.py AA.json [AB.json]

Per (device, cadence): steps that change the frame in BOTH blocks of a pair; pairs are adjacent blocks of one ABBA group (A1-B1, B2-A2),
matched on the key index. Paired difference = A minus B (ms). Median + 95 % bootstrap interval resampling ABBA groups (2,000, seed
20261116). Secondary: p95 per arm and its difference; long-task p95 difference. Outliers kept; also reported without steps > 1,000 ms.
AA sets the resolution R (interval half-width); AB is judged against the line only where R resolves it.
"""
import json
import random
import statistics
import sys

SEED, B, OUT_MS = 20261116, 2000, 1000.0
LINE_MED, LINE_P95, LINE_LONG = 5.0, 15.0, 15.0


def p95(xs):
    v = sorted(xs)
    return v[min(len(v) - 1, int(0.95 * len(v)))] if v else float("nan")


def pairs_by_group(rows, drop_outliers=False):
    """{group: [(a_step, b_step, a_long, b_long), ...]} for frame-changing steps measured in both blocks of a pair."""
    by = {}
    for r in rows:
        if r.get("changing") and r.get("stepMs") is not None:
            by[(r["group"], r["block"], r["k"])] = r
    blocks = {}
    for r in rows:
        blocks.setdefault(r["group"], {})[r["block"]] = r["pos"]
    out = {}
    for g, bl in blocks.items():
        order = sorted(bl)                       # 4 blocks: A B B A
        for a, b in ((order[0], order[1]), (order[3], order[2])):
            for k in range(64):
                x, y = by.get((g, a, k)), by.get((g, b, k))
                if not x or not y:
                    continue
                if drop_outliers and (x["stepMs"] > OUT_MS or y["stepMs"] > OUT_MS):
                    continue
                out.setdefault(g, []).append((x["stepMs"], y["stepMs"], x["longMs"], y["longMs"]))
    return out


def counts(rows):
    """6a: frame-changing steps per arm position, censored (not drawn within the window), superseded, and no-change keys (apart)."""
    c = {}
    for r in rows:
        pos = r['pos']
        d = c.setdefault(pos, {'changing': 0, 'censored': 0, 'superseded': 0, 'no_change_keys': 0})
        if not r.get('changing'):
            d['no_change_keys'] += 1
            continue
        d['changing'] += 1
        d['censored'] += bool(r.get('censored'))
        d['superseded'] += bool(r.get('superseded'))
    return c


def summarise(rows, drop_outliers=False):
    pg = pairs_by_group(rows, drop_outliers)
    flat = [p for v in pg.values() for p in v]
    if not flat:
        return None
    diffs = [a - b for a, b, _la, _lb in flat]
    rng = random.Random(SEED)
    groups = sorted(pg)
    meds, p95d = [], []
    for _ in range(B):
        sample = [p for g in (rng.choice(groups) for _ in groups) for p in pg[g]]
        meds.append(statistics.median([a - b for a, b, _x, _y in sample]))
        p95d.append(p95([a for a, *_ in sample]) - p95([b for _a, b, *_ in sample]))
    meds.sort(); p95d.sort()
    lo, hi = meds[int(0.025 * B)], meds[int(0.975 * B) - 1]
    plo, phi = p95d[int(0.025 * B)], p95d[int(0.975 * B) - 1]
    return {"n_pairs": len(flat), "groups": len(groups), "median_diff": round(statistics.median(diffs), 1),
            "median_ci": [round(lo, 1), round(hi, 1)], "R_median": round((hi - lo) / 2, 1),
            "p95_A": round(p95([a for a, *_ in flat]), 1), "p95_B": round(p95([b for _a, b, *_ in flat]), 1),
            "p95_diff": round(p95([a for a, *_ in flat]) - p95([b for _a, b, *_ in flat]), 1),
            "p95_diff_ci": [round(plo, 1), round(phi, 1)], "R_p95": round((phi - plo) / 2, 1),
            "long_p95_diff": round(p95([la for _a, _b, la, _lb in flat]) - p95([lb for *_x, lb in flat]), 1),
            "over_1s": sum(1 for a, b, *_ in flat if a > OUT_MS or b > OUT_MS), "counts": counts(rows)}


def cells(path):
    out = {}
    for s in json.load(open(path, encoding="utf-8")):
        key = f"{s['device']} {s['cadence']}ms"
        out[key] = {"error": s["error"]} if "error" in s else {"with": summarise(s["rows"]), "without": summarise(s["rows"], True)}
    return out


def main():
    aa = cells(sys.argv[1])
    ab = cells(sys.argv[2]) if len(sys.argv) > 2 else {}
    report = {}
    for key, a in aa.items():
        line = {"AA": a}
        if "error" in a or not a["with"]:
            print(f"{key}: A/A unusable {a}")
            report[key] = line
            continue
        res = a["with"]
        resolves = res["R_median"] <= LINE_MED and res["R_p95"] <= LINE_P95
        print(f"{key}: A/A median {res['median_diff']} {res['median_ci']} (R {res['R_median']}), p95 diff {res['p95_diff']} "
              f"{res['p95_diff_ci']} (R {res['R_p95']}), n {res['n_pairs']}, >1s {res['over_1s']}, counts {res['counts']} -> "
              f"{'resolves the line' if resolves else 'CANNOT resolve the 5 / 15 ms line'}")
        if key in ab and "error" not in ab[key] and ab[key]["with"]:
            m = ab[key]["with"]; w = ab[key]["without"]
            notworse = m["median_ci"][1] <= LINE_MED and m["p95_diff"] <= LINE_P95 and m["long_p95_diff"] <= LINE_LONG
            if resolves:
                verdict = "NOT WORSE (within the line)" if notworse else "WORSE than the line"
            else:
                # Registered: an unresolved cell is never a pass. It reads "not shown worse at the resolution" when the A/B meets the
                # line's numbers, else "worse" (the instrument saw a difference it can resolve no better than R).
                verdict = (f"not shown worse at the instrument's resolution of {res['R_median']} ms (median) / {res['R_p95']} ms (p95)"
                           if notworse else f"WORSE than the line (instrument resolution {res['R_median']} / {res['R_p95']} ms)")
            print(f"   A/B fix-kill median {m['median_diff']} {m['median_ci']}, p95 {m['p95_A']} vs {m['p95_B']} (d {m['p95_diff']}), "
                  f"long p95 d {m['long_p95_diff']}, n {m['n_pairs']}, >1s {m['over_1s']}; without >1s: median {w and w['median_diff']} "
                  f"{w and w['median_ci']}, p95 d {w and w['p95_diff']} -> {verdict}")
            line.update({"AB": ab[key], "resolves": resolves, "verdict": verdict})
        report[key] = line
    if len(sys.argv) > 3:
        json.dump(report, open(sys.argv[3], "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
