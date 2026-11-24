"""The tide-a-harcon-v1 SCORER (gates/tide-a-harcon-v1.md s4-s6; precedence as tide-datum-parity-v2 s11). PURE over
the instrument's JSON (a_harcon_parity.py), the vendored finder's JSON (finder_check.py --stations) and the frozen
station JSON. No network.

  1. FINDER (C1): finder median |h| <= 0.01 m at every scored station, else VOID.
  2. TESTED MISMATCHES, VOID ANYWHERE (#1270 s11 / #1171 ruling): C2 (own constants reproduce NOAA: median |h| <= 0.01 m
     and median |t| <= 2 min) at every scored station AND every donor used; C3 (w = 0 -> fes, w = 1 -> donor, within
     1e-6 m); C4 (no donor is itself or another scored station).
  3. MEASURABILITY: per stratum, the FINAL scored set after replacement (s4: FES undefined, the donor has no constants,
     or no donor remains; re-selected after each replacement; at most 5 per stratum). FAIL, never VOID, if n < 19
     MEASURED under fes, a sixth replacement, or any harcon measurability loss; untestable identities are vacuous there.
  4. VACUITY: in a full run (no stratum thin), a C2 untestable or a missing C3 at a scored station or donor is VOID.
  5. THE BAR (s5): HARBOR_BAY legs (a)-(f), OPEN_COAST (g)-(i), on the TIDAL BAND. PASS only if all nine hold.

    python scripts/tide_datum/a_harcon_score.py --run run.json --finder finder.json --out score.json
"""
import argparse
import json
import math
import statistics as st
from pathlib import Path

FINDER_H_M, ID_H_M, ID_T_MIN, C3_TOL_M = 0.01, 0.01, 2.0, 1e-6
N_NEED, MAX_REPL, NEAR_TWIN_KM = 19, 5, 1.0
ABS_H, ABS_T, REL, FLOOR_H, FLOOR_T, WIN_FRAC = 0.10, 20.0, 0.80, 0.03, 5.0, 0.75
NI_H, NI_T, WORSE_H, WORSE_T, MAX_WORSE = 0.02, 5.0, 0.05, 15.0, 2
MLLW_P90_M = 0.08


def p90(vals):
    """Nearest rank: the ceil(0.9 n)-th smallest."""
    v = sorted(vals)
    return v[max(0, math.ceil(0.9 * len(v)) - 1)] if v else None


def station_stats(rows):
    """PURE: (measured, median |h|, median |t|, matched, n) over match_events rows (#1183 s8: >= 70 % and >= 8)."""
    m = [r for r in rows or [] if r.get("height_err_m") is not None]
    n = len(rows or [])
    measured = len(m) >= 8 and len(m) >= 0.7 * n
    if not m:
        return measured, None, None, 0, n
    return (measured, st.median(abs(r["height_err_m"]) for r in m), st.median(abs(r["time_err_min"]) for r in m),
            len(m), n)


def identity_ok(c2):
    """(status, detail): 'pass' / 'mismatch' / 'untestable' for one C2 record."""
    if not c2 or "rows" not in c2:
        return "untestable", (c2 or {}).get("error", "missing")
    ok, h, t, matched, n = station_stats(c2["rows"])
    if not matched:
        return "untestable", "no matched events"
    good = h <= ID_H_M and t <= ID_T_MIN
    return ("pass" if good else "mismatch"), {"median_h_m": h, "median_t_min": t, "matched": matched, "n": n}


def resolve(per, stations_doc):
    """PURE: the FINAL scored set and each station's donor, by s4's replacement rule with donors re-selected after each
    replacement. Returns {stratum: {ids, replaced, measurable}}, {sid: donor entry or None}, {sid: cause}."""
    strata = {k: {"order": list(v["deciding"]), "reserve": list(v["reserve"][:MAX_REPL]), "replaced": []}
              for k, v in stations_doc["strata"].items()}
    causes = {}
    for _ in range(200):
        scored = {i for s in strata.values() for i in s["order"]}
        donors, need = {}, []
        for k, s in strata.items():
            for sid in s["order"]:
                row = per.get(sid) or {}
                d = next((e for e in row.get("donors") or [] if e["id"] not in scored), None)
                donors[sid] = d
                cause = ("FES undefined" if row.get("fes_undefined") else
                         None if "fes_tb" not in row and row.get("error") else
                         "no donor remains" if d is None else
                         "donor has no constants" if not d.get("has_constants") else None)
                if cause:
                    need.append((k, sid, cause))
        if not need:
            break
        k, sid, cause = need[0]
        s = strata[k]
        causes[sid] = cause
        nxt = next((r for r in s["reserve"] if r not in s["order"] and r not in [b for _, b in s["replaced"]]), None)
        s["replaced"].append([sid, nxt])
        if nxt is None or len(s["replaced"]) > MAX_REPL:
            s["order"].remove(sid)
            s["exhausted"] = True
        else:
            s["order"][s["order"].index(sid)] = nxt
    out = {k: {"ids": s["order"], "replaced": s["replaced"], "measurable": not s.get("exhausted")}
           for k, s in strata.items()}
    return out, donors, causes


def legs(per, donors, ids, band="tb"):
    """PURE: per-station medians on both arms over the stations MEASURED under fes, and s5's quantities."""
    rows, loss = {}, []
    for sid in ids:
        r = per.get(sid) or {}
        f = station_stats(r.get(f"fes_{band}"))
        d = donors.get(sid) or {}
        h = station_stats(d.get(f"harcon_{band}"))
        if not f[0]:
            continue
        if not h[0]:
            loss.append(sid)
        rows[sid] = {"fes_h": f[1], "fes_t": f[2], "harcon_h": h[1] if h[0] else math.inf,
                     "harcon_t": h[2] if h[0] else math.inf, "donor": d.get("id"), "km": d.get("km"), "w": d.get("w")}
    n = len(rows)
    q = {"n": n, "loss": loss}
    if n:
        q.update(p90_h_fes=p90([x["fes_h"] for x in rows.values()]), p90_h_harcon=p90([x["harcon_h"] for x in rows.values()]),
                 p90_t_fes=p90([x["fes_t"] for x in rows.values()]), p90_t_harcon=p90([x["harcon_t"] for x in rows.values()]),
                 wins_h=sum(1 for x in rows.values() if x["harcon_h"] < x["fes_h"]),
                 wins_t=sum(1 for x in rows.values() if x["harcon_t"] < x["fes_t"]),
                 worse=sorted(s for s, x in rows.items() if x["harcon_h"] - x["fes_h"] > WORSE_H
                              or x["harcon_t"] - x["fes_t"] > WORSE_T))
    return q, rows


def bar(stratum, q):
    """PURE: s5's legs for one stratum."""
    n = q["n"]
    if stratum == "HARBOR_BAY":
        need = math.ceil(WIN_FRAC * n)
        return {"a_abs_h": q["p90_h_harcon"] <= ABS_H, "b_abs_t": q["p90_t_harcon"] <= ABS_T,
                "c_rel_h": q["p90_h_harcon"] <= max(REL * q["p90_h_fes"], FLOOR_H),
                "d_rel_t": q["p90_t_harcon"] <= max(REL * q["p90_t_fes"], FLOOR_T),
                "e_wins_h": q["wins_h"] >= need, "f_wins_t": q["wins_t"] >= need}
    return {"g_ni_h": q["p90_h_harcon"] <= q["p90_h_fes"] + NI_H, "h_ni_t": q["p90_t_harcon"] <= q["p90_t_fes"] + NI_T,
            "i_worse": len(q["worse"]) <= MAX_WORSE}


def event_p90(per, donors, ids, band="tb"):
    """Reported: event-level p90 |h| and |t| per arm, and the signed medians."""
    out = {}
    for arm in ("fes", "harcon"):
        ev = []
        for sid in ids:
            src = (per.get(sid) or {}).get(f"fes_{band}") if arm == "fes" else (donors.get(sid) or {}).get(f"harcon_{band}")
            ev += [r for r in src or [] if r.get("height_err_m") is not None]
        out[arm] = {"events": len(ev), "p90_h_m": p90([abs(r["height_err_m"]) for r in ev]),
                    "p90_t_min": p90([abs(r["time_err_min"]) for r in ev]),
                    "median_signed_h_m": st.median(r["height_err_m"] for r in ev) if ev else None}
    return out


def score(run, finder, stations_doc):
    per = run["per_station"]
    fin = finder.get("gauges", finder)
    final, donors, causes = resolve(per, stations_doc)
    scored = [i for s in final.values() for i in s["ids"]]
    out = {"gate": "gates/tide-a-harcon-v1.md", "window_start": run.get("window_start"), "final": final,
           "replacement_causes": causes,
           "donors": {s: {k: (donors.get(s) or {}).get(k) for k in ("id", "km", "w")} for s in scored},
           "near_twins": sorted(s for s in scored if (donors.get(s) or {}).get("km") is not None
                                and donors[s]["km"] < NEAR_TWIN_KM)}
    # 1. FINDER
    bad = {s: ((fin.get(s) or {}).get("hourly") or {}).get("median_abs_h_m") for s in scored
           if (((fin.get(s) or {}).get("hourly") or {}).get("median_abs_h_m") is None)
           or fin[s]["hourly"]["median_abs_h_m"] > FINDER_H_M}
    out["controls"] = {"c1_finder": {"pass": not bad, "over_or_missing": bad}}
    if bad:
        out["verdict"] = "VOID"
        return out
    # 2. MEASURABILITY
    q, rows = {}, {}
    for k, s in final.items():
        q[k], rows[k] = legs(per, donors, s["ids"])
    thin = {k: (not final[k]["measurable"]) or q[k]["n"] < N_NEED or bool(q[k]["loss"]) for k in final}
    out["measurability"] = {k: {"n": q[k]["n"], "replaced": final[k]["replaced"], "harcon_loss": q[k]["loss"],
                                "fail": thin[k]} for k in final}
    # 3. IDENTITIES
    c2 = {}
    for sid in scored:
        c2[f"station {sid}"] = identity_ok((per.get(sid) or {}).get("c2_station"))
        d = donors.get(sid) or {}
        if d:
            c2[f"donor {d['id']} (of {sid})"] = identity_ok(d.get("c2_donor"))
    c3 = {sid: [(donors.get(sid) or {}).get("c3_w0_max_m"), (donors.get(sid) or {}).get("c3_w1_max_m")] for sid in scored}
    c3_mism = sorted(s for s, (a, b) in c3.items() if a is not None and b is not None and (a > C3_TOL_M or b > C3_TOL_M))
    c3_missing = sorted(s for s, (a, b) in c3.items() if a is None or b is None)
    c4_bad = sorted(s for s in scored if (donors.get(s) or {}).get("id") in set(scored) | {s})
    mism = sorted(k for k, (status, _) in c2.items() if status == "mismatch")
    c2_vac = sorted(k for k, (s, _) in c2.items() if s == "untestable")
    out["controls"].update(c2_identity={"pass": not mism, "mismatch": mism, "untestable": c2_vac,
                                        "detail": {k: v for k, (_, v) in c2.items()}},
                           c3_blend={"pass": not c3_mism, "mismatch": c3_mism, "missing": c3_missing},
                           c4_loo={"pass": not c4_bad, "bad": c4_bad})
    out["strata"] = {k: {"quantities": q[k], "per_station": rows[k]} for k in final}
    out["reported"] = {k: {"event_tb": event_p90(per, donors, final[k]["ids"]),
                           "raw_band": legs(per, donors, final[k]["ids"], band="raw")[0]} for k in final}
    out["reported"]["harbor_mllw_forecast"] = {
        arm: sum(1 for sid in final.get("HARBOR_BAY", {}).get("ids", [])
                 if (p := event_p90(per, donors, [sid])[arm]["p90_h_m"]) is not None and p <= MLLW_P90_M)
        for arm in ("fes", "harcon")}
    # Precedence as ruled on #1270 s11 / #1171 (advisor HOLD on #1285): a TESTED mismatch is VOID anywhere, before the
    # measurability return; a thin stratum is FAIL with vacuous identities 'untestable'; vacuity VOIDs only when no
    # stratum is thin.
    if mism or c3_mism or c4_bad:
        out["verdict"] = "VOID"
        out["why"] = "a tested identity mismatch (C2, C3 or C4): the instrument, not the candidate, failed"
        return out
    if any(thin.values()):
        out["verdict"] = "FAIL"
        out["why"] = "measurability (s5 step 2; never VOID); untestable identities reported as vacuous"
        return out
    if c2_vac or c3_missing:
        out["verdict"] = "VOID"
        out["why"] = "a full run with an untestable identity (C2 untestable or C3 missing at a scored station or donor)"
        return out
    # 4. THE BAR
    for k in final:
        out["strata"][k]["legs"] = bar(k, q[k])
    ok = all(all(out["strata"][k]["legs"].values()) for k in final)
    out["verdict"] = "PASS" if ok else "FAIL"
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--finder", required=True)
    ap.add_argument("--stations", default=str(Path(__file__).resolve().parents[3] / "docs" / "weather-program" /
                                              "research" / "tide-a-harcon-v1-stations.json"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    run, finder, stations = (json.loads(Path(p).read_text(encoding="utf-8")) for p in (a.run, a.finder, a.stations))
    if not run.get("complete"):                # amendment 3: no score from an incomplete run file (no outcome)
        raise SystemExit("REFUSED: the run JSON is not complete; no score (amendment 3)")
    r = score(run, finder, stations)
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(r, fh, indent=1, default=str)
    print("VERDICT", r["verdict"], json.dumps(r.get("controls", {}), default=str)[:800])


if __name__ == "__main__":
    main()
