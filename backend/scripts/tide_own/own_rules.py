"""Pure helpers for the own-data served tide table (scripts/tide_own/build_series.py). numpy only, no I/O, tested in
tests/test_tide_own.py. The table format is the one services/weather_pipeline/tide_own.py validates and serves."""
import math
from datetime import datetime, timedelta, timezone

import numpy as np

SCHEMA = "raw-surf/tide-own/2"           # must equal services/weather_pipeline/tide_own.SCHEMA (pinned by a test)
BOX_DEG = 0.5
BACK_DAYS, AHEAD_DAYS = 3, 90            # served window: 3 days back (tide_state_at looks back) to 90 days ahead. The
                                         # harmonic tide (A + M) is DETERMINISTIC, so the server keeps serving a table for
                                         # as long as it covers today (the owner, 2026-11-22: "we don't have missing tide
                                         # tables ever"): a missed build loses nothing for months, the publish guard
                                         # refuses < 60 days and the horizon check alerts below 30 (publish_guard.py)
SOURCE = ("A = FES2022b ocean tide + long-period equilibrium (AVISO/CNES/LEGOS/NOVELTIS); M = 2016-2025 mean altimetry "
          "sea-level anomaly at the G3t cell rule (Copernicus Marine SEALEVEL_GLO_PHY_L4). No storm surge.")


def round_key(lat, lng):
    """The served cache key (services/weather_pipeline/tide._round_key): 0.1 degree, Python round."""
    return (round(float(lat), 1), round(float(lng), 1))


def key_str(key):
    return f"{float(key[0]):.1f},{float(key[1]):.1f}"


def safe_dir(k):
    """A filesystem-safe directory name for a key string."""
    return k.replace(",", "_").replace("-", "m").replace(".", "p")


def keys_from_spots(spots):
    """{key string: (lat, lng) of the key itself} for every spot with finite coordinates. The tide is evaluated at the
    KEY point, the same point every spot in that 0.1-degree cell is served from (as the Open-Meteo request was)."""
    out = {}
    for p in spots or []:
        try:
            la, lo = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            continue
        if not (math.isfinite(la) and math.isfinite(lo)) or abs(la) > 90:
            continue
        k = round_key(la, ((lo + 180.0) % 360.0) - 180.0)
        out.setdefault(key_str(k), k)
    return out


def wrapped_lon_index(lon, x, box=BOX_DEG):
    """(column indices, their longitudes made monotonic around x) for a grid whose longitudes run 0..360 (or any
    cyclic range), taking every column within `box` of x ACROSS the seam."""
    lon = np.asarray(lon, float)
    d = ((lon - x + 180.0) % 360.0) - 180.0               # signed distance, wrapped
    ix = np.where(np.abs(d) <= box)[0]
    order = np.argsort(d[ix])
    ix = ix[order]
    return ix, x + d[ix]


def window(now):
    """(start, hours): from 00Z BACK_DAYS before today to 00Z AHEAD_DAYS after it, hourly."""
    day0 = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = day0 - timedelta(days=BACK_DAYS)
    return start, 24 * (BACK_DAYS + AHEAD_DAYS)


def levels_mm(a, m):
    """A + M in integer millimetres per hour; null where A is not finite. A key without M (None or not finite) is
    ALL null: A alone is a different arm and is never served."""
    if a is None or m is None:
        return None if a is None else [None] * len(a)
    try:
        mf = float(m)
    except (TypeError, ValueError):
        return [None] * len(a)
    if not math.isfinite(mf):
        return [None] * len(a)
    return [None if not math.isfinite(float(v)) else int(round((float(v) + mf) * 1000.0)) for v in a]


def table(now, start, hours, out_keys, m_cache):
    """The served document. Keys with no series at all (no FES water) are dropped: absent means unavailable."""
    keys = {k: v for k, v in out_keys.items() if v is not None and any(x is not None for x in v)}
    return {"schema": SCHEMA, "generated_at": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "start": start.strftime("%Y-%m-%dT%H:%M:%S"), "hours": hours, "step_h": 1, "units": "mm above mean sea level",
            "source": SOURCE, "keys": keys,
            "m": {k: (m_cache.get(k) or {}).get("m") for k in keys}}


# ---------------------------------------------------------------- M by tile (one altimetry download per tile)
TILE_DEG = 4.0
CELL_HALF = 0.6                          # g3_sources.s1_cell_series's box half-width around a point
TILE_MARGIN = 0.7                        # > CELL_HALF, so every key's +-0.6 cells are inside its tile's download
M_PARITY_MAX_M = 0.0001                  # the tile method must reproduce G3t's per-point M (4 dp) at its 26 gauges
# G3t's M per gauge (run 44166851340, s1_cells[*].M_m; altimetry model files only, computed before any truth)
G3T_M = {"1611400": 0.0894, "1612340": 0.0893, "1615680": 0.0859, "1617760": 0.0983, "8443970": 0.1178,
         "8452660": 0.0931, "8531680": 0.1379, "8534720": 0.1051, "8651370": 0.1158, "8658163": 0.1482,
         "8665530": 0.1495, "8720030": 0.1315, "8722670": 0.1345, "8723214": 0.1216, "8726724": 0.1333,
         "8729840": 0.1219, "8771510": 0.1276, "9410230": 0.0795, "9410660": 0.0812, "9413450": 0.0751,
         "9415020": 0.0780, "9419750": 0.0766, "9435380": 0.0669, "9443090": 0.0982, "9751639": 0.0872,
         "9755371": 0.0961}


def tile_of(lat, lng):
    """The TILE_DEG tile a point falls in (south-west corner)."""
    return (math.floor(lat / TILE_DEG) * TILE_DEG, math.floor(lng / TILE_DEG) * TILE_DEG)


def tile_request(tile):
    """(centre lat, centre lng, half width) of the altimetry box that covers the tile plus TILE_MARGIN on every side."""
    return tile[0] + TILE_DEG / 2, tile[1] + TILE_DEG / 2, TILE_DEG / 2 + TILE_MARGIN


def cell_km(lat, lng, la, lo):
    """g3_sources.s1_cell_series's distance (equirectangular, km), unchanged."""
    return 6371.0 * math.hypot(math.radians(la - lat), math.radians(((lo - lng + 180) % 360) - 180) * math.cos(math.radians(lat)))


# ---------------------------------------------------------------- CMEMS direct read (M1-0)
CMEMS_DATASET = "cmems_mod_glo_phy_anfc_merged-sl_PT1H-i"
CMEMS_AHEAD_DAYS = 10                    # the product ends about 9 days ahead; ask a little past it


def nearest_cell(lats, lons, key):
    """(iy, ix) of the grid cell nearest the key on a regular lat/lon grid (longitude wrapped), or None. MUST equal
    scripts/tide_cmems/parity_rules.nearest_cell, the M1-0 parity rule's primary cell (pinned by a test)."""
    lats, lons = np.asarray(lats, float), np.asarray(lons, float)
    if lats.size == 0 or lons.size == 0:
        return None
    iy = int(np.argmin(np.abs(lats - key[0])))
    ix = int(np.argmin(np.abs(((lons - key[1] + 180.0) % 360.0) - 180.0)))
    return iy, ix


def surface_tyx(ds, var):
    """`var` as a (time, latitude, longitude) array. The merged-sl product (version 202411) serves every variable as
    (depth, time, latitude, longitude) with ONE depth level; indexing that as (time, lat, lon) raised the ValueError that
    voided run 44421247650. MUST equal scripts/tide_cmems/parity_rules.surface_tyx (pinned by a test)."""
    da = ds[var]
    if "depth" in da.dims:
        if da.sizes["depth"] != 1:
            raise ValueError(f"{var}: expected one depth level, got {da.sizes['depth']}")
        da = da.isel(depth=0, drop=True)
    out = da.transpose("time", "latitude", "longitude").values
    if out.ndim != 3:
        raise ValueError(f"{var}: expected (time, latitude, longitude), got dims {da.dims}")
    return out


def hour_index(start, epoch_s):
    """The table hour index of a UTC epoch second, or None if it is not on the hour."""
    d = int(epoch_s) - int(start.timestamp())
    return d // 3600 if d % 3600 == 0 else None


def place_hourly(hours, idx, values):
    """[mm or None] * hours with each finite value placed at its index (indices outside 0..hours-1 dropped)."""
    out = [None] * hours
    for i, v in zip(idx, values):
        if i is None or not 0 <= i < hours:
            continue
        fv = float(v)
        if math.isfinite(fv):
            out[i] = int(round(fv * 1000.0))
    return out


MISSING_I16 = -32768                      # must equal services/weather_pipeline/tide_own._MISSING (pinned by a test)
I16_MAX_MM = 32767                        # the int16 range in mm: levels must lie within +-32.767 m; -32768 = no value


def encode_i16(vals):
    """A series of mm-or-None as base64 of little-endian int16 (None -> -32768): the compact form tide_own reads, so
    the serving process's peak while loading stays near the table's size (lists of ints peaked at about 122 MB).
    A value outside +-32.767 m is REFUSED (ValueError), never clipped: a tide level that large is a bug upstream."""
    import base64
    import struct
    out = []
    for v in vals:
        if v is None:
            out.append(MISSING_I16)
            continue
        iv = int(v)
        if not -I16_MAX_MM <= iv <= I16_MAX_MM:
            raise ValueError(f"tide level {iv} mm is outside the int16 range (+-{I16_MAX_MM} mm)")
        out.append(iv)
    return base64.b64encode(struct.pack(f"<{len(out)}h", *out)).decode("ascii")


def encode_table(doc):
    """The served document with every series in the compact form."""
    out = dict(doc)
    out["keys"] = {k: encode_i16(v) for k, v in doc.get("keys", {}).items()}
    if "cmems" in doc:
        out["cmems"] = {k: encode_i16(v) for k, v in doc["cmems"].items()}
    if "am_h" in doc:                               # the harcon arm (tide-a-harcon-v1 s2), same compact form
        out["am_h"] = {k: encode_i16(v) for k, v in doc["am_h"].items()}
    out["encoding"] = "i16le-base64"
    out["credits"] = dict(CREDITS)                  # the attribution is STORED with every table (advisor, PR B (b))
    return out


# MUST equal services/weather_pipeline/tide_credits.CREDITS (pinned by tests/test_tide_own.py); kept as a copy because
# this CI script never imports the served backend.
_FES_ACK = ("The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available "
            "by AVISO")
_FES_CITATION = ("CNES, 2024. FES2022 (Finite Element Solution) Tidal model (Version 2024). CNES. "
                 "https://doi.org/10.24400/527896/A01-2024.004")
_FES_LICENCE = "https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf"
_CMEMS_CREDIT = "Generated using E.U. Copernicus Marine Service Information"
CREDITS = {
    "am": (f"{_FES_ACK}. {_FES_CITATION}. Mean sea level: {_CMEMS_CREDIT} (altimetry, SEALEVEL_GLO_PHY_L4). "
           f"Licence: {_FES_LICENCE}"),
    "cmems": f"{_CMEMS_CREDIT} (Global Ocean Physics Analysis and Forecast, https://doi.org/10.48670/moi-00016).",
}
_NOAA_HARCON_CREDIT = ("Astronomical tide near NOAA stations: NOAA National Ocean Service, Center for Operational "
                       "Oceanographic Products and Services (CO-OPS), harmonic constituents (public domain)")
CREDITS["am_h"] = f"{_NOAA_HARCON_CREDIT}; blended with: {CREDITS['am']}"


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)
