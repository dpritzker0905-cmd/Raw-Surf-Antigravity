"""surf_spot_panel.py: a fixed panel of surf spots read ONCE from the deployed backend's /api/weather/point.

WHY (owner field report 2026-11-15, 29.77 N 81.25 W: the infobox surf read too high for wind swell on a gently sloping
beach; "we need to test live dev as we work our science"). Every surf-science PR shows this panel before and after on
deployed dev, so a change is seen where the owner sees it. Rule and panel: docs/weather-program/log/2026-11-16-fable-surf-
spot-panel-prereg.md. The panel is FIXED there; adding or dropping a spot is a dated addendum, never an edit.

WHAT IT READS, per spot: the offshore height / period / direction (`point.speed` on the waves layer is the OFFSHORE
significant height in metres, not the surf), the served breaking height `surf_height_m`, its regime, the shelf and break
depths and what geometry is missing; and, from NDBC's public latest-observations feed (one request), the nearest wave
buoy within 100 km with its height, dominant period and MEAN period. A mean period well under the dominant one is a
wind-sea-heavy spectrum, which is hypothesis H1.

THIS IS NOT A LOAD TEST AND MUST NOT BECOME ONE. One 1-CPU box serves production and dev. So: /api/health is read
before anything else and the run stops there if it is not healthy; the 30 calls are sequential and SPACING_S apart; a
call slower than SLOW_S, or two failures in a row, stops the run; /api/health is read again at the end. GET only, and
only to the backend's host and www.ndbc.noaa.gov (enforced in `fetch`). No key, no secret, no write, no artifact."""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
NDBC_HOST = "www.ndbc.noaa.gov"
NDBC_LATEST = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
SPACING_S = 10.0
SLOW_S = 20.0
BUOY_REACH_KM = 100.0
FT_PER_M = 3.28084

# (name, lat, lng, coast, class). Coordinates are the catalogue's (RV-12 spot catalogue 2026-08-12) except the owner's
# point. The class is read off the spot's NAME by the author, not measured: it is a label to be tested, not a finding.
PANEL = (
    ("Owner point St. Augustine-Volusia", 29.77, -81.25, "florida_east", "open_beach"),
    ("Crescent Beach", 29.753, -81.229, "florida_east", "open_beach"),
    ("St. Augustine Pier", 29.855, -81.263, "florida_east", "pier"),
    ("St. Augustine Inlet - North Jetty", 29.912, -81.263, "florida_east", "inlet_jetty"),
    ("Vilano Beach", 29.924, -81.285, "florida_east", "open_beach"),
    ("Flagler Beach Pier", 29.475, -81.127, "florida_east", "pier"),
    ("Daytona Beach - Main Street Pier", 29.228, -81.005, "florida_east", "pier"),
    ("New Smyrna Beach - Inlet", 29.074, -80.919, "florida_east", "inlet_jetty"),
    ("New Smyrna Beach - Flagler Avenue", 29.038081, -80.895559, "florida_east", "open_beach"),
    ("Ponce Inlet - North Jetty", 29.081, -80.924, "florida_east", "inlet_jetty"),
    ("Cocoa Beach Pier", 28.3676, -80.6012, "florida_east", "pier"),
    ("Sebastian Inlet - First Peak", 27.86616805974561, -80.44841765468736, "florida_east", "inlet_jetty"),
    ("Duck", 36.17, -75.755, "mid_atlantic", "open_beach"),
    ("Rodanthe Pier", 35.582, -75.433, "mid_atlantic", "pier"),
    ("Cape Hatteras Lighthouse", 35.2507, -75.5287, "mid_atlantic", "open_beach"),
    ("Manasquan Inlet", 40.105, -74.028, "mid_atlantic", "inlet_jetty"),
    ("Wrightsville Beach", 34.2133, -77.795, "mid_atlantic", "open_beach"),
    ("Folly Beach Pier", 32.652, -79.938, "mid_atlantic", "pier"),
    ("Lower Trestles", 33.3819, -117.5885, "california", "point_reef"),
    ("Huntington Beach Pier", 33.655, -117.999, "california", "pier"),
    ("Ocean Beach SF", 37.758, -122.515, "california", "open_beach"),
    ("Steamer Lane", 36.951, -122.026, "california", "point_reef"),
    ("Rincon", 34.3781, -119.4819, "california", "point_reef"),
    ("Blacks Beach", 32.8925, -117.2536, "california", "open_beach"),
    ("Pipeline", 21.6637, -158.0515, "hawaii", "point_reef"),
    ("Waikiki - Queens", 21.2678, -157.853, "hawaii", "point_reef"),
    ("Galveston - 61st Street", 29.2398, -94.848, "gulf", "open_beach"),
    ("Pensacola Beach Pier", 30.318, -87.138, "gulf", "pier"),
    ("Port Aransas Jetty", 27.818, -97.048, "gulf", "inlet_jetty"),
    ("South Padre - Jetties", 26.068, -97.158, "gulf", "inlet_jetty"),
)


def allowed_hosts(base: str) -> set:
    return {urllib.parse.urlparse(base).hostname, NDBC_HOST}


def fetch(url: str, base: str, timeout: float = 30.0, opener=urllib.request.urlopen):
    """GET `url` and return (status, text, seconds). Any host but the backend's or NDBC's raises before a byte is sent."""
    parts = urllib.parse.urlparse(url)
    if parts.scheme != "https" or parts.hostname not in allowed_hosts(base):
        raise ValueError("surf_spot_panel reads only the backend and NDBC over https: %s" % parts.hostname)
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "raw-surf-spot-panel"})
    t0 = time.monotonic()
    with opener(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", "replace")
        return getattr(resp, "status", 200), text, time.monotonic() - t0


def km_between(a, b) -> float:
    la1, lo1, la2, lo2 = (math.radians(float(x)) for x in (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(h)))


def parse_latest_obs(text: str) -> list:
    """Stations reporting a wave height, from NDBC's latest_obs.txt. Columns are found by the header's names."""
    cols, out = None, []
    for line in (text or "").splitlines():
        parts = line.split()
        if line.startswith("#"):
            if cols is None and "LAT" in parts and "WVHT" in parts:
                cols = {name.lstrip("#"): i for i, name in enumerate(parts)}
            continue
        if cols is None or len(parts) <= max(cols.values()):
            continue

        def num(name):
            try:
                return float(parts[cols[name]])
            except (KeyError, ValueError):
                return None
        lat, lon, hs = num("LAT"), num("LON"), num("WVHT")
        if lat is None or lon is None or hs is None:
            continue
        out.append({"id": parts[cols["STN"]], "lat": lat, "lng": lon, "hs_m": hs, "dpd_s": num("DPD"), "apd_s": num("APD")})
    return out


def nearest_buoy(lat: float, lng: float, stations: list):
    """The nearest station reporting waves within BUOY_REACH_KM, with its distance; None when there is none."""
    best = None
    for s in stations or []:
        d = km_between((lat, lng), (s["lat"], s["lng"]))
        if d <= BUOY_REACH_KM and (best is None or d < best["km"]):
            best = {**s, "km": round(d, 1)}
    return best


def point_url(base: str, lat: float, lng: float, valid_time: str) -> str:
    q = urllib.parse.urlencode({"model": "GFS", "domain": "marine", "layer": "waves", "lat": lat, "lng": lng,
                                "valid_time": valid_time})
    return base.rstrip("/") + "/api/weather/point?" + q


def panel_row(spot, payload, buoy) -> dict:
    """One printed row. `offshore_hs_m` is the model's offshore height; `ratio` is served surf over it."""
    name, lat, lng, coast, kind = spot
    pt = (payload or {}).get("point") or {}
    off, surf = pt.get("speed"), (payload or {}).get("surf_height_m")
    ratio = round(surf / off, 2) if isinstance(off, (int, float)) and isinstance(surf, (int, float)) and off > 0 else None
    b = buoy or {}
    return {"spot": name, "coast": coast, "class": kind, "lat": lat, "lng": lng,
            "offshore_hs_m": off, "offshore_tp_s": pt.get("period"), "offshore_dir": pt.get("direction"),
            "surf_m": surf, "surf_ft": round(surf * FT_PER_M, 1) if isinstance(surf, (int, float)) else None,
            "ratio": ratio, "regime": (payload or {}).get("surf_regime"),
            "shelf_depth_m": (payload or {}).get("shelf_depth_m"), "break_depth_m": (payload or {}).get("break_depth_m"),
            "geometry_missing": (payload or {}).get("geometry_missing") or [],
            "served_valid_time": (payload or {}).get("served_valid_time"),
            "buoy": b.get("id"), "buoy_km": b.get("km"), "buoy_hs_m": b.get("hs_m"),
            "buoy_dpd_s": b.get("dpd_s"), "buoy_apd_s": b.get("apd_s")}


def _cell(v):
    if v is None or v == []:
        return ""
    if isinstance(v, float):
        return ("%.2f" % v).rstrip("0").rstrip(".")
    if isinstance(v, (list, tuple)):
        return ", ".join(str(x) for x in v)
    return str(v).replace("|", "/")


COLUMNS = (("spot", "spot"), ("class", "class"), ("offshore_hs_m", "offshore Hs m"), ("offshore_tp_s", "Tp s"),
           ("surf_m", "surf m"), ("surf_ft", "surf ft"), ("ratio", "surf / offshore"), ("regime", "regime"),
           ("shelf_depth_m", "shelf m"), ("break_depth_m", "break m"), ("geometry_missing", "geometry missing"),
           ("buoy", "buoy"), ("buoy_km", "km"), ("buoy_hs_m", "buoy Hs m"), ("buoy_dpd_s", "buoy Tp s"),
           ("buoy_apd_s", "buoy mean T s"))


def render(rows, meta) -> str:
    out = ["## Surf spot panel", "",
           "- read at %s, valid time asked %s" % (meta.get("read_at"), meta.get("valid_time")),
           "- backend health before: %s; after: %s" % (meta.get("health_before"), meta.get("health_after")),
           "- spots read %d of %d; stopped early: %s" % (len(rows), meta.get("panel_size"), meta.get("stopped") or "no"),
           "- `offshore Hs` is the model's OFFSHORE height; `surf` is the served breaking height; the class is a name-based label",
           ""]
    out.append("| " + " | ".join(h for _, h in COLUMNS) + " |")
    out.append("|" + "---|" * len(COLUMNS))
    for r in rows:
        out.append("| " + " | ".join(_cell(r.get(k)) for k, _ in COLUMNS) + " |")
    by = {}
    for r in rows:
        if r.get("ratio") is not None:
            by.setdefault(r["class"], []).append(r["ratio"])
    out += ["", "| class | spots with a ratio | median surf / offshore |", "|---|---|---|"]
    for kind in sorted(by):
        v = sorted(by[kind])
        mid = v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2
        out.append("| %s | %d | %s |" % (kind, len(v), _cell(float(mid))))
    out += ["", "One reading is one sea state. A class median here is a description, not a factor."]
    return "\n".join(out) + "\n"


def health_ok(base, get) -> str:
    try:
        status, _text, secs = get(base.rstrip("/") + "/api/health")
        return "ok %.1fs" % secs if status == 200 else "status %s" % status
    except Exception as e:
        return "failed %s" % type(e).__name__


def run(base: str, now: datetime, get=None, sleep=time.sleep, panel=PANEL) -> dict:
    """Read the panel. `get(url)` returns (status, text, seconds); injected in tests so nothing is sent."""
    get = get or (lambda url: fetch(url, base))
    valid_time = now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {"read_at": now.strftime("%Y-%m-%dT%H:%MZ"), "valid_time": valid_time, "panel_size": len(panel),
            "health_before": health_ok(base, get), "health_after": "not read", "stopped": None}
    rows = []
    if not meta["health_before"].startswith("ok"):
        meta["stopped"] = "backend not healthy before the run; no spot was read"
        return {"meta": meta, "rows": rows}
    try:
        stations = parse_latest_obs(get(NDBC_LATEST)[1])
    except Exception:
        stations = []
    meta["buoys_in_feed"] = len(stations)
    failures = 0
    for i, spot in enumerate(panel):
        if i:
            sleep(SPACING_S)
        try:
            status, text, secs = get(point_url(base, spot[1], spot[2], valid_time))
            payload = json.loads(text) if status == 200 else None
        except Exception:
            status, payload, secs = None, None, 0.0
        if payload is None:
            failures += 1
            if failures >= 2:
                meta["stopped"] = "two failed reads in a row at '%s'" % spot[0]
                break
            continue
        failures = 0
        rows.append(panel_row(spot, payload, nearest_buoy(spot[1], spot[2], stations)))
        if secs > SLOW_S:
            meta["stopped"] = "a read took %.0fs at '%s'; the backend is busy" % (secs, spot[0])
            break
    meta["health_after"] = health_ok(base, get)
    return {"meta": meta, "rows": rows}


def main(argv=None) -> int:
    base = os.environ.get("PANEL_BASE") or DEFAULT_BASE
    result = run(base, datetime.now(timezone.utc))
    text = render(result["rows"], result["meta"])
    sys.stdout.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text)
    return 0 if result["rows"] else 1


if __name__ == "__main__":
    sys.exit(main())
