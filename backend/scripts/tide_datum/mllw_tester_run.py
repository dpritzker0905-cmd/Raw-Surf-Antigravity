"""tide-mllw-tester-v1 runner (gates/tide-mllw-tester-v1.md): one cycle of the datum-only tester for SURF_TIDE_MLLW_US.

Reads ONLY the served tide table (weather bucket, GET) and NOAA CO-OPS (predictions + harcon.json), inside the read-only
network guard (T5). Never the Render backend. Writes, into --out: result.json (the build record), summary.md (the run
summary and the issue countdown comment), proposal.txt (non-empty only when (p1)-(p4) pass: the workflow opens ONE
`tide-mllw-proposal` issue; the flag is NEVER changed here, D-087), sheet-report.txt (the s11 owner report). The state
(history, the 15-build pool, replacements, the previous fleet flag) lives in --state, the job's cache.

  python backend/scripts/tide_datum/mllw_tester_run.py --state tide-mllw-state.json --out tide-mllw-out
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS, BACKEND = HERE.parent, HERE.parent.parent
for p in (HERE, SCRIPTS / "tide_fes", SCRIPTS / "tide_own", SCRIPTS, BACKEND):
    sys.path.insert(0, str(p))
import mllw_tester_core as C  # noqa: E402

STATIONS = BACKEND.parent / "docs" / "weather-program" / "research" / "tide-mllw-tester-v1-stations.json"
COOPS_HOST = "api.tidesandcurrents.noaa.gov"
COOPS = f"https://{COOPS_HOST}/api/prod/datagetter"
STALE_H, WIN_D, POOL_DAYS, DAYS, MISS_BUILDS = 36, 7, 15, 14, 2
K_SHIFT_TOL = 0.005


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(s):
    t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def noaa_hourly(sid, begin, end, datum="MLLW", opener=urllib.request.urlopen):
    """{aware hour: m} of NOAA's hourly predictions (datum, metric, GMT)."""
    q = (f"{COOPS}?product=predictions&application=raw_surf_tide_mllw_tester&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum={datum}&units=metric&time_zone=gmt"
         f"&interval=h&format=json").replace(" ", "%20")
    with opener(urllib.request.Request(q, headers={"User-Agent": "raw-surf-tide-mllw-tester/1"}), timeout=60) as r:
        rows = json.loads(r.read().decode("utf-8")).get("predictions", [])
    return {datetime.strptime(x["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc): float(x["v"])
            for x in rows if x.get("v") not in (None, "")}


def lp_noaa(harcon, hours):
    """LP_noaa (s10 item 1 + s12 REQ-1 amendment): the station's SA + SSA plus MM, MF and MSF, ALL in NOAA's predictor
    convention (metrics.noaa_long_period; noaa_lp.lp3), calibrated against NOAA's own predictions (REQ-1). Pure Python."""
    import noaa_lp
    from metrics import noaa_long_period
    sa = noaa_long_period([r for r in harcon if r[1] in ("SA", "SSA")], hours) if harcon else [0.0] * len(hours)
    return [float(a) + float(b) for a, b in zip(sa, noaa_lp.lp3(harcon, hours))]


def load_monitors(path=STATIONS):
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    strata = {k: list(v["monitor"]) for k, v in doc["strata"].items()}
    reserve = {k: list(v["reserve"]) for k, v in doc["strata"].items()}
    keys = {i: tuple(v["key"][i]) for v in doc["strata"].values() for i in v["monitor"] + v["reserve"]}
    return strata, reserve, keys


def sheet_share(doc, arm_m):
    """The share of served US keys (with M) whose D would come from a sheet: no positive model D in the table."""
    from services.weather_pipeline.tide_us_region import us_region
    d, us, sheet = doc.get("d") or {}, 0, 0
    for k, vals in arm_m.items():
        la, lo = (float(x) for x in k.split(","))
        if not us_region(la, lo) or (doc.get("m") or {}).get(k) is None or not any(v is not None for v in vals):
            continue
        us += 1
        dv = d.get(k)
        sheet += not (isinstance(dv, (int, float)) and math.isfinite(dv) and dv > 0)
    return (sheet / us) if us else None


def inputs_record(doc, monitors=None):
    """INPUTS ONLY (s11 + s10 item 1; the advisor: before any prediction read): per frozen monitor and reserve, whether
    its key has a served A + M, our model D (MODEL) or not (NOT MEASURED until filled), and the FES-side LP4 amplitudes
    the build recorded; plus the per-stratum counts. Reads only the table; never NOAA."""
    strata, reserve, keys = monitors or load_monitors()
    d, m, amps = doc.get("d") or {}, doc.get("m") or {}, doc.get("am_lp_amp") or {}
    rows, counts = {}, {}
    for k in strata:
        c = {"MODEL": 0, "NOT_MEASURED": 0}
        for role, ids in (("monitor", strata[k]), ("reserve", reserve[k])):
            for sid in ids:
                ks = f"{float(keys[sid][0]):.1f},{float(keys[sid][1]):.1f}"
                dv = d.get(ks)
                model = isinstance(dv, (int, float)) and math.isfinite(dv) and dv > 0 and m.get(ks) is not None
                rows[sid] = {"stratum": k, "role": role, "key": ks, "has_m": m.get(ks) is not None,
                             "model_d_m": dv if model else None, "fes_lp_amp_m": amps.get(ks)}
                if role == "monitor":
                    c["MODEL" if model else "NOT_MEASURED"] += 1
        counts[k] = c
    return {"build": doc.get("generated_at"), "counts": counts, "stations": rows,
            "am_lp_check": doc.get("am_lp_check"), "inputs_only": True}


def monitor_series(doc, arm_m, arm_lp, key, lat, lng, stations_loo, t0, hours):
    """(displayed, lp_ours, block) over [t0, t0 + hours) at one monitor key, the display exactly as served."""
    from services.weather_pipeline import tide_datum as TD
    k = f"{float(key[0]):.1f},{float(key[1]):.1f}"
    series = {"source": "am", "mean_level_m": (doc.get("m") or {}).get(k), "model_d_ntde_m": (doc.get("d") or {}).get(k)}
    block = TD.datum_for(lat, lng, series, enabled=True, stations=stations_loo)
    start = parse(doc["start"])
    i0 = int((t0 - start).total_seconds() // 3600)
    am, lp = arm_m.get(k) or [], arm_lp.get(k) or []
    disp = [TD.display_m(am[i], block) if 0 <= i < len(am) and am[i] is not None else None for i in range(i0, i0 + hours)]
    lpo = [lp[i] if 0 <= i < len(lp) else None for i in range(i0, i0 + hours)]
    return disp, lpo, block


def score(inputs, strata, prev_fleet_over, transform=None, drift_extra=()):
    """Window stats per monitor and the verdict. inputs[sid] = {disp, noaa, lp_o, lp_n, m, source, nonfinite};
    transform(sid, inp) -> a modified copy (the planted controls)."""
    per, e_by = {}, {}
    for sid, inp in inputs.items():
        x = transform(sid, inp) if transform else inp
        e = C.e_series(x["disp"], x["noaa"], x["lp_o"], x["lp_n"], x["m"])
        e_unc = C.e_series(x["disp"], x["noaa"], [0.0] * len(e), [0.0] * len(e), x["m"])
        e_raw = C.e_series(x["disp"], x["noaa"], x["lp_o"], x["lp_n"], 0.0)
        h = len(e) // 2
        per[sid] = {"W1": C.window_stat(e[:h]), "W2": C.window_stat(e[h:]), "W": C.window_stat(e),
                    "uncorrected": C.window_stat(e_unc)["s"], "raw": C.window_stat(e_raw)["s"], "m": x["m"],
                    "source": x["source"], "drift": x["source"] != "model" or sid in drift_extra,
                    "nonfinite": x.get("nonfinite", False)}
        e_by[sid] = e
    return C.judge(per, strata, prev_fleet_over), per, e_by


CONTROLS = {    # T4 (s6 + s10): (transform, base, expectation). base "id" = the identity, "served" = the served display
    "a_identity": ("id", None, "NOT_WORSE, every s = 0 +- 0.001"),
    "b_plus_0.03": ("served", 0.03, "WORSE in both strata"),
    "c_minus_0.03": ("served", -0.03, "WORSE in both strata"),
    "d_plus_0.06": ("served", 0.06, "BREACH b1"),
    "e_minus_0.06": ("served", -0.06, "BREACH b1"),
    "f_units_ft": ("served", "ft", "BREACH"),
    "g_mean_omitted": ("served", "m0", "s shifts by +m: BREACH b1 when >= threshold monitors have |m| > 0.05"),
    "h_mean_doubled": ("served", "m2", "s shifts by +m"),
    "i_mean_sign": ("served", "m-", "s shifts by -2m"),
    "j_d_sign": ("served", "d-", "BREACH"),
    "k_plus_60min": ("served", "t+1", "|s - s_served| <= 0.005, NOT_WORSE"),
    "l_spike": ("id", "spike", "no b1, no WORSE, the monitor listed"),
    "m_one_stratum": ("id", "hb+0.05", "WORSE in HARBOR_BAY only"),
    "n_seasonal_swap": ("served", "swap", "s unchanged +- 0.002"),
    "o_source_drift": ("served", "drift", "that monitor NOT MEASURED; others unchanged"),
}


def planted(inputs, strata, served_per, served_verdict):
    """T4: every control's verdict and pass / fail (sandbox: never fed to decide(), never the state)."""
    ids = sorted(inputs)
    spike, drift = ids[0], ids[-1]
    out = {}
    for name, (base, op, expect) in CONTROLS.items():
        def tf(sid, x, base=base, op=op):
            y = dict(x)
            if base == "id":
                y["disp"] = [n + x["m"] if n is not None else None for n in x["noaa"]]
                y["lp_o"] = list(x["lp_n"])
            if isinstance(op, float):
                y["disp"] = [v + op if v is not None else None for v in y["disp"]]
            elif op == "ft":
                y["disp"] = [v * 3.28084 if v is not None else None for v in y["disp"]]
            elif op == "m0":
                y["m"] = 0.0
                y["disp"] = list(y["disp"])
            elif op == "m2":
                y["disp"] = [v + x["m"] if v is not None else None for v in y["disp"]]
            elif op == "m-":
                y["disp"] = [v - 2 * x["m"] if v is not None else None for v in y["disp"]]
            elif op == "d-":
                d = x.get("d") or 0.0
                y["disp"] = [v - 2 * d if v is not None else None for v in y["disp"]]
            elif op == "t+1":
                y["disp"] = [None] + y["disp"][:-1]
            elif op == "spike" and sid == spike:
                y["disp"] = [v + 0.5 if v is not None else None for v in y["disp"]]
            elif op == "hb+0.05" and sid in strata.get("HARBOR_BAY", []):
                y["disp"] = [v + 0.05 if v is not None else None for v in y["disp"]]
            elif op == "swap":
                y["disp"] = [v - lo + ln if None not in (v, lo, ln) else None
                             for v, lo, ln in zip(y["disp"], x["lp_o"], x["lp_n"])]
                y["lp_o"] = list(x["lp_n"])
            return y
        r, per, _ = score(inputs, strata, {}, tf, drift_extra=(drift,) if op == "drift" else ())
        meas = [i for i in per if not per[i]["drift"] and per[i]["W"]["measured"]]
        if name == "a_identity":
            ok = r["verdict"] == C.NOT_WORSE and not r["sanity"] and all(abs(per[i]["W"]["s"]) <= 0.001 for i in meas)
        elif op in (0.03, -0.03):
            ok = r["verdict"] == C.WORSE and all(abs(r["F"][k]["W1"]) > C.BAR_F for k in strata)
        elif op in (0.06, -0.06):
            ok = any(x.startswith("b1") for x in r["sanity"])
        elif op in ("ft", "d-"):
            ok = bool(r["sanity"])
        elif op in ("m0", "m2", "m-"):
            k = {"m0": 1.0, "m2": 1.0, "m-": -2.0}[op]
            ok = all(abs(per[i]["W"]["s"] - (served_per[i]["W"]["s"] + k * per[i]["m"] if op != "m0" else
                                             served_per[i]["W"]["s"] + served_per[i]["m"])) <= 0.001 for i in meas)
            if op == "m0":
                n_big = sum(1 for i in meas if abs(served_per[i]["W"]["s"] + served_per[i]["m"]) > C.B1_S)
                ok = ok and ((n_big >= C.b1_threshold(len(meas))) == any(x.startswith("b1") for x in r["sanity"]))
        elif op == "t+1":
            ok = r["verdict"] == C.NOT_WORSE and all(abs(per[i]["W"]["s"] - served_per[i]["W"]["s"]) <= K_SHIFT_TOL
                                                    for i in meas if i in served_per and served_per[i]["W"]["measured"])
        elif op == "spike":
            ok = r["verdict"] == C.NOT_WORSE and not any(x.startswith("b1") for x in r["sanity"]) and spike in r["exceed"]
        elif op == "hb+0.05":
            ok = r["verdict"] == C.WORSE and abs(r["F"]["HARBOR_BAY"]["W1"]) > C.BAR_F and abs(r["F"]["OPEN_COAST"]["W1"]) <= C.BAR_F
        elif op == "swap":
            ok = all(abs(per[i]["W"]["s"] - served_per[i]["W"]["s"]) <= 0.002 for i in meas)
        else:                                                # drift
            ok = per[drift]["drift"] and all(abs(per[i]["W"]["s"] - served_per[i]["W"]["s"]) <= 1e-9 for i in meas)
        out[name] = {"expect": expect, "verdict": r["verdict"], "sanity": r["sanity"], "pass": bool(ok)}
    return out


def cycle(state, now, read=None, fetch=None, monitors=None):
    """(record or None if CACHED, state). record = {build, verdict, sanity, reasons, F, n, per, sheet_share, ...}."""
    import flag_guardrail_tide as T
    strata0, reserve, keys = monitors or load_monitors()
    try:
        doc, _, _ = (read or T.read_table)(None)
    except Exception as e:                                   # noqa: BLE001
        return {"verdict": C.UNTESTABLE, "sanity": [], "reasons": [f"tide table unreadable: {type(e).__name__}"],
                "tested": False, "at": iso(now)}, state
    stamp = (doc or {}).get("generated_at")
    if not stamp:
        return {"verdict": C.UNTESTABLE, "sanity": [], "reasons": ["no tide table"], "tested": False, "at": iso(now)}, state
    if (now - parse(stamp)).total_seconds() / 3600.0 > STALE_H:
        return {"verdict": C.UNTESTABLE, "sanity": [], "reasons": [f"tide build {stamp} older than {STALE_H} h"],
                "tested": False, "build": stamp, "at": iso(now)}, state
    if state.get("last_build") == stamp:
        return None, state                                   # CACHED: judged already, no new record
    arm_m, arm_lp = T.arm(doc, "keys"), T.arm(doc, "am_lp")
    base = {"build": stamp, "at": iso(now), "am_lp_check": doc.get("am_lp_check"), "sheet_share": sheet_share(doc, arm_m)}
    if not arm_lp:                                           # REQ-1 is a ONE-OFF calibration (mllw_tester_ref_calibration),
        why = ["no am_lp in the table (or its check failed)"]   # never a per-build check (the advisor's amended ruling)
        rec = dict(base, verdict=C.UNTESTABLE, sanity=[], reasons=why, tested=False)
        history = list(state.get("history") or []) + [{k: rec.get(k) for k in ("build", "at", "verdict", "sanity",
                                                                                 "tested", "sheet_share")}]
        return rec, dict(state, last_build=stamp, history=history[-60:])
    from services.weather_pipeline import tide_datum as TD
    import sources as S
    sheets = TD._load_stations()
    replaced = list(state.get("replaced") or [])
    strata = {k: list(v) for k, v in strata0.items()}
    for old, new in replaced:
        for v in strata.values():
            if old in v:
                v[v.index(old)] = new
    t0 = parse(stamp).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    hours = [t0 + timedelta(hours=i) for i in range(24 * 2 * WIN_D)]
    harcon = dict(state.get("harcon") or {})
    inputs, missing = {}, []
    for k, ids in strata.items():
        for sid in ids:
            la, lo = keys[sid]
            loo = [s for s in sheets if s["id"] != sid]
            disp, lpo, block = monitor_series(doc, arm_m, arm_lp, keys[sid], la, lo, loo, t0, len(hours))
            try:
                noaa = (fetch or noaa_hourly)(sid, hours[0], hours[-1])
            except Exception:                                # noqa: BLE001 - a missing station is counted, never fatal
                noaa = {}
            if sid not in harcon:
                harcon[sid] = [list(r) for r in S.coops_harcon(sid)]
            if block.get("datum") != "MLLW" or not noaa:
                missing.append(sid)
            inputs[sid] = {"disp": disp, "noaa": [noaa.get(t) for t in hours], "lp_o": lpo,
                           "lp_n": lp_noaa([tuple(r) for r in harcon[sid]], hours),
                           "m": block.get("mean_level_included_m"), "d": block.get("offset_m"),
                           "source": block.get("source") if block.get("datum") == "MLLW" else "msl",
                           "nonfinite": block.get("datum") == "MLLW" and not C._num(block.get("offset_m"))}
    r, per, e_by = score(inputs, strata, state.get("prev_fleet_over") or {})
    rec = dict(base, verdict=r["verdict"], sanity=r["sanity"], reasons=r["reasons"], F=r["F"], n=r["n"],
               exceed=r["exceed"], tested=r["verdict"] != C.UNTESTABLE, missing=sorted(missing),
               per={i: {"s": p["W"]["s"], "s_W1": p["W1"]["s"], "s_W2": p["W2"]["s"], "uncorrected": p["uncorrected"],
                        "raw": p["raw"], "m": p["m"], "source": p["source"], "measured": p["W"]["measured"]}
                    for i, p in per.items()},
               planted=planted(inputs, strata, per, r["verdict"]))
    misses = dict(state.get("misses") or {})
    for sid in inputs:
        misses[sid] = misses.get(sid, 0) + 1 if sid in missing else 0
    for k, v in strata.items():
        pool = [x for x in reserve[k] if x not in v and x not in [b for _, b in replaced]]
        for sid in [x for x in v if misses.get(x, 0) >= MISS_BUILDS]:
            if pool:
                replaced.append([sid, pool.pop(0)])
                rec["reasons"].append(f"monitor {sid} replaced by {replaced[-1][1]} ({MISS_BUILDS} builds without data)")
    pool_b = [b for b in (state.get("pool") or []) if parse(b["stamp"]) >= now - timedelta(days=POOL_DAYS)]
    pool_b.append({"stamp": stamp, "e": {sid: {iso(t): v for t, v in zip(hours, e)} for sid, e in e_by.items()}})
    history = list(state.get("history") or []) + [{k: rec.get(k) for k in ("build", "at", "verdict", "sanity",
                                                                             "tested", "sheet_share")}]
    state = dict(state, last_build=stamp, replaced=replaced, misses=misses, harcon=harcon, pool=pool_b,
                 history=history[-60:], prev_fleet_over=r["fleet_over"] if rec["tested"] else state.get("prev_fleet_over"),
                 first_tested=state.get("first_tested") or (stamp if rec["tested"] else None))
    view = {sid: {"W": C.window_stat(e), "drift": per.get(sid, {}).get("drift", False)}
            for sid, e in C.pool29(pool_b).items()}
    rec["view29"] = {k: C.stratum_f(view, ids, "W") for k, ids in strata.items()}
    first = state.get("first_tested")
    days_in = (now - parse(first)).total_seconds() / 86400.0 if first else 0.0
    rec["days_remaining"] = max(0, math.ceil(DAYS - days_in))
    ok, why = C.proposal([h for h in history if h.get("verdict") is not None], view, strata,
                         [h.get("sheet_share") for h in history])
    rec["proposal"] = {"ready": bool(ok and days_in >= DAYS), "why": why if not ok else []}
    rec["sheet_report"] = C.sheet_report([h.get("sheet_share") for h in history])
    return rec, state


def summary(rec):
    """Markdown for the run summary and the countdown comment (numbers only; no raw series)."""
    if rec is None:
        return "TIDE_DATUM (`SURF_TIDE_MLLW_US`): this build was already judged; no new record.\n"
    out = [f"### tide-mllw-tester-v1: build {rec.get('build')}: **{rec['verdict']}** (report-only)",
           f"- days remaining in the 14-day report-only period: {rec.get('days_remaining', 'n/a')}",
           f"- SHEET share of US keys: {rec.get('sheet_share')}"]
    for k, f in (rec.get("F") or {}).items():
        out.append(f"- {k}: F W1 {f.get('W1')}, W2 {f.get('W2')}, W {f.get('W')} (n {rec['n'].get(k)}); "
                   f"29-day view F {(rec.get('view29') or {}).get(k)}")
    out += [f"- breach: {s}" for s in rec.get("sanity") or []] + [f"- {s}" for s in rec.get("reasons") or []]
    pl = rec.get("planted") or {}
    if pl:
        out.append("- planted controls (sandbox): " + ", ".join(f"{k} {'ok' if v['pass'] else 'FAIL'}" for k, v in pl.items()))
    pr = rec.get("proposal") or {}
    out.append(f"- proposal: {'READY' if pr.get('ready') else 'not yet'}" + (f" ({'; '.join(pr.get('why'))})" if pr.get("why") else ""))
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--inputs-only", action="store_true", help="write inputs.json from the table and stop (no NOAA read)")
    a = ap.parse_args(argv)
    import flag_guardrail_tide as T
    os.makedirs(a.out, exist_ok=True)
    with T.guarded():                                        # the first-table step: inputs only, before any prediction
        doc, _, _ = T.read_table(None)
    rec_in = inputs_record(doc or {})
    with open(os.path.join(a.out, "inputs.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec_in, indent=1, sort_keys=True) + "\n")
    print("inputs:", json.dumps(rec_in["counts"]))
    if a.inputs_only:
        return
    state = json.loads(Path(a.state).read_text(encoding="utf-8")) if Path(a.state).exists() else {}
    with T.guarded():                                        # T5: the bucket host and CO-OPS only, GET only
        rec, state = cycle(state, datetime.now(timezone.utc))
    Path(a.state).write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    body = summary(rec)
    for name, text in (("result.json", json.dumps(rec, indent=1, default=str) + "\n"), ("summary.md", body),
                       ("proposal.txt", body if rec and (rec.get("proposal") or {}).get("ready") else ""),
                       ("sheet-report.txt", body if rec and rec.get("sheet_report") else "")):
        with open(os.path.join(a.out, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    print(body)


if __name__ == "__main__":
    main()
