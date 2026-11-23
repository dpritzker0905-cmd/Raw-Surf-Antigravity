"""wind_lr2_clim.py - the climatology field CLIM for the long-range wind v2 registration. Serves nothing.

Amendment 2 (supersedes amendment 1 A2; ERA5 is not used): CLIM is built from Copernicus Marine
WIND_GLO_PHY_L4_MY_012_006 (hourly 0.125 deg stress-equivalent wind, ERA5 bias-corrected with scatterometers), the
calendar years 2008-2025, at the 00/06/12/18 UTC hours, with the registered day-of-year +-15 d window. The table is
[365 days of year, 4 hours, stations] for the mean eastward wind `u`, mean northward wind `v` and the MEAN SPEED `s`
(the mean of hourly speeds, not the length of the mean vector). A station with no valid ocean cell within 25 km has NaN
and is dropped from every CLIM-dependent line, reported, never filled. Building it (`wind_lr2_cmems.py`) is CI-only.
"""
from datetime import datetime
from typing import Dict, List

import numpy as np

HOURS = (0, 6, 12, 18)
PERIOD = (2008, 2025)            # fixed now: the full calendar years of the hourly 0.125 deg dataset (2007 and 2026 partial)
WINDOW_DAYS = 15                 # the registered +-15 d window
DOI = "https://doi.org/10.48670/moi-00185"
ATTRIBUTION = f"E.U. Copernicus Marine Service Information; {DOI}"
DATASET = "cmems_obs-wind_glo_phy_my_l4_0.125deg_PT1H"
PRODUCT = "WIND_GLO_PHY_L4_MY_012_006"
# what the product's wind IS (its own description: "stress-equivalent wind"): an equivalent-neutral 10 m wind, which differs
# from the actual 10 m wind by a few tenths of m/s under stable or unstable air. CLIM_SERVE is served raw, so its label says it.
VARIABLE_MEANING = "stress-equivalent (equivalent-neutral) 10 m wind, not the actual 10 m wind"


def doy_index(valid: datetime) -> int:
    """0-based day-of-year slot 0..364. Feb 29 uses Feb 28's slot (leap-day samples are dropped at build time)."""
    if valid.month == 2 and valid.day == 29:
        return 58
    d = valid.timetuple().tm_yday
    return (d - 2 if (valid.year % 4 == 0 and valid.month > 2) else d - 1)


def clim_value(table: np.ndarray, valid: datetime) -> np.ndarray:
    """table: [365, 4, ...]; the value at `valid` (a 6-hourly UTC hour)."""
    if valid.hour not in HOURS:
        raise ValueError(f"CLIM exists at {HOURS} UTC only, not {valid.hour}")
    return table[doy_index(valid), HOURS.index(valid.hour)]


def clim_vector(fields: Dict[str, np.ndarray], valid: datetime):
    """(c_u, c_v, c_s) over stations at `valid`. c_s is the mean SPEED."""
    return clim_value(fields["u"], valid), clim_value(fields["v"], valid), clim_value(fields["s"], valid)


def check_fields(fields: Dict[str, np.ndarray]) -> List[str]:
    """Guard on a built climatology: shapes, finite where a station has a cell, speed >= |mean vector| (Jensen).
    NaN is allowed ONLY as a whole station (no ocean cell within 25 km), never partially."""
    bad = []
    for k in ("u", "v", "s"):
        if k not in fields:
            bad.append(f"missing {k}")
            continue
        if fields[k].ndim != 3 or fields[k].shape[:2] != (365, 4):
            bad.append(f"{k} shape {fields[k].shape}")
    if bad:
        return bad
    has = np.isfinite(fields["s"]).any(axis=(0, 1))
    for k in ("u", "v", "s"):
        part = np.isfinite(fields[k]).all(axis=(0, 1))
        if not np.array_equal(part, has):
            bad.append(f"{k} is partially NaN for some station")
    if not bad:
        mag = np.hypot(fields["u"][..., has], fields["v"][..., has])
        if np.any(fields["s"][..., has] + 1e-6 < mag):
            bad.append("mean speed below the mean vector magnitude somewhere")
    return bad


def stations_without_clim(fields: Dict[str, np.ndarray]) -> List[int]:
    return [int(i) for i in np.where(~np.isfinite(fields["s"]).any(axis=(0, 1)))[0]]
