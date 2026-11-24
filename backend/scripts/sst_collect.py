"""sst_collect.py - the G4 forward collection: each day's Copernicus SST bulletin at the NDBC water-temperature stations.

WHY. The section 11 observation check (docs/weather-program/log/2026-11-15-opus-gusts-currents.md) scores the Copernicus
ocean model's water temperature against NDBC WTMP at 0-23 h and 24-47 h leads. Copernicus replaces past forecast steps with
analyses, so an old forecast cannot be fetched back: it has to be saved the day it is issued. GFS skin, ECMWF skt and the
NDBC observations stay in their public archives and are read at scoring time, so only Copernicus is collected here.

READS (public, no credential): NDBC latest_obs.txt (once, to freeze the station list) and the Copernicus hourly-mean store
(cmems_mod_glo_phy_anfc_0.083deg_PT1H-m, thetao, the top level -0.494 m): its geoChunked ARCO Zarr, chunks
[3216 h, 1, 16, 16 cells], so one chunk holds every hour of a bulletin for every station in a 1.33-degree box.
WRITES local files only (sst_bucket_io.py uploads them create-only, under calibration/sst_g4/):
  stations: sst_stations.json.new - every station reporting WTMP in latest_obs between 60S and 65N (no hand-picking), frozen
            on the first run; each station's Copernicus cell = the cell containing it, or the nearest OCEAN cell within 2
            cells (~18 km) when that one is land, else the station is excluded with its reason.
  daily:    runs/<store end, YYYYMMDDTHH>.json.gz.new - the last 264 hourly values at every station (the day before the
            bulletin plus its ~10-day forecast), keyed by the store's last time step: a run whose key exists is skipped.

  python sst_collect.py stations --cache D
  python sst_collect.py daily    --cache D
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import buoy_holdout  # noqa: E402 - stdlib only

buoy_holdout.declare_collector(__name__, "archives the Copernicus SST bulletin at every frozen NDBC WTMP station; scores nothing")

GEO = ("https://s3.waw3-1.cloudferro.com/mdl-arco-geo-014/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
       "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m_202406/geoChunked.zarr")
LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
EPOCH = datetime(1950, 1, 1, tzinfo=timezone.utc)
ROWS, COLS = 2041, 4320                         # lat -80..90, lon -180..179.917, every 1/12 deg
LAT_BAND = (-60.0, 65.0)                        # section 11: every station reporting WTMP between 60S and 65N
SEARCH = 2                                      # cells: the nearest ocean cell within this many when the station's is land
KEEP_HOURS = 264                                # the day before the bulletin + its ~10 days
LAND = 1e30


def _http():
    import requests
    s = requests.Session()
    s.headers["User-Agent"] = "raw-surf-sst-g4-collector (public data, one read a day)"
    return s


def parse_latest_obs(text):
    """[(id, lat, lon, wtmp)] for rows with a numeric WTMP inside LAT_BAND (the file's own header names the columns)."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    head = lines[0].lstrip("#").split()
    i_lat, i_lon, i_w = head.index("LAT"), head.index("LON"), head.index("WTMP")
    out = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        p = ln.split()
        if len(p) <= i_w or p[i_w] == "MM":
            continue
        try:
            lat, lon, w = float(p[i_lat]), float(p[i_lon]), float(p[i_w])
        except ValueError:
            continue
        if LAT_BAND[0] <= lat <= LAT_BAND[1]:
            out.append((p[0], lat, lon, w))
    return out


def cell_of(lat, lon):
    """(row, col) of the 1/12-degree cell nearest (lat, lon): row 0 = 80S, col 0 = 180W."""
    return int(round((lat + 80.0) * 12)), int(round((lon + 180.0) * 12)) % COLS


def cell_center(j, k):
    return -80.0 + j / 12.0, -180.0 + k / 12.0


def km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))


def pick_cell(lat, lon, is_ocean):
    """(j, k, offset_km) of the station's own cell, or the nearest ocean cell within SEARCH cells; None if all are land.
    `is_ocean(j, k)` reads the model's sea mask."""
    j0, k0 = cell_of(lat, lon)
    best = None
    for dj in range(-SEARCH, SEARCH + 1):
        for dk in range(-SEARCH, SEARCH + 1):
            j, k = j0 + dj, (k0 + dk) % COLS
            if not (0 <= j < ROWS) or not is_ocean(j, k):
                continue
            d = km(lat, lon, *cell_center(j, k))
            if best is None or d < best[2]:
                best = (j, k, d)
    return best


class GeoStore:
    """The geoChunked store, read by chunk (numcodecs decodes; nothing else)."""

    def __init__(self, http, base=GEO):
        self.http, self.base, self._meta = http, base, {}

    def meta(self, name):
        if name not in self._meta:
            r = self.http.get(f"{self.base}/{name}/.zarray", timeout=60)
            r.raise_for_status()
            self._meta[name] = r.json()
        return self._meta[name]

    def chunk(self, name, key):
        import numpy as np
        from numcodecs import get_codec
        m = self.meta(name)
        r = self.http.get(f"{self.base}/{name}/{key}", timeout=180)
        if r.status_code in (403, 404):     # the store never writes an all-land chunk, and answers 403 for an unwritten key
            return None
        r.raise_for_status()
        a = np.frombuffer(get_codec(m["compressor"]).decode(r.content), dtype=np.dtype(m["dtype"])).astype(float)
        return a.reshape(m["chunks"])

    def times(self):
        import numpy as np
        m = self.meta("time")
        n, c = m["shape"][0], m["chunks"][0]
        parts = [self.chunk("time", str(i)) for i in range((n + c - 1) // c)]
        if any(p is None for p in parts):    # the time axis always exists: a refusal here is access, not land
            raise RuntimeError("the store refused its time axis")
        return np.concatenate(parts)[:n]

    def box(self, tchunk, cy, cx):
        """(chunk_t, 16, 16) thetao of one time chunk and cell box; land (the fill) as NaN."""
        import numpy as np
        a = self.chunk("thetao", f"{tchunk}.0.{cy}.{cx}")
        if a is None:                       # an all-land box (e.g. the Great Lakes): no ocean cell, every value NaN
            m = self.meta("thetao")["chunks"]
            return np.full((m[0], m[2], m[3]), np.nan)
        a = a[:, 0]
        a[~(np.abs(a) < LAND)] = np.nan
        return a


def freeze_stations(http, store, now):
    """The station file's content: every WTMP station in LAT_BAND with its model cell (module docstring)."""
    import numpy as np
    rows = parse_latest_obs(http.get(LATEST_OBS, timeout=120).text)
    t = store.times()
    last = int(np.nonzero(np.isfinite(t))[0][-1])
    tc = last // store.meta("thetao")["chunks"][0]
    cy_n, cx_n = store.meta("thetao")["chunks"][2:]
    boxes = {}

    def is_ocean(j, k):
        key = (j // cy_n, k // cx_n)
        if key not in boxes:
            boxes[key] = store.box(tc, *key)[last % store.meta("thetao")["chunks"][0]]
        return bool(np.isfinite(boxes[key][j % cy_n, k % cx_n]))

    kept, excluded = [], []
    for sid, lat, lon, _w in rows:
        got = pick_cell(lat, lon, is_ocean)
        if got is None:
            excluded.append({"id": sid, "lat": lat, "lon": lon, "reason": f"no ocean cell within {SEARCH} cells"})
            continue
        j, k, d = got
        clat, clon = cell_center(j, k)
        kept.append({"id": sid, "lat": lat, "lon": lon, "j": j, "k": k, "cell_lat": round(clat, 4), "cell_lon": round(clon, 4),
                     "offset_km": round(d, 2)})
    return {"frozen_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": LATEST_OBS, "store": GEO,
            "rule": "every station with a numeric WTMP in latest_obs between 60S and 65N; its own 1/12-deg cell, or the "
                    f"nearest ocean cell within {SEARCH} cells", "stations": kept, "excluded": excluded}


def collect_run(store, stations, workers=8):
    """(key, content) of today's run: the last KEEP_HOURS hourly values at every station, keyed by the store's last step."""
    import numpy as np
    t = store.times()
    fin = np.nonzero(np.isfinite(t))[0]
    last = int(fin[-1])
    first = max(0, last - KEEP_HOURS + 1)
    tlen, _, cy_n, cx_n = store.meta("thetao")["chunks"]
    end = EPOCH + timedelta(hours=float(t[last]))
    start = EPOCH + timedelta(hours=float(t[first]))
    if not np.allclose(np.diff(t[first:last + 1]), 1.0):
        raise RuntimeError("the store's time axis is not hourly over the window")
    tchunks = range(first // tlen, last // tlen + 1)
    groups = {}
    for s in stations:
        groups.setdefault((s["j"] // cy_n, s["k"] // cx_n), []).append(s)

    def read(key):
        parts = [store.box(tc, *key) for tc in tchunks]
        series = np.concatenate(parts, axis=0)[first - tchunks[0] * tlen: last - tchunks[0] * tlen + 1]
        return key, series

    vals = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for key, series in pool.map(read, list(groups)):
            for s in groups[key]:
                v = series[:, s["j"] % cy_n, s["k"] % cx_n]
                vals[s["id"]] = [None if not np.isfinite(x) else round(float(x), 3) for x in v]
    key = end.strftime("%Y%m%dT%H")
    content = {"store_end": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "step_h": 1,
               "n": last - first + 1, "collected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "store": GEO, "variable": "thetao (hourly mean, -0.494 m)", "unit": "degC", "values": vals,
               "chunks_read": len(groups) * len(tchunks)}
    return key, content


def main(argv=None, http=None, store=None, now=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("mode", choices=("stations", "daily"))
    ap.add_argument("--cache", required=True)
    a = ap.parse_args(argv)
    os.makedirs(os.path.join(a.cache, "runs"), exist_ok=True)
    http = http or _http()
    store = store or GeoStore(http)
    now = now or datetime.now(timezone.utc)
    sp = os.path.join(a.cache, "sst_stations.json")
    report = {"mode": a.mode}
    if not os.path.exists(sp):
        doc = freeze_stations(http, store, now)
        json.dump(doc, open(sp + ".new", "w"), indent=1)
        json.dump(doc, open(sp, "w"), indent=1)
        report.update(stations=len(doc["stations"]), excluded=len(doc["excluded"]), frozen=True)
    doc = json.load(open(sp))
    report.setdefault("stations", len(doc["stations"]))
    if a.mode == "daily":
        existing = set()
        ep = os.path.join(a.cache, "existing_runs.json")
        if os.path.exists(ep):
            existing = set(json.load(open(ep)))
        key, content = collect_run(store, doc["stations"])
        name = f"{key}.json.gz"
        if name in existing:
            report.update(run=name, skipped="already stored (the store has not advanced)")
        else:
            with gzip.open(os.path.join(a.cache, "runs", name + ".new"), "wt", encoding="utf-8") as fh:
                json.dump(content, fh, separators=(",", ":"))
            missing = sum(all(v is None for v in vs) for vs in content["values"].values())
            report.update(run=name, store_end=content["store_end"], hours=content["n"], chunks_read=content["chunks_read"],
                          stations_all_missing=missing)
    json.dump(report, open(os.path.join(a.cache, f"collect_report_sst_{a.mode}.json"), "w"), indent=1)
    print(buoy_holdout.redact(json.dumps(report)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
