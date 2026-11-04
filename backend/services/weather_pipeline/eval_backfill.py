"""eval_backfill.py - HISTORICAL BACKFILL for the evaluation harness: fills the harness's own raw-file cache with the
archived GFS-Wave + GFS pgrb2 10 m wind spans of any past window (2024-01 -> now), in parallel, so a flip test never
waits for future data. Serves nothing, decodes nothing, changes no served number.

PARITY BY CONSTRUCTION. Every file is fetched through `eval_provenance.Cache` under the SAME cache key, from the SAME
URL and the SAME `.idx`-derived byte range that `eval_gfswave.fetch_fields` asks for (`wave_span_keys` /
`atm_span_keys` below are imported from it, never copied). A harness run on the filled cache is therefore a run on
cache hits: the bytes it decodes are the bytes the sequential fetch would have downloaded (sha256 checked by the
cache on every hit). `parity_check` proves it against an existing harness cache (byte identity per file).

WHAT IS FASTER (measured 2026-11-03/04, home link, docs/weather-program/log/2026-11-04-claude-harness-backfill.md):
the sequential fetch spends ~5.7 s per (cycle, forecast hour) (4 requests, 0.5 s pause before each, ~1 MB/s per
S3 connection); 8 parallel connections reach ~0.49 s per file and 16 ~0.38 s (the link saturates ~10-12 MB/s).

POLITENESS. Only the NOAA Open Data bucket is fetched in parallel (AWS S3: thousands of GETs per second per prefix
by design); `MAX_WORKERS` caps it at 16 and every request still goes through the harness's host allowlist and
redirect guard. Truth hosts (NDBC, CDIP, CO-OPS, Open-Meteo) are never parallelised here.

INPUT VERSION. `fingerprint` reads the GFS-Wave HTSGW message header (GRIB master / local table versions, the
generating-process id, the grid) and the wave `.idx` message list. A window whose fingerprint differs from the
reference is a PARITY BREAK (a different model version or product layout, e.g. a GFS-Wave upgrade): it is reported,
never mixed silently into one scorecard.
"""
import hashlib
import json
import os
import struct
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

from services.weather_pipeline import eval_grib2 as g2
from services.weather_pipeline import eval_gfswave as gw
from services.weather_pipeline import eval_provenance as pv

DEFAULT_WORKERS = 8
MAX_WORKERS = 16
PARALLEL_HOSTS = ("noaa-gfs-bdp-pds.s3.amazonaws.com",)
# Same spans as eval_gfswave.fetch_fields: the wave span always covers UGRD..DIRPW (one cache serves both winds).
WAVE_SPAN_KEYS = tuple(gw.WIND_KEYS["gfswave"]) + tuple(gw.WAVE_KEYS)
ATM_SPAN_KEYS = tuple(gw.WIND_KEYS["pgrb2"])


def cache_base(cycle: datetime, fh: int) -> str:
    """The key prefix eval_gfswave.fetch_fields uses (kept in lock-step; a test pins it)."""
    return f"gfs/{cycle:%Y%m%d%H}/f{fh:03d}"


def _fetch_span(cache, url: str, key: str, span_keys, source: str) -> Tuple[bytes, List[dict], List[str]]:
    idx_raw, r_idx = cache.fetch(key + ".idx", url + ".idx", source=source + "_idx", parser="eval_grib2.parse_idx",
                                 time_standard="UTC (cycle + forecast hour)")
    idx = g2.parse_idx(idx_raw.decode("utf-8", "replace"))
    sel = g2.select_range(idx, list(span_keys))
    if sel is None:
        raise g2.Unsupported(f"{url}: idx lacks {list(span_keys)}")
    lo, hi, keys = sel
    raw, r_grb = cache.fetch(f"{key}.{lo}-{hi}.grib2", url, (lo, hi), source=source,
                             parser="eval_grib2.decode_span (decoded at harness run time)",
                             time_standard="UTC (cycle + forecast hour)",
                             notes=f"messages {','.join(keys)}; prefetched by eval_backfill (no decode)")
    return raw, [r_idx, r_grb], [k for _, k in idx], keys


def prefetch_one(cache, cycle: datetime, fh: int, wind_source: str = "pgrb2") -> dict:
    """Fetch (never decode) every raw file the harness needs for one (cycle, fh). Returns a summary row."""
    u, base = gw.urls(cycle, fh), cache_base(cycle, fh)
    wave, recs, idx_keys, span = _fetch_span(cache, u["wave"], base + "/wave", WAVE_SPAN_KEYS, "gfs_wave_grib2")
    if wind_source == "pgrb2":
        _, r2, _, _ = _fetch_span(cache, u["atm"], base + "/atm", ATM_SPAN_KEYS, "gfs_atm_grib2")
        recs += r2
    return {"cycle": f"{cycle:%Y-%m-%dT%HZ}", "fh": fh, "fingerprint": fingerprint(wave, idx_keys, span),
            "bytes": sum(r["bytes"] for r in recs if not r.get("cache_hit")),
            "hits": sum(1 for r in recs if r.get("cache_hit")), "files": len(recs),
            "grib_sha256": [r["sha256"] for r in recs if r["source"].endswith("grib2")]}


# ---- input-version fingerprint ---------------------------------------------------------------------------------
def _section(msg: bytes, num: int) -> Optional[bytes]:
    p = 16
    while p < len(msg) - 4:
        if msg[p:p + 4] == b"7777":
            return None
        n = struct.unpack(">I", msg[p:p + 4])[0]
        if n < 5:
            return None
        if msg[p + 4] == num:
            return msg[p:p + n]
        p += n
    return None


def fingerprint(span: bytes, idx_keys: List[str], span_keys: List[str]) -> dict:
    """What identifies the PRODUCT (not the values): table versions, generating process, grid, message list."""
    out = {"idx_messages": ",".join(idx_keys)}
    for key, msg in zip(span_keys, g2.iter_messages(span)):
        if key != "HTSGW":
            continue
        s1, s3, s4 = _section(msg, 1), _section(msg, 3), _section(msg, 4)
        if s1 is not None:
            out.update(centre=struct.unpack(">H", s1[5:7])[0], subcentre=struct.unpack(">H", s1[7:9])[0],
                       master_table=s1[9], local_table=s1[10], production_status=s1[19])
        if s3 is not None:
            out.update(grid_template=struct.unpack(">H", s3[12:14])[0], ni=struct.unpack(">I", s3[30:34])[0],
                       nj=struct.unpack(">I", s3[34:38])[0])
        if s4 is not None:
            out.update(product_template=struct.unpack(">H", s4[7:9])[0], generating_process=s4[13])
    out["id"] = hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12]
    return out


def parity_breaks(rows: List[dict], reference_id: Optional[str]) -> List[dict]:
    """Rows whose input fingerprint differs from the reference (the current served product's)."""
    if not reference_id:
        return []
    return [{"cycle": r["cycle"], "fh": r["fh"], "fingerprint": r["fingerprint"]} for r in rows
            if r.get("fingerprint", {}).get("id") != reference_id]


# ---- the parallel driver --------------------------------------------------------------------------------------
def needed(targets: List[datetime], leads: List[int]) -> List[Tuple[datetime, int]]:
    """Distinct (cycle, fh) the harness's plan asks for (eval_gfswave.plan, never re-derived)."""
    return sorted({(c, fh) for c, fh, _, _ in gw.plan(targets, leads)})


def prefetch(cache_dir: str, pairs: List[Tuple[datetime, int]], workers: int = DEFAULT_WORKERS,
             wind_source: str = "pgrb2", get: Callable = pv.http_get, max_bytes: Optional[int] = None,
             progress: Optional[Callable[[dict], None]] = None) -> dict:
    """Fill `cache_dir` for every pair, `workers` at a time (capped at MAX_WORKERS). One Cache per worker thread (the
    cache's pause clock is per instance); all write disjoint keys under the same root. Failures are counted."""
    workers = max(1, min(int(workers), MAX_WORKERS))
    local = threading.local()
    lock = threading.Lock()
    state = {"bytes": 0}

    def cache():
        if not hasattr(local, "c"):
            local.c = pv.Cache(cache_dir, get=get, pause_s=0.0)
        return local.c

    def job(pair):
        c, fh = pair
        try:
            row = prefetch_one(cache(), c, fh, wind_source)
        except Exception as e:                                          # noqa: BLE001 - counted, never silent
            row = {"cycle": f"{c:%Y-%m-%dT%HZ}", "fh": fh, "error": f"{type(e).__name__}: {e}"[:200]}
        with lock:
            state["bytes"] += row.get("bytes", 0)
            if max_bytes is not None and state["bytes"] > max_bytes:
                row["error"] = row.get("error") or "byte budget reached"
        if progress:
            progress(row)
        return row

    with ThreadPoolExecutor(workers) as ex:
        rows = list(ex.map(job, pairs))
    ok = [r for r in rows if "error" not in r]
    fps = {}
    for r in ok:
        fps.setdefault(r["fingerprint"]["id"], r["fingerprint"])
    return {"pairs": len(pairs), "ok": len(ok), "failed": [r for r in rows if "error" in r],
            "downloaded_bytes": state["bytes"], "fingerprints": fps, "rows": rows}


# ---- parity proof against an existing harness cache --------------------------------------------------------------
def _sidecars(root: str, pairs: List[Tuple[datetime, int]]) -> Dict[str, str]:
    out = {}
    for c, fh in pairs:
        d = os.path.join(root, *cache_base(c, fh).split("/"))
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if fn.endswith(".prov.json"):
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    out[f"{cache_base(c, fh)}/{fn[:-len('.prov.json')]}"] = json.load(f)["sha256"]
    return out


def parity_check(new_root: str, ref_root: str, pairs: List[Tuple[datetime, int]]) -> dict:
    """Byte identity: every cache key the reference (sequential harness) cache holds for these pairs must exist in the
    new cache with the same sha256. The idx sidecars are compared too (same key = same range was selected)."""
    ref, new = _sidecars(ref_root, pairs), _sidecars(new_root, pairs)
    common = sorted(set(ref) & set(new))
    diff = [k for k in common if ref[k] != new[k]]
    return {"reference_files": len(ref), "new_files": len(new), "compared": len(common),
            "identical": len(common) - len(diff), "different": diff,
            "missing_in_new": sorted(set(ref) - set(new)), "byte_identical": bool(common) and not diff
            and not (set(ref) - set(new))}
