"""wind_lr_obs.py - stations, truth and climatology for the long-range wind hindcast. Serves nothing.

Pre-registered: docs/weather-program/log/2026-11-15-wind-long-range.md (21:45Z, amendment 23:30Z). Public data only:
  * NDBC historical stdmet (`data/historical/stdmet/{id}h{YYYY}.txt.gz`): WDIR, WSPD, GST; station metadata
    (`activestations.xml`, station pages for the anemometer height). NDBC wind -> 10 m by the neutral log law, z0 2e-4.
  * ASOS through the Iowa Environmental Mesonet archive (`asos.py`): sknt, drct, gust (knots). Treated as 10 m.
  * Coastal: the GFS 0.25 deg LAND field (f000). NDBC within 50 km of a land cell; ASOS within 10 km of a sea cell.
Stations are chosen by rule only, never by skill, and frozen to JSON before any arm is scored.
"""
import gzip
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np

NDBC = "https://www.ndbc.noaa.gov"
IEM = "https://mesonet.agron.iastate.edu"
GFS_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
Z0 = 2e-4
KT = 0.514444
ASOS_CAP = 60
# Amendment 2: coverage is measured where NDBC truth exists for the TEST half (realtime2 from 10-02; Sep unpublished)
COVER = (datetime(2026, 10, 2, tzinfo=timezone.utc), datetime(2026, 11, 14, tzinfo=timezone.utc))
# Coastal US/territory ASOS networks scanned (IEM network ids). Rule-based list; no station is picked by name.
ASOS_NETWORKS = ["ME_ASOS", "NH_ASOS", "MA_ASOS", "RI_ASOS", "CT_ASOS", "NY_ASOS", "NJ_ASOS", "DE_ASOS", "MD_ASOS",
                 "VA_ASOS", "NC_ASOS", "SC_ASOS", "GA_ASOS", "FL_ASOS", "AL_ASOS", "MS_ASOS", "LA_ASOS", "TX_ASOS",
                 "CA_ASOS", "OR_ASOS", "WA_ASOS", "HI_ASOS", "AK_ASOS", "PR_ASOS"]


def _get(s, url, tries=4, timeout=120, **kw):
    last = None
    for k in range(tries):
        try:
            r = s.get(url, timeout=timeout, **kw)
            if r.status_code in (200, 206, 404):
                return r
            last = RuntimeError(f"HTTP {r.status_code} {url}")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 * (k + 1))
    raise last


def haversine_km(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = map(np.radians, (la1, lo1, la2, lo2))
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(h))


def gfs_land(s, cache: str) -> Tuple[np.ndarray, dict]:
    """GFS 0.25 deg LAND (1 = land), rows south to north, lon 0..359.75 (eval_grib2 convention)."""
    from services.weather_pipeline import eval_grib2 as g2
    path = os.path.join(cache, "gfs_land.npy")
    if os.path.exists(path) and os.path.exists(path + ".json"):
        return np.load(path), json.load(open(path + ".json"))
    url = f"{GFS_BASE}/gfs.20251015/00/atmos/gfs.t00z.pgrb2.0p25.f000"
    rows = [ln.split(":") for ln in _get(s, url + ".idx").text.strip().splitlines()]
    k = next(i for i, p in enumerate(rows) if p[3] == "LAND" and p[4] == "surface")
    msg = _get(s, url, headers={"Range": f"bytes={rows[k][1]}-{int(rows[k + 1][1]) - 1}"}).content
    arr, meta = g2.decode_span(msg, ["LAND"], ["LAND"])["LAND"]
    np.save(path, arr)
    json.dump(meta, open(path + ".json", "w"))
    return arr, meta


def _distance_to(mask: np.ndarray, meta: dict, lat: float, lon: float, box_deg: float = 2.0) -> float:
    lats = meta["lat_south"] + np.arange(meta["nj"]) * meta["dlat"]
    lons = meta["lon_west"] + np.arange(meta["ni"]) * meta["dlon"]
    ri = np.where(np.abs(lats - lat) <= box_deg)[0]
    dl = ((lons - lon + 180.0) % 360.0) - 180.0
    ci = np.where(np.abs(dl) <= box_deg / max(math.cos(math.radians(lat)), 0.2))[0]
    if not len(ri) or not len(ci):
        return 999.0
    sub = mask[np.ix_(ri, ci)]
    if not sub.any():
        return 999.0
    gi, gj = np.where(sub)
    return float(haversine_km(lat, lon, lats[ri][gi], lons[ci][gj]).min())


def anemometer_m(s, sid) -> Optional[float]:
    r = _get(s, f"{NDBC}/station_page.php?station={sid}", tries=2)
    m = re.search(r"Anemometer height:\s*</b>\s*([0-9.]+)\s*m", r.text if r is not None else "")
    return float(m.group(1)) if m else None


def to_10m(speed, z):
    """Neutral log law to 10 m."""
    return np.asarray(speed, dtype=float) * math.log(10.0 / Z0) / math.log(max(float(z), 0.5) / Z0)


def parse_ndbc_stdmet(text: str) -> Dict[datetime, Tuple[float, float, float]]:
    """{UTC time: (wspd, gst, wdir)} raw (station height), NaN for the 99/999 missing codes."""
    out = {}
    head = None
    for line in text.splitlines():
        if line.startswith("#"):
            if head is None:
                head = line.lstrip("#").split()
            continue
        p = line.split()
        if head is None or len(p) < len(head):
            continue
        rec = dict(zip(head, p))
        try:
            yy = int(rec.get("YY") or rec.get("YYYY"))
            t = datetime(yy, int(rec["MM"]), int(rec["DD"]), int(rec["hh"]), int(rec.get("mm", 0)), tzinfo=timezone.utc)
        except (ValueError, KeyError, TypeError):
            continue

        def f(k, bad):
            try:
                v = float(rec.get(k, "nan"))
            except ValueError:
                return float("nan")
            return float("nan") if v >= bad else v
        out[t] = (f("WSPD", 99), f("GST", 99), f("WDIR", 999))
    return out


def ndbc_year(s, cache, sid, year) -> Dict[datetime, Tuple[float, float, float]]:
    path = os.path.join(cache, "ndbc", f"{sid}h{year}.txt")
    if not os.path.exists(path):
        r = _get(s, f"{NDBC}/data/historical/stdmet/{sid.lower()}h{year}.txt.gz", tries=3)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        text = gzip.decompress(r.content).decode("utf-8", "replace") if r.status_code == 200 else ""
        open(path, "w", encoding="utf-8").write(text)
    return parse_ndbc_stdmet(open(path, encoding="utf-8").read())


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def ndbc_window(s, cache, sid, months=((2026, 9),)) -> Dict[datetime, Tuple[float, float, float]]:
    """2026 window truth (amendment 2): the NDBC monthly stdmet file of each listed month IF published, plus the
    `realtime2` snapshot (45 days). Both are cached on first read; the stations job keeps the cache as its artifact
    so a later score reads the SAME records after realtime2 rolls on."""
    out: Dict[datetime, Tuple[float, float, float]] = {}
    for y, m in months:
        path = os.path.join(cache, "ndbc", f"{sid}_{y}{m:02d}.txt")
        if not os.path.exists(path):
            r = _get(s, f"{NDBC}/data/stdmet/{MONTHS[m - 1]}/{sid.lower()}{m}{y}.txt.gz", tries=3)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            text = gzip.decompress(r.content).decode("utf-8", "replace") if r.status_code == 200 else ""
            open(path, "w", encoding="utf-8").write(text)
        out.update(parse_ndbc_stdmet(open(path, encoding="utf-8").read()))
    path = os.path.join(cache, "ndbc", f"{sid}_realtime2.txt")
    if not os.path.exists(path):
        r = _get(s, f"{NDBC}/data/realtime2/{sid.upper()}.txt", tries=3)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(r.text if r.status_code == 200 else "")
    rt = parse_ndbc_stdmet(open(path, encoding="utf-8").read())
    for t, rec in rt.items():
        out.setdefault(t, rec)          # a published monthly (QC'd) record wins over realtime
    return out


def parse_iem_csv(text: str) -> Dict[datetime, Tuple[float, float, float]]:
    """{UTC time: (sknt m/s, gust m/s or NaN, drct)} from IEM asos.py onlycomma output."""
    out = {}
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    if not lines:
        return out
    head = lines[0].split(",")
    for ln in lines[1:]:
        rec = dict(zip(head, ln.split(",")))
        try:
            t = datetime.strptime(rec["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue

        def f(k, scale=1.0):
            try:
                return float(rec.get(k, "M")) * scale
            except ValueError:
                return float("nan")
        out[t] = (f("sknt", KT), f("gust", KT), f("drct"))
    return out


def asos_range(s, cache, sid, start: datetime, end: datetime) -> Dict[datetime, Tuple[float, float, float]]:
    path = os.path.join(cache, "asos", f"{sid}_{start:%Y%m%d}_{end:%Y%m%d}.csv")
    if not os.path.exists(path):
        q = (f"{IEM}/cgi-bin/request/asos.py?station={sid}&data=sknt&data=drct&data=gust&tz=Etc/UTC"
             f"&format=onlycomma&latlon=no&missing=M&trace=T&report_type=3"
             f"&year1={start.year}&month1={start.month}&day1={start.day}"
             f"&year2={end.year}&month2={end.month}&day2={end.day}")
        r = _get(s, q, tries=4, timeout=300)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(r.text if r.status_code == 200 else "")
        time.sleep(1.0)  # IEM asks for polite serial use
    return parse_iem_csv(open(path, encoding="utf-8").read())


def hourly_coverage(obs: Dict[datetime, tuple], start: datetime, end: datetime, need_gust: bool) -> float:
    hours = set()
    for t, (w, g, _d) in obs.items():
        if start <= t <= end and w == w and (not need_gust or g == g):
            hours.add(t.replace(minute=0, second=0))
    return len(hours) / max(1.0, (end - start).total_seconds() / 3600.0)


# ---------------------------------------------------------------------------------------------- matching
def wind_at(obs: Dict[datetime, tuple], valid: datetime, tol_min: int = 30) -> Optional[Tuple[float, float]]:
    """(speed, dir) of the record nearest `valid` within tol."""
    best, bd = None, None
    for dt in range(-tol_min, tol_min + 1):
        t = valid + timedelta(minutes=dt)
        rec = obs.get(t)
        if rec and rec[0] == rec[0] and (bd is None or abs(dt) < bd):
            best, bd = rec, abs(dt)
    return (best[0], best[2]) if best else None


def gust_window(obs: Dict[datetime, tuple], valid: datetime, hours: int = 6, gust_absent_is_wind: bool = False):
    """Max gust over (valid - hours, valid]. For ASOS (gust_absent_is_wind) a record with no gust group counts its
    sustained speed (a METAR carries a gust only while it is gusting). None when the window has < 50% records."""
    vals, n = [], 0
    t = valid - timedelta(hours=hours) + timedelta(minutes=1)
    while t <= valid:
        rec = obs.get(t)
        if rec:
            w, g, _ = rec
            if g == g:
                vals.append(g)
                n += 1
            elif gust_absent_is_wind and w == w:
                vals.append(w)
                n += 1
        t += timedelta(minutes=1)
    expected = hours  # >= one record per hour
    return max(vals) if vals and n >= 0.5 * expected else None


class SeasonalClim:
    """Seasonal climatology (amendment 2): for a valid time V, the mean of the station's records within +-HALF days
    of V's day of year at V's UTC hour, over earlier years. `.get(V)` -> (mean speed, mean u, mean v) or None
    (< MIN_N records)."""
    HALF, MIN_N = 15, 20

    def __init__(self, acc):
        self.acc = acc       # {(doy, hour): [sum speed, sum u, sum v, n]}

    def get(self, V: datetime):
        doy, h = V.timetuple().tm_yday, V.hour
        tot = [0.0, 0.0, 0.0, 0]
        for d in range(doy - self.HALF, doy + self.HALF + 1):
            a = self.acc.get((((d - 1) % 366) + 1, h))
            if a:
                for k in range(4):
                    tot[k] += a[k]
        return (tot[0] / tot[3], tot[1] / tot[3], tot[2] / tot[3]) if tot[3] >= self.MIN_N else None


def climatology(obs_years: List[Dict[datetime, tuple]], z_fix=lambda x: x) -> "SeasonalClim":
    """Seasonal (day-of-year +-15 d, UTC hour) climatology from earlier years' records (no window data)."""
    acc: Dict[Tuple[int, int], List[float]] = {}
    for obs in obs_years:
        for t, (w, _g, d) in obs.items():
            if w != w or d != d or t.minute > 10 and t.minute < 50:
                continue
            tt = t + timedelta(minutes=30)          # :50-:59 records belong to the next hour
            key = (tt.timetuple().tm_yday, tt.hour)
            sp = float(z_fix(w))
            u, v = -sp * math.sin(math.radians(d)), -sp * math.cos(math.radians(d))
            a = acc.setdefault(key, [0.0, 0.0, 0.0, 0])
            a[0] += sp
            a[1] += u
            a[2] += v
            a[3] += 1
    return SeasonalClim(acc)


# ---------------------------------------------------------------------------------------------- station selection
def ndbc_candidates(s) -> List[dict]:
    text = _get(s, f"{NDBC}/activestations.xml").text
    out = []
    for tag in re.findall(r"<station\s[^>]*>", text):
        a = dict(re.findall(r'(\w+)="([^"]*)"', tag))
        if a.get("met") != "y" or a.get("type") not in ("buoy", "fixed"):
            continue
        out.append({"id": a["id"].upper(), "lat": float(a["lat"]), "lon": float(a["lon"]), "type": a.get("type"),
                    "name": a.get("name", "")})
    return out


def asos_candidates(s) -> List[dict]:
    out = []
    for net in ASOS_NETWORKS:
        r = _get(s, f"{IEM}/geojson/network/{net}.geojson", tries=3)
        if r.status_code != 200:
            continue
        for f in r.json().get("features", []):
            p, g = f.get("properties", {}), f.get("geometry", {}).get("coordinates", [None, None])
            if p.get("archive_end") not in (None, "", "None"):
                continue  # closed stations
            out.append({"id": p.get("sid") or f.get("id"), "lat": float(g[1]), "lon": float(g[0]), "network": net,
                        "name": p.get("sname", "")})
    return out


def select_stations(s, cache, start: datetime, end: datetime, out_path: str) -> dict:
    land, meta = gfs_land(s, cache)
    land_b = land > 0.5
    sea_b = ~land_b & np.isfinite(land)
    ndbc, asos = [], []
    for c in ndbc_candidates(s):
        dk = _distance_to(land_b, meta, c["lat"], c["lon"])
        if dk > 50.0:
            continue
        obs = ndbc_window(s, cache, c["id"])
        if hourly_coverage(obs, COVER[0], COVER[1], need_gust=True) < 0.70:
            continue
        z = anemometer_m(s, c["id"])
        if not z:
            continue
        ndbc.append({**c, "land_km": round(dk, 1), "anemometer_m": z, "kind": "ndbc"})
    for c in asos_candidates(s):
        dk = _distance_to(sea_b, meta, c["lat"], c["lon"])
        if dk > 10.0:
            continue
        obs = asos_range(s, cache, c["id"], start, end)
        if hourly_coverage(obs, COVER[0], COVER[1], need_gust=False) < 0.70:
            continue
        asos.append({**c, "sea_km": round(dk, 1), "kind": "asos"})
    # Amendment 23:30Z: at most ASOS_CAP ASOS stations, nearest the sea first (ties by id): a deterministic rule that
    # bounds the IEM archive load; never chosen by skill.
    asos = sorted(asos, key=lambda x: (x["sea_km"], x["id"]))[:ASOS_CAP]
    doc = {"frozen_at": datetime.now(timezone.utc).isoformat(), "window": [start.isoformat(), end.isoformat()],
           "rules": "NDBC/C-MAN met=y within 50 km of GFS land, >=70% hourly WSPD+GST over 2026-10-02..11-14, anemometer "
                    "height known; ASOS (IEM, open) within 10 km of GFS sea, >=70% hourly sknt; <=60 ASOS nearest the sea",
           "ndbc": ndbc, "asos": asos}
    json.dump(doc, open(out_path, "w"), indent=1)
    return doc


def is_hawaii(st: dict) -> bool:
    return 18.0 <= st["lat"] <= 23.0 and -161.0 <= st["lon"] <= -154.0
