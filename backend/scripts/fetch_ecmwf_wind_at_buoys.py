"""Fetch ECMWF open-data 10 m wind at the graded buoys, for the offline wind-forcing test (second registration).

NOT RUN when committed: it needs the `eccodes` Python package and downloads public files, both of which need the
owner's word in the session that runs it. Pre-registration: docs/weather-program/log/
2026-11-14-advisor-wind-forcing-prereg.md, section 3.

Source: the public ECMWF open-data mirror (no account, no key), IFS 0.25 degree, one GRIB2 file per cycle and step with
a JSON-lines `.index` giving byte ranges. Only the 10u and 10v messages are downloaded (byte-range requests). Raw
ranges are cached under --cache, OUTSIDE the repo. Nothing here touches the Raw Surf backend.

For every (buoy, cycle, lead) in the rows file it writes one JSON line:
    {"id", "cycle", "lead", "e_kt", "e_dir", "ep_kt", "ep_dir"}
e_  = the ECMWF run of the SAME cycle hour at the SAME lead (bilinear at the buoy).
ep_ = the run 6 h EARLIER at lead + 6 (what was actually available when the same-cycle GFS was): the
      latency-matched arm.

Run from backend/:
    python scripts/fetch_ecmwf_wind_at_buoys.py --rows <rows.jsonl> --grade <grade.json> --cache <dir outside the repo> \
        --out <ecmwf.jsonl>
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from services.weather_pipeline import surf_rating as SR  # noqa: E402  (the ONE knots constant, read as an attribute)

BASE = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
LEADS = (3, 12, 24, 36)


def url(cyc, step, stream="oper"):
    return f"{BASE}/{cyc:%Y%m%d}/{cyc:%H}z/ifs/0p25/{stream}/{cyc:%Y%m%d%H}0000-{step}h-{stream}-fc.grib2"


def _get(u, rng=None):
    """One GET. The mirror answers 503 SlowDown when asked too fast: wait and retry. 404 returns None."""
    req = urllib.request.Request(u, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
    for attempt in range(8):
        try:
            time.sleep(0.4)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code not in (429, 500, 503):
                raise
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(min(60, 3 * 2 ** attempt))
    raise RuntimeError(f"gave up on {u}")


def field_bytes(cache, cyc, step, param):
    path = os.path.join(cache, "ecmwf", f"{cyc:%Y%m%d%H}_{step:03d}_{param}.grib2")
    if os.path.exists(path):
        return open(path, "rb").read()
    # The mirror keeps 00/06/12/18Z under "oper" (checked 2026-11-14); "scda" is tried for older layouts.
    for stream in ("oper", "scda"):
        u = url(cyc, step, stream)
        idx = _get(u[:-6] + ".index")
        if idx is not None:
            break
    else:
        return None
    for line in idx.decode().splitlines():
        m = json.loads(line)
        if m.get("param") == param and m.get("levtype") == "sfc":
            blob = _get(u, (m["_offset"], m["_offset"] + m["_length"] - 1))
            if blob is None:
                return None
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "wb").write(blob)
            return blob
    return None


def grid(blob):
    import eccodes  # imported here so --help works without it
    h = eccodes.codes_new_from_message(blob)
    try:
        g = {k: eccodes.codes_get(h, k) for k in ("Ni", "Nj", "latitudeOfFirstGridPointInDegrees",
                                                 "longitudeOfFirstGridPointInDegrees", "iDirectionIncrementInDegrees",
                                                 "jDirectionIncrementInDegrees", "jScansPositively")}
        g["v"] = eccodes.codes_get_values(h)
        return g
    finally:
        eccodes.codes_release(h)


def bilinear(g, lat, lon):
    ni, nj, di, dj = g["Ni"], g["Nj"], g["iDirectionIncrementInDegrees"], g["jDirectionIncrementInDegrees"]
    lat0, lon0 = g["latitudeOfFirstGridPointInDegrees"], g["longitudeOfFirstGridPointInDegrees"]
    x = ((lon - lon0) % 360.0) / di
    y = (lat - lat0) / dj if g["jScansPositively"] else (lat0 - lat) / dj
    i0, j0 = int(math.floor(x)), int(math.floor(y))
    fx, fy = x - i0, y - j0
    j1 = min(j0 + 1, nj - 1)

    def at(i, j):
        return float(g["v"][j * ni + (i % ni)])
    return ((1 - fx) * (1 - fy) * at(i0, j0) + fx * (1 - fy) * at(i0 + 1, j0)
            + (1 - fx) * fy * at(i0, j1) + fx * fy * at(i0 + 1, j1))


def wind_at(cache, cyc, step, pts, memo):
    key = (cyc, step)
    if key not in memo:
        bu, bv = field_bytes(cache, cyc, step, "10u"), field_bytes(cache, cyc, step, "10v")
        memo[key] = (grid(bu), grid(bv)) if bu and bv else None
    if memo[key] is None:
        return {}
    gu, gv = memo[key]
    out = {}
    for sid, (lat, lon) in pts.items():
        u, v = bilinear(gu, lat, lon), bilinear(gv, lat, lon)
        out[sid] = (math.hypot(u, v) * SR.MS_TO_KT, (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--grade", required=True, help="the grade's output JSON (its 'stations' list has id, lat, lon)")
    ap.add_argument("--cache", required=True, help="directory OUTSIDE the repo")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    assert not os.path.abspath(a.cache).startswith(repo), "--cache must be outside the repo"

    pts = {str(s["id"]): (float(s["lat"]), float(s["lon"])) for s in json.load(open(a.grade))["stations"]}
    want = set()
    with open(a.rows) as fh:
        for line in fh:
            r = json.loads(line)
            if r.get("zone") == "full" and r["lead"] in LEADS:
                want.add((str(r["id"]), r["cycle"], r["lead"]))
    memo, missing, n = {}, 0, 0
    with open(a.out, "w") as fh:
        for cyc_s in sorted({c for (_, c, _) in want}):
            cyc = dt.datetime.strptime(cyc_s, "%Y%m%d%H")
            for lead in LEADS:
                ids = {i for (i, c, L) in want if c == cyc_s and L == lead}
                if not ids:
                    continue
                sub = {i: pts[i] for i in ids if i in pts}
                same = wind_at(a.cache, cyc, lead, sub, memo)
                prev = wind_at(a.cache, cyc - dt.timedelta(hours=6), lead + 6, sub, memo)
                for i in sorted(ids):
                    e, p = same.get(i), prev.get(i)
                    missing += e is None
                    n += 1
                    fh.write(json.dumps({"id": i, "cycle": cyc_s, "lead": lead,
                                         "e_kt": e[0] if e else None, "e_dir": e[1] if e else None,
                                         "ep_kt": p[0] if p else None, "ep_dir": p[1] if p else None}) + "\n")
            memo.clear()
            fh.flush()
            print(f"{cyc_s} done ({n} lines)", flush=True)
    print(f"wrote {n} lines, {missing} without a same-cycle ECMWF value")


if __name__ == "__main__":
    main()
