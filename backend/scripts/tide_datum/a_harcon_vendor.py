"""VENDORED VERBATIM (tide-a-harcon-v1 s3 PRE-DATA note; #1273 L1): helpers of scripts/tide_datum/parity_coops.py at
1d92f7564b66dcf0fac49b4acb60317fec20aa4a (#1171's head), copied byte for byte by function so the A instrument runs from dev whether or not #1171
or #1149 ever merges. Do not edit them to follow later changes there; tests/test_a_harcon_instrument.py pins the hash.
"""
import json
import urllib.request

HARCON = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{}/harcon.json?units=metric"
MATCH_H = 3.0


def noaa_seasonal_harcon(sid):
    """[(number, name, amplitude m, phase_GMT deg, speed deg/h)] for SA and SSA from CO-OPS harcon (read-only GET)."""
    req = urllib.request.Request(HARCON.format(sid), headers={"User-Agent": "raw-surf-tide-parity/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    return [(c.get("number"), c["name"], float(c["amplitude"]), float(c["phase_GMT"]), float(c["speed"]))
            for c in d.get("HarmonicConstituents", []) if c.get("name") in ("SA", "SSA")]


def remove_seasonal(noaa, seasonal_m):
    """PURE: NOAA events with their own seasonal term removed; seasonal_m[i] is NOAA's SA+SSA at noaa[i]'s time."""
    return [(t, kind, round(v - s, 4)) for (t, kind, v), s in zip(noaa, seasonal_m)]


def match_events(noaa, ours):
    """PURE: one signed row per NOAA event: {time, type, noaa_m, ours_m, height_err_m, time_err_min}; ours_m and the
    errors are None when no event of the same type lies within MATCH_H. Errors are ours - NOAA."""
    rows = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] != kind:
                continue
            dt = (e["time"] - t0).total_seconds() / 60.0
            if abs(dt) <= MATCH_H * 60 and (best is None or abs(dt) < abs(best[1])):
                best = (e, dt)
        row = {"time": t0.strftime("%Y-%m-%dT%H:%MZ"), "type": kind, "noaa_m": v, "ours_m": None,
               "height_err_m": None, "time_err_min": None}
        if best:
            row.update(ours_m=round(best[0]["level_m"], 4), height_err_m=round(best[0]["level_m"] - v, 4),
                       time_err_min=round(best[1], 1))
        rows.append(row)
    return rows


def p90(values):
    """PURE: the nearest-rank 90th percentile, or None for no values."""
    v = sorted(values)
    return v[max(0, -(-9 * len(v) // 10) - 1)] if v else None


def match(noaa, ours):
    """PURE: [(height error m, time error min)] per NOAA event (None, None when unmatched within MATCH_H)."""
    res = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] != kind:
                continue
            dt = abs((e["time"] - t0).total_seconds()) / 60.0
            if dt <= MATCH_H * 60 and (best is None or dt < best[1]):
                best = (e["level_m"] - v, dt)
        res.append(best if best else (None, None))
    return res
