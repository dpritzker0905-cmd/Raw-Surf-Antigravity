"""GFS precipitation raster frames (2026-11-12): the amount that fell in the step BEFORE a forecast hour, mm/h, from NCEP's APCP
bucket totals. Real-cycle check (2026-11-12 12Z, f007 / f008 / f126): within 0.09 mm/h of NCEP's own PRATE mean for the same
step (docs/weather-program/log/2026-11-12-fable-precip-own-frames.md)."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

CYCLE = datetime(2026, 11, 12, 12, tzinfo=timezone.utc)
SPEC = fsr.SPECS["precipitation"]
IDX_F007 = """592:480000000:d=2026111212:CPRAT:surface:7 hour fcst:
593:480500000:d=2026111212:PRATE:surface:7 hour fcst:
594:481000000:d=2026111212:CPRAT:surface:6-7 hour ave fcst:
595:481500000:d=2026111212:PRATE:surface:6-7 hour ave fcst:
596:482000000:d=2026111212:APCP:surface:6-7 hour acc fcst:
597:482600000:d=2026111212:APCP:surface:0-7 hour acc fcst:
598:483200000:d=2026111212:ACPCP:surface:6-7 hour acc fcst:
599:483700000:d=2026111212:ACPCP:surface:0-7 hour acc fcst:
"""


def test_hours_are_hourly_to_f120_then_three_hourly_with_no_f000():
    h = fsr.PRECIP_HOURS
    assert len(h) == 192 and h[0] == 1 and h[119] == 120 and h[120] == 123 and h[-1] == 336
    assert {b - a for a, b in zip(h, h[1:])} == {1, 3}


def test_the_step_before_an_hour_and_its_six_hour_bucket():
    # (bucket start, previous hour): f007 is its bucket's first step (nothing to subtract), f012 its last
    assert [fsr.precip_step(f) for f in (1, 2, 6, 7, 12, 13, 120)] == [(0, 0), (0, 1), (0, 5), (6, 6), (6, 11), (12, 12), (114, 119)]
    assert [fsr.precip_step(f) for f in (123, 126, 129, 336)] == [(120, 120), (120, 123), (126, 126), (330, 333)]
    for f in fsr.PRECIP_HOURS:
        bucket, prev = fsr.precip_step(f)
        assert bucket <= prev < f <= bucket + 6
    with pytest.raises(ValueError):
        fsr.precip_step(0)


def test_the_bucket_total_is_picked_by_its_exact_time_and_never_the_run_total():
    rows = fsr.idx_rows(IDX_F007)
    assert fsr.select_timed(rows, ("APCP", "surface"), "6-7 hour acc fcst") == (482000000, 482599999)
    assert fsr.select_timed(rows, ("APCP", "surface"), "0-7 hour acc fcst") == (482600000, 483199999)
    assert fsr.select_timed(rows, ("APCP", "surface"), "6-8 hour acc fcst") is None
    assert fsr.select_message(rows, ("APCP", "surface")) is None          # the instantaneous selector never takes a total


class _Totals(fsr.GfsPrecipSource):
    """The source with its byte-range read replaced: bucket totals from a table, the asks recorded."""

    def __init__(self, totals):
        self.spec, self.totals, self.asked = SPEC, totals, []

    def _total(self, cycle, f, bucket):
        self.asked.append((f, bucket))
        return np.array(self.totals[(f, bucket)], dtype=float)


def test_a_step_is_this_total_minus_the_previous_one_and_noise_below_zero_is_zero():
    src = _Totals({(7, 6): [2.0, 0.0, np.nan], (8, 6): [2.5, 0.0, np.nan], (9, 6): [2.4999, 4.0, 1.0]})
    assert np.array_equal(src.fetch(CYCLE, 7), [2.0, 0.0, np.nan], equal_nan=True) and src.asked == [(7, 6)]   # a bucket's first step
    assert np.allclose(src.fetch(CYCLE, 8), [0.5, 0.0, np.nan], equal_nan=True) and src.asked[1:] == [(8, 6), (7, 6)]
    got = src.fetch(CYCLE, 9)
    assert got[0] == 0.0 and got[1] == 4.0 and np.isnan(got[2])            # -0.0001 mm is packing noise, never negative rain


def test_past_f120_a_step_is_three_hours_and_the_frame_is_their_mean_rate():
    src = _Totals({(123, 120): [6.0], (126, 120): [15.0], (129, 126): [0.3]})
    assert src.fetch(CYCLE, 123)[0] == pytest.approx(2.0)                  # 6 mm in 120-123 h
    assert src.fetch(CYCLE, 126)[0] == pytest.approx(3.0)                  # 15 - 6 mm in 123-126 h
    assert src.fetch(CYCLE, 129)[0] == pytest.approx(0.1)


class _Rain:
    """A whole-grid mm/h field per hour (GRIB order), one impossible value in it."""

    def __init__(self):
        self.fetched = []

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://example.invalid/gfs.t12z.pgrb2.0p25.f{f:03d}"

    def fetch(self, cycle, f):
        self.fetched.append(f)
        lat, lon = np.meshgrid(90.0 - 0.25 * np.arange(721), 0.25 * np.arange(1440), indexing="ij")
        a = np.maximum(0.0, 8.0 * np.sin(np.radians(lat * 3 + f)) * np.cos(np.radians(lon * 2)) - 4.0)
        a[100, 100] = 900.0                                               # above any real hourly rate: must become no data
        return a


def test_the_set_publishes_mm_per_hour_frames_on_the_quarter_degree_grid(tmp_path, monkeypatch):
    monkeypatch.delenv("FRAME_MIN_COVERAGE", raising=False)
    spec = dict(SPEC, hours=(1, 2, 7, 123))
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(_Rain(), sink, pub._uploader(sink), log=lambda *_: None, spec=spec)
    assert (report["status"], report["built"], report["missing_nodes"]) == ("published", 4, 4)
    key = "GFS/weather/precipitation/global_0p25"
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"][key]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["common_meta"]["value_unit"] == "mm/h" and index["common_meta"]["value_kind"] == "precipitation_rate"
    assert (index["grid"]["cols"], index["grid"]["rows"]) == (1440, 721) and index["credit"].startswith("Contains modified NOAA GFS data")
    assert [f["source"]["forecast_hour"] for f in index["frames"]] == [1, 2, 7, 123]
    frame = (tmp_path / index["frames"][2]["path"]).read_bytes()
    head = fb.decode_frame(frame)
    assert head["field_mask"] == 1 << fb.PRECIP_MM_H
    got = fb.decode_plane(frame)[1][fb.PRECIP_MM_H]
    want = fsr.to_frame_plane(_Rain().fetch(CYCLE, 7), SPEC["valid"], SPEC["clip"], 1)
    assert np.isnan(want).sum() == 1 and np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) <= 0.005 + 1e-9 and np.nanmin(got) == 0.0


def test_the_set_is_off_until_its_variable_is_one(monkeypatch):
    monkeypatch.delenv("FRAME_RASTER_PRECIP", raising=False)
    assert fsr.enabled("precipitation") is False
    monkeypatch.setenv("FRAME_RASTER_PRECIP", "1")
    assert fsr.enabled("precipitation") is True
    assert isinstance(fsr.make_source(SPEC, session=object()), fsr.GfsPrecipSource)


# ── EURO: ECMWF IFS open data `tp`, the total since the run began (2026-11-12) ───────────────────────────────────────────────
# Real-cycle check (2026-11-12 12Z, f003 / f006 / f150): world mean 0.101 / 0.105 / 0.113 mm/h (GFS, same windows: 0.094 / 0.098),
# pattern correlation with GFS 0.54 / 0.53 (docs/weather-program/log/2026-11-12-fable-precip-euro.md).
from services import frame_set_raster_sources as srcs  # noqa: E402

EURO = fsr.SPECS["precipitation_euro"]


def test_euro_hours_are_three_hourly_to_144_then_six_hourly_with_no_step_zero():
    h = EURO["hours"]
    assert len(h) == 64 and h[0] == 3 and h[47] == 144 and h[48] == 150 and h[-1] == 240
    assert {b - a for a, b in zip(h, h[1:])} == {3, 6}
    src = srcs.EcmwfPrecipSource(EURO, session=object())
    assert [src.previous(f) for f in (3, 6, 144, 150, 240)] == [0, 3, 141, 144, 234]


def test_euro_a_step_is_this_total_minus_the_previous_one_as_a_mean_rate(monkeypatch):
    totals = {3: [0.6, 0.0, np.nan], 6: [0.9, 0.0, np.nan], 9: [0.8999, 3.0, 1.0], 144: [10.0, 0.0, 0.0], 150: [22.0, 0.0, 0.0]}
    asked = []

    def fake_total(self, cycle, f):
        asked.append(f)
        return np.array(totals[f], dtype=float)
    monkeypatch.setattr(srcs.EcmwfOpenDataSource, "fetch", fake_total)
    src = srcs.EcmwfPrecipSource(EURO, session=object())
    assert np.allclose(src.fetch(CYCLE, 3), [0.2, 0.0, np.nan], equal_nan=True) and asked == [3]      # the first step: its total alone
    assert np.allclose(src.fetch(CYCLE, 6), [0.1, 0.0, np.nan], equal_nan=True) and asked[1:] == [6, 3]
    got = src.fetch(CYCLE, 9)
    assert got[0] == 0.0 and got[1] == pytest.approx(1.0) and np.isnan(got[2])                           # packing noise is never negative rain
    assert src.fetch(CYCLE, 150)[0] == pytest.approx(2.0)                                                # 12 mm in the 6 h after 144 h


def test_euro_an_accumulation_message_is_accepted_by_its_window_and_the_spec_converts_metres():
    src = srcs.EcmwfPrecipSource(EURO, session=object())
    assert src._steps_for(6) == ("6", "0-6")
    assert srcs.EcmwfOpenDataSource(fsr.SPECS["pressure_euro"], session=object())._steps_for(6) == ("6",)   # an instant stays strict
    assert EURO["convert"](np.array([0.0015]))[0] == pytest.approx(1.5)                                  # metres of water -> mm
    assert EURO["idx"] == ("tp", "sfc") and EURO["field"] == fb.PRECIP_MM_H and EURO["grid"] == "0p25"
    assert fs.set_key(EURO["target"]) == "EURO/weather/precipitation/global_0p25"
    assert "ECMWF" in EURO["credit"] and "CC BY 4.0" in EURO["license"]


def test_euro_set_is_off_until_its_variable_is_one_and_the_workflow_has_its_step(monkeypatch):
    monkeypatch.delenv("FRAME_RASTER_PRECIP_EURO", raising=False)
    assert fsr.enabled("precipitation_euro") is False
    monkeypatch.setenv("FRAME_RASTER_PRECIP_EURO", "1")
    assert fsr.enabled("precipitation_euro") is True
    assert isinstance(fsr.make_source(EURO, session=object()), srcs.EcmwfPrecipSource)
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    assert "vars.FRAME_RASTER_PRECIP_EURO == '1'" in wf and "--set precipitation_euro" in wf
    assert "vars.FRAME_RASTER_PRECIP == '1'" in wf and "--set precipitation\n" in wf


# ── ICON: DWD ICON global TOT_PREC, the total since the run began, box-averaged onto the 0.25-degree grid (2026-11-13) ────────
# Real-cycle check (2026-11-13 00Z, f006 / f024 / f081): no missing node; world mean on the lattice 0.126 / 0.121 / 0.131 mm/h
# against 0.125 / 0.120 / 0.130 over the native cells (+0.9 to +1.1 %); pattern correlation with GFS at f006 0.55
# (docs/weather-program/log/2026-11-13-fable-precip-icon.md).
ICON_RAIN = fsr.SPECS["precipitation_icon"]
QUARTER = (721, 1440)


def test_icon_hours_are_hourly_to_78_then_three_hourly_to_180_with_no_hour_zero():
    h = ICON_RAIN["hours"]
    assert len(h) == 112 and h[0] == 1 and h[77] == 78 and h[78] == 81 and h[-1] == 180
    assert {b - a for a, b in zip(h, h[1:])} == {1, 3}
    src = srcs.IconPrecipSource(ICON_RAIN, session=object())
    assert [src.previous(f) for f in (1, 2, 78, 81, 180)] == [0, 1, 77, 78, 177]
    assert src.lattice() == QUARTER


def test_icon_a_quarter_degree_node_is_the_mean_of_the_cells_in_its_box():
    # three cells round to the node at (10.00 N, 20.00 E), one to its eastern neighbour, one sits on the date line
    clat = np.array([10.05, 9.95, 10.10, 10.00, 0.0])
    clon = np.array([20.02, 19.90, 20.10, 20.25, 179.95])
    node, counts = srcs.box_assignment(clat, clon, QUARTER)
    r, c = (10 + 90) * 4, (20 + 180) * 4
    assert list(node[:4]) == [r * 1440 + c] * 3 + [r * 1440 + c + 1] and counts[r * 1440 + c] == 3
    assert node[4] == 360 * 1440 + 0                                    # 179.95 E rounds to 180 = the first column (180 W)
    plane = srcs.box_mean(np.array([3.0, 0.0, 6.0, 8.0, 1.0]), node, counts, QUARTER)
    assert plane.shape == QUARTER and plane[r, c] == pytest.approx(3.0) and plane[r, c + 1] == pytest.approx(8.0)
    # the 0.5-degree default is unchanged: the same cells, the pressure set's lattice
    node5, _ = srcs.box_assignment(clat, clon)
    assert node5[0] == (10 + 90) * 2 * 720 + (20 + 180) * 2


def test_icon_the_box_mean_leaves_no_gap_where_a_box_or_a_whole_row_has_no_cell():
    rows, cols = 9, 16                                                  # a small global lattice: 22.5-degree boxes
    lat, lon = np.meshgrid(-90.0 + 22.5 * np.arange(rows), -180.0 + 22.5 * np.arange(cols), indexing="ij")
    keep = np.ones((rows, cols), dtype=bool)
    keep[0, :] = keep[-1, :] = False                                    # no cell at either pole
    keep[3, :] = False                                                  # a whole row with none
    keep[5, 2:5] = False                                                # a run of empty boxes in a row
    values = (lat + 100.0)[keep]
    node, counts = srcs.box_assignment(lat[keep], lon[keep], (rows, cols))
    plane = srcs.box_mean(values, node, counts, (rows, cols))
    assert np.isfinite(plane).all()
    assert np.allclose(plane[0], plane[1].mean()) and np.allclose(plane[-1], plane[-2].mean())
    assert np.allclose(plane[5], lat[5, 0] + 100.0)                     # interpolated along its own row
    assert np.allclose(plane[3], plane[2]) or np.allclose(plane[3], plane[4])   # the nearest row that has cells
    assert np.array_equal(plane[1], (lat + 100.0)[1])                   # rows that were whole are untouched


def test_icon_a_step_is_differenced_per_native_cell_then_averaged_as_a_mean_rate(monkeypatch):
    # four native cells: two in one box, two in another (the middle row of a 3 x 2 toy lattice stands in for the grid)
    totals = {1: [0.4, 0.0, 2.0, np.nan], 2: [1.0, 0.2, 1.9999, np.nan], 78: [5.0, 5.0, 5.0, 5.0], 81: [11.0, 5.0, 5.0, 8.0]}
    asked = []

    def fake_native(self, cycle, f, ncells):
        asked.append(f)
        return np.array(totals[f], dtype=float)
    monkeypatch.setattr(srcs.IconOpenDataSource, "_native", fake_native)
    node, counts = np.array([2, 2, 3, 3]), np.array([0, 0, 2, 2, 0, 0])
    monkeypatch.setattr(srcs.IconPrecipSource, "grid", lambda self, cycle: (node, counts, 4))
    monkeypatch.setattr(srcs.IconPrecipSource, "lattice", lambda self: (3, 2))
    src = srcs.IconPrecipSource(ICON_RAIN, session=object())
    got = src.fetch(CYCLE, 1)[1]
    assert asked == [1] and got[0] == pytest.approx(0.2) and got[1] == pytest.approx(2.0)   # the first hour: its total alone; NaN left out
    got = src.fetch(CYCLE, 2)[1]
    assert asked[1:] == [2, 1] and got[0] == pytest.approx(0.4)      # (0.6 + 0.2) / 2 cells, in the one hour
    assert got[1] == 0.0                                             # packing noise is never negative rain
    got = src.fetch(CYCLE, 81)[1]
    assert got[0] == pytest.approx(1.0) and got[1] == pytest.approx(0.5)   # 6 mm and 3 mm over 3 h, each averaged with a dry cell


def test_icon_set_is_dwd_tot_prec_on_the_quarter_degree_grid_and_off_until_its_variable_is_one(monkeypatch):
    assert ICON_RAIN["idx"] == ("tot_prec", ("TOT_PREC",)) and ICON_RAIN["field"] == fb.PRECIP_MM_H
    assert ICON_RAIN["grid"] == "0p25" and ICON_RAIN["frame_plane"] is True
    assert ICON_RAIN["convert"](np.array([1.5]))[0] == 1.5              # kg m-2 is mm
    assert fs.set_key(ICON_RAIN["target"]) == "ICON/weather/precipitation/global_0p25"
    assert "Deutscher Wetterdienst" in ICON_RAIN["credit"] and "box-averaged" in ICON_RAIN["credit"]
    src = srcs.IconPrecipSource(ICON_RAIN, session=object())
    assert src.url(CYCLE, 7).endswith("/12/tot_prec/icon_global_icosahedral_single-level_2026111212_007_TOT_PREC.grib2.bz2")
    monkeypatch.delenv("FRAME_RASTER_PRECIP_ICON", raising=False)
    assert fsr.enabled("precipitation_icon") is False
    monkeypatch.setenv("FRAME_RASTER_PRECIP_ICON", "1")
    assert fsr.enabled("precipitation_icon") is True
    assert isinstance(fsr.make_source(ICON_RAIN, session=object()), srcs.IconPrecipSource)
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    assert "vars.FRAME_RASTER_PRECIP_ICON == '1'" in wf and "--set precipitation_icon" in wf


class _IconRain:
    """A plane already on the 0.25-degree lattice (what IconPrecipSource.fetch returns), one impossible value in it."""

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://opendata.dwd.de/weather/nwp/icon/grib/12/tot_prec/x_{f:03d}_TOT_PREC.grib2.bz2"

    def fetch(self, cycle, f):
        lat, lon = np.meshgrid(-90.0 + 0.25 * np.arange(721), -180.0 + 0.25 * np.arange(1440), indexing="ij")
        a = np.maximum(0.0, 6.0 * np.sin(np.radians(lat * 3 + f)) * np.cos(np.radians(lon * 2)) - 3.0)
        a[200, 300] = 900.0
        return a


def test_the_icon_set_publishes_quarter_degree_mm_per_hour_frames_with_dwd_credit(tmp_path, monkeypatch):
    monkeypatch.delenv("FRAME_MIN_COVERAGE", raising=False)
    spec = dict(ICON_RAIN, hours=(1, 78, 81))
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(_IconRain(), sink, pub._uploader(sink), log=lambda *_: None, spec=spec)
    assert (report["status"], report["built"], report["missing_nodes"]) == ("published", 3, 3)
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["ICON/weather/precipitation/global_0p25"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert (index["grid"]["cols"], index["grid"]["rows"]) == (1440, 721) and index["common_meta"]["value_unit"] == "mm/h"
    assert index["credit"].startswith("Source: Deutscher Wetterdienst (DWD)")
    frame = (tmp_path / index["frames"][1]["path"]).read_bytes()
    got = fb.decode_plane(frame)[1][fb.PRECIP_MM_H]
    want = _IconRain().fetch(CYCLE, 78)
    assert np.isnan(got[200, 300]) and np.isnan(got).sum() == 1         # the impossible rate is no data, and only it
    want[200, 300] = np.nan
    assert np.nanmax(np.abs(got - want)) <= 0.005 + 1e-9                # the plane as given: no flip, no stride
