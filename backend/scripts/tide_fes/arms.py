"""The M1 gate's arms, each a tide height (m, relative to MSL) at given UTC times for one point.

OFFLINE ONLY (PyFES is GPL; pyTMD is MIT; both run only in .github/workflows/tide-fes-gate.yml).
- A  FES2022b extrapolated ocean tide, PyFES, + its long-period equilibrium term.
- B  EOT20 ocean tide (DGFI-TUM, CC BY 4.0), pyTMD, extrapolated up to 10 km toward the coast.
- C  Open-Meteo sea_level_height_msl de-meaned over its served 72 h window (TEST-ONLY reference).
- D  Open-Meteo minus its own 365-day mean (TEST-ONLY reference, the #926 variant).
- P  NOAA's own published harmonic constants synthesised by pyTMD: the POSITIVE control.
Times are numpy datetime64[us] arrays (naive, UTC).
"""
import statistics as st
from datetime import datetime, timedelta, timezone

import numpy as np

try:
    from scripts.tide_fes.metrics import NOAA_TERMS, noaa_terms, sun_mean_longitude_deg
except ImportError:                                           # run by path from the workflow
    from metrics import NOAA_TERMS, noaa_terms, sun_mean_longitude_deg


def to_np(times):
    return np.array([np.datetime64(t.astimezone(timezone.utc).replace(tzinfo=None), "us") for t in times])


def fes_eval(sid_dir, lat, lng, dates, exclude=()):
    """Arm A. None where FES has no value at this point. `exclude`: constituent file stems left out (the reported
    seasonal-constants line isolates Sa / Ssa as full minus without)."""
    import pyfes                                              # GPL - offline job only
    paths = {p.stem: str(p) for p in sorted(sid_dir.glob("*.nc")) if p.stem not in exclude}
    cfg = sid_dir / ("fes" + "".join("-" + e for e in exclude) + ".yaml")
    body = ["engine: darwin", "tide:", "  cartesian:", "    latitude: lat", "    longitude: lon",
            "    amplitude: amplitude", "    phase: phase", "    paths:"]
    body += [f"      {k}: {v}" for k, v in paths.items()]
    cfg.write_text("\n".join(body) + "\n", encoding="utf-8")
    config = pyfes.config.load(str(cfg))
    out = np.empty(len(dates))
    for i in range(0, len(dates), 200_000):                   # chunks keep the 19-year synthesis in memory
        d = dates[i:i + 200_000]
        tide, lp, flags = pyfes.evaluate_tide(config.models["tide"], d, np.full(d.shape, lng % 360.0),
                                              np.full(d.shape, lat), settings=config.settings)
        if i == 0 and int(np.asarray(flags)[0]) == 0:
            return None                                       # undefined here
        out[i:i + len(d)] = (np.asarray(tide) + np.asarray(lp)) / 100.0   # cm -> m
    return out


def eot20_eval(root, lat, lng, dates, constituents=None):
    """Arm B. None where EOT20 has no value within 10 km. `constituents`: a subset, minors not inferred."""
    import pyTMD.compute
    kw = {"constituents": constituents, "infer_minor": False} if constituents else {}
    out = np.empty(len(dates))
    for i in range(0, len(dates), 200_000):
        d = dates[i:i + 200_000].astype("datetime64[ns]")
        v = pyTMD.compute.tide_elevations(np.array([lng]), np.array([lat]), d, directory=str(root), model="EOT20",
                                          type="time series", standard="datetime", crop=True, buffer=1.0,
                                          extrapolate=True, cutoff=10.0, **kw)
        v = np.asarray(v, dtype=float).reshape(-1)
        if i == 0 and not np.isfinite(v[0]):
            return None
        out[i:i + len(d)] = v
    return out


def fit_seasonal(times, vals, k):
    """Fit A cos(k*h - G) + c (h = the sun's mean longitude, NOAA's SA / SSA argument). Returns [A m, G deg]."""
    h = np.radians([k * sun_mean_longitude_deg(t) for t in times])
    X = np.column_stack([np.cos(h), np.sin(h), np.ones_like(h)])
    c, *_ = np.linalg.lstsq(X, np.asarray(vals, dtype=float), rcond=None)
    return [round(float(np.hypot(c[0], c[1])), 4), round(float(np.degrees(np.arctan2(c[1], c[0])) % 360), 1)]


def harcon_eval(harcon, dates):
    """Positive control: CO-OPS's published constants (number, name, amplitude m, phase_GMT deg), pyTMD synthesis
    with the GOT nodal corrections (pyTMD's own Compare-NOAA-Tides recipe), no inferred minors (NOAA infers none).
    G2: SA, SSA, M1, M3 and S1 are NOT given to pyTMD, whose conventions for them differ from NOAA's (SA: Doodson's
    h - p1 vs NOAA's h, the M1 control's ~77-day error); they are added in NOAA's predictor convention
    (metrics.noaa_terms; calibrated on calendar 2025, P only, log 2026-11-16)."""
    import pandas as pd
    import timescale.time  # noqa: F401 - registers timescale.from_datetime
    import timescale
    import pyTMD.constituents
    import pyTMD.io.NOAA  # noqa: F401 - registers the pandas `tmd` accessor
    rows = []
    for num, name, amp, phase, *_ in harcon:
        try:
            c = pyTMD.constituents._parse_name(name)
        except Exception:                                     # noqa: BLE001 - a name pyTMD does not know is dropped
            c = None
        if c and amp > 0 and name not in NOAA_TERMS:
            rows.append({"constNum": num, "name": name, "amplitude": amp, "phase": phase, "constituent": c})
    if not rows:
        return None
    df = pd.DataFrame(rows).set_index("constNum")
    ts = timescale.from_datetime(dates.astype("datetime64[ns]"))
    short = np.asarray(df.tmd.predict(ts.tide, deltat=ts.tt_ut1, corrections="GOT"), dtype=float).reshape(-1)
    aware = [datetime.fromtimestamp(x.astype("datetime64[s]").astype(int), tz=timezone.utc) for x in dates]
    return short + np.array(noaa_terms(harcon, aware))


def om_demean72(om, times):
    """Arm C: each hour minus the mean of the 72 h window starting at 00Z of its day (the served payload window)."""
    out = []
    for t in times:
        w0 = t.replace(hour=0, minute=0)
        win = [v for u, v in om.items() if w0 <= u < w0 + timedelta(hours=72)]
        out.append(om[t] - st.mean(win) if t in om and len(win) >= 60 else None)
    return out


def om_minus_year(om, times, year_mean):
    """Arm D: each hour minus the cell's own 365-day mean (None without a full year)."""
    if year_mean is None:
        return [None] * len(times)
    return [om[t] - year_mean if t in om else None for t in times]
