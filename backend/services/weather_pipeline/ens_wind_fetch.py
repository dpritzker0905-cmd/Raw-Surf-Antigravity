"""ens_wind_fetch.py - read ECMWF open-data IFS ENS members (10u, 10v, 10fg) by byte range and reduce them.

Runs ONLY in GitHub Actions (its own workflow, wind-ens-extension.yml, and the offline hindcast), never on Render:
one 6-hourly step is 51 members x 3 fields x ~1.4 MB. Each decoded message is reduced at once by a caller-supplied
function (a 1-degree subsample for the served extension, station values for the hindcast), so memory holds
[51, small] arrays, never [51, 721, 1440].

Archive: ECMWF's AWS mirror `ecmwf-forecasts` (public, no credentials) keeps the open-data history; data.ecmwf.int
keeps ~2-3 days. Layout: {base}/{YYYYMMDD}/{HH}z/ifs/0p25/enfo/{YYYYMMDDHH}0000-{step}h-enfo-ef.{grib2,index}.
"""
import logging
import time
from datetime import datetime
from typing import Callable, Dict, Optional, Sequence, Tuple

import numpy as np

from services.weather_pipeline import ens_wind_core as ec
from services.weather_pipeline import eval_grib2 as g2

logger = logging.getLogger(__name__)

AWS_BASE = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
ECMWF_BASE = "https://data.ecmwf.int/forecasts"
PARAMS = ("10u", "10v", "10fg")


def ef_url(base: str, run: datetime, step: int, ext: str = "grib2", stream: str = "enfo", typ: str = "ef") -> str:
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return f"{base}/{d}/{h}z/ifs/0p25/{stream}/{d}{h}0000-{int(step)}h-{stream}-{typ}.{ext}"


def _get(session, url: str, headers: Optional[dict] = None, tries: int = 8, timeout: int = 120):
    """GET with exponential backoff + jitter. S3 answers 503 SlowDown under parallel range reads (hindcast run
    43773419409 lost 4 of 24 shards to one 503 each), so 429/5xx and network errors are retried up to ~6 min."""
    import random
    last = None
    for k in range(tries):
        try:
            r = session.get(url, headers=headers or {}, timeout=timeout)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return r
            last = RuntimeError(f"HTTP {r.status_code} {url}")
        except Exception as e:  # noqa: BLE001 - network; retried
            last = e
        time.sleep(min(60.0, 2.0 ** (k + 1)) + random.uniform(0.0, 2.0))
    raise last if last else RuntimeError(url)


def run_available(session, run: datetime, last_step: int = 336, base: str = AWS_BASE) -> bool:
    """True when the run's member file at `last_step` has an index (a run is complete only once its tail exists)."""
    r = _get(session, ef_url(base, run, last_step, "index"), tries=2, timeout=60)
    return r.status_code == 200


def fetch_step(session, run: datetime, step: int, reduce_fn: Callable[[np.ndarray, dict], np.ndarray],
               params: Sequence[str] = PARAMS, base: str = AWS_BASE, prefer: str = "auto",
               members_expected: int = ec.MEMBERS_EXPECTED, max_gap: int = 0) -> Tuple[Dict[str, np.ndarray], dict]:
    """{param: array[members, ...reduced]} for one step of one run, member 0 = control. Raises when any member of
    any wanted param is missing (a partial ensemble is never averaged)."""
    idx = _get(session, ef_url(base, run, step, "index"))
    if idx.status_code != 200:
        raise FileNotFoundError(ef_url(base, run, step, "index"))
    sel = ec.select_members(ec.parse_ecmwf_index(idx.text), params, step)
    want = [(p, m) for p in params for m in range(members_expected)]
    missing = [k for k in want if k not in sel]
    if missing:
        raise ValueError(f"run {run:%Y%m%d%H} step {step}: {len(missing)} member fields missing, e.g. {missing[:3]}")
    keys = list(want)
    ranges = [sel[k] for k in keys]
    out: Dict[str, list] = {p: [None] * members_expected for p in params}
    meta_seen: dict = {}
    url = ef_url(base, run, step, "grib2")
    for start, end, ids in ec.coalesce(ranges, max_gap=max_gap):
        r = _get(session, url, headers={"Range": f"bytes={start}-{end - 1}"})
        if r.status_code not in (200, 206):
            raise RuntimeError(f"HTTP {r.status_code} for {url} {start}-{end}")
        buf = r.content
        ids_sorted = sorted(ids, key=lambda i: ranges[i][0])
        span_keys = [f"{keys[i][0]}#{keys[i][1]}" for i in ids_sorted]
        if max_gap:
            # gaps hold unwanted messages: decode each wanted message from its own slice
            dec = {}
            for i, sk in zip(ids_sorted, span_keys):
                off, ln = ranges[i]
                dec.update(g2.decode_span(buf[off - start: off - start + ln], [sk], [sk], prefer=prefer))
        else:
            dec = g2.decode_span(buf, span_keys, span_keys, prefer=prefer)
        for i, sk in zip(ids_sorted, span_keys):
            arr, meta = dec[sk]
            meta_seen = meta
            p, m = keys[i]
            out[p][m] = reduce_fn(arr, meta)
    return {p: np.stack(v) for p, v in out.items()}, meta_seen


def subsample_1deg(arr: np.ndarray, meta: dict) -> np.ndarray:
    """The served extension's working grid: every 4th 0.25-degree node (no averaging, values stay model values).
    Re-indexed to lon 0..359 east, lat -90..90 north (rows south to north)."""
    step = int(round(1.0 / meta["dlat"])) if meta["dlat"] else 1
    a = arr[::step, ::step]
    lon0 = int(round(meta["lon_west"])) % 360
    return np.roll(a, lon0, axis=1) if lon0 else a


GRID_1DEG_META = {"ni": 360, "nj": 181, "lat_south": -90.0, "lat_north": 90.0, "lon_west": 0.0, "dlat": 1.0, "dlon": 1.0}
