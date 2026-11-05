#!/usr/bin/env python3
"""rodeo_diagnostic.py - WHY does SURF_SPECTRAL_K read worse at Rodeo Beach (hb_proxy, 142p1)? A DIAGNOSTIC, not a
flip test (#727, 2026-11-05). Offline: reads the harness output directories of Actions run 41958242376 only.

THE QUESTION. Rodeo's truth is a PROXY: Komar-Gaughan on buoy 142p1's deshoaled Hs. 142p1 (SF Bar) is open water ~9 km
from the beach and has no K entry, so the proxy carries no headland shadow. Two readings of Rodeo's -0.195 m:
  (a) PROXY-BLIND: K's shelter is real, the proxy cannot see it, so ANY correct shelter scores as harm;
  (b) K-PATH DEFECT: something in K's path reads low whatever the shelter.

THE RULE, stated before this script was first run:
  - Per pair, K's single-train shelter ratio at the Rodeo entry for the pair's own forecast (Tp, direction) - the
    same `shelter_ratio` physics as the scope rule, at that pair's swell instead of the 14 s / 290 deg reference.
  - If the harm sits in the SHADOWED pairs (ratio < 0.6) and the EXPOSED pairs (ratio >= 0.8) show no harm
    (storm-block CI covering 0 or positive), the harm is explained by K's shelter -> consistent with (a), and the
    proxy cannot adjudicate Rodeo: a spot-level truth is needed before any spot-level K verdict.
  - If the EXPOSED pairs are also worse (CI below 0), the harm is not the shadow -> (b), a K-path defect, whatever
    the proxy.
  - Anything else is INCONCLUSIVE. Pismo (285p1, proxy from the sheltered Avila buoy, itself ratio 0.36) is the
    contrast, reported alongside.
Also reported: the regime (depth-capped or not) on each side, and K / served height ratios.

    python scripts/rodeo_diagnostic.py --win F1=dir --win F2=dir --win F3=dir \
        --stations scripts/eval_harness_stations_ca.json --out rodeo.json
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import rework_gate as rg  # noqa: E402
import rework_storm_gate as sg  # noqa: E402
from services.weather_pipeline import eval_scoring as sc  # noqa: E402
from services.weather_pipeline import eval_twoway as tw  # noqa: E402

RATIO_BINS = ((0.0, 0.6, "shadowed<0.6"), (0.6, 0.8, "partial0.6-0.8"), (0.8, 9.0, "exposed>=0.8"))
DIR_BINS = ((0, 250, "dir<250"), (250, 280, "dir250-280"), (280, 300, "dir280-300"), (300, 361, "dir>=300"))


def k_ratio(entry_key, tp, d):
    """K's Hs ratio for a 1 m single swell train at (tp, d) at a table entry (spectral_k_serving.shelter_ratio)."""
    from services.weather_pipeline import spectral_k_serving as S
    from services.weather_pipeline.spectral_k import DEEP_REF_M, hs_of, rebuild, shoal_to_depth
    tr = S.load_table()["transfers"][entry_key]
    E = rebuild([{"h": 1.0, "tp": float(tp), "dir": float(d), "kind": "swell"}])
    if E is None:
        return None
    ref = hs_of(shoal_to_depth(E.sum(axis=1), DEEP_REF_M, tr.depth_m))
    return hs_of(tr.apply(E)) / ref if ref > 0 else None


def entry_key_for(st):
    from services.weather_pipeline import spectral_k_serving as S
    a = st.get("anchor_spot")
    e = S.entry_for_point(a["lat"], a["lng"]) if a else None
    return e["key"] if e else None


def pairs(wins, stations, sid):
    out = []
    key = entry_key_for(stations[sid])
    for tag, path in wins:
        truth, rows, emb = rg.load_window(path)
        arm = next(a for a in rows if a != "served")
        a, _ = sc.build_items("hb_proxy", rows["served"], truth, stations, None, clim_embargo=emb)
        b, _ = sc.build_items("hb_proxy", rows[arm], truth, stations, None, clim_embargo=emb)
        idx = {(r["station"], r["valid"], int(r["lead_h"])): r for r in rows["served"] if r.get("anchor")}
        kdx = {(r["station"], r["valid"], int(r["lead_h"])): r for r in rows[arm] if r.get("anchor")}
        for k, ia in a.items():
            if k[0] != sid or k not in b:
                continue
            vk = (k[0], k[1].strftime("%Y-%m-%dT%H:%MZ"), k[2])
            rs, rk = idx.get(vk), kdx.get(vk)
            if rs is None or rk is None:
                continue
            inp = rs.get("inputs") or {}
            tp, d = inp.get("tp_s"), inp.get("swell_from_deg")
            ratio = k_ratio(key, tp, d) if (key and tp and d is not None) else None
            out.append({"buoy": sid, "t": k[1], "lead": k[2], "obs": ia["obs"], "f_ref": ia["f"],
                        "f_cand": b[k]["f"], "lat": stations[sid]["lat"], "lng": stations[sid]["lng"],
                        "season": tag, "tp": tp, "dir": d, "ratio": ratio, "obs_hs": ia.get("obs_hs"),
                        "regime_ref": (rs.get("outputs") or {}).get("surf_regime"),
                        "regime_cand": (rk.get("outputs") or {}).get("surf_regime")})
    return out


def summarise(its):
    if not its:
        return {"n": 0}
    n = len(its)
    r = sg.storm_ci(its, reps=1000, min_days=min(sg.MIN_DAYS, len({tw._day(i["t"]) for i in its})))
    hr = [i["f_cand"] / i["f_ref"] for i in its if i["f_ref"]]
    return {"n": n, "days": r["days"], "gain": round(sum(tw._gain(i) for i in its) / n, 4),
            "ci": None if not r.get("ci") else [round(x, 4) for x in r["ci"]],
            "bias_ref": round(sum(i["f_ref"] - i["obs"] for i in its) / n, 4),
            "bias_cand": round(sum(i["f_cand"] - i["obs"] for i in its) / n, 4),
            "k_over_served_median": round(sorted(hr)[len(hr) // 2], 3) if hr else None}


def binned(its, field, bins):
    out = {}
    for lo, hi, name in bins:
        out[name] = summarise([i for i in its if i[field] is not None and lo <= i[field] < hi])
    return out


def regimes(its):
    c = {}
    for i in its:
        k = f"{i['regime_ref']}->{i['regime_cand']}"
        c[k] = c.get(k, 0) + 1
    return dict(sorted(c.items(), key=lambda x: -x[1]))


def reading(by_ratio):
    sh, ex = by_ratio.get("shadowed<0.6", {}), by_ratio.get("exposed>=0.8", {})
    if ex.get("ci") and ex["ci"][1] < 0:
        return "K-PATH DEFECT (b): exposed pairs are worse too"
    if sh.get("ci") and sh["ci"][1] < 0 and ex.get("ci") and ex["ci"][1] >= 0:
        return "SHADOW-DRIVEN, consistent with PROXY-BLIND (a): harm sits in the shadowed pairs only"
    return "INCONCLUSIVE"


def run(wins, stations_path):
    stations = {s["id"]: s for s in json.load(open(stations_path, encoding="utf-8"))["stations"]}
    out = {"schema": "raw-surf.rodeo-diagnostic.v1", "windows": dict(wins), "stations": {}}
    for sid in ("142p1", "285p1"):
        its = pairs(wins, stations, sid)
        by_ratio = binned(its, "ratio", RATIO_BINS)
        out["stations"][sid] = {"entry": entry_key_for(stations[sid]), "all": summarise(its),
                                "by_k_ratio": by_ratio, "by_direction": binned(its, "dir", DIR_BINS),
                                "by_obs_hs": binned(its, "obs_hs", ((0, 1, "<1m"), (1, 2, "1-2m"), (2, 99, ">=2m"))),
                                "regimes": regimes(its), "reading": reading(by_ratio)}
    return out


def markdown(res):
    L = ["## Rodeo diagnostic (hb_proxy, served vs SURF_SPECTRAL_K=1)", ""]
    for sid, s in res["stations"].items():
        L += [f"### {sid} (entry {s['entry']}): **{s['reading']}**", "",
              "| bin | n | days | gain m | storm-block CI | bias served -> K | K/served median |", "|---|---|---|---|---|---|---|"]
        for group in ("all", "by_k_ratio", "by_direction", "by_obs_hs"):
            items = [("all", s["all"])] if group == "all" else list(s[group].items())
            for name, v in items:
                L.append(f"| {name} | {v.get('n')} | {v.get('days')} | {v.get('gain')} | {v.get('ci')} | "
                         f"{v.get('bias_ref')} -> {v.get('bias_cand')} | {v.get('k_over_served_median')} |")
        L += ["", "regimes served->K: " + json.dumps(s["regimes"]), ""]
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--win", action="append", required=True)
    ap.add_argument("--stations", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run([tuple(w.split("=", 1)) for w in a.win], a.stations)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=1, default=str)
    md = markdown(res)
    print(md)
    print("RODEO_JSON_BEGIN")
    print(json.dumps(res, default=str))
    print("RODEO_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
