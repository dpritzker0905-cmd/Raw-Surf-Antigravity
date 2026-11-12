"""Stored GFS-Wave partition fields (WVHGT/WVPER/WVDIR and SWELL/SWPER/SWDIR 1-3) sampled at buoy positions.

Source: the public NOAA GFS-Wave 0.25 degree archive on AWS Open Data (the same files, and the same slot order, the
ingest reads in services/noaa_gfs_wave_fetcher.py). ONE byte-range GET per (cycle, forecast hour) covers the wind-sea
and the three swell slots (about 7 MB of a 30 MB file); the sampled values are cached as small JSON, the raw bytes are
not kept. Sampling is the NEAREST valid cell of the four surrounding nodes (never an average across slots).
Direction is the WW3 meteorological convention (compass FROM); the scorer checks that with a 180-degree control.
"""
import json
import time
import urllib.request
from datetime import datetime
from typing import Dict, List, Optional, Sequence

import numpy as np

from services.weather_pipeline import eval_grib2 as g2
from scripts.partition_truth.ndbc_spectra import USER_AGENT, cache_dir

WAVE_URL = ("https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{hh}/wave/gridded/"
            "gfswave.t{hh}z.global.0p25.f{fh:03d}.grib2")
SLOTS = {"windsea": ("WVHGT", "WVPER", "WVDIR"), "swell1": ("SWELL:1", "SWPER:1", "SWDIR:1"),
         "swell2": ("SWELL:2", "SWPER:2", "SWDIR:2"), "swell3": ("SWELL:3", "SWPER:3", "SWDIR:3")}
WANTED = [k for trio in SLOTS.values() for k in trio]


def _http(url: str, headers=None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def _nearest_valid(arr: np.ndarray, meta: dict, lat: float, lng: float) -> Optional[float]:
    i, j = g2.index_of(meta, lat, lng)
    best = None
    for di in (0, 1):
        for dj in (0, 1):
            ii, jj = i + di, (j + dj) % meta["ni"]
            if not 0 <= ii < meta["nj"]:
                continue
            v = float(arr[ii, jj])
            if not np.isfinite(v) or abs(v) > 1e10:
                continue
            la = meta["lat_south"] + ii * meta["dlat"]
            lo = (meta["lon_west"] + jj * meta["dlon"]) % 360.0
            d = (la - lat) ** 2 + (((lo - lng + 180.0) % 360.0 - 180.0) * np.cos(np.radians(lat))) ** 2
            if best is None or d < best[0]:
                best = (d, v)
    return None if best is None else best[1]


def sample(cycle: datetime, fh: int, stations: Dict[str, tuple], decoder: str = "auto") -> Dict[str, Dict]:
    """{station: {'windsea': [h, tp, dir] | None, 'swell1': ..., 'swell2': ..., 'swell3': ...}} for one (cycle, fh)."""
    key = f"gfswave_{cycle:%Y%m%d%H}_f{fh:03d}.json"
    path = cache_dir() / key
    have = json.loads(path.read_text()) if path.exists() else {}
    if all(s in have for s in stations):
        return {s: have[s] for s in stations}
    url = WAVE_URL.format(d=f"{cycle:%Y%m%d}", hh=f"{cycle:%H}", fh=fh)
    idx = g2.parse_idx(_http(url + ".idx").decode("utf-8", "replace"))
    sel = g2.select_range(idx, WANTED)
    if sel is None:
        raise g2.Unsupported(f"{url}: idx lacks the partition messages")
    lo, hi, keys = sel
    buf = _http(url, {"Range": f"bytes={lo}-{hi if hi is not None else ''}"})
    got = g2.decode_span(buf, keys, WANTED, decoder)
    out: Dict[str, Dict] = {}
    for sid, (lat, lng) in stations.items():
        rec = {}
        for slot, trio in SLOTS.items():
            vals = [_nearest_valid(got[k][0], got[k][1], lat, lng) for k in trio]
            rec[slot] = None if any(v is None for v in vals) else [round(v, 3) for v in vals]
        out[sid] = rec
    have.update(out)
    path.write_text(json.dumps(have))
    time.sleep(0.5)
    return out


def cycles(start: datetime, end: datetime, hours: Sequence[int] = (0, 12)) -> List[datetime]:
    from datetime import timedelta
    d, out = start.replace(hour=0, minute=0, second=0, microsecond=0), []
    while d <= end:
        out += [d.replace(hour=h) for h in hours]
        d += timedelta(days=1)
    return [c for c in out if start <= c <= end]
