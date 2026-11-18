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
# Retries seen by _get, by cause ("503", "429", "exc", ...): the hindcast records them per shard so a VOID from
# dropped runs can be traced to throttling, not missing data (senior lead 2026-11-16).
RETRY_STATS: Dict[str, int] = {}


def ef_url(base: str, run: datetime, step: int, ext: str = "grib2", stream: str = "enfo", typ: str = "ef",
           model: str = "ifs") -> str:
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    return f"{base}/{d}/{h}z/{model}/0p25/{stream}/{d}{h}0000-{int(step)}h-{stream}-{typ}.{ext}"


def _get(session, url: str, headers: Optional[dict] = None, tries: Optional[int] = None, timeout: int = 120):
    """GET with exponential backoff + jitter. S3 answers 503 SlowDown under parallel range reads (hindcast run
    43773419409 lost 4 of 24 shards to one 503 each), so 429/5xx and network errors are retried up to ~6 min."""
    import os
    import random
    tries = int(tries or os.environ.get("ENS_FETCH_TRIES", "8"))         # FILL mode: 12 (log 2026-11-17 09:57Z)
    cap = float(os.environ.get("ENS_FETCH_BACKOFF_CAP", "60"))           # FILL mode: 180 s
    last = None
    for k in range(tries):
        try:
            r = session.get(url, headers=headers or {}, timeout=timeout)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return r
            last = RuntimeError(f"HTTP {r.status_code} {url}")
            RETRY_STATS[str(r.status_code)] = RETRY_STATS.get(str(r.status_code), 0) + 1
        except Exception as e:  # noqa: BLE001 - network; retried
            last = e
            RETRY_STATS["exc"] = RETRY_STATS.get("exc", 0) + 1
        time.sleep(min(cap, 2.0 ** (k + 1)) + random.uniform(0.0, 2.0))
    raise last if last else RuntimeError(url)


def run_available(session, run: datetime, last_step: int = 336, base: str = AWS_BASE) -> bool:
    """True when the run's member file at `last_step` has an index (a run is complete only once its tail exists)."""
    r = _get(session, ef_url(base, run, last_step, "index"), tries=2, timeout=60)
    return r.status_code == 200


def fetch_step(session, run: datetime, step: int, reduce_fn: Callable[[np.ndarray, dict], np.ndarray],
               params: Sequence[str] = PARAMS, base: str = AWS_BASE, prefer: str = "auto",
               perturbed: int = ec.PERTURBED, max_gap: int = 0, model: str = "ifs",
               file_types: Sequence[str] = ("ef",)) -> Tuple[Dict[str, np.ndarray], dict]:
    """{param: array[members, ...reduced]} for one step of one run. `pf` 1..`perturbed` are REQUIRED (any missing ->
    raise: a partial ensemble is never averaged). The control (`cf`, member 0) is included, FIRST, only when the run's
    index carries it for every wanted param (amendment 5: it left the open-data ef files on 2026-05-13 00Z). The
    returned meta says `has_cf` and `n_members`. IFS ENS ships all members in one `ef` file; AIFS-ENS
    (model="aifs-ens") ships `cf` and `pf` files: pass file_types=("cf", "pf")."""
    sel_by_file = {}
    for typ in file_types:
        iurl = ef_url(base, run, step, "index", typ=typ, model=model)
        idx = _get(session, iurl)
        if idx.status_code != 200:
            raise FileNotFoundError(iurl)
        sel_by_file[typ] = ec.select_members(ec.parse_ecmwf_index(idx.text), params, step)
    owner = {k: typ for typ, sel in sel_by_file.items() for k in sel}
    required = [(p, m) for p in params for m in range(1, perturbed + 1)]
    missing = [k for k in required if k not in owner]
    if missing:
        raise ValueError(f"{model} run {run:%Y%m%d%H} step {step}: {len(missing)} member fields missing, e.g. {missing[:3]}")
    has_cf = all((p, 0) in owner for p in params)
    members = ([0] if has_cf else []) + list(range(1, perturbed + 1))
    want = [(p, m) for p in params for m in members]
    pos = {m: i for i, m in enumerate(members)}
    out: Dict[str, list] = {p: [None] * len(members) for p in params}
    meta_seen: dict = {}
    for typ in file_types:
        keys = [k for k in want if owner[k] == typ]
        if keys:
            meta_seen = _read_file(session, ef_url(base, run, step, "grib2", typ=typ, model=model), keys,
                                   [sel_by_file[typ][k] for k in keys], out, reduce_fn, prefer, max_gap, pos) or meta_seen
    return {p: np.stack(v) for p, v in out.items()}, dict(meta_seen, has_cf=has_cf, n_members=len(members))


def _read_file(session, url, keys, ranges, out, reduce_fn, prefer, max_gap, pos=None) -> dict:
    meta_seen: dict = {}
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
            out[p][pos[m] if pos is not None else m] = reduce_fn(arr, meta)
    return meta_seen


def subsample_1deg(arr: np.ndarray, meta: dict) -> np.ndarray:
    """The served extension's working grid: every 4th 0.25-degree node (no averaging, values stay model values).
    Re-indexed to lon 0..359 east, lat -90..90 north (rows south to north)."""
    step = int(round(1.0 / meta["dlat"])) if meta["dlat"] else 1
    a = arr[::step, ::step]
    lon0 = int(round(meta["lon_west"])) % 360
    return np.roll(a, lon0, axis=1) if lon0 else a


GRID_1DEG_META = {"ni": 360, "nj": 181, "lat_south": -90.0, "lat_north": 90.0, "lon_west": 0.0, "dlat": 1.0, "dlon": 1.0}
