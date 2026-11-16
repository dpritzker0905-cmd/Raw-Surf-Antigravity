"""M1 tide gate, RECONCILED pre-registration (docs/weather-program/log/2026-11-15-claude-tide-m1.md, 22:25 EST).

OFFLINE ONLY. PyFES is GPL: this package runs in .github/workflows/tide-fes-gate.yml and is never imported by the
served backend (guard: tests/test_tide_fes_offline_guard.py). Measurement only: no bucket write, no live backend call.

Frozen window 2026-10-15 00Z .. 2026-10-28 23Z, hourly, 26 CO-OPS stations. Arms A FES2022b, B EOT20, C/D Open-Meteo
(test-only references). Truth T1 CO-OPS predictions (MSL); T2 observed water is reported only. Rules and controls:
scripts/tide_fes/metrics.py. Output: JSON on stdout + Markdown for $GITHUB_STEP_SUMMARY.
"""
import argparse
import json
import os
import statistics as st
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

try:
    from scripts.tide_fes import arms, metrics as M, sources as S
except ImportError:                                           # run by path from the workflow
    import arms
    import metrics as M
    import sources as S

IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8443970", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670",
       "8723214", "8726724", "8729840", "8771510", "9755371", "9751639"]
FES_CONSTITUENTS = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1", "2N2", "M4", "MS4", "MN4", "Mf", "Mm", "Sa", "Ssa"]
# G2 (docs/weather-program/log/2026-11-15-claude-tide-m1.md, 06:41 EST): M1's window 2026-10-15..28 was VOID and is
# SEEN, as are the windows listed there; G2 runs on this unseen window, no offset anywhere.
REGISTRATION = "G2"
START = datetime(2026, 9, 29, 0, tzinfo=timezone.utc)
END = datetime(2026, 10, 12, 23, tzinfo=timezone.utc)          # inclusive
NTDE = (np.datetime64("1983-01-01T00:00", "us"), np.datetime64("2002-01-01T00:00", "us"))
NTDE_STEP_MIN = 10
FINE_STEP_MIN = 6
log = S.log


def hourly_times():
    n = int((END - START).total_seconds() // 3600) + 1
    return [START + timedelta(hours=k) for k in range(n)]


def fine_times():
    a, b = START - timedelta(hours=3), END + timedelta(hours=3)
    return [a + timedelta(minutes=FINE_STEP_MIN * k) for k in range(int((b - a).total_seconds() // (60 * FINE_STEP_MIN)) + 1)]


def ntde_dates():
    return np.arange(NTDE[0], NTDE[1], np.timedelta64(NTDE_STEP_MIN, "m"))


def score_arm(series_h, truth, hours, fine=None, fine_vals=None, events=None, ntde_vals=None, datum=None, obs=None,
              truth_tb=None):
    """One arm at one station. series_h: values aligned with `hours` (None allowed)."""
    idx = [i for i, t in enumerate(hours) if t in truth and series_h[i] is not None]
    if len(idx) < 240:
        return {"error": f"overlap {len(idx)} h"}
    a = [series_h[i] for i in idx]
    b = [truth[hours[i]] for i in idx]
    ma, mb = st.mean(a), st.mean(b)
    row = {"rmse": round(M.rmse(a, b), 4), "rmse_demeaned": round(M.rmse([v - ma for v in a], [v - mb for v in b]), 4),
           "range_ratio": round((max(a) - min(a)) / (max(b) - min(b)), 3) if max(b) > min(b) else None, "n": len(idx)}
    if fine_vals is not None and events:
        errs = M.hilo_errors(events, M.extrema(fine, list(fine_vals)))
        row["hilo_med"] = st.median(errs) if errs else None
        row["hilo_unmatched"] = sum(1 for e in errs if e == float("inf"))
        row["hilo_n"] = len(errs)
    if ntde_vals is not None and datum is not None:
        off = M.mllw_offset(list(ntde_vals), NTDE_STEP_MIN / 60.0)
        row["msl_minus_mllw"] = round(off, 4) if off is not None else None
        row["mllw_err"] = round(off - datum, 4) if off is not None else None
    if truth_tb:                                              # REPORTED, not gating (G2): NOAA's SA/SSA removed from truth
        tb = [i for i in idx if hours[i] in truth_tb]
        if len(tb) >= 240:
            row["rmse_tidal_band"] = round(M.rmse([series_h[i] for i in tb], [truth_tb[hours[i]] for i in tb]), 4)
    if obs:
        oi = [i for i in idx if hours[i] in obs]
        if len(oi) >= 120:
            row["rmse_obs"] = round(M.rmse([series_h[i] for i in oi], [obs[hours[i]] for i in oi]), 4)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="fes_cache")
    ap.add_argument("--eot20", default="eot20_cache")
    ap.add_argument("--work", default="fes_work")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    ap.add_argument("--download-only", action="store_true", help="fetch FES2022b + EOT20 into the caches and stop")
    args = ap.parse_args()
    if args.download_only:
        files = S.download_fes(FES_CONSTITUENTS, Path(args.cache))
        S.download_eot20(Path(args.eot20))
        log(f"downloaded FES: {sorted(files)}")
        missing = sorted(set(FES_CONSTITUENTS) - set(files))
        if missing:
            raise SystemExit(f"FES constituents still missing: {missing}")
        return
    work = Path(args.work)
    hours, fine = hourly_times(), fine_times()
    nd = ntde_dates()
    h_np, f_np = arms.to_np(hours), arms.to_np(fine)
    meta = {sid: S.station_meta(sid) for sid in IDS}
    points = {sid: (m[0], m[1]) for sid, m in meta.items() if m[0] is not None}

    files = S.download_fes(FES_CONSTITUENTS, Path(args.cache))
    log(f"FES constituents: {sorted(files)}")
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        S.subset_fes(path, name, points, boxes, scratch)
    eot_root = S.download_eot20(Path(args.eot20))

    rows, keep = [], {}
    for sid in IDS:
        lat, lng, name = meta[sid]
        row = {"id": sid, "name": name, "stratum": M.stratum(sid), "lat": lat, "lng": lng}
        rows.append(row)
        if lat is None:
            row["error"] = "no metadata"
            continue
        truth = S.coops_series(sid, "predictions", START, END, "h")
        hc = S.coops_harcon(sid)
        seasonal = M.noaa_long_period(hc, hours) if hc else None    # NOAA's own SA + SSA at each hour
        truth_tb = {t: truth[t] - seasonal[i] for i, t in enumerate(hours) if t in truth} if seasonal else None
        events = [e for e in S.coops_hilo(sid, START, END) if START <= e[0] <= END]
        obs = {t: v for t, v in S.coops_series(sid, "water_level", START, END, key="data").items() if t.minute == 0}
        datum = S.coops_msl_minus_mllw(sid)
        row["coops_msl_minus_mllw"] = datum
        both = np.concatenate([h_np, f_np, nd])
        cut = (len(h_np), len(h_np) + len(f_np))
        series = {}
        for arm, fn in (("A", lambda d: arms.fes_eval(boxes / sid, lat, lng, d) if (boxes / sid).is_dir() else None),
                        ("B", lambda d: arms.eot20_eval(eot_root, lat, lng, d))):
            try:
                v = fn(both)
            except Exception as e:                            # noqa: BLE001 - recorded per station, never silent
                log(f"{sid} arm {arm}: {e}")
                row[arm] = {"error": str(e)[:200]}
                continue
            if v is None:
                row[arm] = {"error": "undefined at this point"}
                continue
            vh, vf, vn = v[:cut[0]], v[cut[0]:cut[1]], v[cut[1]:]
            row[arm] = score_arm(list(vh), truth, hours, fine, vf, events, vn, datum, obs, truth_tb)
            series[arm] = (list(vh), list(vf))
        om = S.om_sea_level(lat, lng, START.date(), (END + timedelta(days=3)).date())
        om_year = S.om_sea_level(lat, lng, (START - timedelta(days=365)).date(), (START - timedelta(days=1)).date())
        year_mean = st.mean(om_year.values()) if len(om_year) >= 330 * 24 else None
        row["C"] = score_arm(arms.om_demean72(om, hours), truth, hours, obs=obs)
        row["D"] = score_arm(arms.om_minus_year(om, hours, year_mean), truth, hours, obs=obs)
        try:
            p = arms.harcon_eval(hc, h_np) if hc else None
        except Exception as e:                                # noqa: BLE001
            log(f"{sid} positive control: {e}")
            p = None
        row["P"] = score_arm(list(p), truth, hours) if p is not None else {"error": "no harmonic constants"}
        keep[sid] = {"truth": truth, "events": events, "series": series}
        log(json.dumps({k: row[k] for k in row if k in ("id", "A", "B", "C", "P")}, default=str)[:600])

    report = decide(rows, keep, hours, fine)
    print(json.dumps({"registration": REGISTRATION, "window": [START.isoformat(), END.isoformat()], "fes_constituents": sorted(files),
                      **report, "stations": rows}, indent=1, default=str))
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(markdown(rows, report))


def arm_table(rows, arm):
    return {r["id"]: {"rmse": (r.get(arm) or {}).get("rmse"), "hilo_med": (r.get(arm) or {}).get("hilo_med"),
                      "mllw_err": (r.get(arm) or {}).get("mllw_err")} for r in rows if "error" not in r}


def decide(rows, keep, hours, fine):
    base_c = arm_table(rows, "C")
    verdicts = {arm: M.arm_verdict(arm_table(rows, arm), base_c) for arm in ("A", "B")}
    chosen = M.choose(verdicts)
    positive = M.median_or_none([(r.get("P") or {}).get("rmse") for r in rows])
    swap = shifted = None
    if chosen:
        sids = [s for s in keep if chosen in keep[s]["series"] and len(keep[s]["truth"]) >= 240]
        meds = []
        for perm in M.derangements(len(sids)):
            per = []
            for i, j in enumerate(perm):
                vh, truth = keep[sids[i]]["series"][chosen][0], keep[sids[j]]["truth"]
                idx = [k for k, t in enumerate(hours) if t in truth]
                per.append(M.rmse([vh[k] for k in idx], [truth[hours[k]] for k in idx]))
            meds.append(st.median(per))
        swap = st.median(meds) if meds else None
        shifted_meds = []
        for s in sids:
            vf = keep[s]["series"][chosen][1]
            ex = [(t + timedelta(hours=6), k) for t, k in M.extrema(fine, vf)]
            errs = M.hilo_errors(keep[s]["events"], ex)
            if errs:
                shifted_meds.append(st.median(errs))
        shifted = st.median(shifted_meds) if shifted_meds else None
    controls, ok = M.controls_ok(positive, swap, shifted)
    chosen, verdict = M.final(verdicts, ok)
    strata = {}
    for arm in ("A", "B", "C", "D", "P"):
        for r in rows:
            v = (r.get(arm) or {}).get("rmse")
            if v is not None:
                strata.setdefault(arm, {}).setdefault(r["stratum"], []).append(v)
    strata = {a: {k: round(st.median(v), 4) for k, v in d.items()} for a, d in strata.items()}
    return {"verdict": verdict, "chosen_arm": chosen, "arms": verdicts,
            "controls": {"items": controls, "positive_median_rmse_m": positive, "swap_median_rmse_m": swap,
                         "shift6h_median_hilo_min": shifted},
            "median_rmse_D_m": M.median_or_none([(r.get("D") or {}).get("rmse") for r in rows]),
            "median_rmse_tidal_band_reported": {a: M.median_or_none([(r.get(a) or {}).get("rmse_tidal_band") for r in rows])
                                                for a in ("A", "B")},
            "median_rmse_obs": {a: M.median_or_none([(r.get(a) or {}).get("rmse_obs") for r in rows])
                                for a in ("A", "B", "C", "D")},
            "strata_median_rmse_m": strata}


def fmt(x, nd=3):
    return "-" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def markdown(rows, rep):
    a, b = rep["arms"]["A"], rep["arms"]["B"]
    c = rep["controls"]
    lines = [f"## M1 tide gate {REGISTRATION}: **{rep['verdict']}** (chosen arm {rep['chosen_arm']})", "",
             "| arm | median RMSE vs CO-OPS | vs C | High/Low min | MLLW err | items |", "|---|---|---|---|---|---|"]
    for k, v in (("A FES2022b", a), ("B EOT20", b)):
        lines.append(f"| {k} | {fmt(v['median_rmse_m'])} | {fmt(v['median_rmse_C_m'])} | {fmt(v['median_hilo_min'], 1)} | "
                     f"{fmt(v['median_abs_mllw_err_m'])} | {', '.join(i for i, ok in v['items'].items() if not ok) or 'all pass'} |")
    lines += ["", f"Controls: positive {fmt(c['positive_median_rmse_m'], 4)} m, label swap {fmt(c['swap_median_rmse_m'])} m, "
              f"+6 h shift {fmt(c['shift6h_median_hilo_min'], 1)} min -> {c['items']}. Arm D median {fmt(rep['median_rmse_D_m'])} m. "
              f"Tidal band (truth minus NOAA's SA/SSA; reported, NOT gating): {rep['median_rmse_tidal_band_reported']}. "
              f"Observed water (informative): {rep['median_rmse_obs']}. Strata: {rep['strata_median_rmse_m']}", "",
              "| station | stratum | A | B | C | D | P | A hilo | A MLLW err |", "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        g = lambda k, f="rmse": (r.get(k) or {}).get(f)                     # noqa: E731
        lines.append(f"| {r['id']} {r.get('name', '')} | {r['stratum']} | {fmt(g('A'))} | {fmt(g('B'))} | {fmt(g('C'))} | "
                     f"{fmt(g('D'))} | {fmt(g('P'), 4)} | {fmt(g('A', 'hilo_med'), 1)} | {fmt(g('A', 'mllw_err'))} |")
    lines += ["", "Credits: FES2022 - \"The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS "
              "and made freely available by AVISO\" (DOI 10.24400/527896/A01-2024.004). EOT20 - DGFI-TUM, CC BY 4.0 "
              "(doi:10.17882/79489). NOAA CO-OPS predictions, observations, datums and harmonic constants."]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
