"""G4 POWER CHECK, design only (G4 addendum 1 change 1; the advisor's FINAL edit 3, 2026-11-18 07:25Z).

On G3t's SEEN window (2026-01-01 .. 07-24 minus the held-out weeks; declared seen in the G3t RESULT), take every
56-day stretch, score (A+M) against D with item 1's statistic and bootstrap, and count how often the upper end is
<= -0.02 m. The ONLY output is that pass share (with the stretch count it is over and the length it fixes). No arm
other than A+M against D is scored; C, S and A alone are never computed. Nothing here is a gate: it sets G4's length.

OFFLINE ONLY: no bucket write, nothing served, no live backend. PyFES is GPL and runs only in CI here.
Credentials: AVISO on the FES download step only, Copernicus Marine on this step only; never printed.
"""
import argparse
import json
import math
import os
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tide_g3t"))
sys.path.insert(0, str(HERE.parent / "tide_g3"))
sys.path.insert(0, str(HERE.parent / "tide_fes"))
import g4_rules as R4                                            # noqa: E402
import g3t_gate as T                                             # noqa: E402  (CO-OPS truth fetch, retrying get_json)
import g3t_rules as R                                            # noqa: E402  (the seen window, segments, S1 split)
import g3_metrics as G                                           # noqa: E402  (item 1's paired bootstrap)
import g3_sources as GS                                          # noqa: E402  (S1 altimetry, Open-Meteo runs)
import arms                                                      # noqa: E402  (FES evaluator)
import sources as S                                              # noqa: E402  (CO-OPS metadata, AVISO, FES subset)
from fes_gate import FES_CONSTITUENTS                            # noqa: E402

SEED = 20261119                                                  # G4's registered bootstrap seed


def d_reference(pts, hours):
    """D only (TEST-ONLY): Open-Meteo previous_day1 / previous_day2 minus the 365-day previous_day1 mean before the
    window, as in G3t. (2, H) per gauge. C is not fetched."""
    D = {}
    year0 = R.W0 - timedelta(days=365)
    for sid, (la, lo) in pts.items():
        runs = GS.om_runs(la, lo, (R.W0 - timedelta(days=1)).date(), (R.W1 + timedelta(days=1)).date(), S.get_json)
        year = GS.om_runs(la, lo, year0.date(), (R.W0 - timedelta(days=1)).date(), S.get_json)[0]
        mean365 = float(np.mean(list(year.values()))) if len(year) >= 330 * 24 else float("nan")
        rows = []
        for b in R.GATE_BINS:
            r = runs.get(b, {})
            rows.append(np.array([r[t] - mean365 if t in r and math.isfinite(mean365) else np.nan for t in hours]))
        D[sid] = np.vstack(rows)
    return D


def write(report, summary):
    print(json.dumps(report, indent=1))
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"## Tide G4 power check (design only, on G3t's seen window)\n\n"
                     f"- pass share: **{report.get('pass_share')}** over {report.get('n_stretches')} stretches of "
                     f"{R4.POWER_LEN_DAYS} days\n- G4 length this fixes: **{report.get('g4_length_days')} days**\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="g4p_work")
    ap.add_argument("--download-fes-only", action="store_true")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    args = ap.parse_args()
    if args.download_fes_only:
        files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
        missing = sorted(set(FES_CONSTITUENTS) - set(files))
        if missing:
            raise SystemExit(f"FES constituents still missing: {missing}")
        return
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    T.stage("start")
    base = {"registration": R4.REGISTRATION, "job": "power check (design only)", "window": "G3t's seen window",
            "length_days": R4.POWER_LEN_DAYS, "line_m": R4.POWER_LINE_M, "seed": SEED}

    s1_ok, s1_why = GS.s1_preflight(work / "cm")
    if not s1_ok:
        write({**base, "pass_share": None, "n_stretches": 0, "g4_length_days": None,
               "why": f"S1 preflight failed: {s1_why}"}, args.summary)
        return
    hours = R.window_hours()
    H = len(hours)
    pts = {}
    for sid in R4.GAUGES:
        la, lo, _ = S.station_meta(sid)
        if la is not None:
            pts[sid] = (la, lo)
    T.stage(f"metadata {len(pts)} gauges")

    # A: FES2022b at the 26 gauges (hourly only).
    files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        S.subset_fes(path, name, pts, boxes, scratch)
    A = {}
    for sid, (la, lo) in pts.items():
        v = arms.fes_eval(boxes / sid, la, lo, arms.to_np(hours))
        if v is not None:
            A[sid] = np.tile(v[:H], (len(R.GATE_BINS), 1))
    T.stage("arm A")

    # M: the base mean (2016-2025) of the gauge cell's SLA (addendum 1, change 3: ONE choice, the base mean).
    AM = {}
    for sid, (la, lo) in pts.items():
        if sid not in A:
            continue
        try:
            ser, _info = GS.s1_cell_series(la, lo, work / "cm" / sid, R.BASE)
        except Exception:                                                        # noqa: BLE001 - per gauge
            ser = None
        if ser is None:
            T.stage(f"m {sid} unavailable")
            continue
        m, _s = R.split_s1({int(k): float(v) for k, v in ser.groupby(ser.index.dayofyear).mean().items()})
        AM[sid] = A[sid] + R.series_on(hours, m)
    T.stage("arm A+M")

    D = d_reference(pts, hours)
    T.stage("reference D")

    obs = {}
    for sid in pts:
        o = {}
        for a, b in R.segments():
            oo, _pp = T.coops_obs_pred(sid, a, b)
            o.update(oo)
        obs[sid] = np.array([o.get(t, np.nan) for t in hours])
    T.stage("observed")

    excluded = R.excluded_gauges(AM, D, obs, list(pts))
    gauges = sorted(g for g in pts if g not in excluded and g in AM and g in D)
    uppers = []
    for idx in R4.stretches(hours, R.HELD_OUT, R4.POWER_LEN_DAYS):
        _pt, _lo, hi, _per = G.paired_median_diff(AM, D, obs, gauges, draws=R.DRAWS, seed=SEED, hours_idx=idx)
        uppers.append(hi)
    share, n = R4.pass_share(uppers)
    T.stage("scored")
    write({**base, "pass_share": None if not math.isfinite(share) else round(share, 4), "n_stretches": n,
           "n_gauges": len(gauges), "g4_length_days": R4.window_length(share)}, args.summary)
    T.stage("done")


if __name__ == "__main__":
    main()
