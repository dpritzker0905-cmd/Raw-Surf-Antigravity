"""EURO coarse `waves` GFS-fill (2026-07-22) — the ACTUAL Gulf/enclosed-sea/Antarctic fix. Both the
ECMWF-WAM and CMEMS coarse waves sources structurally mask enclosed seas + the Southern Ocean south of
~-60; NOAA GFS's mask carries those cells. fill_masked_waves_from_gfs fills the masked (NaN/None)
wave-height cells from the aligned GFS coarse grid, leaving open-ocean values untouched and leaving
true-land (GFS-also-masked) cells empty.
"""
import math
from services._fetch_common import fill_masked_waves_from_gfs


def _pt(lat, lon, times, heights, dirs=None, periods=None):
    return {
        "latitude": lat, "longitude": lon,
        "hourly": {
            "time": list(times),
            "wave_height": list(heights),
            "wave_direction": list(dirs if dirs is not None else [None] * len(times)),
            "wave_period": list(periods if periods is not None else [None] * len(times)),
        },
    }


T = ["2026-07-22T00:00", "2026-07-22T03:00", "2026-07-22T06:00"]


def test_fills_masked_gulf_cell_from_gfs():
    # EURO waves: Gulf cell (25,-90) is masked (NaN) at all hours; open-ocean cell (40,-30) is valid.
    waves = [
        _pt(25.0, -90.0, T, [float("nan"), None, float("nan")]),
        _pt(40.0, -30.0, T, [2.1, 2.2, 2.3]),
    ]
    # GFS carries the Gulf (0.5m) and the open ocean.
    gfs = [
        _pt(25.0, -90.0, T, [0.5, 0.52, 0.48], dirs=[180, 182, 179], periods=[7, 7, 6]),
        _pt(40.0, -30.0, T, [9.9, 9.9, 9.9]),
    ]
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 3, "all 3 masked Gulf hours filled"
    assert waves[0]["hourly"]["wave_height"] == [0.5, 0.52, 0.48], "Gulf filled from GFS"
    assert waves[0]["hourly"]["wave_direction"] == [180, 182, 179], "direction filled alongside"
    assert waves[0]["hourly"]["wave_period"] == [7, 7, 6], "period filled alongside"
    # open-ocean cell is UNTOUCHED (ECMWF/CMEMS value kept, NOT the GFS 9.9)
    assert waves[1]["hourly"]["wave_height"] == [2.1, 2.2, 2.3], "open ocean untouched"


def test_true_land_stays_masked():
    # Both EURO and GFS mask this cell (a genuine land cell) -> stays masked (nothing painted on land).
    waves = [_pt(45.0, 10.0, T, [float("nan"), float("nan"), float("nan")])]
    gfs = [_pt(45.0, 10.0, T, [None, float("nan"), None])]
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 0
    assert all(_h is None or (isinstance(_h, float) and math.isnan(_h))
               for _h in waves[0]["hourly"]["wave_height"]), "true-land cell left empty"


def test_partial_hours_filled_only_where_masked():
    # Cell valid at t0, masked at t1/t2 -> only t1/t2 filled; t0 (valid ECMWF) kept.
    waves = [_pt(-63.0, -100.0, T, [3.0, float("nan"), None])]  # Southern Ocean (Antarctic band)
    gfs = [_pt(-63.0, -100.0, T, [4.4, 4.5, 4.6])]
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 2
    assert waves[0]["hourly"]["wave_height"] == [3.0, 4.5, 4.6], "kept valid t0, filled masked t1/t2 (Antarctic restored)"


def test_time_value_matching_gfs_hourly_superset():
    # GFS is hourly (superset); waves 3-hourly. Fill must match by TIME VALUE, not index.
    waves = [_pt(25.0, -90.0, ["2026-07-22T06:00"], [float("nan")])]
    gfs_hourly_times = ["2026-07-22T00:00", "2026-07-22T01:00", "2026-07-22T02:00",
                        "2026-07-22T03:00", "2026-07-22T04:00", "2026-07-22T05:00", "2026-07-22T06:00"]
    gfs = [_pt(25.0, -90.0, gfs_hourly_times, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.77])]
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 1
    assert waves[0]["hourly"]["wave_height"] == [0.77], "matched T06:00 by value, not index 0"


def test_no_gfs_cell_leaves_masked():
    # GFS has no matching cell (grid mismatch / GFS fetch empty for that cell) -> left masked.
    waves = [_pt(25.0, -90.0, T, [float("nan"), float("nan"), float("nan")])]
    gfs = [_pt(30.0, -80.0, T, [1.0, 1.0, 1.0])]  # different cell
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 0
    assert all(math.isnan(h) for h in waves[0]["hourly"]["wave_height"])


def test_mismatched_time_formats_still_match():
    # PRODUCTION CONDITION: ECMWF/CMEMS waves times are aware ('...Z'); GFS via open-meteo is offset-naive
    # ('...T00:00'). Same instant, different string -> must still match (normalize to datetime, not string).
    waves = [_pt(25.0, -90.0, ["2026-07-22T06:00:00Z"], [float("nan")])]
    gfs = [_pt(25.0, -90.0, ["2026-07-22T06:00"], [0.55])]  # naive, no seconds, no Z — same instant
    n = fill_masked_waves_from_gfs(waves, gfs)
    assert n == 1, "aware-vs-naive same instant must match after normalization"
    assert waves[0]["hourly"]["wave_height"] == [0.55]

    # And a genuinely different instant must NOT match.
    waves2 = [_pt(25.0, -90.0, ["2026-07-22T06:00:00Z"], [float("nan")])]
    gfs2 = [_pt(25.0, -90.0, ["2026-07-22T09:00"], [0.55])]
    assert fill_masked_waves_from_gfs(waves2, gfs2) == 0, "different hour must not match"


def test_empty_inputs_are_safe():
    assert fill_masked_waves_from_gfs(None, [_pt(1, 1, T, [1, 1, 1])]) == 0
    assert fill_masked_waves_from_gfs([_pt(1, 1, T, [1, 1, 1])], None) == 0
    assert fill_masked_waves_from_gfs([], []) == 0
