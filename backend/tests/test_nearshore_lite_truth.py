"""MOP-lite buoy truth: NDBC parse, the registered station rules, the sheltered window, presence, snapshots. No network."""
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline.nearshore_lite import truth

SAMPLE = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2027 01 16 12 00 270  5.0  6.0   1.20  10.0   7.5 280 1015.0  15.0  16.0  MM   MM   MM   MM
2027 01 16 11 30 270  5.0  6.0   1.10  10.0   7.5 281 1015.0  15.0  16.0  MM   MM   MM   MM
2027 01 16 11 00 MM   MM   MM    MM    MM    MM  MM  1015.0  15.0  16.0  MM   MM   MM   MM
2027 01 16 10 00 270  5.0  6.0   99.00 10.0   7.5 999 1015.0  15.0  16.0  MM   MM   MM   MM
"""


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def test_parse_reads_hs_tp_dir_and_drops_missing_sentinels():
    rows = truth.parse_ndbc_stdmet(SAMPLE)
    assert len(rows) == 4
    assert rows[0] == {"time": utc(2027, 1, 16, 12), "hs_m": 1.2, "tp_s": 10.0, "dir_deg": 280.0}
    assert rows[2]["hs_m"] is None and rows[2]["dir_deg"] is None                 # MM
    assert rows[3]["hs_m"] is None and rows[3]["dir_deg"] is None                 # 99.00 / 999 sentinels


def test_a_file_without_a_header_is_refused():
    with pytest.raises(ValueError):
        truth.parse_ndbc_stdmet("2027 01 16 12 00 1 2 3\n")


def test_nearest_observation_within_half_an_hour():
    rows = truth.parse_ndbc_stdmet(SAMPLE)
    assert truth.at_hour(rows, utc(2027, 1, 16, 12, 10))["hs_m"] == 1.2
    assert truth.at_hour(rows, utc(2027, 1, 16, 9, 0)) is None


def test_presence_counts_usable_hs_hours():
    rows = truth.parse_ndbc_stdmet(SAMPLE)
    hours = [utc(2027, 1, 16, 12), utc(2027, 1, 16, 11, 30), utc(2027, 1, 16, 11, 0), utc(2027, 1, 16, 10, 0)]
    assert truth.presence(rows, hours) == pytest.approx(0.5)
    assert truth.presence(rows, []) == 0.0 and truth.MIN_PRESENCE == 0.70


def _c(**kw):
    c = {"id": "s", "owner": "NDBC", "source": "NDBC", "depth_m": 25.0, "directional": True, "lat": 33.0, "lon": -118.0,
         "assimilated_into_model": False, "harbour_unresolved_within_1km": False}
    c.update(kw)
    return c


def test_only_the_registered_rules_decide_membership():
    cat = [_c(id="ok1"), _c(id="ok2", source="CDIP", owner="CDIP"), _c(id="shallow", depth_m=8.0), _c(id="deep", depth_m=60.0),
           _c(id="nondir", directional=False), _c(id="duck", owner="USACE-FRF"), _c(id="assim", assimilated_into_model=True),
           _c(id="harbour", harbour_unresolved_within_1km=True), _c(id="nodepth", depth_m=None)]
    kept, dropped = truth.select_stations(cat)
    assert [k["id"] for k in kept] == ["ok1", "ok2"]
    assert {d["id"] for d in dropped} == {"shallow", "deep", "nondir", "duck", "assim", "harbour", "nodepth"}
    assert [k["exam_only"] for k in kept] == [False, True]                           # CDIP is EXAM ONLY
    assert any("FRF" in w for d in dropped if d["id"] == "duck" for w in d["why"])


def test_the_selection_never_reads_skill():
    import inspect
    src = inspect.getsource(truth.select_stations)
    assert "rmse" not in src.lower() and "skill" not in src.lower().replace("no skill", "")


def _open_ocean(lat, lon):
    return 200.0


def _bay_open_to_the_west(lat, lon):
    """Deep water only WEST of the station (lon < -118.0); land/shallow elsewhere: a ~180 deg window to the west."""
    return 200.0 if lon < -118.0 + 1e-9 else 5.0


def _pocket(lat, lon):
    """Deep water only in a narrow wedge toward the south-west (bearings ~ 200-250 deg)."""
    import math
    dy, dx = lat - 33.0, (lon + 118.0) * math.cos(math.radians(33.0))
    brg = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0
    return 200.0 if 200.0 <= brg <= 250.0 else 5.0


def test_open_window_is_the_arc_with_a_clear_50_km_line():
    assert truth.open_window_deg(_open_ocean, 33.0, -118.0) == 360.0
    w = truth.open_window_deg(_bay_open_to_the_west, 33.0, -118.0)
    assert 170.0 <= w <= 190.0
    p = truth.open_window_deg(_pocket, 33.0, -118.0)
    assert 40.0 <= p <= 60.0 and truth.is_sheltered(_pocket, 33.0, -118.0)
    assert not truth.is_sheltered(_bay_open_to_the_west, 33.0, -118.0)


def test_land_or_unknown_depth_blocks_a_bearing():
    assert truth.open_window_deg(lambda la, lo: None, 33.0, -118.0) == 0.0


def test_snapshot_is_hashed_and_immutable(tmp_path):
    p, h = truth.snapshot(str(tmp_path), "46086", "2027-01-16T12:00Z", SAMPLE)
    assert len(h) == 64 and (tmp_path / "SHA256SUMS").read_text().strip().endswith("46086_20270116T1200Z.txt")
    with pytest.raises(FileExistsError):
        truth.snapshot(str(tmp_path), "46086", "2027-01-16T12:00Z", SAMPLE)


def test_fetch_goes_through_the_injected_opener_on_the_ndbc_host_only():
    seen = []
    assert truth.fetch_realtime("46086", lambda u: seen.append(u) or SAMPLE) == SAMPLE
    assert seen == ["https://www.ndbc.noaa.gov/data/realtime2/46086.txt"]
