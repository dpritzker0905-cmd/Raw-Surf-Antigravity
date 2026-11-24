"""gust_verify_collect.py - the forward record for the gust verification: each day's 00Z GFS / EURO / ICON gust (and 10 m wind)
at the NDBC gust stations, plus the NDBC reports. GitHub Actions only.

WHY. The Gusts layer serves each model's own gust (frame_set_raster SPECS gust / gust_euro / gust_icon). The one-off check of
2026-11-15 (log 2026-11-15-opus-gusts-currents.md section 7c) had ~3 days and short leads only, because DWD keeps ICON for about a
day and data.ecmwf.int for a few. This saves each day's run while it is reachable, so weeks of every lead build up.
Method (pre-registered): docs/weather-program/log/2026-11-18-opus-gust-verification.md section 1; scoring is
gust_verify_score.py (standard library only).

READS public data only, never the Raw Surf backend: NOAA GFS on AWS Open Data, ECMWF open data (data.ecmwf.int, and its AWS
mirror for a backfill), DWD open data, NDBC (latest_obs, station metadata, 5-day / 45-day files). The model fields are read by
the PUBLISHER'S OWN source classes, so the value scored is the value the gust frames serve (to their 0.005 kn quantum).
WRITES local files only; gust_bucket_io.py (stdlib, the only step holding the key) uploads them create-only:
  stations.json.new                      the frozen station list (first run only)
  cycles/<MODEL>_<YYYYMMDDHH>.json.gz.new each 00Z run: per step f, its gust window w (0 = instantaneous), gust g and 10 m wind u
                                         in m/s at every station's 0.25-degree node (null = no value)
  obs/<YYYYMMDD>_<5day|rt2>.json.gz.new  the NDBC reports [epoch minute, WSPD, GST] per station

  python gust_verify_collect.py stations --cache D
  python gust_verify_collect.py daily    --cache D
  python gust_verify_collect.py backfill --cache D --start 2026-11-01 --end 2026-11-17   # GFS and EURO only (ICON has no archive)
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import buoy_holdout  # noqa: E402 - stdlib only

buoy_holdout.declare_collector(__name__, "archives raw NDBC gust reports and model gusts at every station; scores nothing")

LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
STATION_META = "https://www.ndbc.noaa.gov/metadata/stationmetadata.xml"
FIVE_DAY = "https://www.ndbc.noaa.gov/data/5day2/{id}_5day.txt"
REALTIME2 = "https://www.ndbc.noaa.gov/data/realtime2/{id}.txt"
ECMWF_AWS = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
LAT_BAND = (-60.0, 65.0)
GFS_STEPS = tuple(range(0, 241, 3))
EURO_STEPS = tuple(range(3, 145, 3)) + tuple(range(150, 241, 6))
ICON_STEPS = tuple(range(3, 181, 3))
KN_PER_MS = 3600.0 / 1852.0
GUST_VALID_KN = (0.0, 250.0)            # the gust specs' own physical range
UA = "raw-surf-gust-verify (public data, one daily read)"
EURO_RETRY_WAITS = (5, 15, 45, 120, 300)  # EURO only: 11-19's backfill (run 45251339050) dropped 31 of 64 steps after 5/15/45
# A cycle stops WAITING to retry after 25 min, so a throttled backfill slice cannot run past the collect step's 120-min timeout
# and lose every cycle not yet written.
CYCLE_RETRY_BUDGET_S = 1500


def euro_window(f):
    """Hours in ECMWF open data's 10fg / 10fg3 window ending at step f (decoded 2026-11-15; checked per message)."""
    return 1 if f <= 90 else (3 if f <= 144 else 6)


def icon_window(f):
    """VMAX_10M is the max since the previous output: hourly output to 78 h, 3-hourly after."""
    return 1 if f <= 78 else 3


def node_of(lat, lon):
    """(row, col) of the nearest 0.25-degree frame-lattice node: row 0 = 90S, column 0 = 180W."""
    return int(round((lat + 90.0) / 0.25)), int(round(((lon + 180.0) % 360.0) / 0.25)) % 1440


# ---------------------------------------------------------------------------------------------------- NDBC
def parse_latest_obs(text):
    """[(id, lat, lon)] reporting a numeric GST inside LAT_BAND (the header names the columns)."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    head = lines[0].lstrip("#").split()
    i_lat, i_lon, i_g = head.index("LAT"), head.index("LON"), head.index("GST")
    out = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        p = ln.split()
        if len(p) <= i_g or p[i_g] == "MM":
            continue
        try:
            lat, lon = float(p[i_lat]), float(p[i_lon])
            float(p[i_g])
        except ValueError:
            continue
        if LAT_BAND[0] <= lat <= LAT_BAND[1]:
            out.append((p[0].upper(), lat, lon))
    return out


def parse_station_meta(xml_text):
    """{id: z_m} from stationmetadata.xml: site elevation + anemometer height of the CURRENT history entry (stop empty)."""
    out = {}
    root = ET.fromstring(xml_text)
    for st in root.iter("station"):
        cur = [h for h in st.findall("history") if not h.get("stop")]
        if not cur:
            continue
        h = max(cur, key=lambda e: e.get("start") or "")
        try:
            an = float(h.get("anemom_height"))
        except (TypeError, ValueError):
            continue
        try:
            elev = float(h.get("elev") or 0.0)
        except ValueError:
            elev = 0.0
        out[st.get("id", "").upper()] = round(max(elev, 0.0) + an, 2)
    return out


def parse_ndbc_met(text):
    """[(epoch minute, WSPD, GST)] from an NDBC standard-met text file (5day2 or realtime2); MM -> None."""
    lines = text.splitlines()
    if not lines or not lines[0].startswith("#"):
        return []
    head = lines[0].lstrip("#").split()
    try:
        iw, ig = head.index("WSPD"), head.index("GST")
    except ValueError:
        return []
    out = []
    for ln in lines:
        if ln.startswith("#") or not ln.strip():
            continue
        p = ln.split()
        if len(p) <= max(iw, ig, 4):
            continue
        try:
            t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=timezone.utc)
        except ValueError:
            continue

        def num(x):
            try:
                return float(x)
            except ValueError:
                return None
        out.append((int(t.timestamp() // 60), None if p[iw] == "MM" else num(p[iw]), None if p[ig] == "MM" else num(p[ig])))
    return out


def fetch_obs(http, ids, kind="5day", workers=6):
    url = FIVE_DAY if kind == "5day" else REALTIME2

    def one(sid):
        try:
            r = http.get(url.format(id=sid), timeout=60)
            return sid, parse_ndbc_met(r.text) if r.status_code == 200 else None
        except Exception:  # noqa: BLE001 - a station without its file is counted, never filled
            return sid, None
    with ThreadPoolExecutor(workers) as ex:
        got = dict(ex.map(one, ids))
    return {sid: rows for sid, rows in got.items() if rows}, sorted(sid for sid, rows in got.items() if not rows)


# ---------------------------------------------------------------------------------------------------- model fields
def _frame(a_grib_order):
    from services import frame_set_raster as fsr
    return fsr.to_frame_plane(a_grib_order, (-1e9, 1e9), None, stride=1)


def _speed(u, v):
    import numpy as np
    return np.hypot(u, v)


def _sample(plane, nodes, scale=1.0, valid=None):
    import numpy as np
    out = []
    for r, c in nodes:
        x = float(plane[r, c])
        if not np.isfinite(x) or (valid and not (valid[0] <= x <= valid[1])):
            out.append(None)
        else:
            out.append(round(x * scale, 2))
    return out


class GfsModel:
    name, steps = "GFS", GFS_STEPS

    def __init__(self, http):
        from services import frame_set_raster as fsr
        self.gust = fsr.GfsGribSource(fsr.SPECS["gust"], http)
        ident = lambda a: a  # noqa: E731
        self.u = fsr.GfsGribSource({"idx": ("UGRD", "10 m above ground"), "convert": ident, "hours": GFS_STEPS}, http)
        self.v = fsr.GfsGribSource({"idx": ("VGRD", "10 m above ground"), "convert": ident, "hours": GFS_STEPS}, http)
        self.land = fsr.GfsGribSource({"idx": ("LAND", "surface"), "convert": ident, "hours": GFS_STEPS}, http)

    def window(self, f):
        return 0

    def available(self, cycle):
        return self.gust.complete_cycle(cycle + timedelta(hours=5)) == cycle

    def step(self, cycle, f, nodes):
        g = _frame(self.gust.fetch(cycle, f))                       # knots (the spec's convert)
        u = _speed(_frame(self.u.fetch(cycle, f)), _frame(self.v.fetch(cycle, f)))
        return _sample(g, nodes, 1.0 / KN_PER_MS, GUST_VALID_KN), _sample(u, nodes)


def _euro_source(spec, base, exact_window):
    from services import frame_set_raster_sources as srcs

    class Euro(srcs.EcmwfOpenDataSource):
        def _stem(self, cycle, f):
            d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
            return f"{base}/{d}/{hh}z/ifs/0p25/oper/{d}{hh}0000-{f}h-oper-fc"

        def _steps_for(self, f):                                 # the window is checked, not assumed (log section 1)
            return (f"{f - euro_window(f)}-{f}",) if exact_window else (str(f),)

        def fetch(self, cycle, f):
            """A throttled mirror answers the .index with an error page, which the publisher's source would read as "index
            has no 10fg" (final-sounding, but transient). Checked here first, so the step is retried as what it is."""
            r = self.http.get(self._stem(cycle, f) + ".index", timeout=60)
            if not is_grib_index(r.status_code, r.text):
                raise RuntimeError(f"index not a GRIB index (HTTP {r.status_code}; throttled mirror): retryable")
            return super().fetch(cycle, f)
    return Euro


def is_grib_index(status, text):
    """ECMWF open-data .index files are JSON lines ({"param": ...}); anything else (an error page, an empty body) is not."""
    if status != 200:
        return False
    first = (text or "").lstrip()[:1]
    return first == "{"


class EuroModel:
    name, steps = "EURO", EURO_STEPS
    retry_waits = EURO_RETRY_WAITS              # the mirror throttles for minutes, not seconds (director, 2026-11-23)

    def __init__(self, http, base=None):
        from services import frame_set_raster as fsr
        from services import frame_set_raster_sources as srcs
        base = base or srcs.ECMWF_BASE
        ident = lambda a: a  # noqa: E731
        self.gust = _euro_source(fsr.SPECS["gust_euro"], base, True)(fsr.SPECS["gust_euro"], http)
        self.u = _euro_source(None, base, False)({"idx": ("10u", "sfc"), "convert": ident, "hours": EURO_STEPS}, http)
        self.v = _euro_source(None, base, False)({"idx": ("10v", "sfc"), "convert": ident, "hours": EURO_STEPS}, http)
        self.http = http

    def window(self, f):
        return euro_window(f)

    def available(self, cycle):
        try:
            return self.http.head(self.gust._stem(cycle, EURO_STEPS[-1]) + ".index", timeout=60).status_code == 200
        except Exception:  # noqa: BLE001
            return False

    def step(self, cycle, f, nodes):
        g = _frame(self.gust.fetch(cycle, f))
        u = _speed(_frame(self.u.fetch(cycle, f)), _frame(self.v.fetch(cycle, f)))
        return _sample(g, nodes, 1.0 / KN_PER_MS, GUST_VALID_KN), _sample(u, nodes)


class IconModel:
    name, steps = "ICON", ICON_STEPS

    def __init__(self, http):
        from services import frame_set_raster as fsr
        from services import frame_set_raster_sources as srcs
        self.srcs = srcs
        self.src = srcs.IconGridSource(fsr.SPECS["gust_icon"], http)
        self.http = http

    def window(self, f):
        return icon_window(f)

    def _file(self, cycle, f, directory, token):
        d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
        return f"{self.srcs.DWD_BASE}/{hh}/{directory}/{self.srcs.ICON_SINGLE}_{d}{hh}_{f:03d}_{token}.grib2.bz2"

    def available(self, cycle):
        try:
            return self.http.head(self._file(cycle, ICON_STEPS[-1], "vmax_10m", "VMAX_10M"), timeout=60).status_code == 200
        except Exception:  # noqa: BLE001
            return False

    def step(self, cycle, f, nodes):
        import numpy as np
        pick, ncells = self.src.grid(cycle)                     # the publisher's nearest-cell pick per 0.25-degree node
        vals = {}
        for directory, token in (("vmax_10m", "VMAX_10M"), ("u_10m", "U_10M"), ("v_10m", "V_10M")):
            x = self.src._decode_bz2(self._file(cycle, f, directory, token))
            if x.size != ncells:
                raise RuntimeError(f"{token} has {x.size} cells, the grid {ncells}")
            vals[token] = x
        speed = np.hypot(vals["U_10M"], vals["V_10M"])
        g, u = [], []
        for r, c in nodes:
            k = int(pick[r * 1440 + c])
            gk = float(vals["VMAX_10M"][k]) if k >= 0 else float("nan")
            sk = float(speed[k]) if k >= 0 else float("nan")
            g.append(round(gk, 2) if np.isfinite(gk) and GUST_VALID_KN[0] <= gk * KN_PER_MS <= GUST_VALID_KN[1] else None)
            u.append(round(sk, 2) if np.isfinite(sk) else None)
        return g, u


RETRY_WAITS = (5, 15, 45)               # seconds; the AWS mirror answers 503 under load (dry run 44392035963: 130 EURO steps)


def available_retried(model, cycle, waits=None):
    """model.available(cycle), asked again after each wait: one failed HEAD must not count as "not published"."""
    import time
    for wait in (0,) + tuple(RETRY_WAITS if waits is None else waits):
        time.sleep(wait)
        if model.available(cycle):
            return True
    return False


# Every model's 00Z run is out by 10 UTC (GFS ~05Z, ICON ~04Z, EURO ~08Z); before that, today's absence is expected, not a
# miss (the PR dry run at 00:01Z on 2026-11-24 flagged one falsely).
PUBLISH_BY_H = 10


LOOKBACK_DAYS = 3      # days before yesterday whose missing runs are REPORTED (flag only; nothing is collected or failed)


def plan_daily(model, today, done, report, waits=None, now=None):
    """The daily job's cycles for one model. Nothing that goes missing is ever silent.
    - TODAY: stored -> skip; available -> collect; not available -> `not_yet_due` before PUBLISH_BY_H (green), otherwise
      `unavailable` (red).
    - YESTERDAY, ALWAYS, whatever today did and whatever the clock: stored -> skip; available -> collect; otherwise
      `unavailable` (red). GitHub drops scheduled runs, and ICON keeps only its latest run, so a dropped day-D run is caught
      by day D+1 here, never lost green (advisor HOLD on #1255).
    - The LOOKBACK_DAYS before yesterday: a missing key is listed in `missing_recent` (a report). The DAY BEFORE YESTERDAY,
      if missing, is also `missed_gap` (red): it was never "yesterday" to any run, so two or more consecutive scheduled runs
      were dropped, and this is the first run that can see it. Further back it is report-only, so a lost day is red once.
    2026-11-22: one failed HEAD for ICON's 00Z sent the old loop to the stored yesterday, and the day was lost green."""
    out = []
    y = today - timedelta(days=1)
    for day, is_today in ((today, True), (y, False)):
        key = f"cycles/{model.name}_{day:%Y%m%d%H}.json.gz"
        if key in done:
            report["skipped"].append(key)
        elif available_retried(model, day, waits):
            out.append((model, day, key))
        elif is_today and now is not None and now < today + timedelta(hours=PUBLISH_BY_H):
            report.setdefault("not_yet_due", []).append(f"{model.name} {day:%Y%m%d%H}")
        else:
            report["unavailable"].append(f"{model.name} {day:%Y%m%d%H}")
    for k in range(2, 2 + LOOKBACK_DAYS):
        d = today - timedelta(days=k)
        if f"cycles/{model.name}_{d:%Y%m%d%H}.json.gz" not in done:
            report.setdefault("missing_recent", []).append(f"{model.name} {d:%Y%m%d%H}")
            if k == 2:   # a day that was never "yesterday" to a run (2+ consecutive runs dropped): its first appearance, red
                report.setdefault("missed_gap", []).append(f"{model.name} {d:%Y%m%d%H}")
    return out


def collect_cycle(model, cycle, stations, workers=4, waits=None, budget_s=CYCLE_RETRY_BUDGET_S):
    """{model, cycle, station_ids, steps:[{f, w, g, u}], dropped:[{f, why}]}; a step is retried after each of the model's
    waits (EURO a longer ladder), then dropped with its last reason, never filled. No retry wait starts once the cycle's
    budget would be passed: the step is dropped instead ("retry budget spent")."""
    import time
    nodes = [tuple(s["node"]) for s in stations]
    waits = getattr(model, "retry_waits", RETRY_WAITS) if waits is None else waits
    deadline = time.monotonic() + budget_s

    def one(f):
        why, tries = None, 0
        for k, wait in enumerate((0,) + tuple(waits)):
            if k and time.monotonic() + wait > deadline:
                why = f"{why} (retry budget spent)"
                break
            time.sleep(wait)
            tries += 1
            try:
                g, u = model.step(cycle, f, nodes)
                return {"f": f, "w": model.window(f), "g": g, "u": u}, None
            except Exception as e:  # noqa: BLE001 - recorded with its reason
                why = f"{type(e).__name__}: {str(e)[:160]}"
        return None, {"f": f, "why": why, "attempts": tries}
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(one, model.steps))
    return {"model": model.name, "cycle": cycle.strftime("%Y%m%d%H"), "station_ids": [s["id"] for s in stations],
            "steps": [s for s, _ in res if s], "dropped": [d for _, d in res if d]}


# ---------------------------------------------------------------------------------------------------- files
def write_gz(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))


def existing(cache):
    """Keys already stored (the storage step writes existing.json) plus any local file of the same name."""
    p = os.path.join(cache, "existing.json")
    keys = set(json.load(open(p))) if os.path.exists(p) else set()
    for sub in ("cycles", "obs"):
        d = os.path.join(cache, sub)
        if os.path.isdir(d):
            keys |= {f"{sub}/{n[:-4] if n.endswith('.new') else n}" for n in os.listdir(d)}
    return keys


def load_stations(cache):
    for name in ("stations.json", "stations.json.new"):
        p = os.path.join(cache, name)
        if os.path.exists(p):
            return json.load(open(p))["stations"]
    return None


def freeze_stations(http, cache, now):
    rows = parse_latest_obs(http.get(LATEST_OBS, timeout=120).text)
    meta = parse_station_meta(http.get(STATION_META, timeout=180).text)
    gfs = GfsModel(http)
    land = None
    floor = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(8):
        try:
            land = _frame(gfs.land.fetch(floor - timedelta(hours=6 * back), 0))
            break
        except Exception:  # noqa: BLE001
            continue
    st = []
    for sid, lat, lon in sorted(set(rows)):
        r, c = node_of(lat, lon)
        lf = None
        if land is not None and math.isfinite(float(land[r, c])):
            lf = int(round(float(land[r, c])))
        st.append({"id": sid, "lat": lat, "lon": lon, "z_m": meta.get(sid), "node": [r, c], "land": lf})
    doc = {"frozen_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
           "rule": "every NDBC latest_obs station with a numeric GST between 60S and 65N; z_m = elev + anemom_height of the "
                   "current stationmetadata.xml history entry; node = nearest 0.25-degree frame node; land = GFS LAND f000",
           "stations": st}
    json.dump(doc, open(os.path.join(cache, "stations.json.new"), "w"), indent=0)
    return st


def _http():
    import requests
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stations", "daily", "backfill"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--models", default="GFS,EURO,ICON")
    ap.add_argument("--report-only", action="store_true",
                    help="the keyless PR dry run only: it starts with NO stored record, so a missed day is reported, not failed")
    a = ap.parse_args(argv)
    os.makedirs(a.cache, exist_ok=True)
    http = _http()
    now = datetime.now(timezone.utc)
    report = {"mode": a.cmd, "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "cycles": [], "skipped": [], "unavailable": [],
              "dropped_steps": {}}
    stations = load_stations(a.cache)
    if stations is None:
        stations = freeze_stations(http, a.cache, now)
        report["stations_frozen"] = len(stations)
    report["stations"] = len(stations)
    if a.cmd == "stations":
        print(buoy_holdout.redact(json.dumps(report)))
        return 0
    done = existing(a.cache)
    wanted = set(a.models.split(","))
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    jobs = []
    if a.cmd == "daily":
        for M in (GfsModel, EuroModel, IconModel):
            if M.name not in wanted:
                continue
            jobs += plan_daily(M(http), today, done, report, now=now)
        obs_kind = "5day"
    else:
        start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
        models = [m for m in (GfsModel(http), EuroModel(http, base=ECMWF_AWS)) if m.name in wanted]
        d = start
        while d <= end:
            for model in models:
                key = f"cycles/{model.name}_{d:%Y%m%d%H}.json.gz"
                if key in done:
                    report["skipped"].append(key)
                else:
                    jobs.append((model, d, key))
            d += timedelta(days=1)
        obs_kind = "rt2"
    for model, cyc, key in jobs:
        t = datetime.now(timezone.utc)
        doc = collect_cycle(model, cyc, stations)
        write_gz(os.path.join(a.cache, key + ".new"), doc)
        report["cycles"].append({"key": key, "steps": len(doc["steps"]), "dropped": len(doc["dropped"]),
                                 "seconds": round((datetime.now(timezone.utc) - t).total_seconds(), 1)})
        if doc["dropped"]:
            report["dropped_steps"][key] = doc["dropped"]
        print(f"{key}: {len(doc['steps'])} steps, {len(doc['dropped'])} dropped", flush=True)
    okey = f"obs/{today:%Y%m%d}_{obs_kind}.json.gz"
    if okey not in done:
        got, missing = fetch_obs(http, [s["id"] for s in stations], obs_kind)
        doc = {"fetched_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "kind": obs_kind, "stations": got}
        write_gz(os.path.join(a.cache, okey + ".new"), doc)
        report["obs"] = {"key": okey, "stations": len(got), "missing": missing}
        print(f"{okey}: {len(got)} stations, {len(missing)} without a file", flush=True)
    open(os.path.join(a.cache, f"collect_report_{a.cmd}.json"), "w").write(buoy_holdout.redact(json.dumps(report, indent=1)))
    missed = report["unavailable"] + report.get("missed_gap", [])
    if missed:                             # loud, AFTER the collected files are written (the upload step runs on failure too)
        level = "warning" if a.report_only else "error"
        print(buoy_holdout.redact(f"::{level}::run not collected: {', '.join(missed)}"), flush=True)
        return 0 if a.report_only else 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
