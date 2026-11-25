"""S_g: the seasonal offset expected in the MLLW parity run, frozen BEFORE its result is opened (2026-11-23).

The parity run (tide-mllw-parity.yml, parity_coops.py) compares our A + D with NOAA's MLLW High/Low predictions. NOAA's
predictions carry NOAA's SA and SSA (the seasonal sea-level cycle); our A (FES2022b) carries almost none: G2 (run
43950822962, SCOREBOARD 2026-11-16 20:39Z, log 2026-11-15-claude-tide-m1.md item 4) measured FES2022b's SA at about
0.0003 m at every gauge. So per gauge

    S_g = mean over the run window of [NOAA SA/SSA(t) - FES Sa/Ssa(t)]  ~=  mean of NOAA SA/SSA(t)

with NOAA's convention (SA = A cos(h - G), SSA = A cos(2h - G), h the sun's mean longitude; tide_fes.metrics.
noaa_long_period, the function the tide gates calibrated). Our minus NOAA then reads about -S_g, so the parity bar
compares each gauge's |median err| with |S_g|.

Read-only: CO-OPS mdapi harcon.json per gauge. No FES, no bucket, no live backend.

    python scripts/tide_datum/parity_seasonal.py --start 2026-11-23 --start 2026-11-24 --json out.json
"""
import argparse
import datetime as dt
import json
import statistics as st
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tide_own"))
sys.path.insert(0, str(HERE.parent / "tide_fes"))
from own_rules import G3T_M  # noqa: E402
from metrics import noaa_long_period  # noqa: E402

HARCON = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{}/harcon.json?units=metric"
UA = {"User-Agent": "raw-surf-research/1.0"}
FES_SA_M = 0.0003          # G2 measured FES2022b SA amplitude at every gauge; below the table's resolution, so 0 is used


def harcon(sid):
    for attempt in range(3):
        try:
            req = urllib.request.Request(HARCON.format(sid), headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read().decode("utf-8"))
            return [(c.get("number"), c["name"], float(c["amplitude"]), float(c["phase_GMT"]), float(c["speed"]))
                    for c in d.get("HarmonicConstituents", []) if c.get("name") in ("SA", "SSA")]
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 + 3 * attempt)


def window_mean(hc, start, days=7):
    t0 = dt.datetime.fromisoformat(start).replace(tzinfo=dt.timezone.utc)
    hours = [t0 + dt.timedelta(hours=i) for i in range(days * 24)]
    return st.fmean(noaa_long_period(hc, hours))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", action="append", required=True, help="the run's day0 (UTC date); 7-day window")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    out = {"schema": "raw-surf/tide-parity-seasonal/1", "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
           "source": "NOAA CO-OPS mdapi harcon.json (SA, SSA); FES2022b Sa/Ssa taken as 0 (G2: ~0.0003 m)",
           "windows": a.start, "gauges": {}}
    for sid in G3T_M:
        hc = harcon(sid)
        row = {"SA": next(([x[2], x[3]] for x in hc if x[1] == "SA"), None),
               "SSA": next(([x[2], x[3]] for x in hc if x[1] == "SSA"), None)}
        for w in a.start:
            row[f"S_g {w}"] = round(window_mean(hc, w), 4)
        out["gauges"][sid] = row
        print(sid, row)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
