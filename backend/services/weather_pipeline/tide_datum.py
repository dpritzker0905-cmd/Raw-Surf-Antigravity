"""tide_datum.py - the DISPLAY datum of a served tide height: above MLLW at US points, above local mean sea level elsewhere.

WHY (owner 2026-11-22, "Yes, build MLLW"; research note Q6, docs/weather-program/research/): US surfers read tide tables
from NOAA (and apps built on NOAA), whose heights are above MLLW, NOAA's chart datum. Our served level is "above local
mean sea level", so a US surfer comparing the two saw every number differ by 0.25 m (Honolulu) to 1.59 m (Boston).

ONE COMPOSITION. Every surface that shows a tide height (the infobox readout /point-tide, the spot hub /tides, the
forecast-card and glyph tide rows from the ratings, the spot-series chart) converts through `datum_for` + `display_m`,
and carries the `datum` block so its label names the datum and the source. The PHYSICS never sees this: the rating's
tide_fit, the SURF_TIDE_DEPTH cap and `water_level_m` stay on our mean-sea-level level (`tide_state.height_m`).

THE CONVERSION (and the epoch, the advisor's condition 1):
    above MLLW (t) = A(t) + M + D        where our served level is A(t) + M
    i.e.  display = level + D            (offset_m = D)
  A  our FES2022b astronomical tide: zero mean, no mean level.
  M  the key's 2016-2025 mean level (altimetry, against the 1993-2012 reference), the `m` the table stores per key.
  D  MSL - MLLW at the point, a TIDAL-RANGE quantity on the 1983-2001 National Tidal Datum Epoch (or the station's
     published epoch).
  NOAA's tide predictions - the numbers in a NOAA tide table - are the astronomical tide about the EPOCH's MSL, read
  against the epoch's MLLW: mean D, no sea-level change since the epoch. Our display keeps M, so it reads M ABOVE
  the NOAA table: tide plus the average sea-level rise since the epoch (frame A + M + D, 2026-11-23, replacing A + D:
  research/tide-mllw-us-method-2026-11-22.md "Frame check" measured A + M + D within 0.011 m of observed water at San
  Diego, San Francisco and Seattle in a quiet week, where A + D read 0.075-0.087 m low; neither follows a weather or
  basin anomaly, which the label says).
  MEASURED: G3t (run 44166851340, 26 US gauges, observed water on each station's epoch MSL) found A alone 0.099 m LOW
  (median) and A + M +0.008 m: M is the measured rise of the water above the epoch MSL, 0.067-0.150 m at the gauges
  (Gulf 0.12-0.15, East 0.09-0.14, West 0.067-0.098, Hawaii 0.086-0.098; own_rules.G3T_M). That is the amount the
  display reads above the NOAA table, reported per point as `mean_level_included_m`. Today's anomaly (surge, a
  basin-wide high, the seasonal cycle) is in neither the display nor the NOAA table.
  D's epoch: CO-OPS's superseded 1960-1978 datums move D by a few millimetres against 1983-2001 at the same stations
  (scripts/tide_datum/epoch_check.py measures it): the range is epoch-stable, the mean is not, which is why M (a mean)
  is our own (2016-2025) and D (a range) is used as published.

THE SOURCE OF D, PER POINT (the advisor's condition 2; named in the payload and on the label), in this order:
  model         our own 19-year computation: A synthesised every 10 min over 1983-2001 at the point and NOAA's MLLW
                definition applied (scripts/tide_own/own_rules.d_ntde, computed in CI; measured 0.0135 m median |error|
                against the datum sheets at the US gauges, G3t item 4). FIRST because it is the MLLW of the very tide
                the point displays: its own lower lows average to exactly 0.
  gauge         no model value yet: a NOAA CO-OPS station that publishes MSL and MLLW within GAUGE_KM, its datum sheet.
  interpolated  neither: the inverse-distance mean of the stations within INTERP_KM, only when they agree (spread <=
                INTERP_MAX_SPREAD).
  MEASURED (scripts/tide_datum/loo_check.py, leave-one-out over the 2,114 US stations with a dated sheet, 2026-11-22):
  the nearest other sheet within 0.5 / 1 / 2 / 5 km is off by 0.011 / 0.016 / 0.017 / 0.020 m median and 0.070 /
  0.104 / 0.092 / 0.103 m at the 90th percentile (stations sit up estuaries and rivers: distance alone does not make
  a sheet the point's own), so a gauge is taken only within 2 km and only when the model has no value; interpolation
  is 0.0185 m median, 0.101 m p90 (2.8% / 12.6% relative), refused at 993 of 2,114 stations (too few or disagreeing).
  Otherwise the point stays above local mean sea level, labelled so. VDatum was not used: its grids are a gated
  825 MB download with no Hawaii grid.

Scope: tide_us_region (CONUS, Alaska, Hawaii, Puerto Rico, USVI, Guam, CNMI, American Samoa). Kill switch:
SURF_TIDE_MLLW_US (runtime_flags; '0' = every point above local mean sea level, as before).
"""
import json
import logging
import math
import os
import threading
from typing import Optional

from services.weather_pipeline.tide_us_region import us_region

logger = logging.getLogger(__name__)

FLAG = "SURF_TIDE_MLLW_US"
STATIONS_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "tide_datum", "coops_datums.json")
GAUGE_KM = 2.0                 # loo_check: 0.017 m median within 2 km, no better closer in (docstring)
INTERP_KM = 40.0
INTERP_MAX_SPREAD = 0.25       # (max - min) / mean of the neighbours' D; beyond it the coast is too varied to blend
INTERP_MAX_N = 4

MSL_SHORT = "above local MSL"
MLLW_SHORT = "above MLLW"
NEGATIVE_NOTE = ("0 = mean lower low water (NOAA chart datum). A minus tide (below 0) is a lower-than-average low "
                 "tide, not an error.")

_lock = threading.Lock()
_stations = {"rows": None}


def _load_stations():
    with _lock:
        if _stations["rows"] is not None:
            return _stations["rows"]
    rows = []
    try:
        with open(STATIONS_PATH, encoding="utf-8") as fh:
            doc = json.load(fh)
        for r in doc.get("stations") or []:
            try:
                lat, lng, d = float(r["lat"]), float(r["lng"]), float(r["d"])
            except (KeyError, TypeError, ValueError):
                continue
            epoch = str(r.get("epoch") or "")
            if epoch in ("", "NONE", "0000-0000"):            # a sheet with no stated epoch is not a published datum
                continue
            if math.isfinite(lat) and math.isfinite(lng) and math.isfinite(d) and d > 0 and us_region(lat, lng):
                rows.append({"id": str(r["id"]), "name": r.get("name") or "", "lat": lat, "lng": lng, "d": d,
                             "epoch": r.get("epoch") or ""})
    except (OSError, ValueError) as e:
        logger.warning("[tide-datum] station table unreadable (%s): US points stay above local MSL", type(e).__name__)
    with _lock:
        _stations["rows"] = rows
    return rows


def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(((lng2 - lng1 + 180.0) % 360.0) - 180.0)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def neighbours(lat, lng, radius_km, stations=None, exclude_id=None):
    """PURE given `stations`: [(km, station)] within radius_km, nearest first."""
    rows = _load_stations() if stations is None else stations
    out = []
    for s in rows:
        if exclude_id is not None and s["id"] == exclude_id:
            continue
        if abs(s["lat"] - lat) > radius_km / 100.0 + 0.1:          # cheap latitude reject (1 deg ~ 111 km)
            continue
        k = _km(lat, lng, s["lat"], s["lng"])
        if k <= radius_km:
            out.append((k, s))
    out.sort(key=lambda t: t[0])
    return out


def interpolate(lat, lng, stations=None, exclude_id=None):
    """PURE given `stations`: (D, [(km, station)]) by inverse-distance-squared over up to INTERP_MAX_N stations within
    INTERP_KM, or None when fewer than two are in reach or they disagree by more than INTERP_MAX_SPREAD."""
    near = neighbours(lat, lng, INTERP_KM, stations, exclude_id)[:INTERP_MAX_N]
    if len(near) < 2:
        return None
    ds = [s["d"] for _, s in near]
    if (max(ds) - min(ds)) / (sum(ds) / len(ds)) > INTERP_MAX_SPREAD:
        return None
    w = [1.0 / max(k, 0.5) ** 2 for k, _ in near]
    return sum(wi * di for wi, di in zip(w, ds)) / sum(w), near


def msl_block(reason, region=None):
    """The local-MSL display block (offset 0) with the reason a point is not shown above MLLW."""
    return _msl(reason, region)


def _msl(reason, region=None):
    return {"datum": "MSL", "label": MSL_SHORT, "offset_m": 0.0, "reason": reason, "region": region,
            "long_label": "Tide height above local mean sea level (2016-2025 mean level)."}


def _station_ref(km, s):
    return {"id": s["id"], "name": s["name"], "km": round(km, 1), "msl_minus_mllw_m": round(s["d"], 3),
            "epoch": s["epoch"]}


def resolve_d(lat, lng, model_d=None, stations=None):
    """PURE given `stations`: (D, source, source_label, [station refs], epoch) or None. Order: model, gauge,
    interpolated (module docstring)."""
    if isinstance(model_d, (int, float)) and not isinstance(model_d, bool) and math.isfinite(model_d) and model_d > 0:
        return (float(model_d), "model", "Raw Surf 19-year tide computation (FES2022, 1983-2001 epoch)", [],
                "1983-2001")
    near = neighbours(lat, lng, GAUGE_KM, stations)
    if near:
        km, s = near[0]
        return (s["d"], "gauge", f"NOAA CO-OPS gauge {s['id']} {s['name']} ({km:.1f} km)", [_station_ref(km, s)],
                s["epoch"] or "1983-2001")
    got = interpolate(lat, lng, stations)
    if got is not None:
        d, nb = got
        names = ", ".join(f"{s['id']} {s['name']}" for _, s in nb)
        epochs = sorted({s["epoch"] for _, s in nb if s["epoch"]})
        return (d, "interpolated", f"interpolated between NOAA CO-OPS gauges {names}",
                [_station_ref(k, s) for k, s in nb], "/".join(epochs) or "1983-2001")
    return None


def datum_for(lat, lng, series, enabled=None, stations=None) -> dict:
    """The display datum block for a point and its served tide series (tide_own.series_from_table's dict). PURE when
    `enabled` and `stations` are given. MLLW only when: the flag is on, the point is a US one, the series is our
    harmonic `am` tide with its mean level M, and D resolves; otherwise local MSL with the reason."""
    if enabled is None:
        from services.runtime_flags import on
        enabled = on(FLAG)
    region = us_region(lat, lng)
    if not enabled:
        return _msl("flag-off", region)
    if region is None:
        return _msl("outside-us")
    s = series or {}
    m = s.get("mean_level_m")
    if s.get("source") != "am" or not isinstance(m, (int, float)) or isinstance(m, bool) or not math.isfinite(m):
        return _msl("no-mean-level", region)
    got = resolve_d(lat, lng, s.get("model_d_ntde_m"), stations)
    if got is None:
        # Named: neighbours exist but disagree beyond INTERP_MAX_SPREAD (a varied coast), or none are in reach.
        near = neighbours(lat, lng, INTERP_KM, stations)[:INTERP_MAX_N]
        return _msl("interpolation-disagrees" if len(near) >= 2 else "no-datum-source", region)
    d, source, source_label, refs, epoch = got
    return {"datum": "MLLW", "label": MLLW_SHORT, "offset_m": round(d, 4),
            "msl_minus_mllw_m": round(d, 4), "mean_level_included_m": round(float(m), 4),
            "source": source, "source_label": source_label, "stations": refs, "epoch": epoch, "region": region,
            "long_label": (f"Tide plus average sea-level rise, above MLLW (NOAA chart datum, {epoch} epoch). It "
                           f"includes the rise since the epoch (about {round(float(m) * 100):d} cm here, the 2016-2025 "
                           f"mean), so it reads that much above a NOAA tide table. It excludes today's ocean anomaly "
                           f"and storm surge, which can add tens of centimetres. Datum from {source_label}."),
            "negative_note": NEGATIVE_NOTE}


def display_m(level_m, block) -> Optional[float]:
    """A served level (m above our mean sea level) in the block's display datum; None stays None."""
    if not isinstance(level_m, (int, float)) or isinstance(level_m, bool) or not math.isfinite(level_m):
        return None
    return round(float(level_m) + float((block or {}).get("offset_m") or 0.0), 3)


def _reset_for_tests(rows=None):
    with _lock:
        _stations["rows"] = rows
