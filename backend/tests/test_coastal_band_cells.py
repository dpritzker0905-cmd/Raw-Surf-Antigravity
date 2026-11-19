"""The world coastal band: which 0.25 degree cells it is, and the logging-only census on a model's own field.

Owner, 2026-11-18: "Cover with agency data, start the coastal band" (D-082). This is the definition and its count;
nothing stores, serves or reads the band yet. What these pin:

  1. the cell counts at each candidate width, from the repo's own ETOPO grid (a change of the grid or the rule shows);
  2. the rule itself on a hand-built grid: ocean only, land within `width` cells, longitude wraps, latitude does not;
  3. the census re-indexes a model field given north-first rows and 0..360 longitudes (the GFS layout) and counts the
     band cells with no value; a field that is not on the lattice is refused, not miscounted;
  4. the fetcher hook can not cost a pass: it never raises, it writes to stderr, and the kill switch does no work.
"""
import io
import os
import sys

import numpy as np
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import _coastal_band as B  # noqa: E402


def test_the_band_sizes_from_the_repo_etopo_grid():
    """Counted 2026-11-18. Between 60S and 72N: one cell 20,959; two cells 38,504; three cells 54,243."""
    ocean = B.ocean_grid()
    assert ocean.shape == (B.ROWS, B.COLS)
    assert [int(B.band_mask(w, ocean=ocean).sum()) for w in B.WIDTHS] == [20959, 38504, 54243]


def test_the_band_is_ocean_only_and_nested():
    ocean = B.ocean_grid()
    b1, b2, b3 = (B.band_mask(w, ocean=ocean) for w in B.WIDTHS)
    assert not (b1 & ~ocean).any() and not (b3 & ~ocean).any()
    assert not (b1 & ~b2).any() and not (b2 & ~b3).any()            # a wider band contains a narrower one
    lats = B.lattice_lats()
    assert not b3[(lats < B.LAT_MIN) | (lats > B.LAT_MAX)].any()


def _toy(rows=9, cols=12):
    """All ocean, one land cell at row 4, col 0 (so its neighbourhood crosses the date line)."""
    ocean = np.ones((rows, cols), dtype=bool)
    ocean[4, 0] = False
    return ocean


def test_the_rule_on_a_hand_built_grid_longitude_wraps():
    ocean = _toy()
    band = B.band_mask(1, ocean=ocean, lat_min=-90.0, lat_max=90.0)
    want = {(r, c) for r in (3, 4, 5) for c in (11, 0, 1)} - {(4, 0)}   # the 3x3 round the land cell, wrapped, minus land
    assert {(int(r), int(c)) for r, c in zip(*np.nonzero(band))} == want
    assert int(B.band_mask(2, ocean=ocean, lat_min=-90.0, lat_max=90.0).sum()) == 24


def test_latitude_does_not_wrap():
    ocean = np.ones((9, 12), dtype=bool)
    ocean[0, 5] = False                                               # land on the southernmost row
    band = B.band_mask(1, ocean=ocean, lat_min=-90.0, lat_max=90.0)
    assert band[1, 4:7].all() and not band[8].any()                   # the northernmost row is not its neighbour


def test_the_latitude_limits_cut_the_band():
    ocean = _toy(rows=B.ROWS, cols=B.COLS)                            # land at lat -89 (row 4): poleward of LAT_MIN
    assert int(B.band_mask(1, ocean=ocean).sum()) == 0


def test_a_width_below_one_is_refused():
    with pytest.raises(ValueError):
        B.band_mask(0, ocean=_toy())


def _gfs_axes():
    return 90.0 - B.STEP * np.arange(B.ROWS), B.STEP * np.arange(B.COLS)      # north first, 0..359.75


def test_the_census_reads_a_north_first_0_360_field_and_counts_missing_band_cells():
    ocean = B.ocean_grid()
    lat1d, lon1d = _gfs_axes()
    band = B.band_mask(1, ocean=ocean)
    r, c = (int(x[0]) for x in np.nonzero(band))                      # one band cell on the lattice
    lat, lon = B.lattice_lats()[r], B.lattice_lons()[c]
    valid = np.ones((B.ROWS, B.COLS), dtype=bool)                     # a model with a value everywhere ...
    mr = int(np.abs(lat1d - lat).argmin())
    mc = int(np.abs(lon1d - (lon % 360.0)).argmin())
    valid[mr, mc] = False                                             # ... except at that one cell, in ITS layout
    got = B.census(valid, lat1d, lon1d, ocean=ocean)
    assert got == {1: (20959, 1), 2: (38504, 1), 3: (54243, 1)}
    assert B.census(np.ones_like(valid), lat1d, lon1d, ocean=ocean)[2] == (38504, 0)


def test_a_field_on_another_grid_is_refused_not_miscounted():
    lat1d = 90.0 - 0.5 * np.arange(361)
    lon1d = 0.5 * np.arange(720)
    assert B.census(np.ones((361, 720), dtype=bool), lat1d, lon1d, ocean=_toy(B.ROWS, B.COLS)) is None
    assert "not on the 0.25 degree lattice" in B.census_line("GFS", "waves", None)


def test_the_log_line_carries_counts_and_shares_only():
    line = B.census_line("GFS", "waves", {1: (200, 10), 2: (400, 30)})
    assert line == ("[coastal-band census] GFS waves, band cells on the model's own field: "
                    "width 1: 200 cells, 10 with no value (5.0%); width 2: 400 cells, 30 with no value (7.5%)")


def test_the_hook_never_raises_and_writes_to_the_stream(monkeypatch):
    monkeypatch.delenv(B.CENSUS_FLAG, raising=False)
    out = io.StringIO()
    line = B.log_census("GFS", "waves", "not an array", [1, 2], [3, 4], stream=out)     # a broken call
    assert line.startswith("[coastal-band census] GFS waves: skipped (") and out.getvalue() == line + "\n"
    lat1d, lon1d = _gfs_axes()
    field = np.full((B.ROWS, B.COLS), 1.5)
    field[0, 0] = np.nan
    out = io.StringIO()
    assert "width 2: 38504 cells" in B.log_census("GFS", "waves", field, lat1d, lon1d, stream=out)


def test_the_kill_switch_does_no_work(monkeypatch):
    monkeypatch.setenv(B.CENSUS_FLAG, "0")
    monkeypatch.setattr(B, "census", lambda *a, **k: (_ for _ in ()).throw(AssertionError("census ran")))
    out = io.StringIO()
    assert B.log_census("GFS", "waves", np.zeros((2, 2)), [0, 1], [0, 1], stream=out) is None
    assert out.getvalue() == ""


def test_the_gfs_fetcher_calls_the_census_once_by_the_sibling_import():
    """The fetcher is spawned by path: the sibling import first, the package import only as the fallback."""
    src = open(os.path.join(BACKEND, "services", "noaa_gfs_wave_fetcher.py"), encoding="utf-8").read()
    assert src.count('log_census("GFS", "waves", arrs["wave_height"], lat1d, lon1d)') == 1
    assert "from _coastal_band import log_census" in src and "from services._coastal_band import log_census" in src
    assert src.index("from _coastal_band import log_census") < src.index("from services._coastal_band import log_census")
