"""Model-run identity for the CMEMS global wave product (F-05 part 2, audit 15.0, 2026-09-26).

THE GAP. Every other marine upstream stamps `__model_run_time` on its points (NOAA, DWD, and ECMWF
since #89), so `cycle_provenance.cycle_from_points` can say which run a product came from. The CMEMS
lane could not: `copernicusmarine.subset` reads the ARCO zarr, a rolling best-estimate series with
no forecast-reference-time attribute (checked 2026-09-26: the STAC record carries only
`admp_updated_data` and `end_datetime`). The manifest held 90 EURO swell products per layer with the
run missing.

WHERE THE RUN IS DECLARED. The producer names every native file after its bulletin:
`mfwamglocep_<data start YYYYMMDDHH>_R<bulletin YYYYMMDD>_<HH>H.nc`. Listed 2026-09-26, every file
from 2026-09-24 12Z to 2026-10-04 12Z read `R20260925_12H`, and older data dates carried older
bulletins. The native store is public and the catalogue names it (`original-files` service).

WHY THE HORIZON CHECK. The files are the producer's declaration, but the numbers come from ARCO, a
separate store that is rebuilt after the files land (20:24Z files, 21:09Z ARCO on 2026-09-25). A
listing alone would stamp the NEW run while ARCO still serves the old one. Each bulletin extends the
horizon by one file step (12 h), so this stamps a run only when the LAST valid time actually fetched
equals that run's horizon (its newest file start + the file step, which is 2026-10-05T00Z and ARCO's
`end_datetime` on 2026-09-26). No receipt time, schedule or clock is used, as `cycle_from_points`
requires. Any doubt (mixed bulletins in the window, a horizon mismatch, a failed listing) returns
None and the products stay 'missing', never a guessed run. Kill: CMEMS_RUN_IDENTITY=0.
"""
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

_NATIVE_NAME = re.compile(r"_(\d{10})_R(\d{8})_(\d{2})H\.nc$")
_S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"

# Per-process memo. The in-process lane (`copernicus_marine_service._fetch_sync`) runs once per island
# region and once per ~5 deg spot box (107 boxes in a precompute run), and each would otherwise pay
# a catalogue read plus a listing. A stale memo cannot mis-stamp: a listing that misses a newer
# bulletin still has to match the horizon ARCO actually served, which moves 12 h per bulletin.
URI_TTL_S = 3600.0
LISTING_TTL_S = 300.0
_memo = {}


def _memoized(key, ttl, compute):
    hit = _memo.get(key)
    if hit is not None and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = compute()
    _memo[key] = (time.monotonic(), value)
    return value


def parse_native_key(key):
    """'..._2026100412_R20260925_12H.nc' -> (data start, bulletin), both UTC; None if not a native file."""
    m = _NATIVE_NAME.search(key or "")
    if not m:
        return None
    start = datetime.strptime(m.group(1), "%Y%m%d%H").replace(tzinfo=timezone.utc)
    run = datetime.strptime(m.group(2) + m.group(3), "%Y%m%d%H").replace(tzinfo=timezone.utc)
    return start, run


def run_from_native_keys(keys, first_valid, last_valid):
    """PURE: (bulletin datetime | None, reason) for the fetched window [first_valid, last_valid].

    A file starting at s holds (s, s + step]; the step is read from the listing, not assumed."""
    files = sorted({p for p in map(parse_native_key, keys) if p})
    starts = sorted({s for s, _ in files})
    if len(starts) < 2:
        return None, "too_few_native_files"
    step = min(b - a for a, b in zip(starts, starts[1:]))
    covering = [(s, r) for s, r in files if s < last_valid and s + step >= first_valid]
    if not covering:
        return None, "no_native_file_covers_window"
    runs = {r for _, r in covering}
    if len(runs) != 1:
        return None, f"mixed_bulletins:{len(runs)}"
    run = runs.pop()
    horizon = max(s for s, r in files if r == run) + step
    if horizon != last_valid:
        return None, f"horizon_mismatch:served={last_valid.isoformat()},bulletin={horizon.isoformat()}"
    return run, "ok"


def _months(first, last):
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def native_files_uri(dataset_id, describe=None):
    """The catalogue's `original-files` URI for the dataset's current (unretired, newest) version."""
    if describe is None:
        import copernicusmarine
        describe = copernicusmarine.describe
    cat = describe(dataset_id=dataset_id, disable_progress_bar=True)
    cat = cat.model_dump() if hasattr(cat, "model_dump") else cat
    versions = [v for p in cat["products"] for d in p["datasets"] if d["dataset_id"] == dataset_id
                for v in d["versions"] if all(pt.get("retired_date") is None for pt in v["parts"])]
    for v in sorted(versions, key=lambda v: v["label"], reverse=True):
        for part in v["parts"]:
            for svc in part["services"]:
                if str(svc.get("service_name")) == "original-files" and svc.get("uri"):
                    return svc["uri"].rstrip("/")
    return None


def list_native_keys(uri, first_valid, last_valid, session, step_pad=timedelta(days=1)):
    """S3 ListObjectsV2 over the month folders the window touches (one day of padding before it)."""
    parts = urlsplit(uri)
    bucket, _, prefix = parts.path.lstrip("/").partition("/")
    base = f"{parts.scheme}://{parts.netloc}/{bucket}"
    keys = []
    for y, m in _months(first_valid - step_pad, last_valid):
        token = None
        while True:
            params = {"list-type": "2", "prefix": f"{prefix}/{y:04d}/{m:02d}/", "max-keys": "1000"}
            if token:
                params["continuation-token"] = token
            resp = session.get(base, params=params, timeout=30)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            keys += [k.text for k in root.iter(f"{_S3_NS}Key")]
            token = root.findtext(f"{_S3_NS}NextContinuationToken")
            if root.findtext(f"{_S3_NS}IsTruncated") != "true" or not token:
                break
    return keys


def resolve_run(dataset_id, times, describe=None, session=None):
    """NEVER RAISES: (ISO bulletin | None, reason) for a fetched ISO time axis."""
    if os.environ.get("CMEMS_RUN_IDENTITY", "1") == "0":
        return None, "disabled"
    try:
        if not times:
            return None, "no_times"
        first, last = (datetime.fromisoformat(t.replace("Z", "+00:00")) for t in (times[0], times[-1]))
        uri = _memoized(("uri", dataset_id), URI_TTL_S, lambda: native_files_uri(dataset_id, describe))
        if not uri:
            return None, "no_original_files_service"
        if session is None:
            import requests
            session = requests.Session()
        months = tuple(_months(first - timedelta(days=1), last))
        keys = _memoized(("keys", uri, months), LISTING_TTL_S, lambda: list_native_keys(uri, first, last, session))
        run, reason = run_from_native_keys(keys, first, last)
        return (run.isoformat() if run else None), reason
    except Exception as e:  # identity is metadata; losing it must never cost the fetch
        return None, f"error:{type(e).__name__}"


def stamp_run(points, times, dataset_id, **kw):
    """Stamp every point with the proven bulletin, or none of them. Returns (iso | None, reason)."""
    iso, reason = resolve_run(dataset_id, times, **kw)
    if iso:
        for p in points:
            p["__model_run_time"] = iso
    return iso, reason


def latest_native_bulletin(dataset_id, now=None, describe=None, session=None):
    """NEVER RAISES: the newest bulletin the native store holds (a datetime), or None.

    A cheap listing, no data. It lets a lane ask "has CMEMS published anything new?" before
    spending ~20 minutes of subsets on data it already has (roadmap stage 1). It is NOT proof that
    ARCO serves this bulletin yet; entries cached under it were each proven by `stamp_run` when
    they were fetched."""
    now = now or datetime.now(timezone.utc)
    try:
        uri = _memoized(("uri", dataset_id), URI_TTL_S, lambda: native_files_uri(dataset_id, describe))
        if not uri:
            return None
        if session is None:
            import requests
            session = requests.Session()
        first, last = now - timedelta(days=2), now + timedelta(days=11)
        months = tuple(_months(first - timedelta(days=1), last))
        keys = _memoized(("keys", uri, months), LISTING_TTL_S, lambda: list_native_keys(uri, first, last, session))
        runs = [p[1] for p in map(parse_native_key, keys) if p]
        return max(runs) if runs else None
    except Exception:
        return None
