"""tide-mllw-tester-v1 REQ-1 (gate s12, as amended by the advisor): a ONE-OFF instrument calibration, never run per build,
so it can never make a build UNTESTABLE. It proves the NOAA-side long-period convention (LP_noaa) the tester relies on.

At Longview (9440422; SA + SSA 0.43 + 0.227 m, the worst case) and Point Hope (9491873), over calendar 2025 (outside every
test window): r = NOAA's own hourly MSL prediction - our synthesis of the station's harcon.json (arms.harcon_eval), minus
r's yearly mean. PASS iff EVERY 14-day and 29-day running mean of r is within +-0.003 m, AND the same holds with SA + SSA
removed from both sides (ours: the synthesis without SA / SSA; NOAA's: its prediction minus metrics.noaa_long_period of
the SA / SSA rows). Hourly RMS is a diagnostic only. If it fails, the convention is fixed, never the bar.

Reads NOAA only (predictions and harcon.json, 3 requests per station), under the paced access:
  python backend/scripts/tide_datum/paced_run.py --budget-s 1200 --outcome cal_outcome.json \
      backend/scripts/tide_datum/mllw_tester_ref_calibration.py --json docs/weather-program/research/tide-mllw-tester-v1-ref-calibration.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
for sub in ("tide_own", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))

STATIONS = ("9440422", "9491873")
YEAR = 2025
BAR_M, WINDOWS_H = 0.003, {"14d": 24 * 14, "29d": 24 * 29}


def running_max(r, w):
    """PURE: the largest |mean| over every w-long window of consecutive hours (None-free r), or None if r is shorter."""
    if len(r) < w:
        return None
    s, best = sum(r[:w]), None
    best = abs(s / w)
    for i in range(w, len(r)):
        s += r[i] - r[i - w]
        best = max(best, abs(s / w))
    return best


def judge(noaa, ours, corr=None):
    """PURE: {rms, max running means, pass} for r = (noaa - corr) - ours minus its mean. Hours missing on either side
    are dropped (the running means then span the remaining consecutive record)."""
    corr = corr or [0.0] * len(noaa)
    r = [(n - c) - o for n, o, c in zip(noaa, ours, corr) if n is not None and o is not None]
    if not r:
        return {"pass": False, "why": "no overlap"}
    mean = sum(r) / len(r)
    r = [x - mean for x in r]
    out = {"n": len(r), "yearly_mean_m": round(mean, 5), "rms_m": round(math.sqrt(sum(x * x for x in r) / len(r)), 5)}
    for name, w in WINDOWS_H.items():
        out[f"max_running_{name}_m"] = None if running_max(r, w) is None else round(running_max(r, w), 5)
    out["pass"] = all(out[f"max_running_{k}_m"] is not None and out[f"max_running_{k}_m"] <= BAR_M for k in WINDOWS_H)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    a = ap.parse_args(argv)
    import arms
    import noaa_lp
    import sources as S
    from metrics import noaa_long_period
    from mllw_tester_run import noaa_hourly
    t0 = datetime(YEAR, 1, 1, tzinfo=timezone.utc)
    hours = [t0 + timedelta(hours=i) for i in range(int((datetime(YEAR + 1, 1, 1, tzinfo=timezone.utc) - t0).total_seconds() // 3600))]
    half = datetime(YEAR, 7, 1, tzinfo=timezone.utc)
    out = {"schema": "raw-surf/tide-mllw-tester-v1-ref-calibration/1", "gate": "gates/tide-mllw-tester-v1.md s12 REQ-1",
           "year": YEAR, "bar_m": BAR_M, "windows_h": WINDOWS_H, "stations": {}}
    for sid in STATIONS:
        pred = dict(noaa_hourly(sid, t0, half - timedelta(hours=1), datum="MSL"))
        pred.update(noaa_hourly(sid, half, hours[-1], datum="MSL"))
        hc = S.coops_harcon(sid)
        noaa = [pred.get(t) for t in hours]
        lp3 = noaa_lp.lp3(hc, hours)                          # MM, MF, MSF in NOAA's convention (pyTMD's left 4 mm)
        rest = [r for r in hc if r[1] not in noaa_lp.LP3]
        full = [float(x) + y for x, y in zip(arms.harcon_eval(rest, arms.to_np(hours)), lp3)]
        no_sa = [float(x) + y for x, y in zip(arms.harcon_eval([r for r in rest if r[1] not in ("SA", "SSA")],
                                                               arms.to_np(hours)), lp3)]
        lp = [float(x) for x in noaa_long_period([r for r in hc if r[1] in ("SA", "SSA")], hours)]
        out["stations"][sid] = {"with_sa_ssa": judge(noaa, full), "without_sa_ssa": judge(noaa, no_sa, lp),
                                "hours_with_prediction": sum(v is not None for v in noaa)}
    out["pass"] = all(v["with_sa_ssa"]["pass"] and v["without_sa_ssa"]["pass"] for v in out["stations"].values())
    Path(a.json).write_bytes((json.dumps(out, indent=1, sort_keys=True) + "\n").encode("utf-8"))   # LF on every OS
    print(json.dumps({sid: {k: v[k].get("pass") for k in ("with_sa_ssa", "without_sa_ssa")}
                      for sid, v in out["stations"].items()}), "PASS" if out["pass"] else "FAIL")


if __name__ == "__main__":
    main()
