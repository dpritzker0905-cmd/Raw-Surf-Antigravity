"""NOAA's predictor convention for the fortnightly and monthly long-period constituents MM, MF and MSF (tide-mllw-tester-v1
REQ-1, gate s12): pure Python, no pyTMD.

Found by the REQ-1 calibration (2026-11-25): pyTMD's synthesis of Longview's MM (0.077 m) and MSF (0.139 m) left 14-day
running means of NOAA - ours up to 4.15 mm (bar 3 mm). Schureman's convention, as metrics.noaa_year_terms already uses for
SA / SSA / M1 / M3 (V0 at 00:00 UTC Jan 1, f and u at mid-year), reproduces NOAA to 0.14 mm (14-day) / 0.06 mm (29-day):
  MM:  V = s - p,          u = 0,                  f = (2/3 - sin^2 I) / 0.5021          (Schureman formula 73)
  MF:  V = 2s,             u = -2 xi,              f = sin^2 I / 0.1578                  (formula 74)
  MSF: V = 2s - 2h,        u = -(2 xi - 2 nu),     f = f(M2) = cos^4(I/2) / 0.9154       (the compound S2 - M2)
The Mm-type node factor for MSF left 0.87 mm; the compound form is NOAA's.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

LP3 = ("MM", "MF", "MSF")
SPEED = {"MM": 0.5443747, "MF": 1.0980331, "MSF": 1.0158958}


def year_terms(year):
    """{name: (f, V0 + u in degrees)} for MM, MF and MSF in NOAA's convention for one calendar year."""
    from metrics import schureman_astro, _nodal
    s, h, p, _ = schureman_astro(datetime(year, 1, 1, tzinfo=timezone.utc))
    _, _, _, n_mid = schureman_astro(datetime(year, 7, 2, 12, tzinfo=timezone.utc))
    i, nu, xi = _nodal(n_mid)
    f_mm = (2.0 / 3.0 - math.sin(i) ** 2) / 0.5021
    f_mf = math.sin(i) ** 2 / 0.1578
    f_m2 = math.cos(i / 2) ** 4 / 0.9154
    return {"MM": (f_mm, s - p), "MF": (f_mf, 2 * s - math.degrees(2 * xi)),
            "MSF": (f_m2, 2 * s - 2 * h - math.degrees(2 * xi - 2 * nu))}


def lp3(harcon, times):
    """The sum of the station's MM, MF and MSF at aware UTC datetimes. harcon rows: (num, name, amp_m, G_deg[, speed])."""
    rows = [(r[1], float(r[2]), float(r[3]), float(r[4]) if len(r) > 4 else SPEED[r[1]])
            for r in harcon or [] if r[1] in LP3 and float(r[2]) > 0]
    if not rows:
        return [0.0] * len(times)
    out, years = [], {}
    for t in times:
        if t.year not in years:
            years[t.year] = (year_terms(t.year), datetime(t.year, 1, 1, tzinfo=timezone.utc))
        yt, t0 = years[t.year]
        hrs = (t - t0).total_seconds() / 3600.0
        out.append(sum(yt[n][0] * a * math.cos(math.radians(sp * hrs + yt[n][1] - g)) for n, a, g, sp in rows))
    return out
