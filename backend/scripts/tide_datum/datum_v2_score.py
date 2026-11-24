"""Score a v2 parity artifact (parity_coops.py --stations) against gates/tide-datum-parity-v2.md (#1210). Committed
before the v2 run.

Order (VOID-only controls first; the bar is opened only if all pass; no re-run):
  REPLACEMENT  per stratum, a deciding station whose artifact row says "FES undefined" is replaced by the next scored
               reserve of the same stratum, in the frozen order; at most CAP per stratum, else the stratum is NOT
               MEASURABLE (the gate FAILS). No other replacement.
  CONTROLS     planted-D identity at NEIGHBOR stations (model_tb vs nsheet_tb: same event times within 0.1 min, signed
               heights differ by exactly d_nsheet - d_model within 0.002 m); finder heights (finder_check --stations
               JSON: hourly median |h| <= 0.01 m at every MEASURED deciding station); PLACEBO as an EXACT SHIFT
               IDENTITY (gate amendment 1, #1270): per stratum, median signed(placebo_tb) - median signed(hybrid_tb)
               over the SAME matched events (paired by NOAA time at the MEASURED stations, MEASURED decided by
               hybrid_tb alone) = +0.10 m within 0.002 m. Independent of the outcome: it can never turn a FAIL
               into a VOID.
  BAR          per stratum, on hybrid_tb over MEASURED stations (>= 70% and >= 8 NOAA events matched, else a FAIL):
               median |h| <= 0.03; p90 <= 0.08 (nearest rank); per-station median <= 0.10 at >= 19 of 20; median signed
               within +-0.02. PRIMARY: PASS iff BOTH strata pass all four (intersection).
  REPORTED     pooled 40 (event-pooled, station-equal, population-weighted 96 : 1014), model and nsheet variants per
               stratum, raw band.

    python scripts/tide_datum/datum_v2_score.py --artifact a.json --heldout heldout.json --finder finder.json --json out.json
"""
import argparse
import json
import statistics as st
from pathlib import Path

try:
    from datum_gate_score import measured, p90
except ImportError:                                               # imported as scripts.tide_datum.datum_v2_score
    from scripts.tide_datum.datum_gate_score import measured, p90

CAP = 5
BAR = {"median": 0.03, "p90": 0.08, "gauge": 0.10, "gauges_needed": 19, "signed": 0.02}
ID_TIME_MIN, ID_HEIGHT_M, FINDER_H_M = 0.1, 0.002, 0.01
PLACEBO_SHIFT_M, PLACEBO_TOL_M = 0.10, 0.002
MIN_IDENTITY_STATIONS, MIN_MEASURED_PER_STRATUM, COLOCATED_KM = 10, 8, 0.05   # gate amendment 2 (#1270 s10)


def placebo_identity(per, ids, measured_ids):
    """PURE (gate amendment 1): {ok, diff_m, events} for one stratum. Both medians on the SAME frozen events: at each
    MEASURED station, the NOAA events matched in BOTH hybrid_tb and placebo_tb, paired by NOAA event time."""
    h, p = [], []
    for sid in ids:
        if sid not in measured_ids:
            continue
        row = per.get(sid) or {}
        a = {e["time"]: e["height_err_m"] for e in row.get("hybrid_tb_events") or [] if e.get("height_err_m") is not None}
        b = {e["time"]: e["height_err_m"] for e in row.get("placebo_tb_events") or [] if e.get("height_err_m") is not None}
        for t in sorted(set(a) & set(b)):
            h.append(a[t])
            p.append(b[t])
    n_meas = sum(1 for sid in ids if sid in measured_ids)
    if not h or n_meas < MIN_MEASURED_PER_STRATUM:          # s10 (c'): never a vacuous PASS
        return {"ok": False, "diff_m": None, "events": len(h), "measured": n_meas}
    diff = st.median(p) - st.median(h)
    return {"ok": abs(diff - PLACEBO_SHIFT_M) <= PLACEBO_TOL_M, "diff_m": round(diff, 5), "events": len(h),
            "measured": n_meas}


def donor_distances(per, ids):
    """REPORTED, never a bar (s10 d): donor distances at the scored NEIGHBOR stations, co-located sheets flagged."""
    km = {sid: (per.get(sid) or {}).get("donor", {}).get("km") for sid in ids if (per.get(sid) or {}).get("donor")}
    vals = sorted(v for v in km.values() if v is not None)
    return {"count": len(vals), "min_km": vals[0] if vals else None, "median_km": st.median(vals) if vals else None,
            "max_km": vals[-1] if vals else None,
            "colocated": sorted(k for k, v in km.items() if v is not None and v <= COLOCATED_KM)}


def deciding_after_replacement(heldout, per, cap=CAP):
    """PURE: {stratum: {"ids": [...20...], "replaced": [[out, in]], "measurable": bool}}."""
    out = {}
    for k, s in heldout["strata"].items():
        reserve = [r for r in s["reserve"] if r in per]
        ids, replaced, ok = [], [], True
        for sid in s["deciding"]:
            if (per.get(sid) or {}).get("error") == "FES undefined":
                nxt = next((r for r in reserve if (per.get(r) or {}).get("error") != "FES undefined"
                            and r not in ids and r not in [x[1] for x in replaced]), None)
                if nxt is None or len(replaced) >= cap:
                    ok = False
                    continue
                replaced.append([sid, nxt])
                ids.append(nxt)
            else:
                ids.append(sid)
        out[k] = {"ids": ids, "replaced": replaced, "measurable": ok and len(ids) == len(s["deciding"])}
    return out


def identity(row):
    a = {e["time"]: e for e in row.get("model_tb_events") or [] if e.get("height_err_m") is not None}
    b = {e["time"]: e for e in row.get("nsheet_tb_events") or [] if e.get("height_err_m") is not None}
    d = row.get("d") or {}
    if "nsheet" not in d or "model" not in d:
        return True, 0.0, 0.0, 0
    dd = d["nsheet"] - d["model"]
    wt = wh = 0.0
    common = set(a) & set(b)
    for t in common:
        wt = max(wt, abs(a[t]["time_err_min"] - b[t]["time_err_min"]))
        wh = max(wh, abs((b[t]["height_err_m"] - a[t]["height_err_m"]) - dd))
    return wt <= ID_TIME_MIN and wh <= ID_HEIGHT_M, round(wt, 3), round(wh, 5), len(common)


def legs(per, ids, variant):
    gauges, pooled, meds = {}, [], []
    for sid in ids:
        ev = (per.get(sid) or {}).get(variant + "_events")
        if ev is None:
            gauges[sid] = {"measured": False, "pass_gauge": False}
            continue
        m = measured(ev)
        h = [e["height_err_m"] for e in ev if e.get("height_err_m") is not None]
        med = st.median([abs(x) for x in h]) if h else None
        m.update(median_abs_h_m=None if med is None else round(med, 4),
                 median_signed_h_m=round(st.median(h), 4) if h else None,
                 pass_gauge=bool(m["measured"] and med is not None and med <= BAR["gauge"]))
        gauges[sid] = m
        if m["measured"]:
            pooled += h
            meds.append(med)
    absd = [abs(x) for x in pooled]
    agg = {"events": len(pooled), "median_abs_h_m": round(st.median(absd), 4) if absd else None,
           "p90_abs_h_m": round(p90(absd), 4) if absd else None,
           "median_signed_h_m": round(st.median(pooled), 4) if pooled else None,
           "station_equal_median_abs_h_m": round(st.median(meds), 4) if meds else None,
           "gauges_pass": sum(1 for g in gauges.values() if g["pass_gauge"]), "n": len(ids)}
    lg = {"median": agg["median_abs_h_m"] is not None and agg["median_abs_h_m"] <= BAR["median"],
          "p90": agg["p90_abs_h_m"] is not None and agg["p90_abs_h_m"] <= BAR["p90"],
          "per_gauge": agg["gauges_pass"] >= BAR["gauges_needed"],
          "signed": agg["median_signed_h_m"] is not None and abs(agg["median_signed_h_m"]) <= BAR["signed"]}
    return {"aggregate": agg, "legs": lg, "pass": all(lg.values()), "gauges": gauges}


def score(art, heldout, finder):
    per = art["per_gauge"]
    dec = deciding_after_replacement(heldout, per)
    out = {"window_start": art.get("window_start"), "mode": art.get("mode"), "deciding": dec, "bar": BAR}
    measured_ids = [sid for k in dec for sid in dec[k]["ids"]
                    if per.get(sid, {}).get("hybrid_tb_events") is not None and measured(per[sid]["hybrid_tb_events"])["measured"]]
    ids_nb = dec.get("NEIGHBOR", {}).get("ids", [])
    ident = {sid: identity(per.get(sid) or {}) for sid in ids_nb if sid in measured_ids}
    tested = sorted(sid for sid, v in ident.items() if v[3] >= 1 and "nsheet" in ((per.get(sid) or {}).get("d") or {}))
    fin_bad = {sid: (finder.get(sid) or {}).get("hourly", {}).get("median_abs_h_m") for sid in measured_ids
               if (finder.get(sid) is None) or ((finder[sid]["hourly"].get("median_abs_h_m") or 0) > FINDER_H_M)}
    placebo = {k: placebo_identity(per, dec[k]["ids"], set(measured_ids)) for k in dec}
    placebo_ok = all(v["ok"] for v in placebo.values())
    out["controls"] = {"planted_d_identity": {"pass": all(v[0] for v in ident.values()) and len(tested) >= MIN_IDENTITY_STATIONS,
                                              "tested_stations": len(tested), "per_station": ident},
                       "finder_heights": {"pass": not fin_bad, "over_or_missing": fin_bad},
                       "placebo": {"pass": placebo_ok, "shift_identity_by_stratum": placebo}}
    out["donor_distance_km"] = donor_distances(per, ids_nb)
    if not all(c["pass"] for c in out["controls"].values()):
        out["verdict"] = "VOID"
        return out                                                # the bar is NOT opened
    out["strata"] = {k: legs(per, dec[k]["ids"], "hybrid_tb") for k in dec}
    ok = all(dec[k]["measurable"] for k in dec) and all(out["strata"][k]["pass"] for k in dec)
    out["verdict"] = "PASS" if ok else "FAIL"
    out["reported"] = {f"{k}:{v}": legs(per, dec[k]["ids"], v)["aggregate"] for k in dec for v in ("model_tb", "nsheet_tb", "hybrid")}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", required=True)
    ap.add_argument("--heldout", required=True)
    ap.add_argument("--finder", required=True)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    out = score(json.loads(Path(a.artifact).read_text(encoding="utf-8")),
                json.loads(Path(a.heldout).read_text(encoding="utf-8")),
                json.loads(Path(a.finder).read_text(encoding="utf-8"))["gauges"])
    print("VERDICT", out["verdict"], "| controls", {k: v["pass"] for k, v in out["controls"].items()})
    if "strata" in out:
        for k, v in out["strata"].items():
            print(k, v["legs"], v["aggregate"])
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
