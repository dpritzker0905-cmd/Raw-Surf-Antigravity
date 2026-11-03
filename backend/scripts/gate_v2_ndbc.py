#!/usr/bin/env python3
"""gate_v2_ndbc.py - the ONLY network code of validation gates v2: two kinds of public NDBC GET, nothing else.

  * https://www.ndbc.noaa.gov/metadata/stationmetadata.xml  - hull code per station deployment (one ~1 MB file)
  * https://www.ndbc.noaa.gov/data/realtime2/<ID>.data_spec - the last ~45 days of spectral density per station

Called by scripts/scored_rows_gate.py INSIDE its `read_only_http` guard, which then admits exactly the Supabase project
and NDBC_HOST, GET only, no body. No key, no write, no other host. A failure is never fatal: the hull falls back to
"unknown" and a buoy without a spectrum simply has no fit-Tp truth, and the report counts both (counts only: no
station id is printed, because the repo and its Actions logs are public).

BUDGET. One request at a time, `timeout_s` each, and the whole spectral pass stops at `budget_s`; the buoys left over
are counted as "not fetched (budget)". NDBC is a public service and the gate job has a 15-minute limit.

RETENTION NOTE. realtime2 holds ~45 days, so spectra for the GFS_SCALAR rows (targets from 2026-10-03) roll off from
about 2026-11-17. Later reads of older rows need NDBC's monthly archive (data/swden/<Mon>/), which this does not fetch.
"""
import re
import time
import urllib.request

NDBC_HOST = "www.ndbc.noaa.gov"
META_URL = "https://www.ndbc.noaa.gov/metadata/stationmetadata.xml"
SPEC_URL = "https://www.ndbc.noaa.gov/data/realtime2/{station}.data_spec"
MAX_META_BYTES = 8 * 1024 * 1024
MAX_SPEC_BYTES = 6 * 1024 * 1024
_STATION_ID = re.compile(r"^[0-9A-Z]{5}$")
USER_AGENT = "raw-surf-gate-v2 (read-only verification; github.com/dpritzker0905-cmd/Raw-Surf-Antigravity)"


def _get(url: str, timeout_s: float, max_bytes: int) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:     # noqa: S310 - fixed https NDBC URLs only
        body = resp.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ValueError("response larger than the cap")
    return body.decode("utf-8", errors="replace")


def valid_station(sid) -> bool:
    return bool(_STATION_ID.match(str(sid or "").strip().upper()))


def fetch_truth(buoys, parse_meta, parse_spec, get=None, timeout_s: float = 30.0, budget_s: float = 420.0,
                clock=time.monotonic) -> dict:
    """{"meta": parsed metadata or None, "spectra": {id: records}, "counts": {...}}. `parse_*` are the pure parsers
    (gate_v2_truth) so this module holds no parsing; `get(url, timeout_s, max_bytes)` is injectable for tests."""
    get = get or _get
    counts = {"meta": "missing", "spec_ok": 0, "spec_failed": 0, "spec_empty": 0, "not_fetched_budget": 0,
              "invalid_id": 0}
    meta = None
    try:
        meta = parse_meta(get(META_URL, timeout_s, MAX_META_BYTES))
        counts["meta"] = "ok"
    except Exception as e:                                          # noqa: BLE001 - recorded, never fatal
        counts["meta"] = f"failed ({type(e).__name__})"
    spectra = {}
    start = clock()
    for sid in sorted({str(b).strip().upper() for b in buoys if b is not None}):
        if not valid_station(sid):
            counts["invalid_id"] += 1
            continue
        if clock() - start > budget_s:
            counts["not_fetched_budget"] += 1
            continue
        try:
            recs = parse_spec(get(SPEC_URL.format(station=sid), timeout_s, MAX_SPEC_BYTES))
        except Exception:                                           # noqa: BLE001 - a 404 is a buoy without spectra
            counts["spec_failed"] += 1
            continue
        if recs:
            spectra[sid] = recs
            counts["spec_ok"] += 1
        else:
            counts["spec_empty"] += 1
    return {"meta": meta, "spectra": spectra, "counts": counts}
