#!/usr/bin/env python3
"""rework_gate.py - the POOLED multi-window flip gate for the 2026-11-04 reworks (round 7's r7_score.py, rebuilt on the
repo's own binding rule). Offline: reads evaluation-harness output directories only (truth.json + replay_<arm>.json),
never the network, never the app.

    python scripts/rework_gate.py --win W1=out_w1 --win W4=out_w4 --win W26=out_w26 --ref served \
        --arm SURF_SPECTRAL_K_1 --quantity hs_station --out gate.json

THE GATE (pre-registered in docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/):
  binding   eval_twoway.two_way_ci (D-066): spatial block (complete linkage <= 100 km) x UTC target day bootstrap of the
            mean absolute-error gain d = |ref - obs| - |cand - obs| (positive = candidate better), pooled over every
            window, >= 14 UTC days, stations the candidate never moves left out.
  better    lower bound > 0 AND the one-sided p (t on the two-way SE, df = days - 1) survives Holm across the arms.
  no harm   Holm over the season (window) and region (inside / outside the Bight polygon) strata on "worse"; any
            stratum significantly worse = FAIL.
  controls  on the reference's own pairs: identical = REFUSED (no change), 20% less error = PASS, 25% more = FAIL;
            a control that misbehaves makes every verdict INVALID.
  advisory  the station-cluster CI, per-station gain, bias before/after.
"""
import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import eval_scoring as sc  # noqa: E402
from services.weather_pipeline import eval_twoway as tw  # noqa: E402
from services.weather_pipeline.bight_hs_consensus import inside_bight  # noqa: E402

ALPHA = 0.05


def _ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load_window(path):
    tj = json.load(open(os.path.join(path, "truth.json"), encoding="utf-8"))
    truth = {sid: sorted((dict(o, time=_ts(o["time"])) for o in recs), key=lambda o: o["time"])
             for sid, recs in tj["records"].items()}
    reps = {}
    for f in os.listdir(path):
        if f.startswith("replay_") and f.endswith(".json"):
            reps[f[len("replay_"):-len(".json")]] = json.load(open(os.path.join(path, f), encoding="utf-8"))["rows"]
    if "served" not in reps:
        raise SystemExit(f"{path}: no replay_served.json")
    ts = sorted(datetime.strptime(r["valid"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) for r in reps["served"])
    return truth, reps, sc.clim_embargo(ts[0], ts[-1], 72)


def items(q, ref_rows, cand_rows, truth, stations, emb, tag):
    a, _ = sc.build_items(q, ref_rows, truth, stations, None, clim_embargo=emb)
    b, _ = sc.build_items(q, cand_rows, truth, stations, None, clim_embargo=emb)
    out = []
    for i in sc.pair(a, b):
        st = stations[i["buoy"]]
        out.append({"buoy": i["buoy"], "t": i["t"], "lead": i["lead"], "obs": i["obs"], "f_ref": i["f_ref"],
                    "f_cand": i["f_cand"], "lat": st["lat"], "lng": st["lng"], "season": tag,
                    "region": "bight" if inside_bight(st["lat"], st["lng"]) else "outside"})
    return out


def p_one_sided(r, better=True):
    """One-sided p from the two-way mean / SE with the interval's own t df and day-factor correction."""
    se = (r.get("se") or 0.0) * math.sqrt(r.get("factor") or 1.0)
    if not r.get("computable") or se <= 0:
        return 1.0
    z = r["mean"] / se
    return 1.0 - tw.t_cdf(z, r["df"]) if better else tw.t_cdf(z, r["df"])


def holm(pairs, alpha=ALPHA):
    """Names whose p survives Holm (step-down) at alpha."""
    out, k = [], len(pairs)
    for idx, (name, p) in enumerate(sorted(pairs, key=lambda x: x[1])):
        if p <= alpha / (k - idx):
            out.append(name)
        else:
            break
    return out


def station_ci(its, reps=2000, seed=11):
    by = {}
    for i in its:
        by.setdefault(i["buoy"], []).append(tw._gain(i))
    ks = sorted(by)
    if len(ks) < 2:
        return None
    rng, vals = random.Random(seed), []
    for _ in range(reps):
        s = n = 0.0
        for _ in ks:
            g = by[ks[rng.randrange(len(ks))]]
            s, n = s + sum(g), n + len(g)
        vals.append(s / n)
    vals.sort()
    return [round(vals[int(0.025 * reps)], 4), round(vals[int(0.975 * reps) - 1], 4)]


def gate(its, reps=2000):
    if not its:
        return {"n": 0, "verdict": "REFUSED (no paired items)"}
    if all(i["f_cand"] == i["f_ref"] for i in its):
        return {"n": len(its), "gain": 0.0, "verdict": "REFUSED (no change)"}
    r = tw.two_way_ci(its, reps=reps)
    moved = [i for i in its if i["buoy"] not in set(r["untouched_stations"])]
    res = {"n": len(its), "n_moved": len(moved), "stations_moved": sorted({i["buoy"] for i in moved}),
           "untouched_stations": r["untouched_stations"], "days": r["days"], "blocks": r["blocks"],
           "gain": None if r.get("mean") is None else round(r["mean"], 4),
           "twoway_ci": None if not r.get("ci") else [round(x, 4) for x in r["ci"]],
           "computable": r["computable"], "reason": r.get("reason", ""),
           "p_better": round(p_one_sided(r, True), 6), "station_ci_advisory": station_ci(moved),
           "bias_ref": round(sum(i["f_ref"] - i["obs"] for i in moved) / len(moved), 4) if moved else None,
           "bias_cand": round(sum(i["f_cand"] - i["obs"] for i in moved) / len(moved), 4) if moved else None,
           "mae_ref": round(sum(abs(i["f_ref"] - i["obs"]) for i in moved) / len(moved), 4) if moved else None,
           "mae_cand": round(sum(abs(i["f_cand"] - i["obs"]) for i in moved) / len(moved), 4) if moved else None}
    if not r["computable"]:
        res["verdict"] = f"REFUSED ({r.get('reason')})"
        return res
    strata, harm = {}, []
    for key in ("season", "region"):
        for v in sorted({i[key] for i in moved}):
            sub = [i for i in moved if i[key] == v]
            if all(i["f_cand"] == i["f_ref"] for i in sub):
                continue
            rs = tw.two_way_ci(sub, reps=max(500, reps // 2), min_days=min(tw.MIN_DAYS, len({i["t"].date() for i in sub})))
            if not rs["computable"]:
                strata[f"{key}={v}"] = {"n": len(sub), "computable": False, "reason": rs.get("reason")}
                continue
            pw = p_one_sided(rs, better=False)
            strata[f"{key}={v}"] = {"n": len(sub), "days": rs["days"], "gain": round(rs["mean"], 4),
                                   "ci": [round(x, 4) for x in rs["ci"]], "p_worse": round(pw, 6)}
            harm.append((f"{key}={v}", pw))
    res["strata"] = strata
    res["holm_worse"] = holm(harm)
    per = {}
    for s in sorted({i["buoy"] for i in its}):
        sub = [i for i in its if i["buoy"] == s]
        per[s] = {"n": len(sub), "gain": round(sum(tw._gain(i) for i in sub) / len(sub), 4),
                  "bias_ref": round(sum(i["f_ref"] - i["obs"] for i in sub) / len(sub), 4),
                  "bias_cand": round(sum(i["f_cand"] - i["obs"] for i in sub) / len(sub), 4)}
    res["per_station"] = per
    res["verdict"] = "PASS" if res["twoway_ci"][0] > 0 and not res["holm_worse"] else "FAIL"
    return res


def controls(ref_items, reps=1000):
    out = {}
    for name, fac in (("null", 1.0), ("positive_0.8", 0.8), ("negative_1.25", 1.25)):
        rr = [dict(i, f_cand=i["f_ref"] if fac == 1.0 else i["obs"] + fac * (i["f_ref"] - i["obs"])) for i in ref_items]
        g = gate(rr, reps=reps)
        out[name] = {"verdict": g["verdict"], "twoway_ci": g.get("twoway_ci")}
    ok = (out["null"]["verdict"].startswith("REFUSED") and out["positive_0.8"]["verdict"] == "PASS"
          and out["negative_1.25"]["verdict"] == "FAIL")
    return out, ok


def run(wins, ref, arms, quantities, stations_path, reps=2000, reference_arms=()):
    stations = {s["id"]: s for s in json.load(open(stations_path, encoding="utf-8"))["stations"]}
    pooled, ref_pool, served_meta = {}, {}, {}
    for tag, path in wins:
        truth, reps_rows, emb = load_window(path)
        served_meta[tag] = {"rows": len(reps_rows["served"]), "arms": sorted(reps_rows)}
        for q in quantities:
            ref_pool.setdefault(q, []).extend(items(q, reps_rows[ref], reps_rows[ref], truth, stations, emb, tag))
            for a in list(arms) + list(reference_arms):
                if a not in reps_rows:
                    raise SystemExit(f"{path}: no replay_{a}.json")
                pooled.setdefault((a, q), []).extend(items(q, reps_rows[ref], reps_rows[a], truth, stations, emb, tag))
    out = {"schema": "raw-surf.rework-gate.v1", "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "windows": dict(wins), "window_meta": served_meta, "ref": ref, "arms": {}, "controls": {}}
    ok_all = True
    for q in quantities:
        c, ok = controls(ref_pool[q])
        out["controls"][q] = {"cases": c, "ok": ok}
        ok_all = ok_all and ok
    for (a, q), its in sorted(pooled.items()):
        out["arms"][f"{a}|{q}"] = gate(its, reps=reps)
        if a in reference_arms:
            out["arms"][f"{a}|{q}"]["role"] = "reference (not a candidate; outside Holm across arms)"
    # Holm across arms on the primary (first) quantity: a PASS must also survive the multiplicity of arms.
    q0 = quantities[0]
    ps = [(a, out["arms"][f"{a}|{q0}"].get("p_better", 1.0)) for a in arms]
    survive = set(holm(ps))
    for a in arms:
        g = out["arms"][f"{a}|{q0}"]
        g["holm_across_arms_survives"] = a in survive
        if g["verdict"] == "PASS" and a not in survive:
            g["verdict"] = "FAIL (does not survive Holm across arms)"
        if not ok_all:
            g["verdict"] = "INVALID (controls failed)"
    out["primary"] = q0
    return out


def markdown(res):
    lines = [f"## Rework gate (pooled, D-066 two-way binding) - primary `{res['primary']}`", "",
             "| arm | quantity | n moved | days | blocks | gain m | two-way 95% CI | bias ref -> cand | Holm worse | verdict |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for k, g in res["arms"].items():
        a, q = k.split("|")
        lines.append(f"| {a} | {q} | {g.get('n_moved', g.get('n'))} | {g.get('days')} | {g.get('blocks')} | "
                     f"{g.get('gain')} | {g.get('twoway_ci')} | {g.get('bias_ref')} -> {g.get('bias_cand')} | "
                     f"{', '.join(g.get('holm_worse') or []) or '-'} | **{g['verdict']}** |")
    lines += ["", "Controls (on the reference's own pairs): " + "; ".join(
        f"{q}: {'ok' if c['ok'] else 'FAILED'} ({', '.join(f'{n} {v['verdict']}' for n, v in c['cases'].items())})"
        for q, c in res["controls"].items())]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--win", action="append", required=True, help="TAG=harness_out_dir; repeatable")
    ap.add_argument("--ref", default="served")
    ap.add_argument("--arm", action="append", required=True, help="replay file slug (replay_<slug>.json)")
    ap.add_argument("--reference-arm", action="append", default=[], help="scored, but not a candidate")
    ap.add_argument("--quantity", action="append", default=None, help="first = primary (default hs_station)")
    ap.add_argument("--stations", required=True)
    ap.add_argument("--reps", type=int, default=2000)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    wins = [tuple(w.split("=", 1)) for w in a.win]
    res = run(wins, a.ref, a.arm, a.quantity or ["hs_station"], a.stations, a.reps, a.reference_arm)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=1, default=str)
    md = markdown(res)
    with open(os.path.splitext(a.out)[0] + ".md", "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(md)
    print("GATE_JSON_BEGIN")
    print(json.dumps(res, default=str))
    print("GATE_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
