"""Score a parity_coops v2 artifact against gates/tide-datum-parity-v1.md (#1183). Committed BEFORE the run's artifact
was opened (2026-11-23, run 45102683907).

Order (the advisor's ruling on #1183 s9): VOID controls first, then the bar. A failed control = VOID (a new tag plus the
owner's word), never a re-read of the bar.
  CONTROL planted-D identity (s9.1): per MEASURED gauge, for every NOAA event both tidal-band variants matched, the time
          errors agree within 0.1 min and (sheet - model) signed height error = d_sheet - d_model within 0.002 m.
  CONTROL finder heights (s9.2): from finder_check.py --all26 (a separate JSON): median |h| <= 0.01 m at every MEASURED
          gauge (hourly sampling, as served).
  MEASURED (s8): matched >= 70% of NOAA's events AND matched >= 8; else NOT MEASURED = a FAIL in the per-gauge leg.
  BAR (s3), per variant on the TIDAL BAND: median |h| <= 0.03 m; p90 |h| <= 0.08 m (nearest rank); per gauge median |h|
          <= 0.10 m at >= 24 of 26 (MEASURED only); median signed error within +-0.02 m. Aggregates over the matched events
          of MEASURED gauges. VERDICT on the MODEL variant; a sheet failure is a named limit on the fallback.
  Reported outside the verdict: raw-band heights, timing.

    python scripts/tide_datum/datum_gate_score.py --artifact tide_mllw_parity.json --finder finder26.json --json out.json
"""
import argparse
import json
import statistics as st
from pathlib import Path

MIN_SHARE, MIN_MATCHED = 0.70, 8
BAR = {"median": 0.03, "p90": 0.08, "gauge": 0.10, "gauges_needed": 24, "signed": 0.02}
ID_TIME_MIN, ID_HEIGHT_M, FINDER_H_M = 0.1, 0.002, 0.01


def p90(values):
    v = sorted(values)
    return v[max(0, -(-9 * len(v) // 10) - 1)] if v else None


def measured(events):
    n = len(events)
    m = sum(1 for e in events if e.get("height_err_m") is not None)
    return {"noaa_events": n, "matched": m, "share": round(m / n, 3) if n else 0.0,
            "measured": bool(n) and m / n >= MIN_SHARE and m >= MIN_MATCHED}


def identity(row):
    """PURE: planted-D identity at one gauge -> (ok, worst_time_min, worst_height_m, pairs)."""
    a = {e["time"]: e for e in row.get("model_tb_events") or [] if e.get("height_err_m") is not None}
    b = {e["time"]: e for e in row.get("sheet_tb_events") or [] if e.get("height_err_m") is not None}
    dd = (row.get("d_sheet") or 0.0) - (row.get("d_model") or 0.0)
    wt = wh = 0.0
    pairs = 0
    for t in set(a) & set(b):
        pairs += 1
        wt = max(wt, abs(a[t]["time_err_min"] - b[t]["time_err_min"]))
        wh = max(wh, abs((b[t]["height_err_m"] - a[t]["height_err_m"]) - dd))
    return wt <= ID_TIME_MIN and wh <= ID_HEIGHT_M, round(wt, 2), round(wh, 4), pairs


def score_variant(per, variant):
    gauges, pooled = {}, []
    for sid, row in per.items():
        ev = row.get(variant + "_events")
        if ev is None:
            gauges[sid] = {"measured": False, "why": row.get("error") or "variant absent", "pass_gauge": False}
            continue
        m = measured(ev)
        h = [e["height_err_m"] for e in ev if e.get("height_err_m") is not None]
        med = st.median([abs(x) for x in h]) if h else None
        m.update(median_abs_h_m=round(med, 4) if med is not None else None,
                 median_signed_h_m=round(st.median(h), 4) if h else None,
                 pass_gauge=bool(m["measured"] and med is not None and med <= BAR["gauge"]))
        gauges[sid] = m
        if m["measured"]:
            pooled += h
    absd = [abs(x) for x in pooled]
    agg = {"events": len(pooled),
           "median_abs_h_m": round(st.median(absd), 4) if absd else None,
           "p90_abs_h_m": round(p90(absd), 4) if absd else None,
           "median_signed_h_m": round(st.median(pooled), 4) if pooled else None,
           "gauges_pass": sum(1 for g in gauges.values() if g["pass_gauge"]), "gauges_total": len(per),
           "not_measured": sorted(k for k, g in gauges.items() if not g["measured"])}
    legs = {"median": agg["median_abs_h_m"] is not None and agg["median_abs_h_m"] <= BAR["median"],
            "p90": agg["p90_abs_h_m"] is not None and agg["p90_abs_h_m"] <= BAR["p90"],
            "per_gauge": agg["gauges_pass"] >= BAR["gauges_needed"],
            "signed": agg["median_signed_h_m"] is not None and abs(agg["median_signed_h_m"]) <= BAR["signed"]}
    return {"aggregate": agg, "legs": legs, "pass": all(legs.values()), "gauges": gauges}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", required=True)
    ap.add_argument("--finder", required=True)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    art = json.loads(Path(a.artifact).read_text(encoding="utf-8"))
    fin = json.loads(Path(a.finder).read_text(encoding="utf-8"))["gauges"]
    per = art["per_gauge"]
    out = {"artifact_generated_at": art.get("generated_at"), "bar": BAR}
    model, sheet = score_variant(per, "model_tb"), score_variant(per, "sheet_tb")
    ids = {sid: identity(row) for sid, row in per.items() if model["gauges"].get(sid, {}).get("measured")}
    id_ok = all(v[0] for v in ids.values()) and bool(ids)
    fin_bad = {sid: fin[sid]["hourly"]["median_abs_h_m"] for sid in fin
               if model["gauges"].get(sid, {}).get("measured") and (fin[sid]["hourly"]["median_abs_h_m"] or 0) > FINDER_H_M}
    out["controls"] = {"planted_d_identity": {"pass": id_ok, "per_gauge": {k: list(v) for k, v in ids.items()}},
                       "finder_heights": {"pass": not fin_bad, "over": fin_bad}}
    out["void"] = not (id_ok and not fin_bad)
    out["model_tb"], out["sheet_tb"] = model, sheet
    out["reported_raw"] = {v: art.get("all", {}).get(v) for v in ("model", "sheet", "model_tb", "sheet_tb")}
    out["verdict"] = ("VOID" if out["void"] else "PASS" if model["pass"] else "FAIL")
    out["sheet_limit"] = (not out["void"]) and model["pass"] and not sheet["pass"]
    print("VERDICT", out["verdict"], "| controls", out["controls"]["planted_d_identity"]["pass"],
          out["controls"]["finder_heights"]["pass"], "| model legs", model["legs"], model["aggregate"],
          "| sheet pass", sheet["pass"], sheet["legs"])
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
