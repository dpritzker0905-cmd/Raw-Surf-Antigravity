"""Offline, pre-registered test: which wind should the surf rating read (GFS, HRRR, the lane, the blend)?

Pre-registration: docs/weather-program/log/2026-11-14-advisor-wind-forcing-prereg.md (section 1). This script
implements that section and nothing else. It reads ONLY the matched rows `grade_wind_lane_ndbc.py --rows` wrote
(buoy-observed wind and three forecasts at the buoy) and the checked-in skill-weight table. No network, no
credentials, no backend.

Run from backend/:
    python scripts/wind_forcing_rating_test.py --rows <rows.jsonl> --out <result.json>
"""
import argparse
import inspect
import json
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from services.weather_pipeline import surf_rating as SR  # noqa: E402
from services.weather_pipeline import surf_point  # noqa: E402
from services.weather_pipeline.spot_ratings import wind_relation  # noqa: E402

SEED = 20261114
DRAWS = 2000
SURF_STATES = [(1.0, 10.0), (1.5, 14.0), (2.5, 12.0)]
NORMALS = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0]
COAST_OF = {"46": "west", "41": "east", "44": "east", "42": "gulf", "45": "lakes"}
FACING = {"west": 270.0, "east": 90.0, "gulf": 180.0, "lakes": None}
LEADS = [3, 12, 24, 36]
MIN_ROWS, MIN_DAYS = 300, 10
MATERIAL = 1.0
DIR_MIN_KT = 4.0
WEIGHTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "services", "weather_pipeline",
                       "wind_lane_skill_weights.json")


def _uv(kt, frm):
    r = math.radians(frm)
    return -kt * math.sin(r), -kt * math.cos(r)


def _from(u, v):
    return (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0


def blend(row, w):
    lu, lv = _uv(row["lane_kt"], row["lane_dir"])
    gu, gv = _uv(row["gfs_kt"], row["gfs_dir"])
    return w * row["lane_kt"] + (1 - w) * row["gfs_kt"], _from(w * lu + (1 - w) * gu, w * lv + (1 - w) * gv)


_cache = {}


def ratings(kt, frm):
    """(score, level) for the 24 fixed cases at this wind. Cached on the wind rounded to 0.01 kn / 0.01 deg."""
    key = (round(kt, 2), round(frm, 2))
    hit = _cache.get(key)
    if hit is None:
        ms = key[0] * SR.KT_TO_MS
        hit = [SR.compute_surf_rating(h, tp, ms, wind_from_deg=key[1], shore_normal_deg=n, swell_from_deg=n)
               for (h, tp) in SURF_STATES for n in NORMALS]
        _cache[key] = hit
    return hit


def m1_m2(arm, ref, only=None):
    idx = range(len(ref)) if only is None else only
    d = [abs((arm[i][0] or 0.0) - (ref[i][0] or 0.0)) for i in idx]
    same = [1.0 if arm[i][1] == ref[i][1] else 0.0 for i in idx]
    return sum(d) / len(d), sum(same) / len(same)


def gate(kt, frm, normal):
    return SR.wind_gate(kt * SR.KT_TO_MS, frm, normal) < 1.0


def boot(by_day, draws=DRAWS, seed=SEED):
    """by_day: {day: (sum, n)} of a per-row paired difference. Mean and day-block 95% interval."""
    days = sorted(by_day)
    tot_s = sum(by_day[d][0] for d in days)
    tot_n = sum(by_day[d][1] for d in days)
    rng = random.Random(seed)
    means = []
    for _ in range(draws):
        s = n = 0.0
        for _ in days:
            a, b = by_day[rng.choice(days)]
            s += a
            n += b
        means.append(s / n if n else 0.0)
    means.sort()
    return tot_s / tot_n, means[int(0.025 * draws)], means[int(0.975 * draws) - 1], int(tot_n)


def call(mean, lo, hi):
    if lo > 0 or hi < 0:
        return "MATERIAL" if abs(mean) >= MATERIAL else "detectable, not material"
    return "no difference shown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    # Breaking height: wind must not enter the height chain (pre-registered wiring fact).
    params = [p for p in inspect.signature(surf_point.estimate_surf_at).parameters if "wind" in p.lower()]
    assert not params, f"estimate_surf_at takes a wind argument: {params}"

    table = json.load(open(WEIGHTS))
    wmax = {reg: dict(zip(table["leads_h"], table["w_max"][reg])) for reg in ("west", "east")}

    rng_swap = random.Random(SEED)
    facing_idx = {c: [i for i in range(24) if NORMALS[i % 8] == f] for c, f in FACING.items() if f is not None}
    cells = defaultdict(lambda: defaultdict(list))   # cell -> name -> list of (day, value)
    counts = defaultdict(lambda: {"rows": 0, "days": set()})
    n_in = n_used = 0
    with open(a.rows) as fh:
        for line in fh:
            r = json.loads(line)
            n_in += 1
            coast = COAST_OF.get(str(r["id"])[:2])
            if coast is None or r.get("zone") != "full" or r["lead"] not in LEADS:
                continue
            if any(r.get(k) is None for k in ("obs_kt", "obs_dir", "gfs_kt", "gfs_dir", "lane_kt", "lane_dir",
                                             "raw_kt", "raw_dir")):
                continue
            n_used += 1
            day = r["cycle"][:8]
            even = (int(r["cycle"][6:8]) + int(r["cycle"][8:10]) // 6) % 2 == 0
            ref = ratings(r["obs_kt"], r["obs_dir"])
            arms = {"G": (r["gfs_kt"], r["gfs_dir"]), "H": (r["raw_kt"], r["raw_dir"]),
                    "L": (r["lane_kt"], r["lane_dir"])}
            reg = "west" if coast == "west" else "east"
            arms["B"] = blend(r, wmax[reg][r["lead"]])
            arms["O"] = (r["obs_kt"], r["obs_dir"])                          # C0
            arms["Gp3"] = (r["gfs_kt"] + 3.0, r["gfs_dir"])                  # C2
            arms["Grot"] = (r["gfs_kt"], (r["gfs_dir"] + 180.0) % 360.0)     # C3
            swap = rng_swap.random() < 0.5                                   # C1
            arms["nG"], arms["nL"] = (arms["L"], arms["G"]) if swap else (arms["G"], arms["L"])
            fac = FACING[coast]
            row_m = {}
            for name, (kt, frm) in arms.items():
                rt = ratings(kt, frm)
                m1, m2 = m1_m2(rt, ref)
                row_m[name] = {"m1": m1, "m2": m2}
                if fac is not None:
                    row_m[name]["m1c"] = m1_m2(rt, ref, facing_idx[coast])[0]
                    if r["obs_kt"] >= DIR_MIN_KT:
                        row_m[name]["m3"] = 1.0 if wind_relation(frm, fac) == wind_relation(r["obs_dir"], fac) else 0.0
                    go, ga = gate(r["obs_kt"], r["obs_dir"], fac), gate(kt, frm, fac)
                    if go:
                        row_m[name]["miss"] = 0.0 if ga else 1.0
                    else:
                        row_m[name]["false_alarm"] = 1.0 if ga else 0.0
            for sub in ("all", "coastal" if r.get("coastal") else "offshore"):
                cell = (coast, r["lead"], sub)
                counts[cell]["rows"] += 1
                counts[cell]["days"].add(day)
                for name, mm in row_m.items():
                    for k, v in mm.items():
                        cells[cell][f"{name}.{k}"].append((day, v, even))

    def mean(cell, key, even_only=False):
        v = [x[1] for x in cells[cell].get(key, []) if (x[2] or not even_only)]
        return (sum(v) / len(v), len(v)) if v else (None, 0)

    def paired(cell, ka, kb, even_only=False):
        xa, xb = cells[cell][ka], cells[cell][kb]
        by = defaultdict(lambda: [0.0, 0])
        for (d, va, ev), (_, vb, _) in zip(xa, xb):
            if ev or not even_only:
                by[d][0] += va - vb
                by[d][1] += 1
        if not by:
            return None
        m, lo, hi, n = boot({d: tuple(v) for d, v in by.items()})
        return {"diff": round(m, 4), "lo": round(lo, 4), "hi": round(hi, 4), "n": n, "call": call(m, lo, hi)}

    out = {"prereg": "docs/weather-program/log/2026-11-14-advisor-wind-forcing-prereg.md", "rows_read": n_in,
           "rows_used": n_used, "seed": SEED, "draws": DRAWS, "material_points": MATERIAL, "cells": []}
    for cell in sorted(counts):
        coast, lead, sub = cell
        c = counts[cell]
        testable = c["rows"] >= MIN_ROWS and len(c["days"]) >= MIN_DAYS and coast != "lakes"
        rec = {"coast": coast, "lead": lead, "subset": sub, "rows": c["rows"], "days": len(c["days"]),
               "testable": testable, "arms": {}, "arms_even": {}, "pairs": {}, "controls": {}}
        for arm in ("G", "H", "L"):
            rec["arms"][arm] = {k: (round(mean(cell, f"{arm}.{k}")[0], 4) if mean(cell, f"{arm}.{k}")[0] is not None
                                    else None) for k in ("m1", "m2", "m1c", "m3", "miss", "false_alarm")}
        for arm in ("G", "L", "B"):
            v = mean(cell, f"{arm}.m1", even_only=True)
            rec["arms_even"][arm] = {"m1": round(v[0], 4) if v[0] is not None else None, "n": v[1]}
        # a positive diff means the FIRST arm has the larger rating error (is worse)
        rec["pairs"]["L_minus_G"] = paired(cell, "L.m1", "G.m1")
        rec["pairs"]["H_minus_G"] = paired(cell, "H.m1", "G.m1")
        rec["pairs"]["L_minus_G_facing"] = paired(cell, "L.m1c", "G.m1c") if FACING[coast] is not None else None
        rec["pairs"]["B_minus_G_even"] = paired(cell, "B.m1", "G.m1", even_only=True)
        rec["pairs"]["B_minus_L_even"] = paired(cell, "B.m1", "L.m1", even_only=True)
        o_m1, o_m2, o_m3 = mean(cell, "O.m1")[0], mean(cell, "O.m2")[0], mean(cell, "O.m3")[0]
        rec["controls"]["C0_obs_as_forecast"] = {"m1": o_m1, "m2": o_m2, "m3": o_m3,
                                                 "holds": o_m1 == 0.0 and o_m2 == 1.0 and o_m3 in (1.0, None)}
        null = paired(cell, "nL.m1", "nG.m1")
        rec["controls"]["C1_null_swap"] = {**null, "includes_zero": null["lo"] <= 0 <= null["hi"]}
        pos = paired(cell, "Gp3.m1", "G.m1")
        rec["controls"]["C2_plus3kn"] = {**pos, "detected": pos["lo"] > 0}
        rot = mean(cell, "Grot.m3")[0]
        rec["controls"]["C3_rotated_m3"] = {"m3": round(rot, 4) if rot is not None else None,
                                            "holds": rot is None or rot < 0.40}
        out["cells"].append(rec)

    main_cells = [c for c in out["cells"] if c["subset"] == "all" and c["testable"]]
    out["controls_summary"] = {
        "C0_all_hold": all(c["controls"]["C0_obs_as_forecast"]["holds"] for c in main_cells),
        "C1_cells_excluding_zero": sum(1 for c in main_cells if not c["controls"]["C1_null_swap"]["includes_zero"]),
        "C2_all_detected": all(c["controls"]["C2_plus3kn"]["detected"] for c in main_cells),
        "C3_all_hold": all(c["controls"]["C3_rotated_m3"]["holds"] for c in main_cells),
        "testable_cells": len(main_cells)}
    cs = out["controls_summary"]
    out["run_valid"] = bool(cs["C0_all_hold"] and cs["C1_cells_excluding_zero"] <= 1 and cs["C2_all_detected"]
                            and cs["C3_all_hold"])
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, "w"), indent=1)

    print(f"rows read {n_in}, used {n_used}; run_valid={out['run_valid']}; controls {cs}")
    print("coast lead rows days | M1 G / H / L | L-G [95%] call | H-G call | even: B-G, B-L")
    for c in out["cells"]:
        if c["subset"] != "all":
            continue
        p = c["pairs"]
        fmt = lambda x: "n/a" if x is None else f"{x['diff']:+.2f} [{x['lo']:+.2f}, {x['hi']:+.2f}] {x['call']}"  # noqa: E731
        print(f"{c['coast']:5s} L{c['lead']:<2d} {c['rows']:5d} {c['days']:2d} {'' if c['testable'] else 'UNTESTABLE '}| "
              f"{c['arms']['G']['m1']} / {c['arms']['H']['m1']} / {c['arms']['L']['m1']} | {fmt(p['L_minus_G'])} | "
              f"{fmt(p['H_minus_G'])} | {fmt(p['B_minus_G_even'])} ; {fmt(p['B_minus_L_even'])}")


if __name__ == "__main__":
    main()
