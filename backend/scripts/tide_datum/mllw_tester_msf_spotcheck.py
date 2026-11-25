"""tide-mllw-tester-v1 (gate s13; the advisor on amendment 4): a CONSTANTS-ONLY spot-check of LP_noaa at the frozen station
with the largest MSF other than the REQ-1 stations. It reads every frozen station's harcon.json (published constants; no prediction, water level or
table), records MM / MF / MSF for all 80, and at the largest-MSF station compares LP_noaa's MM + MF + MSF in NOAA's
convention (noaa_lp.lp3, the one REQ-1 calibrated at Longview) with pyTMD's synthesis of the same rows, over 2025. It
shows the size of the convention correction there; it never reads NOAA's predictions.

  python backend/scripts/tide_datum/paced_run.py --budget-s 1200 --outcome msf_outcome.json \
      backend/scripts/tide_datum/mllw_tester_msf_spotcheck.py --json docs/weather-program/research/tide-mllw-tester-v1-msf-spotcheck.json
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
STATIONS = HERE.parents[2] / "docs" / "weather-program" / "research" / "tide-mllw-tester-v1-stations.json"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    a = ap.parse_args(argv)
    import arms
    import noaa_lp
    import sources as S
    doc = json.loads(STATIONS.read_text(encoding="utf-8"))
    ids = sorted(i for v in doc["strata"].values() for i in v["monitor"] + v["reserve"])
    rows, consts = {}, {}
    for sid in ids:
        hc = S.coops_harcon(sid)
        consts[sid] = hc
        rows[sid] = {r[1]: {"amplitude_m": r[2], "phase_gmt_deg": r[3]} for r in hc if r[1] in noaa_lp.LP3}
    calibrated = ("9440422", "9491873")                    # REQ-1 already reproduced these against NOAA itself
    top = max((i for i in ids if i not in calibrated), key=lambda i: (rows[i].get("MSF") or {}).get("amplitude_m", 0.0))
    t0 = datetime(2025, 1, 1, tzinfo=timezone.utc)
    hours = [t0 + timedelta(hours=i) for i in range(8760)]
    lp3 = [r for r in consts[top] if r[1] in noaa_lp.LP3]
    ours = noaa_lp.lp3(lp3, hours)
    pytmd = [float(x) for x in arms.harcon_eval(lp3, arms.to_np(hours))] if lp3 else [0.0] * len(hours)
    d = [x - y for x, y in zip(ours, pytmd)]
    out = {"schema": "raw-surf/tide-mllw-tester-v1-msf-spotcheck/1", "gate": "gates/tide-mllw-tester-v1.md s13",
           "inputs_only": True, "lp3_by_station": rows, "largest_msf_station": top,
           "spotcheck": {"station": top, "rows": rows[top], "year": 2025,
                         "lp3_noaa_convention_range_m": [round(min(ours), 4), round(max(ours), 4)],
                         "noaa_minus_pytmd_max_abs_m": round(max(abs(x) for x in d), 4),
                         "noaa_minus_pytmd_rms_m": round(math.sqrt(sum(x * x for x in d) / len(d)), 4)}}
    Path(a.json).write_bytes((json.dumps(out, indent=1, sort_keys=True) + "\n").encode("utf-8"))   # LF on every OS
    print(json.dumps(out["spotcheck"]))


if __name__ == "__main__":
    main()
