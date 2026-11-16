"""NOAA GFS-Wave station bulletins: an INDEPENDENT same-model reference lane for the skill ledger (D-072 v2).

WHY (research lead, 2026-11-16, brief section 4): rule 1 of the accuracy monitor's red split compares our GFS-Wave
heights against the same model fetched by someone else. Until now that "someone else" was Open-Meteo
(`open_meteo:ncep_gfswave025`), which David allows for testing but never for anything served. NOAA publishes the
model's own point output for every NDBC station, per cycle, as a plain-text bulletin on the public AWS bucket:

    https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/wave/station/bulls.tHHz/gfswave.<STATION>.bull

That is the model at the buoy, with no interpolation of ours and no third party in between, so it is the cleanest
same-model reference there is.

FORMAT (read from 41117, cycle 2026-11-15 00Z, committed as `tests/fixtures/noaa_bull/`):
    Location : 41117      (30.00N  81.08W)
    Cycle    : 20261115  0 UTC
    | day & |  Hst  n x |    Hs   Tp  dir | ... up to 6 partitions ... |
    | 15  0 | 0.78  1   | * 0.76  4.8 193 |                 | ...
- Hst is the total significant height (m).
- n is the number of partitions in the table; x is the number of fields with Hs > 0.15 m NOT in the table.
- Each partition is Hs (m), Tp (s), dir (deg).
- `*` means "wave generation due to local wind probable": a WIND-SEA partition, not a data-quality flag. It is kept
  as `wind_sea`.
- Rows are hourly to +384 h. The row's day-of-month rolls over at month and year ends, so the valid time is rebuilt
  from the cycle, never from the day alone.

⛔ INDEPENDENCE IS THE POINT. This module must never import our sampler, resolver or any grid/frame code: a
reference lane fed by our own chain would agree with us by construction. `tests/test_skill_noaa_bulletin.py` pins
the import set.

Runs only inside the skill ledger (GitHub Actions lanes), never on the serve box. Kill: FORECAST_SKILL_NOAA_BULL=0.
"""
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

SOURCE_NOAA_BULL = "noaa:gfswave_station"
BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
CYCLE_HOURS = (0, 6, 12, 18)
# GFS-Wave station bulletins land on the bucket roughly 4-5 h after the cycle hour. Asking for a cycle younger than
# this only produces 404s, so the newest cycle tried is the one at least this old; one older cycle is the fallback.
PUBLISH_LAG_H = 5

_LOCATION = re.compile(r"^\s*Location\s*:\s*(\S+)")
_CYCLE = re.compile(r"^\s*Cycle\s*:\s*(\d{8})\s+(\d{1,2})\s*UTC")
_ROW = re.compile(r"^\s*\|\s*(\d{1,2})\s+(\d{1,2})\s*\|(.*)$")
_HST = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(\d+)(?:\s+(\d+))?\s*$")
_PART = re.compile(r"^\s*(\*)?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+)\s*$")


def bulletin_url(cycle: datetime, station: str) -> str:
    hh = f"{cycle.hour:02d}"
    return f"{BUCKET}/gfs.{cycle:%Y%m%d}/{hh}/wave/station/bulls.t{hh}z/gfswave.{station}.bull"


def _valid_time(cycle: datetime, day: int, hour: int) -> Optional[datetime]:
    """The row's valid time: the first time at or after the cycle whose day-of-month and hour match. Rows run
    forward from the cycle, so walking forward day by day handles month and year rollover (30 -> 1, 31 -> 1)."""
    t = cycle.replace(minute=0, second=0, microsecond=0)
    for _ in range(40):                       # a bulletin spans 16 days; 40 bounds the walk
        cand = t.replace(hour=hour)
        if cand.day == day and cand >= cycle:
            return cand
        t = (t + timedelta(days=1)).replace(hour=0)
    return None


def parse_bulletin(text: str) -> Optional[dict]:
    """{station, cycle, rows: [{valid, lead_h, hst, n, x, parts: [{hs, tp, dir, wind_sea}]}]}, or None when the text
    has no Cycle line (not a bulletin: an S3 error page, an empty body)."""
    station, cycle, rows = None, None, []
    for line in (text or "").splitlines():
        if station is None:
            m = _LOCATION.match(line)
            if m:
                station = m.group(1)
                continue
        if cycle is None:
            m = _CYCLE.match(line)
            if m:
                cycle = datetime.strptime(m.group(1), "%Y%m%d").replace(hour=int(m.group(2)), tzinfo=timezone.utc)
                continue
        m = _ROW.match(line)
        if not m or cycle is None:
            continue
        cells = m.group(3).split("|")
        hm = _HST.match(cells[0]) if cells else None
        if hm is None:
            continue
        valid = _valid_time(cycle, int(m.group(1)), int(m.group(2)))
        if valid is None:
            continue
        parts = []
        for cell in cells[1:7]:
            pm = _PART.match(cell)
            if pm:
                parts.append({"hs": float(pm.group(2)), "tp": float(pm.group(3)), "dir": int(pm.group(4)),
                              "wind_sea": pm.group(1) == "*"})
        rows.append({"valid": valid, "lead_h": round((valid - cycle).total_seconds() / 3600.0, 1),
                     "hst": float(hm.group(1)), "n": int(hm.group(2)),
                     "x": int(hm.group(3)) if hm.group(3) else 0, "parts": parts})
    if cycle is None:
        return None
    return {"station": station, "cycle": cycle, "rows": rows}


def candidate_cycles(now: datetime) -> List[datetime]:
    """The newest cycle old enough to be published, then the one before it."""
    t = (now - timedelta(hours=PUBLISH_LAG_H)).astimezone(timezone.utc)
    newest = t.replace(hour=max(h for h in CYCLE_HOURS if h <= t.hour), minute=0, second=0, microsecond=0)
    return [newest, newest - timedelta(hours=6)]


def _http_get(url: str, timeout: int = 20) -> Optional[str]:
    """The body, or None on 404/403 (a station the cycle does not carry). Other errors raise."""
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-skill"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


def fetch_bulletin_rows(stations: Iterable[str], now: datetime, leads_h=(24, 48, 72),
                        get: Optional[Callable[[str], Optional[str]]] = None,
                        stats: Optional[dict] = None) -> List[dict]:
    """One ledger row per (station, lead): the bulletin's Hst at target = now + lead, from the newest published cycle.

    Rows carry the same keys the other lanes do (source, buoy_id, target_time, lead_h, hs_m, tp_s), so they pair
    with `raw_surf` on (buoy, target, lead bucket). `lead_h` is the NOMINAL lead, as every other lane records it;
    the honest age is `cycle_lead_h` (target - cycle). A missing station is logged and yields no row; one station
    failing never costs another its row."""
    get = get or _http_get                     # resolved at call time, so a test can refuse the live fetch
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cycles = candidate_cycles(now)
    out: List[dict] = []
    st = {"stations": 0, "with_bulletin": 0, "missing": 0, "errors": 0, "fallback_cycle": 0}
    for station in stations:
        st["stations"] += 1
        parsed, url = None, None
        for i, cyc in enumerate(cycles):
            url = bulletin_url(cyc, station)
            try:
                body = get(url)
            except Exception as e:                 # network trouble on one station: log, move on
                st["errors"] += 1
                logger.warning("[forecast-skill] NOAA bulletin %s failed (%s)", station, e)
                body = None
                break
            parsed = parse_bulletin(body) if body else None
            if parsed is not None:
                st["fallback_cycle"] += i > 0
                st["with_bulletin"] += 1
                break
        if parsed is None:
            st["missing"] += 1
            logger.info("[forecast-skill] NOAA bulletin missing for %s (cycles %s)", station,
                        ", ".join(f"{c:%Y%m%d%H}" for c in cycles))
            continue
        by_valid = {r["valid"]: r for r in parsed["rows"]}
        for lead in leads_h:
            target = (now + timedelta(hours=lead)).replace(minute=0, second=0, microsecond=0)
            r = by_valid.get(target)
            # 0.0 is dropped for parity with every other lane (`rows_from_calibration_report`, the Open-Meteo lanes):
            # a lane that kept zeros would be scored on rows its peers refuse.
            if r is None or r["hst"] == 0.0:
                continue
            # tp_s is the period of the LARGEST partition: a proxy for the peak period, not the spectral Tp. Anything
            # that ever scores period from this lane must say so (advisor, 2026-11-16).
            peak = max(r["parts"], key=lambda p: p["hs"]) if r["parts"] else None
            out.append({"source": SOURCE_NOAA_BULL, "buoy_id": station,
                        "target_time": target.strftime("%Y-%m-%dT%H:00:00Z"), "lead_h": float(lead),
                        "hs_m": r["hst"], "tp_s": peak["tp"] if peak else None,
                        "cycle": parsed["cycle"].strftime("%Y-%m-%dT%H:00Z"), "cycle_lead_h": r["lead_h"],
                        # the same key and meaning as our rows' (skill_attribution.serving_provenance): ledger time minus
                        # the cycle that answered, so rule 1's delta can be split by cycle offset before this lane is a
                        # reference (advisor, 2026-11-16)
                        "cycle_age_h": round((target - timedelta(hours=float(lead)) - parsed["cycle"]).total_seconds() / 3600.0, 1),
                        "tp_kind": "largest_partition",
                        "parts": [[p["hs"], p["tp"], p["dir"], int(p["wind_sea"])] for p in r["parts"]],
                        "source_url": url, "fetched_at": fetched_at})
    if stats is not None:
        stats.update(st)
    return out


def ledger_rows(report, now: datetime, leads_h) -> List[dict]:
    """The wired entry point (`forecast_skill.run_skill_ledger`): bulletin rows for the report's buoys. It keys on buoy
    ids alone, so it needs no coordinates and survives a coordinate failure in the Open-Meteo lanes. Its own kill
    switch, and every failure is swallowed: this lane can never cost the ledger another lane."""
    if os.environ.get("FORECAST_SKILL_NOAA_BULL", "1") == "0":
        return []
    try:
        stations: List[str] = []
        for entry in (report or {}).get("spots") or []:
            bid = entry.get("buoy_id")
            if bid and bid not in stations:
                stations.append(bid)
        stats: dict = {}
        rows = fetch_bulletin_rows(stations, now, leads_h, stats=stats)
        logger.info("[forecast-skill] NOAA bulletins rows=%d %s", len(rows), stats)
        return rows
    except Exception as e:
        logger.warning("[forecast-skill] NOAA bulletin lane failed (%s)", e)
        return []
