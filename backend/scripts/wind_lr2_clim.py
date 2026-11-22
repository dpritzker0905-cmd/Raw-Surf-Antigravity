"""wind_lr2_clim.py - the climatology field CLIM for the long-range wind v2 registration. Serves nothing.

CLIM = seasonal climatology of 10 m u, v and speed by day of year and 6-hourly UTC hour from ERA5 (Copernicus C3S),
bilinear at the station. Amendment 1 fixes how it is built from the CDS product `reanalysis-era5-single-levels-monthly-
means` (`monthly_averaged_reanalysis_by_hour_of_day`, 1991-2020): the 30-year mean of each calendar month at each
UTC hour, placed at mid-month and interpolated linearly in day of year (circular). That replaces the registration's
"+-15 d window" with the same intent (a smooth seasonal mean) at a data cost of 12 x 24 fields per variable, not 30
years of hourly fields. The CDS request is built here; nothing is requested until the owner dispatches the freeze.
Credentials are read by environment-variable NAME (`CDS_API_KEY`) by the `cdsapi` client; never written anywhere.
Attribution (served basis label and tracked file): "Contains modified Copernicus Climate Change Service information".
"""
import math
from datetime import datetime
from typing import Dict, List

import numpy as np

ATTRIBUTION = "Contains modified Copernicus Climate Change Service information"
YEARS = [str(y) for y in range(1991, 2021)]
VARIABLES = ["10m_u_component_of_wind", "10m_v_component_of_wind", "10m_wind_speed"]
MID_DOY = [15.5, 45.0, 74.5, 105.0, 135.5, 166.0, 196.5, 227.5, 258.0, 288.5, 319.0, 349.5]   # mid-month, non-leap


def cds_request(variable: str) -> dict:
    """The CDS request body for one variable (all months, all hours, the 1991-2020 normal period)."""
    return {"product_type": "monthly_averaged_reanalysis_by_hour_of_day", "variable": [variable], "year": YEARS,
            "month": [f"{m:02d}" for m in range(1, 13)], "time": [f"{h:02d}:00" for h in range(24)],
            "data_format": "netcdf"}


def doy_weights(doy: float):
    """(month_a, month_b, w_b): linear interpolation between mid-month anchors, circular over the year."""
    d = float(doy)
    for i in range(12):
        a, b = MID_DOY[i], MID_DOY[(i + 1) % 12] + (365.0 if i == 11 else 0.0)
        dd = d + (365.0 if (i == 11 and d < MID_DOY[0]) else 0.0)
        if a <= dd <= b:
            return i, (i + 1) % 12, (dd - a) / (b - a)
    return 11, 0, 0.0


def clim_value(monthly: np.ndarray, valid: datetime) -> np.ndarray:
    """monthly: [12, 24, ...] 30-year means by month and UTC hour (any trailing shape, e.g. [nst]). The value at `valid`
    (UTC hour = the 6-hourly step's hour), linearly interpolated in day of year. Feb 29 counts as Feb 28 (doy 59)."""
    doy = min(valid.timetuple().tm_yday, 365) if not (valid.month == 2 and valid.day == 29) else 59
    a, b, w = doy_weights(doy)
    h = valid.hour
    return (1.0 - w) * monthly[a, h] + w * monthly[b, h]


def clim_vector(fields: Dict[str, np.ndarray], valid: datetime):
    """(c_u, c_v, c_s) at `valid` from {'u': [12,24,n], 'v': ..., 's': ...}. c_s is the mean SPEED (not |mean vector|)."""
    return clim_value(fields["u"], valid), clim_value(fields["v"], valid), clim_value(fields["s"], valid)


def check_fields(fields: Dict[str, np.ndarray]) -> List[str]:
    """Sanity guard on a built climatology (unit-tested): shapes, finiteness, speed >= |mean vector| (Jensen)."""
    bad = []
    for k in ("u", "v", "s"):
        if k not in fields:
            bad.append(f"missing {k}")
            continue
        if fields[k].shape[:2] != (12, 24):
            bad.append(f"{k} shape {fields[k].shape}")
        if not np.all(np.isfinite(fields[k])):
            bad.append(f"{k} has non-finite values")
    if not bad:
        mag = np.hypot(fields["u"], fields["v"])
        if np.any(fields["s"] + 1e-6 < mag):
            bad.append("mean speed below the mean vector magnitude somewhere")
    return bad


def seasonal_cycle_range(fields: Dict[str, np.ndarray]) -> float:
    """Max over stations of the annual range of mean speed at 00 UTC (a crude picture for the freeze log)."""
    s = fields["s"][:, 0, ...]
    return float(np.nanmax(np.nanmax(s, axis=0) - np.nanmin(s, axis=0))) if s.size else math.nan
