"""Collectors, truth readers, climatology and pairing for the long-range wind v2 registration. Fakes only: no network."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_clim as C  # noqa: E402
import wind_lr2_collect as K  # noqa: E402
import wind_lr2_runs as R  # noqa: E402
import wind_lr2_truth as T  # noqa: E402

UTC = timezone.utc
RUN = datetime(2026, 12, 1, 0, tzinfo=UTC)


# ------------------------------------------------------------------------------------------------ urls
def test_aigefs_url_matches_the_public_layout():
    u = K.aigefs_url(RUN, 7, 192)
    assert u == ("https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/EAGLE_ensemble/aigefs.20261201/00/mem007/model/"
                 "atmos/grib2/aigefs.t00z.sfc.f192.grib2")
    assert "mem030" in K.aigefs_url(RUN.replace(hour=12), 30, 336) and "/12/" in K.aigefs_url(RUN.replace(hour=12), 30, 336)


def test_gefs_urls_use_the_half_degree_files_because_the_quarter_degree_files_stop_at_240h():
    a = K.gefs_url(RUN, 0, 300)
    assert a.endswith("/gefs.20261201/00/atmos/pgrb2ap5/gec00.t00z.pgrb2a.0p50.f300")
    assert K.gefs_url(RUN, 5, 300, "b").endswith("/pgrb2bp5/gep05.t00z.pgrb2b.0p50.f300")
    assert "pgrb2sp25" not in a                      # amendment 1: 0.25 deg stops at f240 (listing checked 2026-11-22)


# ------------------------------------------------------------------------------------------------ collect_run
NST = 3


def _fake_io(fail=None, comparators=True):
    calls = {"noaa": 0}

    def noaa(session, url, keys, lats, lons):
        calls["noaa"] += 1
        if fail and fail in url:
            raise FileNotFoundError(url)
        return {k: np.full(NST, 1.0 if "UGRD" in k else 2.0) for k in keys}

    def ifs(session, run, step, lats, lons):
        if fail == "ifs" and step == 240:
            raise ValueError("503 throttled")
        return {"10u": np.ones((51, NST)), "10v": np.ones((51, NST)), "10fg": np.ones((51, NST))}

    def cmp_(session, run, lats, lons):
        return {"gfs_u_186": np.ones(NST)}
    return {"noaa": noaa, "ifs": ifs, "comparators": cmp_}, calls


def test_collect_run_keeps_a_complete_run(tmp_path):
    io, calls = _fake_io()
    assert K.collect_run(None, RUN, np.zeros(NST), np.zeros(NST), str(tmp_path), io, comparators=True) == "ok"
    z = np.load(tmp_path / "2026120100.npz")
    assert z["aigefs_u_186"].shape == (31, NST) and z["gefs_u_330"].shape == (31, NST) and z["gefs_g_336"].shape == (31, NST)
    assert z["ifs_10u_240"].shape == (51, NST) and "cmp_gfs_u_186" in z.files
    assert "aigefs_g_186" not in z.files                          # AIGEFS has no gust field
    assert len([k for k in z.files if k.startswith("aigefs_u_")]) == len(R.STEPS) == 27
    assert K.collect_run(None, RUN, np.zeros(NST), np.zeros(NST), str(tmp_path), io, comparators=True) == "cached"


@pytest.mark.parametrize("fail", ["mem012", "gep07", "ifs"])
def test_a_missing_member_or_step_drops_the_run_and_never_fills(tmp_path, fail):
    io, _ = _fake_io(fail=fail)
    assert K.collect_run(None, RUN, np.zeros(NST), np.zeros(NST), str(tmp_path), io, comparators=False) == "dropped"
    assert not (tmp_path / "2026120100.npz").exists()
    doc = json.load(open(tmp_path / "2026120100.dropped.json"))
    assert doc["n_causes"] >= 1 and any(fail in c or "throttled" in c for c in doc["dropped"])


def test_fit_runs_need_no_comparators(tmp_path):
    io, _ = _fake_io()
    io["comparators"] = lambda *a: (_ for _ in ()).throw(AssertionError("comparators must not be read for FIT"))
    assert K.collect_run(None, RUN, np.zeros(NST), np.zeros(NST), str(tmp_path), io, comparators=False) == "ok"


def test_shard_partitions_the_run_list_exactly():
    runs = R.test_window_runs()
    parts = [K.shard(runs, f"{i}/6") for i in range(6)]
    assert sorted(r for p in parts for r in p) == sorted(runs) and sum(len(p) for p in parts) == 90


# ------------------------------------------------------------------------------------------------ truth
NDBC = ("#YY  MM DD hh mm WDIR WSPD GST\n#yr  mo dy hr mn degT m/s m/s\n"
        "2026 12 08 00 00 270  5.0  7.0\n2026 12 08 01 00 280  6.0  8.0\n")
NDBC_REVISED = ("#YY  MM DD hh mm WDIR WSPD GST\n#yr  mo dy hr mn degT m/s m/s\n"
                "2026 12 08 00 00 275  5.5  7.5\n")


def _snap(tmp, name, sid, text):
    d = tmp / name
    d.mkdir()
    (d / f"{sid}.txt").write_text(text)


def test_earliest_snapshot_wins_and_snapshots_merge(tmp_path):
    _snap(tmp_path, "20261211T0000Z", "41001", NDBC)
    _snap(tmp_path, "20261218T0000Z", "41001", NDBC_REVISED + "2026 12 08 02 00 100 4.0 5.0\n")
    truth = T.load_snapshots(str(tmp_path), "41001")
    t0 = datetime(2026, 12, 8, 0, tzinfo=UTC)
    assert truth[t0] == (5.0, 7.0, 270.0)                         # the first-seen record, not the later revision
    assert truth[t0 + timedelta(hours=2)] == (4.0, 5.0, 100.0)    # a record only the later snapshot holds


def test_monthly_stdmet_replaces_the_snapshot_and_sources_are_counted(tmp_path):
    _snap(tmp_path, "20261211T0000Z", "41001", NDBC)
    t0 = datetime(2026, 12, 8, 0, tzinfo=UTC)
    out, src = T.truth_for_test(str(tmp_path), "41001", monthly={t0: (5.2, 7.1, 271.0)})
    assert out[t0] == (5.2, 7.1, 271.0) and out[t0 + timedelta(hours=1)] == (6.0, 8.0, 280.0)
    assert src == {"snapshot": 1, "monthly": 1}


def test_fit_truth_reads_annual_and_monthly_files_never_realtime2():
    start, end = datetime(2025, 12, 17, tzinfo=UTC), datetime(2026, 10, 15, tzinfo=UTC)
    seen = {"years": [], "months": []}
    t_dec, t_mar = datetime(2025, 12, 20, 6, tzinfo=UTC), datetime(2026, 3, 1, 6, tzinfo=UTC)

    def year_reader(s, c, sid, y):
        seen["years"].append(y)
        return {t_dec: (4.0, 6.0, 90.0), datetime(2025, 1, 1, tzinfo=UTC): (1.0, 1.0, 1.0)}

    def month_reader(s, c, sid, y, m):
        seen["months"].append((y, m))
        return {t_mar: (7.0, 9.0, 180.0)} if (y, m) == (2026, 3) else {}
    out, src = T.fit_truth(None, "", "41001", start, end, year_reader, month_reader)
    assert seen["years"] == [2025] and seen["months"][0] == (2026, 1) and seen["months"][-1] == (2026, 10)
    assert set(out) == {t_dec, t_mar}                             # out-of-window records are cut
    assert src["annual"] == 2 and src["monthly"] == 1


def test_months_between_spans_a_year_end():
    assert T.months_between(datetime(2025, 11, 5, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


# ------------------------------------------------------------------------------------------------ pairing
SPOTS = [{"id": "s2", "lat": 34.00, "lon": -120.00}, {"id": "s1", "lat": 34.00, "lon": -120.00},
         {"id": "far", "lat": 35.0, "lon": -120.0}, {"id": "near_land", "lat": 34.01, "lon": -120.0}]


def test_pairing_picks_nearest_without_crossing_land_and_breaks_ties_by_lowest_id():
    st = {"id": "46054", "lat": 34.01, "lon": -120.0}
    never = lambda *a: False  # noqa: E731
    assert T.pair_station_to_spot(st, SPOTS, never)["id"] == "near_land"
    blocked = lambda la1, lo1, la2, lo2: (la2, lo2) == (34.01, -120.0)  # noqa: E731
    assert T.pair_station_to_spot(st, SPOTS, blocked)["id"] == "s1"      # s1 and s2 tie on distance: lowest id
    assert T.pair_station_to_spot({"id": "x", "lat": 10.0, "lon": 0.0}, SPOTS, never) is None
    assert T.pair_station_to_spot({"id": "y", "lat": 34.0, "lon": -120.0}, [SPOTS[2]], never) is None     # > 25 km
    assert T.pairing_table([st], SPOTS, never) == {"46054": "near_land"}


# ------------------------------------------------------------------------------------------------ climatology
def _table(fn):
    a = np.zeros((365, 4, 2))
    for d in range(365):
        for h in range(4):
            a[d, h] = fn(d, h)
    return a


def test_clim_indexes_day_of_year_and_hour_and_folds_leap_day():
    f = _table(lambda d, h: d * 10.0 + h)
    assert C.clim_value(f, datetime(2026, 1, 1, 0, tzinfo=UTC))[0] == 0.0
    assert C.clim_value(f, datetime(2026, 12, 31, 18, tzinfo=UTC))[0] == 364 * 10.0 + 3
    assert C.clim_value(f, datetime(2026, 3, 1, 6, tzinfo=UTC))[0] == 59 * 10.0 + 1
    assert C.clim_value(f, datetime(2028, 3, 1, 6, tzinfo=UTC))[0] == 59 * 10.0 + 1          # a leap year's Mar 1 is the same slot
    assert C.clim_value(f, datetime(2028, 2, 29, 0, tzinfo=UTC))[0] == C.clim_value(f, datetime(2027, 2, 28, 0, tzinfo=UTC))[0]
    with pytest.raises(ValueError):
        C.clim_value(f, datetime(2026, 6, 15, 3, tzinfo=UTC))                                  # only 00/06/12/18 UTC exist


def test_clim_guards_catch_bad_fields_and_partial_nan():
    ok = {"u": np.ones((365, 4, 3)), "v": np.zeros((365, 4, 3)), "s": np.full((365, 4, 3), 2.0)}
    assert C.check_fields(ok) == []
    assert C.check_fields(dict(ok, s=np.full((365, 4, 3), 0.5))) != []                     # speed below |mean vector|
    assert C.check_fields({"u": ok["u"], "v": ok["v"]}) == ["missing s"]
    whole = {k: v.copy() for k, v in ok.items()}
    for k in whole:
        whole[k][..., 1] = np.nan                                                           # a whole station without CLIM is allowed
    assert C.check_fields(whole) == [] and C.stations_without_clim(whole) == [1]
    part = {k: v.copy() for k, v in ok.items()}
    part["s"][5, 2, 0] = np.nan
    assert any("partially NaN" in b for b in C.check_fields(part))


def test_clim_records_what_the_product_is_and_how_to_credit_it():
    assert C.PERIOD == (2008, 2025) and C.WINDOW_DAYS == 15 and C.PRODUCT == "WIND_GLO_PHY_L4_MY_012_006"
    assert "10.48670/moi-00185" in C.ATTRIBUTION and C.ATTRIBUTION.startswith("E.U. Copernicus Marine Service Information")
    assert "stress-equivalent" in C.VARIABLE_MEANING and "not the actual 10 m wind" in C.VARIABLE_MEANING


# ------------------------------------------------------------------------------------------------ CMEMS builder
import wind_lr2_cmems as CM  # noqa: E402


def test_nearest_valid_cell_uses_only_ocean_cells_within_25_km():
    lats, lons = np.array([34.0, 34.125, 34.25]), np.array([-120.25, -120.125, -120.0])
    valid = np.array([[True, False, False], [True, False, False], [True, False, False]])      # ocean only in the first column
    i, j, km = CM.nearest_valid_cell(valid, lats, lons, 34.1, -120.0)
    assert (i, j) == (1, 0) and 20.0 < km < 25.0
    assert CM.nearest_valid_cell(valid, lats, lons, 34.1, -119.5) is None                      # > 25 km: no CLIM, never filled
    assert CM.nearest_valid_cell(np.zeros((3, 3), bool), lats, lons, 34.0, -120.25) is None


def _hourly(years, fn):
    times, u = [], []
    for y in years:
        t = datetime(y, 1, 1, tzinfo=UTC)
        while t.year == y:
            times.append(np.datetime64(t.replace(tzinfo=None), "s"))
            u.append(fn(t))
            t += timedelta(hours=1)
    return np.array(times), np.array(u)


def test_accumulate_and_finish_build_the_window_mean_speed_not_the_vector_mean():
    times, ang = _hourly([2008, 2009], lambda t: [(t.hour // 6) * 90.0])
    u, v = 4.0 * np.cos(np.radians(ang)), 4.0 * np.sin(np.radians(ang))                         # constant speed 4, hour-dependent direction
    sums = CM.new_sums(1)
    CM.accumulate(sums, times, u, v)
    out = CM.finish(sums, min_n=20)
    assert np.allclose(out["s"][:, :, 0], 4.0)                                                   # mean SPEED, whatever the direction
    assert out["s"].shape == (365, 4, 1) and C.check_fields(out) == []
    assert np.hypot(out["u"], out["v"]).max() <= 4.0 + 1e-9


def test_accumulate_keeps_only_the_synoptic_hours_period_and_skips_leap_day_and_nan():
    t = np.array([np.datetime64("2008-03-01T00", "s"), np.datetime64("2008-03-01T03", "s"), np.datetime64("2007-03-01T00", "s"),
                  np.datetime64("2008-02-29T00", "s"), np.datetime64("2008-03-01T06", "s")])
    u = np.array([[3.0], [3.0], [3.0], [3.0], [np.nan]])
    sums = CM.new_sums(1)
    CM.accumulate(sums, t, u, np.zeros((5, 1)))
    assert sums["n"].sum() == 1.0 and sums["n"][59, 0, 0] == 1.0                                 # only 2008-03-01 00Z counted


def test_a_station_with_a_thin_slot_is_nan_everywhere_never_partial():
    sums = CM.new_sums(2)
    sums["n"][:, :, 0] = 200.0
    sums["s"][:, :, 0] = 200.0 * 3.0
    sums["u"][:, :, 0] = 200.0 * 3.0
    sums["n"][:, :, 1] = 200.0
    sums["n"][10, 1, 1] = 0.0                                                                    # one empty slot for station 1
    sums["n"][:, 1, 1] = 0.0
    out = CM.finish(sums, min_n=100)
    assert np.isfinite(out["s"][..., 0]).all() and np.isnan(out["s"][..., 1]).all()


# ------------------------------------------------------------------------------------------------ spot export
import wind_lr2_spots as SP  # noqa: E402


def test_spot_rows_keep_the_shore_normal_or_null_and_are_sorted(tmp_path):
    spots = [{"id": 9, "latitude": 34.0, "longitude": -120.0}, {"id": 2, "latitude": 21.6, "longitude": -158.0}]
    rows = SP.spot_rows(spots, lambda la, lo: (270.0, 5.0) if la > 30 else (None, None))
    assert [r["id"] for r in rows] == ["2", "9"] and rows[0]["shore_normal"] is None and rows[1]["shore_normal"] == 270.0
    out = tmp_path / "spots.json"
    assert SP.export(str(out), fetch=lambda: spots, shore_normal_at=lambda la, lo: (90.0, 1.0)) == 0
    assert len(json.load(open(out))) == 2
