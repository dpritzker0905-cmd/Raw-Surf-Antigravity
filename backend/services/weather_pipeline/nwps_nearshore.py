"""nwps_nearshore.py — NOAA NWPS, the nearshore model roadmap stage 4 names for the US outside California.

WHY. Stage 4 replaces the parametric transform with a real nearshore model where one exists. CDIP's MOP
covers California only (mop_nearshore.py). For the other US coasts the roadmap names NWPS, the National
Weather Service's Nearshore Wave Prediction System: SWAN runs for the coastal forecast offices, bounded by
WaveWatch III (the model our GFS lane serves) and driven by the offices' own winds. MEASURE FIRST, as the
MOP arm (#124) did before any MOP code shipped: graded beside our chain at the same buoys and hours, the
NWPS arm isolates the transform. It is not a foregone win: at Cape Canaveral (CDIP 143) on 2026-09-27 12Z
the NWPS spectrum integrated to 1.02 m against 0.79 m observed.

THE PRODUCT. Each office's run writes a SWAN 2-D spectrum at every buoy in its domain, hourly for 144 h:
    {NWPS_BASE}/{region}.{YYYYMMDD}/{wfo}/{HH}/CG1/nwps.t{HH}z.spc2d_{buoy}_CG1.{wfo}.txt   (~1 MB)
NOMADS keeps about five days, so the arm can grade the recent past on its first run. Cycles vary by
office (Melbourne runs 00Z and 12Z) and post hours late (Melbourne's 12Z posted at 16:36Z).

WHICH CYCLE GRADES AN HOUR. The latest cycle at or before it, the rule mop_grid_hours uses, and the one the
bulk arm's /point answer for a past hour follows, so the two arms are graded on equal terms.

The station -> buoy table (data/nwps_buoy_points.json) is DISCOVERED from each output file's own LONLAT
header by scripts/build_nwps_buoy_points.py and committed; a stale table refuses, never guesses.
"""
import json
import math
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from services.weather_pipeline.nearshore_validation import Refusal, _parse_dt

NWPS_BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod"
REGIONS = ("er", "sr", "wr", "pr", "ar")      # NWS Eastern, Southern, Western, Pacific, Alaska
GRID = "CG1"                                  # every office's outer grid; the spectra are written from it
POINTS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           "data", "nwps_buoy_points.json")
POINTS_MAX_AGE_DAYS = 180.0
# An NWPS output point stands for a CDIP station within 1 km. Measured on the first build: Fort Pierce
# (41114) sits 0.79 km from CDIP 134's position (the buoy's published location), while 46254 at 1.12 km
# from CDIP 116 is a different instrument. Only 5-digit NDBC ids are buoys (LJPC1 is a pier station).
MATCH_KM = 1.0
RHO_G = 1025.0 * 9.81                         # SWAN's defaults, for an energy-density (EnDens) file
UA = {"User-Agent": "raw-surf-nearshore-validation"}


def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


# ── THE SWAN SPECTRAL FILE (PURE) ─────────────────────────────────────────────────────────────────

def bin_widths(freqs: list) -> list:
    """Frequency bin widths: half the gap to each neighbour, one-sided at the ends (they sum to the
    band's span). SWAN's own integration for its logarithmic frequency grid."""
    n = len(freqs)
    if n < 2:
        return [0.0] * n
    inner = [(freqs[k + 1] - freqs[k - 1]) / 2.0 for k in range(1, n - 1)]
    return [(freqs[1] - freqs[0]) / 2.0] + inner + [(freqs[-1] - freqs[-2]) / 2.0]


def _block_label(line: str) -> str:
    return (line.split() or [""])[0]


def parse_swan_spec(txt: str) -> dict:
    """{times: [ISO hour], points: [{lat, lng, hs: [m | None]}]} from a SWAN standard spectral file.
    Hs = 4 sqrt(m0), m0 the spectrum's integral over frequency and direction. A ZERO block is a calm
    0.0; NODATA, or any negative (exception) value in a block, is None: absent, never guessed. Raises
    ValueError when the header is not a SWAN 2-D spectrum. PURE."""
    lines = txt.splitlines()
    if not lines or not lines[0].startswith("SWAN"):
        raise ValueError("not a SWAN spectral file")

    def after(labels):
        for k, line in enumerate(lines):
            if _block_label(line) in labels:
                return k
        raise ValueError(f"SWAN file has no {'/'.join(labels)} block")

    k = after(("LONLAT", "LOCATIONS"))
    npts = int(lines[k + 1].split()[0])
    points = []
    for line in lines[k + 2:k + 2 + npts]:
        x, y = (float(v) for v in line.split()[:2])
        points.append({"lat": y, "lng": x - 360.0 if x > 180.0 else x, "hs": []})
    k = after(("AFREQ", "RFREQ"))
    nf = int(lines[k + 1].split()[0])
    freqs = [float(v.split()[0]) for v in lines[k + 2:k + 2 + nf]]
    k = after(("NDIR", "CDIR"))
    nd = int(lines[k + 1].split()[0])
    dirs = [float(v.split()[0]) for v in lines[k + 2:k + 2 + nd]]
    k = after(("QUANT",))
    quant = _block_label(lines[k + 2])
    if quant not in ("VaDens", "EnDens"):
        raise ValueError(f"SWAN file holds {quant!r}, not a 2-D variance or energy density")
    scale = 1.0 if quant == "VaDens" else 1.0 / RHO_G
    ddir = abs((dirs[1] - dirs[0] + 180.0) % 360.0 - 180.0) if nd > 1 else 360.0
    df = bin_widths(freqs)

    times, i = [], k + 5
    while i < len(lines):
        m = re.match(r"^(\d{4})(\d\d)(\d\d)\.(\d\d)(\d\d)", lines[i])
        if not m:
            i += 1
            continue
        times.append(f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:00Z")
        i += 1
        for p in points:
            label = _block_label(lines[i]) if i < len(lines) else ""
            if label != "FACTOR":
                p["hs"].append(0.0 if label == "ZERO" else None)
                i += 1
                continue
            factor, vals, i = float(lines[i + 1].split()[0]), [], i + 2
            while len(vals) < nf * nd and i < len(lines):
                vals.extend(int(v) for v in lines[i].split())
                i += 1
            if len(vals) < nf * nd or min(vals) < 0:
                p["hs"].append(None)
                continue
            m0 = sum(sum(vals[a * nd:(a + 1) * nd]) * df[a] for a in range(nf)) * factor * ddir * scale
            p["hs"].append(round(4.0 * math.sqrt(max(m0, 0.0)), 4))
    return {"times": times, "points": points}


# ── WHICH CYCLE GRADES AN HOUR (PURE) ─────────────────────────────────────────────────────────────

def cycle_of(day: str, hh: str):
    """datetime of the cycle `hh`Z on `day` (YYYYMMDD), or None."""
    try:
        return datetime.strptime(f"{day}{hh}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def served_hours(runs: list, now: datetime, lookback_hours: float) -> dict:
    """{ISO hour: {hs, cycle, lead_h}} over the last `lookback_hours`: each hour from the LATEST cycle at
    or before it that has a value there, never from a cycle issued after it. `runs` are
    [{cycle: datetime, times: [ISO], hs: [m | None]}]. PURE."""
    lo = now - timedelta(hours=lookback_hours)
    out, best = {}, {}
    for r in runs or []:
        cyc = r.get("cycle")
        if cyc is None:
            continue
        for t_iso, hs in zip(r.get("times") or [], r.get("hs") or []):
            t = _parse_dt(t_iso)
            if hs is None or t is None or t < cyc or not (lo <= t <= now):
                continue
            key = t.strftime("%Y-%m-%dT%H:%M:%SZ")
            if key not in best or cyc > best[key]:
                best[key] = cyc
                out[key] = {"hs": hs, "cycle": cyc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "lead_h": round((t - cyc).total_seconds() / 3600.0, 1)}
    return out


# ── THE STATION -> BUOY TABLE ─────────────────────────────────────────────────────────────────────

def parse_spec_name(name: str):
    """'nwps.t12z.spc2d_41113_CG1.mlb.txt' -> ('12', '41113', 'mlb'); None for any other file. PURE."""
    m = re.fullmatch(r"nwps\.t(\d\d)z\.spc2d_([A-Za-z0-9]+)_" + GRID + r"\.([a-z]{3})\.txt", name or "")
    return (m.group(1), m.group(2), m.group(3)) if m else None


def match_stations(outputs: list, pairs: list, max_km: float = MATCH_KM) -> dict:
    """{station: {buoy, region, wfo, lat, lng, distance_km, alternates}} for each pair-table station with
    an NWPS buoy output within `max_km`. `outputs` are [{buoy, region, wfo, lat, lng}]. When several
    offices publish the same buoy (Fort Pierce: Miami and Melbourne), the office whose own output points
    centre nearest the buoy is chosen, the one whose domain the buoy sits inside rather than at the edge
    of; the others are kept as alternates. PURE."""
    groups = {}
    for o in outputs or []:
        groups.setdefault((o["region"], o["wfo"]), []).append((o["lat"], o["lng"]))
    centre = {k: (sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v)) for k, v in groups.items()}
    out = {}
    for pair in pairs or []:
        st, slat, slng = pair["station"], float(pair["station_lat"]), float(pair["station_lng"])
        cands = []
        for o in outputs or []:
            if not re.fullmatch(r"\d{5}", str(o.get("buoy", ""))):
                continue
            d = _km(slat, slng, o["lat"], o["lng"])
            if d <= max_km:
                c = centre[(o["region"], o["wfo"])]
                cands.append((_km(o["lat"], o["lng"], c[0], c[1]), d, o))
        if not cands:
            continue
        cands.sort(key=lambda c: (c[0], c[1], c[2]["wfo"]))
        _, d, o = cands[0]
        out[st] = {"buoy": o["buoy"], "region": o["region"], "wfo": o["wfo"], "lat": o["lat"],
                   "lng": o["lng"], "distance_km": round(d, 2),
                   "alternates": [{"region": c[2]["region"], "wfo": c[2]["wfo"]} for c in cands[1:]]}
    return out


def load_points(path: str = None, max_age_days: float = None) -> dict:
    p = path or POINTS_PATH
    try:
        with open(p, encoding="utf-8") as f:
            obj = json.load(f)
    except (OSError, ValueError) as e:
        raise Refusal(f"NWPS buoy table unreadable at {p}: {e}") from e
    gen = _parse_dt(obj.get("generated_at"))
    if gen is None or not isinstance(obj.get("stations"), dict):
        raise Refusal("NWPS buoy table has no parseable generated_at or stations")
    cap = POINTS_MAX_AGE_DAYS if max_age_days is None else max_age_days
    age_d = (datetime.now(timezone.utc) - gen).total_seconds() / 86400.0
    if age_d > cap:
        raise Refusal(f"NWPS buoy table is stale: generated {age_d:.0f} days ago (cap {cap:.0f}) "
                      f"— rerun backend/scripts/build_nwps_buoy_points.py")
    return obj


# ── FETCH (the network; `get` is injected so every branch is testable offline) ───────────────────────

def _get(url: str, timeout: float = 90.0) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def list_dir(get, url: str) -> list:
    """Entry names in a NOMADS directory listing; [] when the directory does not exist (a 404: a day
    not yet published or already aged out). Other failures raise."""
    try:
        html = get(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise
    return re.findall(r'href="([^"?/][^"]*)"', html)


def fetch_station_runs(entry: dict, now: datetime, lookback_hours: float, get=_get) -> list:
    """[{cycle, times, hs}] for one station's buoy: the cycles that can grade an hour of the window.
    Newest first, stopping at the first one issued at or before the window's start: every hour of the
    window takes the latest cycle at or before it, so an older cycle is never the one graded. An hourly
    run therefore reads ~1 file per station, not every cycle of the last day. A cycle whose file is
    missing or unreadable is skipped; transport failures raise (the caller isolates per station)."""
    start = now - timedelta(hours=lookback_hours)
    lo = start - timedelta(hours=24.0)            # a day before the window, for its first hours
    candidates, day = [], lo.date()
    while day <= now.date():
        d = day.strftime("%Y%m%d")
        base = f"{NWPS_BASE}/{entry['region']}.{d}/{entry['wfo']}"
        for hh in (n.strip("/") for n in list_dir(get, f"{base}/") if re.fullmatch(r"\d\d/", n)):
            cyc = cycle_of(d, hh)
            if cyc is not None and lo <= cyc <= now:
                candidates.append((cyc, base, hh))
        day += timedelta(days=1)
    runs = []
    for cyc, base, hh in sorted(candidates, reverse=True):
        name = f"nwps.t{hh}z.spc2d_{entry['buoy']}_{GRID}.{entry['wfo']}.txt"
        try:
            spec = parse_swan_spec(get(f"{base}/{hh}/{GRID}/{name}"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            raise
        except ValueError:
            continue
        if spec["points"]:
            runs.append({"cycle": cyc, "times": spec["times"], "hs": spec["points"][0]["hs"]})
            if cyc <= start:
                break
    return sorted(runs, key=lambda r: r["cycle"])


def attach_nwps(preds: list, now: datetime, lookback_hours: float, points: dict = None, get=_get) -> dict:
    """Stamp `nwps_hs_m` and `nwps_lead_h` on each prediction row whose station has an NWPS buoy and
    whose hour a cycle covers. Returns {station: status}; one station's failure never costs another."""
    try:
        table = points if points is not None else load_points()
    except Refusal as e:
        return {"_table": f"unavailable: {e}"}
    stations = table.get("stations") or {}
    status = {}
    for st in sorted({p.get("station") for p in preds or [] if p.get("station")}):
        entry = stations.get(st)
        if not entry:
            status[st] = "no NWPS output point"
            continue
        try:
            runs = fetch_station_runs(entry, now, lookback_hours, get=get)
        except BaseException as e:                                    # noqa: BLE001 — one station, never the run
            status[st] = f"unavailable: {str(e)[:80]}"
            continue
        hours = served_hours(runs, now, lookback_hours)
        n = 0
        for p in preds:
            h = hours.get(p.get("valid_time")) if p.get("station") == st else None
            if h:
                p["nwps_hs_m"], p["nwps_lead_h"] = h["hs"], h["lead_h"]
                n += 1
        status[st] = f"{entry['wfo']}/{entry['buoy']}: {len(runs)} cycles, {n} rows"
    return status
