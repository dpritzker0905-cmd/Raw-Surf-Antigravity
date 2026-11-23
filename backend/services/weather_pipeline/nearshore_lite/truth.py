"""Buoy TRUTH side of the MOP-lite gate (section 4): parse, select, snapshot. Pure functions; the only I/O is an injected
opener, so the tests never touch the network and the Render box never runs this (CI / offline only).

  * `parse_ndbc_stdmet`: NDBC standard-meteorological text (realtime2 and historical share one layout): WVHT (Hs, m), DPD (peak
    period, s), MWD (mean wave direction FROM, deg true). Parsing and QC are the SHARED module's (`point_archive.qc`).
  * `select_stations`: the registered rules ONLY (directional, 10-40 m, not USACE FRF Duck, not assimilated into the driving
    model, no unresolved harbour structure within 1 km). Nothing is chosen by skill; CDIP stations are tagged EXAM-ONLY.
  * `open_window_deg`: the sheltered-subset geometry, from station position and bathymetry ONLY (no observed or forecast
    direction): the arc of bearings from which a straight 50 km line stays in water deeper than 50 m.
  * `presence`: share of TEST hours present, for the >= 70% rule.
  * `snapshot`: an immutable hashed copy of a fetched series, in the shared archive's truth/ prefix (NDBC realtime2 keeps only 45 days, so the 90-init window must be
    archived as it goes).
"""
import json
import math

from services.point_archive import qc

NDBC_HOST = "www.ndbc.noaa.gov"
SHELTER_LINE_KM = 50.0
SHELTER_MIN_DEPTH_M = 50.0
SHELTERED_WINDOW_DEG = 90.0
DEPTH_MIN_M, DEPTH_MAX_M = 10.0, 40.0
MIN_PRESENCE = 0.70
EXCLUDED_OWNERS = {"USACE-FRF", "FRF"}


def realtime_url(station_id):
    return qc.realtime_url(station_id, "txt")


def parse_ndbc_stdmet(text):
    """Rows of {time (UTC datetime), hs_m, tp_s, dir_deg} from NDBC stdmet text, through the SHARED QC module
    (`point_archive.qc.parse_stdmet`: per-field ranges, 'MM' the only global missing, the stuck rule). A value the shared QC
    flags for ANY reason (missing, out of range, stuck) is None here, so this lane and the served-wave lane cannot diverge.
    Raises ValueError without a header."""
    out = []
    for r in qc.parse_stdmet(text):
        bad = r.get("qc", {})
        out.append({"time": r["time"], **{k: (None if k in bad else r[k]) for k in ("hs_m", "tp_s", "dir_deg")}})
    return out


def at_hour(rows, when, tol_min=30):
    """The observation nearest `when` within +/- tol_min minutes, else None."""
    best, best_dt = None, None
    for r in rows:
        d = abs((r["time"] - when).total_seconds()) / 60.0
        if d <= tol_min and (best_dt is None or d < best_dt):
            best, best_dt = r, d
    return best


def presence(rows, hours):
    """Fraction of the requested TEST hours (datetimes) with a usable Hs observation."""
    if not hours:
        return 0.0
    have = sum(1 for h in hours if (o := at_hour(rows, h)) is not None and o["hs_m"] is not None)
    return have / len(hours)


# ---- station selection -----------------------------------------------------------------------------------------
def select_stations(catalogue):
    """catalogue rows: dict(id, owner, source ('NDBC'|'CDIP'|'COPERNICUS'), depth_m, directional, lat, lon,
    assimilated_into_model (bool), harbour_unresolved_within_1km (bool)). Returns (kept, dropped): kept rows gain
    `exam_only` (CDIP) and the reason list for dropped rows. Only the registered rules; no skill enters."""
    kept, dropped = [], []
    for c in sorted(catalogue, key=lambda r: str(r["id"])):
        why = []
        if str(c.get("owner", "")).upper() in EXCLUDED_OWNERS:
            why.append("USACE FRF (non-commercial licence)")
        if not c.get("directional"):
            why.append("not directional")
        d = c.get("depth_m")
        if d is None or not (DEPTH_MIN_M <= d <= DEPTH_MAX_M):
            why.append(f"depth {d} outside {DEPTH_MIN_M:g}-{DEPTH_MAX_M:g} m")
        if c.get("assimilated_into_model"):
            why.append("its own data assimilate into the driving model's boundary")
        if c.get("harbour_unresolved_within_1km"):
            why.append("harbour structure within 1 km not resolved by the bathymetry")
        if why:
            dropped.append({**c, "why": why})
        else:
            kept.append({**c, "exam_only": c.get("source") == "CDIP"})
    return kept, dropped


def open_window_deg(depth_at, lat, lon, step_deg=5.0, line_km=SHELTER_LINE_KM, min_depth_m=SHELTER_MIN_DEPTH_M, samples=25):
    """Width (deg) of the arc of bearings from which a straight `line_km` line stays in water deeper than `min_depth_m`.
    `depth_at(lat, lon) -> depth m (positive down) or None (land / unknown)`. Station geometry and bathymetry only. A start
    point that is itself not sampled (shallow) is allowed: the test is along the line OUT TO SEA from the first sample on."""
    open_bearings = 0
    n = int(round(360.0 / step_deg))
    for k in range(n):
        brg = math.radians(k * step_deg)
        clear = True
        for s in range(1, samples + 1):
            km = line_km * s / samples
            dlat = (km * math.cos(brg)) / 111.0
            dlon = (km * math.sin(brg)) / (111.0 * max(math.cos(math.radians(lat)), 1e-6))
            d = depth_at(lat + dlat, lon + dlon)
            if d is None or d < min_depth_m:
                clear = False
                break
        open_bearings += clear
    return open_bearings * step_deg


def is_sheltered(depth_at, lat, lon):
    return open_window_deg(depth_at, lat, lon) < SHELTERED_WINDOW_DEG


# ---- snapshot --------------------------------------------------------------------------------------------------
def snapshot(writer, station_id, fetched_utc, text):
    """One immutable gzipped copy of a fetched NDBC realtime2 file in the SHARED truth/ prefix, through the shared
    `point_archive.writer.ArchiveWriter` (it refuses to overwrite and lists the file in the prefix's SHA256SUMS).
    Returns (path, sha256)."""
    return writer.write_truth(station_id, "txt", fetched_utc, text)


def fetch_realtime(station_id, opener):
    """Fetch one station's realtime2 text through an injected `opener(url) -> str` (tests inject; CI uses urllib).
    Refuses any URL that is not https on the NDBC host."""
    url = realtime_url(station_id)
    if not url.startswith(f"https://{NDBC_HOST}/"):
        raise ValueError(url)
    return opener(url)


def station_table_json(kept):
    """Canonical frozen station list (sorted, hashed by the caller)."""
    return json.dumps(sorted(kept, key=lambda r: str(r["id"])), sort_keys=True, separators=(",", ":"))
