"""M1-0 parity rules, fixed before any run (numpy only, no I/O; tests/test_tide_cmems.py). See parity_probe.py."""
import math

import numpy as np

DATASET = "cmems_mod_glo_phy_anfc_merged-sl_PT1H-i"
VARIABLES = ("total_sea_level", "ocean_tide", "sea_surface_height", "invert_barometer", "tide_loading")
BOX = 0.15                               # degrees around the key (>= one 1/12-degree cell each way)
HINDCAST_H = 48                          # gating pairs: the 48 hours before the run's 00Z
FORECAST_H = 96                          # reported: the 96 hours from the run's 00Z
LINE_M = 0.01
QUANTILE = 99
MIN_PAIR_SHARE = 0.90
# Fixed 2026-11-18 before any value: 10 US keys (gauges and breaks) + 10 surf spots worldwide, as 0.1-degree served keys.
HELD_KEYS = ((21.3, -157.9), (21.7, -158.1), (32.9, -117.3), (33.4, -117.6), (36.6, -121.9), (37.5, -122.5),
             (32.8, -79.9), (36.2, -75.7), (39.4, -74.4), (25.8, -80.1),
             (-34.0, 24.9), (43.7, -1.4), (39.6, -9.1), (-17.9, -149.3), (-8.8, 115.1), (-28.2, 153.6),
             (15.9, -97.1), (43.4, -2.7), (-37.8, 174.8), (58.6, -3.5))
PRIMARY = "total_sea_level@nearest"
CANDIDATES = {                           # name: (cell, summed variables); only PRIMARY gates
    PRIMARY: ("nearest", ("total_sea_level",)),
    "total_sea_level@nearest_wet": ("nearest_wet", ("total_sea_level",)),
    "tide+ssh@nearest": ("nearest", ("ocean_tide", "sea_surface_height")),
    "tide+ssh+ib@nearest": ("nearest", ("ocean_tide", "sea_surface_height", "invert_barometer")),
    "tide_only@nearest": ("nearest", ("ocean_tide",)),
}
RULE_TEXT = (f"PASS iff p{QUANTILE} |CMEMS {PRIMARY} - Open-Meteo sea_level_height_msl| <= {LINE_M} m over the "
             f"{HINDCAST_H} h before the run's 00Z at the {len(HELD_KEYS)} held keys, with >= {MIN_PAIR_SHARE:.0%} of "
             "pairs present; other candidates and forecast hours are reported only")


def nearest_cell(lats, lons, key):
    """(iy, ix) of the grid cell nearest the key on a regular lat/lon grid (longitude wrapped)."""
    lats, lons = np.asarray(lats, float), np.asarray(lons, float)
    if lats.size == 0 or lons.size == 0:
        return None
    iy = int(np.argmin(np.abs(lats - key[0])))
    ix = int(np.argmin(np.abs(((lons - key[1] + 180.0) % 360.0) - 180.0)))
    return iy, ix


def nearest_wet_cell(lats, lons, key, wet):
    """(iy, ix) of the nearest cell where `wet` (lat x lon bool) is True, by equirectangular distance; None if none."""
    lats, lons, wet = np.asarray(lats, float), np.asarray(lons, float), np.asarray(wet, bool)
    if not wet.any():
        return None
    dy = (lats[:, None] - key[0])
    dx = (((lons[None, :] - key[1] + 180.0) % 360.0) - 180.0) * math.cos(math.radians(key[0]))
    d = np.where(wet, np.hypot(dy, dx), np.inf)
    iy, ix = np.unravel_index(int(np.argmin(d)), d.shape)
    return int(iy), int(ix)


def combine(cell, terms):
    """The sum of the named variables' series at one cell (NaN wherever any term is NaN)."""
    out = None
    for t in terms:
        v = np.asarray(cell[t], float)
        out = v.copy() if out is None else out + v
    return out


def stats(diffs):
    d = np.asarray([x for x in diffs if np.isfinite(x)], float)
    if d.size == 0:
        return {"n": 0}
    return {"n": int(d.size), "median_m": round(float(np.median(d)), 4),
            f"p{QUANTILE}_m": round(float(np.percentile(d, QUANTILE)), 4), "max_m": round(float(d.max()), 4)}


def verdict(primary_hindcast_diffs, expected_pairs):
    d = [x for x in primary_hindcast_diffs if np.isfinite(x)]
    if expected_pairs <= 0 or len(d) < MIN_PAIR_SHARE * expected_pairs:
        return "NOT ENOUGH PAIRS"
    return "PASS" if float(np.percentile(d, QUANTILE)) <= LINE_M else "MISS"
