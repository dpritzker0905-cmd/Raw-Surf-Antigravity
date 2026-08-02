"""
Unit tests for services/weather_pipeline/buoy_calibration.py — NDBC parse + model-vs-buoy residual metrics.
Pure helpers tested directly; the async fetch/loop with injected mocks (no network, no DB).
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import buoy_calibration as bc

# Two NDBC realtime2 rows (newest first), with a 'MM' missing marker in the trailing met columns.
NDBC_SAMPLE = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50 110  5.0  6.0   1.2   9.0   5.5 100 1015.0  25.0  24.0  20.0   MM   MM   MM
2026 06 28 18 20 110  5.0  6.0   1.1   8.0   5.4  95 1015.0  25.0  24.0  20.0   MM   MM   MM
"""

# A met-only station (no wave height — WVHT column is 'MM' on every row).
NDBC_NO_WAVES = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50 110  5.0  6.0    MM    MM    MM  MM 1015.0  25.0  24.0  20.0   MM   MM   MM
"""


# ---------------------------------------------------------------------------------------------
# WIND OBSERVATIONS — the three real shapes that forced a SEPARATE selector + an age gate.
# Every fixture below is modelled on a live station measured 2026-08-02 21:5xZ, named in each test.
# ---------------------------------------------------------------------------------------------

# 41009 / 44013 / 41008: the anemometer reports every 10 min, the wave sensor every 30, so the
# NEWEST row carries wind with the wave columns still 'MM'.
NDBC_WIND_NEWER_THAN_WAVES = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50 200 10.0 13.0    MM    MM    MM  MM 1015.0  25.0  24.0  20.0   MM   MM   MM
2026 06 28 18 20 190  8.0 10.0   0.8   3.0   3.6 162 1015.0  25.0  24.0  20.0   MM   MM   MM
"""

# 44025: waves CURRENT, wind 19 days stale. Staleness is PER-SENSOR — the newest rows carry 'MM'
# wind and the only row with an anemometer reading is ancient.
NDBC_STALE_WIND_FRESH_WAVES = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50   MM   MM   MM   1.4   9.0   5.5 100 1015.0  25.0  24.0  20.0   MM   MM   MM
2026 06 09 10 40 300 12.0 15.0   1.1   8.0   5.4  95 1015.0  25.0  24.0  20.0   MM   MM   MM
"""

_NOW = datetime(2026, 6, 28, 19, 0, tzinfo=timezone.utc)   # 10 min after the newest fixture row


def test_wind_is_read_from_the_newest_row_even_when_that_row_has_no_waves():
    """41009's shape. The wave-gated selector would return the 18:20 row's wind, 30 min stale."""
    w = bc.parse_ndbc_wind(NDBC_WIND_NEWER_THAN_WAVES, now=_NOW)
    assert w is not None
    assert w["wdir_deg"] == 200.0 and w["wspd_ms"] == 10.0 and w["gust_ms"] == 13.0
    assert w["time"] == "2026-06-28T18:50:00+00:00"
    # DISCRIMINATING CONTROL: the wave parser lands on the OLDER row from the same payload, which is
    # exactly why wind cannot reuse it.
    assert bc.parse_ndbc_realtime(NDBC_WIND_NEWER_THAN_WAVES)["time"] == "2026-06-28T18:20:00+00:00"


def test_a_wind_only_station_is_visible_to_the_wind_parser_and_invisible_to_the_wave_parser():
    """46006's shape: wind on every row, waves on none. The pair IS the finding."""
    assert bc.parse_ndbc_realtime(NDBC_NO_WAVES) is None          # known-FAILING control
    w = bc.parse_ndbc_wind(NDBC_NO_WAVES, now=_NOW)               # known-PASSING control
    assert w is not None and w["wspd_ms"] == 5.0 and w["wdir_deg"] == 110.0


def test_stale_wind_beside_fresh_waves_is_REFUSED_not_served():
    """44025's shape, and the reason the age gate exists.

    A caller can fall back to the model forecast; it cannot detect that a number it was handed is
    19 days old. So this must fail CLOSED.
    """
    assert bc.parse_ndbc_wind(NDBC_STALE_WIND_FRESH_WAVES, now=_NOW) is None
    # NEGATIVE CONTROL — without this the assertion above is satisfied by a parser that always
    # returns None. Widen the gate past the row's age and the SAME payload must yield the reading.
    w = bc.parse_ndbc_wind(NDBC_STALE_WIND_FRESH_WAVES, now=_NOW, max_age_min=60 * 24 * 30)
    assert w is not None and w["wspd_ms"] == 12.0
    assert w["age_min"] > 60 * 24 * 18          # ~19 days, and it SAYS so
    # ...and the wave sensor on that same station is perfectly healthy.
    assert bc.parse_ndbc_realtime(NDBC_STALE_WIND_FRESH_WAVES)["wvht_m"] == 1.4


def test_wind_needs_BOTH_direction_and_speed_and_tolerates_junk():
    assert bc.parse_ndbc_wind("", now=_NOW) is None
    assert bc.parse_ndbc_wind("#only headers\n#second", now=_NOW) is None
    only_dir = NDBC_WIND_NEWER_THAN_WAVES.replace("200 10.0 13.0", "200   MM   MM")
    assert only_dir != NDBC_WIND_NEWER_THAN_WAVES        # assert the fixture mutation LANDED
    w = bc.parse_ndbc_wind(only_dir, now=_NOW)
    assert w is not None and w["time"] == "2026-06-28T18:20:00+00:00"   # fell through to the full row


def test_wspd_kt_comes_from_the_ONE_shared_constant_not_a_local_literal():
    from services.weather_pipeline.surf_rating import MS_TO_KT
    w = bc.parse_ndbc_wind(NDBC_WIND_NEWER_THAN_WAVES, now=_NOW)
    assert w["wspd_kt"] == round(w["wspd_ms"] * MS_TO_KT, 2)
    assert w["wspd_kt"] == 19.44        # 10 m/s, the value the audit quoted for buoy 41009


# NDBC latest_obs.txt — a DIFFERENT layout from realtime2 (station id + coords come first).
# Row 1 fresh with wind; row 2 fresh but wind 'MM'; row 3 has wind but is 19 days stale (44025's shape).
LATEST_OBS = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
41009     28.508  -80.185 2026 06 28 18 50  200 10.0    MM   MM   MM  MM  MM     MM    MM  27.8  25.8    MM   MM     MM
46999     36.000 -122.000 2026 06 28 18 50   MM   MM    MM  1.4  9.0 5.5 100     MM    MM  15.0  14.0    MM   MM     MM
44025     40.251  -73.164 2026 06 09 10 40  300 12.0    MM  1.1  8.0 5.4  95     MM    MM  20.0  19.0    MM   MM     MM
"""


def test_latest_obs_wind_keeps_only_fresh_stations_that_report_BOTH_fields():
    got = bc.parse_latest_obs_wind(LATEST_OBS, now=_NOW)
    assert [s["id"] for s in got] == ["41009"]          # 46999 has no wind; 44025 is 19 days stale
    s = got[0]
    assert s["wdir_deg"] == 200.0 and s["wspd_ms"] == 10.0
    assert (s["lat"], s["lon"]) == (28.508, -80.185)    # coords come from THIS layout, not realtime2
    assert s["wspd_kt"] == 19.44
    # NEGATIVE CONTROL — without it, "only 41009" is satisfied by a parser that drops everything.
    # Widen the gate and the stale station must reappear, still reporting its true age.
    wide = bc.parse_latest_obs_wind(LATEST_OBS, now=_NOW, max_age_min=60 * 24 * 30)
    assert [s["id"] for s in wide] == ["41009", "44025"]
    assert wide[1]["age_min"] > 60 * 24 * 18


def test_latest_obs_wind_returns_a_LIST_never_None_and_survives_junk():
    for bad in ("", "#only headers", "not a table at all\n", "1 2 3\n"):
        got = bc.parse_latest_obs_wind(bad, now=_NOW)
        assert got == [], bad          # a caller iterating the result must never hit None


def test_compare_wind_to_model_is_signed_and_direction_error_is_ANGULAR():
    obs = bc.parse_ndbc_wind(NDBC_WIND_NEWER_THAN_WAVES, now=_NOW)   # 19.44 kt from 200 deg
    r = bc.compare_wind_to_model(obs, 10.04, 186.0)                  # ICON's live reading that hour
    assert r["wspd_err_kt"] == -9.4 and r["abs_wspd_err_kt"] == 9.4  # the model UNDER-reads
    assert r["wdir_err_deg"] == 14.0
    # the wrap case: 350 vs 200 is 150, never 210
    assert bc.compare_wind_to_model(obs, 10.0, 350.0)["wdir_err_deg"] == 150.0
    # 350 vs 10 must read 20, not 340 — the classic angular bug
    across = dict(obs, wdir_deg=350.0)
    assert bc.compare_wind_to_model(across, 10.0, 10.0)["wdir_err_deg"] == 20.0
    assert bc.compare_wind_to_model(None, 10.0) is None
    assert bc.compare_wind_to_model(obs, None)["wspd_err_kt"] is None


def test_parse_ndbc_realtime_takes_newest_wave_row():
    obs = bc.parse_ndbc_realtime(NDBC_SAMPLE)
    assert obs is not None
    assert obs["wvht_m"] == 1.2 and obs["dpd_s"] == 9.0 and obs["apd_s"] == 5.5
    assert obs["mwd_deg"] == 100.0 and obs["wtmp_c"] == 24.0
    assert obs["time"] == "2026-06-28T18:50:00+00:00"


def test_parse_ndbc_realtime_handles_missing_and_empty():
    assert bc.parse_ndbc_realtime("") is None
    assert bc.parse_ndbc_realtime("#only headers\n#second header") is None
    assert bc.parse_ndbc_realtime(NDBC_NO_WAVES) is None     # no usable wave height anywhere


def test_compare_obs_to_model_signed_and_abs():
    obs = {"wvht_m": 1.0, "dpd_s": 10.0}
    r = bc.compare_obs_to_model(obs, model_hs_m=1.3, model_tp_s=9.0)
    assert r["height_err_m"] == pytest.approx(0.3)      # model runs high
    assert r["abs_height_err_m"] == pytest.approx(0.3)
    assert r["period_err_s"] == pytest.approx(-1.0)     # model period low
    assert r["abs_period_err_s"] == pytest.approx(1.0)


def test_compare_obs_to_model_tolerates_missing_pieces():
    assert bc.compare_obs_to_model(None, 1.0, 10.0) is None
    assert bc.compare_obs_to_model({"wvht_m": None}, 1.0, 10.0) is None
    # model height present, period missing → height residual only
    r = bc.compare_obs_to_model({"wvht_m": 1.0, "dpd_s": None}, 1.2, 10.0)
    assert r["abs_height_err_m"] == pytest.approx(0.2) and r["period_err_s"] is None


def test_aggregate_residuals_mae_and_bias():
    residuals = [
        {"abs_height_err_m": 0.2, "height_err_m": 0.2, "abs_period_err_s": 1.0, "period_err_s": 1.0},
        {"abs_height_err_m": 0.4, "height_err_m": -0.4, "abs_period_err_s": 3.0, "period_err_s": -3.0},
        None,                                              # skipped
        {"abs_height_err_m": 0.3, "height_err_m": 0.3, "abs_period_err_s": None, "period_err_s": None},
    ]
    agg = bc.aggregate_residuals(residuals)
    assert agg["n_spots"] == 3
    assert agg["height_mae_m"] == pytest.approx((0.2 + 0.4 + 0.3) / 3, abs=1e-3)  # rounded to 3 dp
    assert agg["height_bias_m"] == pytest.approx((0.2 - 0.4 + 0.3) / 3, abs=1e-3)
    assert agg["height_n"] == 3
    assert agg["period_mae_s"] == pytest.approx(2.0) and agg["period_n"] == 2
    assert agg["height_mae_ft"] == pytest.approx(agg["height_mae_m"] * bc.FT_PER_M, abs=1e-2)


def test_aggregate_residuals_empty():
    agg = bc.aggregate_residuals([])
    assert agg["n_spots"] == 0 and agg["height_mae_m"] is None and agg["period_mae_s"] is None


def test_build_calibration_report_shape():
    rows = [{"spot_id": "s1", "name": "X", "buoy_id": "41009", "buoy_time": "t",
             "residual": {"abs_height_err_m": 0.5, "height_err_m": 0.5,
                          "abs_period_err_s": 2.0, "period_err_s": 2.0}}]
    rep = bc.build_calibration_report(rows)
    assert rep["version"] == bc.BUOY_CALIBRATION_SCHEMA_VERSION
    assert rep["summary"]["height_mae_m"] == pytest.approx(0.5)
    assert rep["spots"] == rows and "generated_at" in rep


@pytest.mark.asyncio
async def test_fetch_ndbc_latest_with_injected_client():
    class FakeResp:
        status_code = 200
        text = NDBC_SAMPLE
    class FakeClient:
        def __init__(self): self.url = None
        async def get(self, url): self.url = url; return FakeResp()
    client = FakeClient()
    obs = await bc.fetch_ndbc_latest("41009", client=client)
    assert client.url == "https://www.ndbc.noaa.gov/data/realtime2/41009.txt"
    assert obs["wvht_m"] == 1.2
    assert await bc.fetch_ndbc_latest("", client=client) is None   # no station → None


@pytest.mark.asyncio
async def test_calibrate_spots_loop(monkeypatch):
    from datetime import datetime, timezone
    from services.weather_pipeline.schemas import NormalizedPointResponse, NormalizedPointDetail

    class FakeResp:
        status_code = 200
        text = NDBC_SAMPLE
    class FakeClient:
        async def get(self, url): return FakeResp()

    class FakeResolver:
        async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
            return NormalizedPointResponse(
                model=model, provider="open-meteo", domain=domain, layer=layer,
                run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
                is_forecast_authoritative=True, is_estimated=False,
                point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                            sampled_lng=lng, speed=1.5, period=10.0, interpolation_method="t"),
                value_kind="wave_height", value_unit="m", display_unit_hint="ft",
                source_variables=["wave_height"], freshness_sec=1800)

    spots = [
        {"id": "s1", "name": "A", "latitude": 28.4, "longitude": -80.5, "noaa_buoy_id": "41009"},
        {"id": "s2", "name": "B", "latitude": 30.0, "longitude": -81.0, "noaa_buoy_id": None},  # skipped
    ]
    rep = await bc.calibrate_spots(FakeResolver(), spots, "GFS", "2026-06-28T18:00:00Z", client=FakeClient())
    assert len(rep["spots"]) == 1 and rep["spots"][0]["spot_id"] == "s1"
    # model 1.5 m vs buoy 1.2 m → +0.3 m bias; model 10 s vs buoy 9 s → +1 s
    assert rep["spots"][0]["residual"]["height_err_m"] == pytest.approx(0.3)
    assert rep["summary"]["height_mae_m"] == pytest.approx(0.3) and rep["summary"]["n_spots"] == 1


# ── Resolve-at-BUOY + per-buoy aggregation (2026-07-26) ────────────────────────────────────────────
# Before this, calibrate_spots resolved the model at the SPOT and the summary averaged per SPOT. Both
# were wrong: the first conflated model error with the real deep-water -> nearshore difference (which
# is physics, not bias, and must never be "corrected" away); the second let spot DENSITY weight the
# summary, so a crowded stretch of coast could outvote an entire ocean basin.

_LATEST_OBS = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa
41013    33.441  -77.764 2026 07 26 19 40   MM  0.0   1.0  0.7   MM 5.0 103 1012.9
46026    37.759 -122.833 2026 07 26 19 00    4  1.1    MM  2.1   12 8.0 270     MM
"""


def test_parse_station_coords_reads_the_header():
    c = bc.parse_station_coords(_LATEST_OBS)
    assert c["41013"] == (33.441, -77.764)
    assert c["46026"] == (37.759, -122.833)


def test_parse_station_coords_fails_CLOSED_on_a_format_change():
    """An NDBC re-order must yield {} (fall back + tag), never a wrong latitude."""
    assert bc.parse_station_coords(_LATEST_OBS.replace("#STN       LAT      LON", "#STN       XXX      YYY")) == {}
    assert bc.parse_station_coords("") == {}
    assert bc.parse_station_coords("garbage\n1 2 3") == {}


def test_summary_weights_each_BUOY_once_not_each_spot():
    """Ten spots on one buoy must not outvote a single spot on another."""
    hot = {"height_err_m": 2.0, "abs_height_err_m": 2.0, "period_err_s": None, "abs_period_err_s": None}
    cool = {"height_err_m": 0.0, "abs_height_err_m": 0.0, "period_err_s": None, "abs_period_err_s": None}
    rows = [{"buoy_id": "AAA", "residual": hot} for _ in range(10)]
    rows.append({"buoy_id": "BBB", "residual": cool})
    summary = bc.build_calibration_report(rows)["summary"]
    # per-buoy: mean(2.0, 0.0) = 1.0.  per-spot would have been (10*2.0+0)/11 = 1.82
    assert summary["height_bias_m"] == pytest.approx(1.0, abs=0.01)
    assert summary["height_n"] == 2


def test_one_residual_per_buoy_passes_through_rows_without_a_buoy_id():
    r = {"height_err_m": 1.0, "abs_height_err_m": 1.0}
    assert len(bc._one_residual_per_buoy([{"residual": r}, {"residual": r}])) == 2


@pytest.mark.asyncio
async def test_calibrate_spots_resolves_at_the_BUOY_and_tags_the_row(monkeypatch):
    seen = []

    class _R:
        async def resolve_point(self, **kw):
            seen.append((kw["lat"], kw["lng"]))
            return None

    async def _coords(client=None):
        return {"41013": (33.441, -77.764)}

    async def _obs(station_id, client=None):
        return {"wvht_m": 0.7, "dpd_s": 9.0, "time": "t"}

    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", _coords)
    monkeypatch.setattr(bc, "fetch_ndbc_latest", _obs)

    # two spots share one buoy; the spot coords are deliberately far from the station
    spots = [
        {"id": "s1", "name": "A", "latitude": 34.9, "longitude": -76.1, "noaa_buoy_id": "41013"},
        {"id": "s2", "name": "B", "latitude": 33.9, "longitude": -78.9, "noaa_buoy_id": "41013"},
    ]
    rep = await bc.calibrate_spots(_R(), spots, "GFS", "2026-07-26T19:00:00Z")

    assert seen == [(33.441, -77.764)], seen        # resolved AT the buoy, and only ONCE (cached)
    assert all(r["resolved_at"] == "buoy" for r in rep["spots"])
    # Both per-spot rows are retained for auditability; the per-BUOY collapse of the summary is
    # proven by test_summary_weights_each_BUOY_once_not_each_spot (this fake resolver returns no
    # model value, so there is deliberately nothing to aggregate here).
    assert len(rep["spots"]) == 2
    assert {r["buoy_id"] for r in rep["spots"]} == {"41013"}


@pytest.mark.asyncio
async def test_calibrate_spots_falls_back_to_the_spot_and_says_so(monkeypatch):
    seen = []

    class _R:
        async def resolve_point(self, **kw):
            seen.append((kw["lat"], kw["lng"]))
            return None

    async def _no_coords(client=None):
        return {}

    async def _obs(station_id, client=None):
        return {"wvht_m": 1.0, "dpd_s": None, "time": "t"}

    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", _no_coords)
    monkeypatch.setattr(bc, "fetch_ndbc_latest", _obs)

    spots = [{"id": "s1", "name": "A", "latitude": 34.9, "longitude": -76.1, "noaa_buoy_id": "41013"}]
    rep = await bc.calibrate_spots(_R(), spots, "GFS", "2026-07-26T19:00:00Z")
    assert seen == [(34.9, -76.1)]                  # fell back to the spot
    assert rep["spots"][0]["resolved_at"] == "spot"  # ...and the row SAYS so


# ── The residual ARCHIVE (2026-07-28) ─────────────────────────────────────────────────────────
# `buoy_latest.json` is a single overwritten key, so exactly one snapshot has ever existed. The
# blocker on a calibration curve is EVIDENCE, not method — these pin the accumulation.
from services.weather_pipeline.buoy_calibration import (          # noqa: E402
    archive_rows_from_report, merge_residual_archive, stratified_height_bias,
    build_archive_summary, HEIGHT_BANDS)
from datetime import datetime, timedelta, timezone                # noqa: E402


def _report(rows):
    return {"spots": [{"buoy_id": b, "buoy_time": t,
                       "residual": {"buoy_wvht_m": o, "model_hs_m": m,
                                    "height_err_m": round(m - o, 4)}}
                      for b, t, o, m in rows]}


def test_the_archive_keeps_one_row_per_buoy_not_per_spot():
    """Measured 2026-07-28: 421 spot rows over 60 buoys, and 0 of 54 multi-spot buoys had a model
    value that varied across its spots — so per-spot rows are pure replication. Archiving them
    would weight Cape Canaveral (40 spots on one buoy) 40x."""
    rows = _report([("41113", "2026-07-28T01:00:00+00:00", 0.3, 0.5438)] * 40
                   + [("46232", "2026-07-28T00:56:00+00:00", 1.4, 1.0084)] * 2)
    out = archive_rows_from_report(rows)
    assert len(out) == 2
    assert {r["buoy_id"] for r in out} == {"41113", "46232"}


def test_a_model_zero_is_a_coverage_hole_and_is_not_archived():
    """3 of 421 rows read model_hs_m == 0.0 against a real observation. Archiving that teaches the
    curve the model under-predicts by the entire wave height."""
    out = archive_rows_from_report(_report([("46267", "2026-07-28T01:00:00+00:00", 0.5, 0.0)]))
    assert out == []


def test_rerunning_within_the_same_buoy_hour_is_not_new_evidence():
    """CI runs more often than NDBC reports (~hourly). The same observation seen twice must not
    count twice, or the series inflates without gaining information."""
    a = _report([("41113", "2026-07-28T01:00:00+00:00", 0.3, 0.54)])
    merged = merge_residual_archive(archive_rows_from_report(a), archive_rows_from_report(a))
    assert len(merged) == 1
    later = _report([("41113", "2026-07-28T02:00:00+00:00", 0.4, 0.55)])
    merged = merge_residual_archive(merged, archive_rows_from_report(later))
    assert len(merged) == 2          # a NEW observation time is new evidence


def test_the_archive_prunes_by_age_and_never_grows_without_bound():
    now = datetime(2026, 7, 28, tzinfo=timezone.utc)
    old = (now - timedelta(days=120)).isoformat()
    fresh = (now - timedelta(days=1)).isoformat()
    entries = [{"buoy_id": "A", "buoy_time": old, "buoy_wvht_m": 1.0, "height_err_m": 0.1},
               {"buoy_id": "B", "buoy_time": fresh, "buoy_wvht_m": 1.0, "height_err_m": 0.1}]
    kept = merge_residual_archive(entries, [], now=now)
    assert [r["buoy_id"] for r in kept] == ["B"]
    many = [{"buoy_id": f"B{i}", "buoy_time": fresh, "buoy_wvht_m": 1.0, "height_err_m": 0.1}
            for i in range(50)]
    assert len(merge_residual_archive(many, [], now=now, max_entries=10)) == 10


def test_a_malformed_time_is_dropped_not_kept_unorderable():
    entries = [{"buoy_id": "A", "buoy_time": "not-a-time", "buoy_wvht_m": 1.0, "height_err_m": 0.1}]
    assert merge_residual_archive(entries, []) == []


def test_stratification_reproduces_the_measured_compression():
    """The 2026-07-28 per-buoy measurement: over-predicts small, under-predicts big. Stratified on
    the OBSERVATION — bucketing by the model's own value is how a compressing model is made to
    look unbiased in every bucket."""
    entries = ([{"buoy_id": f"s{i}", "buoy_time": "2026-07-28T01:00:00+00:00",
                 "buoy_wvht_m": 0.3, "height_err_m": 0.237} for i in range(7)]
               + [{"buoy_id": f"b{i}", "buoy_time": "2026-07-28T01:00:00+00:00",
                   "buoy_wvht_m": 3.0, "height_err_m": -0.808} for i in range(2)])
    bands = {(b["band_lo_m"], b["band_hi_m"]): b for b in stratified_height_bias(entries)}
    assert bands[(0.0, 0.5)]["bias_m"] == 0.237
    assert bands[(2.5, 10.0)]["bias_m"] == -0.808
    # The aggregate hides it entirely — that is why a single bias number is the wrong instrument.
    allerr = [e["height_err_m"] for e in entries]
    assert abs(sum(allerr) / len(allerr)) < 0.06


def test_thin_bands_are_named_so_a_two_sample_band_is_never_fitted():
    """A table with n=2 looks identical to one with n=2000 unless the thin bands are called out."""
    entries = [{"buoy_id": "a", "buoy_time": "2026-07-28T01:00:00+00:00",
                "buoy_wvht_m": 3.0, "height_err_m": -0.8}]
    summary = build_archive_summary(entries)
    assert "not_yet_fittable" in summary
    assert "2.5-10.0m (n=1, 1 buoys)" in summary["not_yet_fittable"]
    assert summary["n_buoys"] == 1 and summary["n_entries"] == 1


def test_many_rows_from_few_buoys_is_still_not_fittable():
    """★ THE independence trap: a week of hourly runs gives the top band ~336 rows but STILL the
    same 2 stations. Row count alone would call that fittable and calibrate every big-wave spot on
    the planet to two buoys."""
    entries = [{"buoy_id": f"b{i % 2}", "buoy_time": f"2026-07-{(i % 27) + 1:02d}T{i % 24:02d}:00:00+00:00",
                "buoy_wvht_m": 3.0, "height_err_m": -0.8} for i in range(300)]
    band = [b for b in stratified_height_bias(entries) if b["band_lo_m"] == 2.5][0]
    assert band["n"] >= 30 and band["n_buoys"] == 2
    assert "2.5-10.0m" in build_archive_summary(entries)["not_yet_fittable"]


def test_every_band_is_reported_even_when_empty():
    """A missing band must be visible as n=0, not absent — an absent band reads as 'no problem'."""
    assert len(stratified_height_bias([])) == len(HEIGHT_BANDS)
    assert all(b["n"] == 0 for b in stratified_height_bias([]))
