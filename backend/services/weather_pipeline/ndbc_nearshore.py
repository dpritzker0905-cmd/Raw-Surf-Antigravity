"""ndbc_nearshore.py — NOAA NDBC buoys as nearshore-judge instruments where CDIP has none (2026-09-28).

WHY: the nearshore judge graded only CDIP stations, and the one Gulf of Mexico station in its pair table (129p1,
Okaloosa) answers 404, so the Gulf was ungraded. That mattered the day cross-shelf friction went off by default
(#146): the evidence came from the Atlantic's wide shelves (Duck to Fort Pierce), while the widest shelf we serve,
Galveston's 166 km, had no instrument at all. NDBC 42035 sits on that shelf in 15.5 m of water (29.235 N,
94.410 W; NDBC station page), and its realtime feed carries WVHT (significant height) roughly every 30 min.

PAIRING: the nearest catalogue spot (Galveston Seawall) is 37 km from the buoy, far outside the CDIP table's
10 km rule, so the NDBC table pairs each buoy with its OWN cell: the served field is sampled at the buoy and
graded with the buoy's geometry. That is the Kr study's deep-buoy method, and it asks exactly the #146
question — served field plus chain versus an instrument on a very wide shelf — without a 37 km mismatch.

Stations are hand-listed in data/nearshore_ndbc_pairs.json (NDBC identities do not come from the CDIP catalogue
build_nearshore_pairs.py reads) and addressed as `ndbc:<id>` so nothing can mistake one for a CDIP deployment.
PURE parsing + one fetch; a missing value (MM) is skipped, never zero.
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

NDBC_RT = "https://www.ndbc.noaa.gov/data/realtime2"
NDBC_PREFIX = "ndbc:"
NDBC_PAIRS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                               "data", "nearshore_ndbc_pairs.json")
UA = {"User-Agent": "raw-surf-nearshore-validation"}


def is_ndbc(station: str) -> bool:
    return str(station).startswith(NDBC_PREFIX)


def parse_ndbc_wvht(text: str, hours: float, now: datetime) -> list:
    """Rows [{time, hs_m, flag}] from an NDBC realtime2 standard-meteorological file, newest window only.
    The header names the columns; WVHT 'MM' (missing) rows are skipped. NDBC publishes no per-row QC flag,
    so a numeric WVHT is flag 1 (the judge's 'good' value)."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if not lines or not lines[0].startswith("#"):
        return []
    cols = lines[0].lstrip("#").split()
    try:
        idx = {c: cols.index(c) for c in ("YY", "MM", "DD", "hh", "mm", "WVHT")}
    except ValueError:
        return []
    cutoff = now - timedelta(hours=hours)
    out = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        f = ln.split()
        if len(f) <= max(idx.values()) or f[idx["WVHT"]] == "MM":
            continue
        try:
            t = datetime(int(f[idx["YY"]]), int(f[idx["MM"]]), int(f[idx["DD"]]), int(f[idx["hh"]]),
                         int(f[idx["mm"]]), tzinfo=timezone.utc)
            hs = float(f[idx["WVHT"]])
        except ValueError:
            continue
        if t >= cutoff and hs >= 0:
            out.append({"time": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": hs, "flag": 1})
    return sorted(out, key=lambda r: r["time"])


def fetch_ndbc_hs(station: str, hours: float = 26.0, timeout: float = 60.0) -> list:
    """Recent Hs at an `ndbc:<id>` station. Failures raise (an HTTP 404 is a dead station, as for CDIP)."""
    sid = station[len(NDBC_PREFIX):] if is_ndbc(station) else station
    req = urllib.request.Request(f"{NDBC_RT}/{sid}.txt", headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        txt = r.read().decode("utf-8", "replace")
    return parse_ndbc_wvht(txt, hours, datetime.now(timezone.utc))


def load_ndbc_pairs(path: str = None) -> list:
    """The hand-listed NDBC pairs ([] when the table is absent: CDIP grading must never depend on it)."""
    try:
        with open(path or NDBC_PAIRS_PATH, encoding="utf-8") as f:
            pairs = json.load(f).get("pairs") or []
    except (OSError, ValueError):
        return []
    return [p for p in pairs if is_ndbc(p.get("station", ""))]
