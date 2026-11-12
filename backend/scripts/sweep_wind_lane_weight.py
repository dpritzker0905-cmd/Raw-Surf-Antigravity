"""sweep_wind_lane_weight.py - fit a constant HRRR weight per region x lead on odd cycles, score it on even cycles.

WHY (log 2026-11-12-claude-wind-lane-skill-weights.md; the proposal in log 2026-11-11-claude-hrrr-wind-grade.md §4).
The 2026-11-11 grade found the HRRR wind lane (full HRRR weight L3-L36) WORSE than GFS on the West coast at every lead
and tied on the East, while the 50/50 blend on the time taper (L47) beat both. This sweep asks the next question: what
constant HRRR weight w (blend of the drawn lane at w = 1 and drawn GFS at w = 0) is best, by lead and region, judged on
cycles it was NOT fitted on. It is the 2026-11-11 session's scratch `wsweep.py`, committed (it never was), plus the
two-region fit that feeds `services/weather_pipeline/wind_lane_skill_weights.json`.

INPUT: the matched pairs `grade_wind_lane_ndbc.py --rows <rows.jsonl>` writes (one JSON object per buoy x cycle x lead:
obs_kt/obs_dir, lane_kt/lane_dir, gfs_kt/gfs_dir, coast, zone, coastal, cycle, lead). That script reads only public
archives (NOAA AWS HRRR + GFS, NDBC realtime2, which keeps 45 days); this one reads only its rows (no network).

THE BLEND AT THE BUOY: scalar speed w*lane + (1-w)*gfs, bearing from the blended vector (LESSONS L-S16), as
wind_lane._blend draws a node. Blending at the buoy, not at the nodes, is exact for the speed (bilinear is linear) and
differs for the bearing only through the vectors' magnitudes.

THE SPLIT: a row is "odd" when (day of month + cycle hour / 6) is odd, "even" otherwise; w is the grid value (0.0, 0.1,
... 1.0) with the lowest vector RMSE on the odd rows, scored on the even rows. Same split and grid as the scratch script.

CELLS:
  * the 28 published cells: leads 3/12/24/36 x {E+G+W pooled, East/Gulf/West x coastal/offshore}, full-weight buoys
    (space weight 1), Great Lakes excluded; "beats both" = held-out RMSE at the fitted w below GFS AND below the lane;
  * the table cells: leads 3/12/24/36 x region {west: WMO 46 (Pacific), east: WMO 41/42/44 (Atlantic + Gulf, pooled
    because the Gulf's 4 buoys are under the n 300 rule)}, coastal and offshore pooled, full-weight buoys.

USAGE (from backend/):
  python scripts/sweep_wind_lane_weight.py --rows <rows.jsonl> --out <sweep.json> [--table-out <table.json>]
"""
import argparse
import json
import sys

import numpy as np

LEADS = (3, 12, 24, 36)
W_GRID = np.round(np.arange(0.0, 1.0001, 0.1), 2)
TABLE_REGIONS = {"west": ("West",), "east": ("East", "Gulf")}


def _uv(s, d):
    r = np.radians(d)
    return -s * np.sin(r), -s * np.cos(r)


def _arrays(rows):
    g = {k: np.array([r[k] for r in rows], dtype=float)
         for k in ("obs_kt", "obs_dir", "lane_kt", "lane_dir", "gfs_kt", "gfs_dir")}
    g["ou"], g["ov"] = _uv(g["obs_kt"], g["obs_dir"])
    g["lu"], g["lv"] = _uv(g["lane_kt"], g["lane_dir"])
    g["gu"], g["gv"] = _uv(g["gfs_kt"], g["gfs_dir"])
    return g


def rmse(a, w):
    """Vector RMSE (kn) of the HRRR-weight-w blend of the drawn lane and drawn GFS, over arrays `a` (see _arrays)."""
    bu, bv = w * a["lu"] + (1 - w) * a["gu"], w * a["lv"] + (1 - w) * a["gv"]
    sp = w * a["lane_kt"] + (1 - w) * a["gfs_kt"]
    n = np.hypot(bu, bv)
    n[n < 1e-9] = 1.0
    fu, fv = sp * bu / n, sp * bv / n
    return float(np.sqrt(np.mean((fu - a["ou"]) ** 2 + (fv - a["ov"]) ** 2)))


def is_odd(row):
    c = row["cycle"]                                      # "YYYYMMDDHH"
    return bool((int(c[-2:]) // 6 + int(c[6:8])) % 2)


def fit_cell(rows):
    """The fitted weight and its held-out scores for one cell, or None when it has under 100 rows."""
    if len(rows) < 100:
        return None
    odd = _arrays([r for r in rows if is_odd(r)])
    even = _arrays([r for r in rows if not is_odd(r)])
    every = _arrays(rows)
    w = float(W_GRID[int(np.argmin([rmse(odd, x) for x in W_GRID]))])
    held = {"blend": rmse(even, w), "gfs": rmse(even, 0.0), "lane": rmse(even, 1.0)}
    return {"n": len(rows), "n_fit": int(len(odd["ou"])), "n_held_out": int(len(even["ou"])), "w": round(w, 2),
            "all_rows": {"gfs": rmse(every, 0.0), "half": rmse(every, 0.5), "lane": rmse(every, 1.0)},
            "held_out": held, "beats_both": held["blend"] < held["gfs"] and held["blend"] < held["lane"]}


def published_groups():
    g = {"all full": lambda r: r["zone"] == "full" and r["coast"] != "Lakes"}
    for c in ("East", "Gulf", "West"):
        g[c + " coastal"] = lambda r, c=c: r["zone"] == "full" and r["coast"] == c and r["coastal"]
        g[c + " offshore"] = lambda r, c=c: r["zone"] == "full" and r["coast"] == c and not r["coastal"]
    return g


def sweep(rows):
    published, table = [], []
    for L in LEADS:
        at_l = [r for r in rows if r["lead"] == L]
        for name, pred in published_groups().items():
            cell = fit_cell([r for r in at_l if pred(r)])
            if cell:
                published.append({"lead": L, "group": name, **cell})
        for region, coasts in TABLE_REGIONS.items():
            cell = fit_cell([r for r in at_l if r["zone"] == "full" and r["coast"] in coasts])
            if cell:
                table.append({"lead": L, "region": region, **cell})
    return published, table


def fmt(cells, key):
    out = [f"| lead | {key} | n | all rows GFS / w=0.5 / lane | fitted w (odd) | held-out (even) at w | GFS / lane there |"
           " beats both |", "|---|---|---|---|---|---|---|---|"]
    for c in cells:
        a, h = c["all_rows"], c["held_out"]
        out.append(f"| L{c['lead']} | {c[key]} | {c['n']} | {a['gfs']:.2f} / {a['half']:.2f} / {a['lane']:.2f} | "
                   f"{c['w']:.1f} | {h['blend']:.2f} | {h['gfs']:.2f} / {h['lane']:.2f} | "
                   f"{'yes' if c['beats_both'] else 'NO'} |")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--rows", required=True, help="grade_wind_lane_ndbc.py --rows output (JSON lines)")
    ap.add_argument("--out", required=True, help="the sweep's JSON (both cell sets)")
    ap.add_argument("--table-out", help="also write the fitted two-region table in the wind_lane_skill_weights format")
    a = ap.parse_args(argv)
    with open(a.rows, encoding="utf-8") as fh:
        rows = [json.loads(line) for line in fh if line.strip()]
    published, table = sweep(rows)
    cycles = sorted({r["cycle"] for r in rows})
    res = {"rows": len(rows), "cycles": [cycles[0], cycles[-1], len(cycles)] if cycles else None,
           "split": "odd = (day of month + cycle hour / 6) odd: fit; even: held out", "w_grid": W_GRID.tolist(),
           "published": published, "published_beats_both": [sum(c["beats_both"] for c in published), len(published)],
           "table": table, "table_beats_both": [sum(c["beats_both"] for c in table), len(table)]}
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=1)
    print(fmt(published, "group"))
    print(f"\npublished cells: held-out blend beats both members in {res['published_beats_both'][0]} of "
          f"{res['published_beats_both'][1]}\n")
    print(fmt(table, "region"))
    print(f"\ntable cells: held-out blend beats both members in {res['table_beats_both'][0]} of "
          f"{res['table_beats_both'][1]}")
    if a.table_out:
        tab = {"leads_h": list(LEADS), "w_max": {reg: [c["w"] for L in LEADS for c in table
                                                       if c["region"] == reg and c["lead"] == L]
                                                 for reg in TABLE_REGIONS},
               "n": {reg: [c["n"] for L in LEADS for c in table if c["region"] == reg and c["lead"] == L]
                     for reg in TABLE_REGIONS}}
        with open(a.table_out, "w", encoding="utf-8") as fh:
            json.dump(tab, fh, indent=1)
    return res


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
