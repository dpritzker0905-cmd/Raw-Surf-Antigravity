"""wind_lr2_truth.py - truth readers, snapshots and station-to-spot pairing for the long-range wind v2 registration.

FIT truth (registration section 4): NDBC historical stdmet (annual files for completed years, monthly files for 2026;
NOT realtime2) + Iowa Environmental Mesonet ASOS. TEST truth: weekly NDBC realtime2 snapshots kept as artifacts,
replaced by monthly stdmet when NDBC publishes them (the source of every row is recorded), + IEM ASOS.
Serves nothing; the parsing is `wind_lr_obs`'s, imported, not copied.
"""
import glob
import math
import os
import sys
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import wind_lr_obs as obs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import buoy_holdout  # noqa: E402

Rec = Tuple[float, float, float]            # (wspd, gust, wdir) at station height
Truth = Dict[datetime, Rec]


def months_between(start: datetime, end: datetime) -> List[Tuple[int, int]]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def fit_truth(s, cache: str, sid: str, start: datetime, end: datetime,
              year_reader: Callable = obs.ndbc_year, month_reader: Optional[Callable] = None) -> Tuple[Truth, Dict[str, int]]:
    """NDBC FIT truth for [start, end]: annual stdmet for each completed calendar year touched, the monthly stdmet files
    for months of the current/unfinished year. Returns (records, {source: n}). realtime2 is never read here."""
    if buoy_holdout.is_locked(sid):                         # a LOCKED buoy: no truth is read (the locked-holdout fence)
        return {}, {"annual": 0, "monthly": 0}
    month_reader = month_reader or (lambda s_, c_, sid_, y_, m_: obs.ndbc_window(s_, c_, sid_, months=((y_, m_),)))
    now_year = datetime.now(timezone.utc).year
    out: Truth = {}
    src: Dict[str, int] = {"annual": 0, "monthly": 0}
    for y in sorted({m[0] for m in months_between(start, end)}):
        if y < now_year:
            rec = year_reader(s, cache, sid, y)
            src["annual"] += len(rec)
            out.update(rec)
    for y, m in months_between(start, end):
        if y >= now_year:
            rec = month_reader(s, cache, sid, y, m)
            src["monthly"] += len(rec)
            for t, r in rec.items():
                out.setdefault(t, r)
    return {t: r for t, r in out.items() if start <= t <= end}, src


def snapshot_name(stamp: datetime) -> str:
    return f"{stamp:%Y%m%dT%H%M}Z"


def save_snapshot(s, snap_dir: str, ids: Sequence[str], stamp: datetime) -> int:
    """Weekly realtime2 snapshot of every station, kept verbatim so the scorer reads what was seen."""
    d = os.path.join(snap_dir, snapshot_name(stamp))
    os.makedirs(d, exist_ok=True)
    n = 0
    for sid in ids:
        r = obs._get(s, f"{obs.NDBC}/data/realtime2/{sid.upper()}.txt", tries=3)
        if r.status_code == 200 and r.text.strip():
            open(os.path.join(d, f"{sid.upper()}.txt"), "w", encoding="utf-8").write(r.text)
            n += 1
    return n


def load_snapshots(snap_dir: str, sid: str) -> Truth:
    """Merge every snapshot for one station. Snapshots overlap by design (45-day window, weekly); the same record is
    read the same way in each, and the EARLIEST snapshot that holds a record wins (what was seen first)."""
    out: Truth = {}
    if buoy_holdout.is_locked(sid):                         # archived by save_snapshot, never read before the window
        return out
    for p in sorted(glob.glob(os.path.join(snap_dir, "*", f"{sid.upper()}.txt"))):
        for t, r in obs.parse_ndbc_stdmet(open(p, encoding="utf-8").read()).items():
            out.setdefault(t, r)
    return out


def truth_for_test(snap_dir: str, sid: str, monthly: Optional[Truth] = None) -> Tuple[Truth, Dict[str, int]]:
    """TEST truth: snapshots, with any published monthly stdmet record replacing the snapshot's. Source counts returned."""
    snap = load_snapshots(snap_dir, sid)
    out = dict(snap)
    n_month = 0
    for t, r in (monthly or {}).items():
        out[t] = r
        n_month += 1
    return out, {"snapshot": len([t for t in snap if t not in (monthly or {})]), "monthly": n_month}


# ---------------------------------------------------------------------------------------------- pairing
def pair_station_to_spot(station: dict, spots: Sequence[dict], crosses_land: Callable[[float, float, float, float], bool],
                         max_km: float = 25.0) -> Optional[dict]:
    """Nearest catalogue spot within `max_km` great-circle whose straight segment from the station does not cross land.
    Ties by lowest spot id. No manual judgement (registration section 4). `crosses_land(la1, lo1, la2, lo2)` is the
    ETOPO 15 s mask test supplied by the caller."""
    best = None
    for sp in spots:
        d = float(obs.haversine_km(station["lat"], station["lon"], sp["lat"], sp["lon"]))
        if d > max_km:
            continue
        if crosses_land(station["lat"], station["lon"], sp["lat"], sp["lon"]):
            continue
        key = (round(d, 6), sp["id"])
        if best is None or key < best[0]:
            best = (key, sp)
    return best[1] if best else None


def pairing_table(stations: Sequence[dict], spots: Sequence[dict], crosses_land: Callable) -> Dict[str, Optional[str]]:
    """{station id: paired spot id or None}; hashed at freeze."""
    out = {}
    for st in stations:
        sp = pair_station_to_spot(st, spots, crosses_land)
        out[str(st["id"])] = str(sp["id"]) if sp else None
    return out


def station_ok(truth: Truth, start: datetime, end: datetime, need_gust: bool = False) -> bool:
    """>= 70% hourly records over the window (reported at SCORE time; never used to pick stations by skill)."""
    return obs.hourly_coverage(truth, start, end, need_gust) >= 0.70
