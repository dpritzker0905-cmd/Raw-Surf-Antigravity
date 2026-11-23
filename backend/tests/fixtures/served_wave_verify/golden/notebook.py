"""SYNTHETIC golden fixture for the served-wave scorer (gate served-wave-verify-v1 section 7) and its hand computation.

Until collection starts no real sampled run exists, so this fixture is written by hand and LABELLED SYNTHETIC. It is replaced
by a frozen real archived run in the first PR after collection starts.

The fixture (one run, 2027-01-15T00Z; models gfs and icon; three scored NDBC-shaped stations plus one CDIP exam station):
  * buoys.json      the fixture's buoy list
  * records.jsonl   the run's records (built below from the TABLE, then committed)
  * SYN0x.txt       one NDBC realtime2-shaped stdmet response per station for the same window
  * expected.json   the expected score cells, computed here with EXACT rational arithmetic (fractions.Fraction) straight
                    from the table, independently of services/point_archive/served_scorer.py (only the final square root and
                    the circular mean are floats). The scorer must reproduce it to 1e-9.

  python tests/fixtures/served_wave_verify/golden/notebook.py           # rewrite every file from the table
  python tests/fixtures/served_wave_verify/golden/notebook.py --check    # exit 1 if a committed file differs
"""
import json
import math
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = "2027-01-15T00:00:00Z"
TIMES = {0: "2027-01-15T00:00:00Z", 6: "2027-01-15T06:00:00Z", 30: "2027-01-16T06:00:00Z"}
NDBC = {0: (2027, 1, 15, 0), 6: (2027, 1, 15, 6), 30: (2027, 1, 16, 6)}
FETCHED = "2027-01-16T12:00:00Z"
BINS = {0: "[0,24)", 6: "[0,24)", 30: "[24,48)"}
STATIONS = {"SYN01": "us_west", "SYN02": "us_west", "SYN03": "hawaii"}
# observed (WVHT, DPD, APD, MWD) per station and lead; SYN01 lead 0 carries MWD 99 deg, a VALID direction (L-S30)
OBS = {
    "SYN01": {0: ("1.0", "10", "7.0", "99"), 6: ("1.2", "11", "7.5", "350"), 30: ("1.5", "12", "8.0", "270")},
    "SYN02": {0: ("2.0", "12", "8.0", "180"), 6: ("2.2", "13", "8.5", "190"), 30: ("2.5", "14", "9.0", "200")},
    "SYN03": {0: ("3.0", "14", "9.0", "10"), 6: ("3.2", "15", "9.5", "20"), 30: ("3.5", "16", "10.0", "30")},
    "SYN04": {0: ("1.0", "10", "7.0", "200"), 6: ("1.0", "10", "7.0", "200"), 30: ("1.0", "10", "7.0", "200")},
}
# forecast = observed + these errors (heights m, periods s, directions deg)
HS_ERR = {"gfs": {"SYN01": ("0.10", "-0.10", "0.20"), "SYN02": ("0.20", "0.00", "-0.10"), "SYN03": ("-0.30", "0.10", "0.40")},
          "icon": {"SYN01": ("0.00", "0.20", "-0.20"), "SYN02": ("-0.10", "-0.10", "0.30"), "SYN03": ("0.10", "0.30", "0.00")}}
GFS_TP_ERR = "1.0"           # gfs serves a PEAK period (tp_s vs DPD)
ICON_TM_ERR = "-0.5"         # icon serves a MEAN period (tm_s vs APD)
GFS_DIR_ERR = {"SYN01": (-9, 20, 0), "SYN02": (5, -5, 10), "SYN03": (-20, 0, 10)}
TIER_B = ("SYN03", 0, "0.5")     # one Tier B (regional `hawaii`) gfs row: never pooled with Tier A
EXAM = ("SYN04", 0, "1.0")       # one CDIP exam row: exam table only
LEADS = (0, 6, 30)


def buoys():
    st = [{"id": s, "wmo_id": s, "lat": 20.0 + i, "lon": -150.0 - i, "depth_m": 100.0, "region": r, "sheltered": None,
           "source": "ndbc", "exam_only": False, "purposes": ["served"], "stratum": "exposed", "regional_box": {}}
          for i, (s, r) in enumerate(sorted(STATIONS.items()))]
    st.append({"id": "SYN04", "wmo_id": "SYN04", "lat": 33.0, "lon": -118.0, "depth_m": 30.0, "region": "us_west",
               "sheltered": None, "source": "cdip", "exam_only": True, "purposes": ["served"], "stratum": "exposed",
               "regional_box": {}})
    return {"version": "golden-synthetic/1", "about": "SYNTHETIC golden fixture (served-wave-verify-v1 section 7)", "stations": st}


def _rec(model, station, lead, tier="global_mid", **vals):
    return {"schema": "point-archive/1", "purpose": "served", "row_type": "record", "model": model, "frame_set": "waves",
            "tier": tier, "run_time": RUN, "valid_time": TIMES[lead], "lead_h": lead, "station_id": station, "status": "ok",
            "decoder_version": "synthetic", "buoy_list_version": "golden-synthetic/1",
            "period_kind": "tp" if model == "gfs" else "tm", **vals}


def records():
    out = []
    for model in ("gfs", "icon"):
        for s in STATIONS:
            for k, lead in enumerate(LEADS):
                h, dpd, apd, mwd = OBS[s][lead]
                v = {"hs_m": float(F(h) + F(HS_ERR[model][s][k]))}
                if model == "gfs":
                    v["tp_s"] = float(F(dpd) + F(GFS_TP_ERR))
                    v["dir_deg"] = float((F(mwd) + GFS_DIR_ERR[s][k]) % 360)
                else:
                    v["tm_s"] = float(F(apd) + F(ICON_TM_ERR))
                out.append(_rec(model, s, lead, **v))
    s, lead, e = TIER_B
    out.append(_rec("gfs", s, lead, tier="hawaii", hs_m=float(F(OBS[s][lead][0]) + F(e))))
    s, lead, e = EXAM
    out.append(_rec("gfs", s, lead, hs_m=float(F(OBS[s][lead][0]) + F(e))))
    return out


def stdmet(station):
    lines = ["#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE",
             "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft"]
    for lead in sorted(LEADS, reverse=True):          # realtime2 is newest first
        y, mo, d, hh = NDBC[lead]
        h, dpd, apd, mwd = OBS[station][lead]
        lines.append(f"{y} {mo:02d} {d:02d} {hh:02d} 00 MM MM MM {h} {dpd} {apd} {mwd} MM MM MM MM MM MM MM")
    return "\n".join(lines) + "\n"


def cell(pairs, kind):
    """The expected metrics of one cell from its (forecast, observed) Fraction pairs."""
    n = len(pairs)
    if kind == "dir":
        e = [((f - o + 180) % 360) - 180 for f, o in pairs]
        s = sum(math.sin(math.radians(x)) for x in e)
        c = sum(math.cos(math.radians(x)) for x in e)
        return {"mae_deg": float(sum(abs(x) for x in e) / n), "circ_mean_err_deg": math.degrees(math.atan2(s, c))}
    e = [f - o for f, o in pairs]
    mean_o = sum(o for _f, o in pairs) / n
    rmse = math.sqrt(sum(x * x for x in e) / n)
    return {"bias": float(sum(e) / n), "rmse": rmse, "mean_obs": float(mean_o), "si": rmse / float(mean_o)}


def expected():
    groups = {}

    def add(key, f, o):
        for region in (key[5], "all"):
            groups.setdefault(key[:5] + (region,), []).append((f, o))
    for model in ("gfs", "icon"):
        for s, region in STATIONS.items():
            for k, lead in enumerate(LEADS):
                h, dpd, apd, mwd = (F(x) for x in OBS[s][lead])
                add(("A", model, "hs", BINS[lead], "main", region), h + F(HS_ERR[model][s][k]), h)
                if model == "gfs":
                    add(("A", model, "tp", BINS[lead], "main", region), dpd + F(GFS_TP_ERR), dpd)
                    add(("A", model, "dir", BINS[lead], "main", region), (mwd + GFS_DIR_ERR[s][k]) % 360, mwd)
                else:
                    add(("A", model, "tm", BINS[lead], "main", region), apd + F(ICON_TM_ERR), apd)
    s, lead, e = TIER_B
    add(("B", "gfs", "hs", BINS[lead], "main", STATIONS[s]), F(OBS[s][lead][0]) + F(e), F(OBS[s][lead][0]))
    s, lead, e = EXAM
    add(("A", "gfs", "hs", BINS[lead], "exam", "us_west"), F(OBS[s][lead][0]) + F(e), F(OBS[s][lead][0]))
    out = []
    for key in sorted(groups):
        tier, model, var, lb, table, region = key
        out.append({"table": table, "tier_class": tier, "model": model, "variable": var, "lead_bin": lb, "region": region,
                    "n": len(groups[key]), **cell(groups[key], "dir" if var == "dir" else "lin")})
    return out


def files():
    return {"buoys.json": json.dumps(buoys(), indent=1, sort_keys=True) + "\n",
            "records.jsonl": "".join(json.dumps(r, sort_keys=True) + "\n" for r in records()),
            **{f"{s}.txt": stdmet(s) for s in OBS},
            "expected.json": json.dumps({"label": "SYNTHETIC", "asof": FETCHED, "fetched_at": FETCHED, "cells": expected()},
                                        indent=1, sort_keys=True) + "\n"}


if __name__ == "__main__":
    bad = []
    for name, text in files().items():
        p = HERE / name
        if "--check" in sys.argv:
            if not p.exists() or p.read_text(encoding="utf-8") != text:
                bad.append(name)
        else:
            p.write_text(text, encoding="utf-8", newline="\n")
    if bad:
        print("differs:", bad)
        sys.exit(1)
    print("golden fixture:", "checked" if "--check" in sys.argv else "written")
