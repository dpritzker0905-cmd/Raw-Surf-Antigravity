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
    rows = truth.parse_ndbc_stdmet(SAMPLE)                      # the shared QC returns rows sorted by time, oldest first
    assert len(rows) == 4
    by = {r["time"]: r for r in rows}
    assert by[utc(2027, 1, 16, 12)] == {"time": utc(2027, 1, 16, 12), "hs_m": 1.2, "tp_s": 10.0, "dir_deg": 280.0}
    assert by[utc(2027, 1, 16, 11)]["hs_m"] is None and by[utc(2027, 1, 16, 11)]["dir_deg"] is None       # MM
    assert by[utc(2027, 1, 16, 10)]["hs_m"] is None and by[utc(2027, 1, 16, 10)]["dir_deg"] is None       # 99.00 / 999 sentinels


def _one(wvht="1.20", dpd="10.0", mwd="280"):
    lines = ["#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD",
             "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT",
             f"2027 01 16 12 00 270  5.0  6.0   {wvht}  {dpd}   7.5 {mwd}"]
    return chr(10).join(lines) + chr(10)


def test_per_field_sentinels_a_valid_99_degree_direction_is_kept():
    """Advisor hold on #1155: a shared numeric sentinel set made MWD 99 deg (a real bearing) None, a hole in one direction bin."""
    assert truth.parse_ndbc_stdmet(_one(mwd="99"))[0]["dir_deg"] == 99.0
    assert truth.parse_ndbc_stdmet(_one(mwd="999"))[0]["dir_deg"] is None            # the MWD fill value, by its range
    assert truth.parse_ndbc_stdmet(_one(mwd="0"))[0]["dir_deg"] == 0.0 and truth.parse_ndbc_stdmet(_one(mwd="360"))[0]["dir_deg"] == 360.0
    assert truth.parse_ndbc_stdmet(_one(wvht="99.00"))[0]["hs_m"] is None            # WVHT fill value, by its range (<= 30)
    assert truth.parse_ndbc_stdmet(_one(dpd="99.00"))[0]["tp_s"] is None             # DPD fill value, by its range (<= 40)
    assert truth.parse_ndbc_stdmet(_one(wvht="MM", dpd="MM", mwd="MM"))[0] == {
        "time": utc(2027, 1, 16, 12), "hs_m": None, "tp_s": None, "dir_deg": None}
    assert truth.parse_ndbc_stdmet(_one(wvht="0.00"))[0]["hs_m"] == 0.0              # calm is a value, not a hole


def test_every_valid_direction_survives_the_parse():
    """No whole-degree bearing 0..360 is lost to a sentinel: the direction-bin scoring depends on it."""
    lost = [d for d in range(0, 361) if truth.parse_ndbc_stdmet(_one(mwd=str(d)))[0]["dir_deg"] != float(d)]
    assert lost == []


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


def test_snapshot_goes_to_the_shared_truth_prefix_hashed_and_immutable(tmp_path):
    from datetime import datetime, timezone
    from services.point_archive import storage, writer
    store = storage.LocalStore(tmp_path)
    w = writer.ArchiveWriter(store)
    when = datetime(2027, 1, 16, 12, 0, tzinfo=timezone.utc)
    p, h = truth.snapshot(w, "46086", when, SAMPLE)
    assert p.startswith("verify/point-archive/v1/truth/46086/") and len(h) == 64
    assert writer.verify_archive(store, "verify/point-archive/v1/truth/46086") == []
    with pytest.raises(FileExistsError):
        truth.snapshot(w, "46086", when, SAMPLE)


def test_the_parser_is_the_shared_qc_module_and_a_stuck_value_is_dropped():
    from services.point_archive import qc
    import inspect
    assert "qc.parse_stdmet" in inspect.getsource(truth.parse_ndbc_stdmet)
    assert not hasattr(truth, "MISSING_TOKENS") and not hasattr(truth, "_num")        # one QC, no private copy
    head = "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT\n"
    body = "".join(f"2027 01 16 {h:02d} 00 270 5.0 6.0 1.20 10.0 7.5 280\n" for h in range(12, -1, -1))
    rows = truth.parse_ndbc_stdmet(head + body)
    assert qc.parse_stdmet(head + body)[-1]["qc"].get("hs_m") == "stuck"
    assert rows[-1]["hs_m"] is None and rows[0]["hs_m"] == 1.2


def test_fetch_goes_through_the_injected_opener_on_the_ndbc_host_only():
    seen = []
    assert truth.fetch_realtime("46086", lambda u: seen.append(u) or SAMPLE) == SAMPLE
    assert seen == ["https://www.ndbc.noaa.gov/data/realtime2/46086.txt"]
