"""The own-data served tide (owner 2026-11-18: "No user data should be open-meteo").

Pins: the table builder's pure rules (keys equal the served cache keys, seam-wrapped FES boxes, the window, A+M in mm,
never A alone, the M tile covers every key's cells, G3t's M values for the parity precondition); the served loader
(shape check, slicing from 00Z today, truncation, staleness, absent key = unavailable, a failed read keeps the last
good table); the dispatch (own by default, the kill switch gives NO tide and NO Open-Meteo request, the legacy path only
through the raw test env, which no deploy or workflow sets); the workflow's credential scoping; and that PyFES and the
builder never enter the served backend."""
import asyncio
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND / "scripts" / "tide_own"))
import own_rules as OR                                   # noqa: E402
from services.weather_pipeline import tide, tide_own     # noqa: E402  (tide: read-only, for _round_key parity)

UTC = timezone.utc
WF = (REPO / ".github" / "workflows" / "tide-own-series.yml").read_text(encoding="utf-8")


def _table(now, keys, back_days=3, hours=48 * 24, generated=None):
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=back_days)
    return {"schema": tide_own.SCHEMA, "generated_at": (generated or now).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "start": start.strftime("%Y-%m-%dT%H:%M:%S"), "hours": hours, "keys": keys}


# ---------------------------------------------------------------- builder rules
def test_schema_and_keys_match_the_served_side():
    assert OR.SCHEMA == tide_own.SCHEMA
    for lat, lng in ((21.6650, -158.0538), (33.25, -118.35), (-33.95, 151.26), (43.48, -1.56), (0.04, 0.06)):
        k = tide._round_key(lat, lng)
        assert OR.key_str(OR.round_key(lat, lng)) == tide_own.key_str(k)
    ks = OR.keys_from_spots([[21.66, -158.04], [21.64, -158.04], [21.66, -158.03], [None, 1], ["x", 2], [95, 0],
                             [10.0, 190.0]])
    assert set(ks) == {"21.7,-158.0", "21.6,-158.0", "10.0,-170.0"}


def test_fes_box_wraps_across_the_seam_and_stays_monotonic():
    lon = np.arange(0, 360, 1 / 30.0)
    for x in (0.2, 359.8, 180.0):
        ix, lo = OR.wrapped_lon_index(lon, x, 0.5)
        assert len(ix) == 31 and np.all(np.diff(lo) > 0) and lo.min() <= x <= lo.max()
    ix, lo = OR.wrapped_lon_index(lon, 180.0, 0.5)
    assert np.allclose(lo, lon[ix])                      # away from the seam: the gate's own box, unchanged


def test_window_and_levels_never_serve_tide_alone():
    start, hours = OR.window(datetime(2026, 11, 18, 15, tzinfo=UTC))
    assert start == datetime(2026, 11, 15, tzinfo=UTC) and hours == 24 * (3 + 90)       # 3 days back, 90 ahead
    a = np.array([0.5, np.nan, -0.25])
    assert OR.levels_mm(a, 0.1) == [600, None, -150]
    assert OR.levels_mm(a, None) == [None, None, None]
    assert OR.levels_mm(a, float("nan")) == [None, None, None]
    assert OR.levels_mm(None, 0.1) is None
    doc = OR.table(datetime(2026, 11, 18, tzinfo=UTC), start, 3, {"1.0,2.0": [1, None, 2], "3.0,4.0": [None] * 3,
                                                                  "5.0,6.0": None}, {"1.0,2.0": {"m": 0.1}})
    assert list(doc["keys"]) == ["1.0,2.0"] and doc["m"] == {"1.0,2.0": 0.1}
    assert tide_own.validate(doc) is not None


def test_every_keys_altimetry_cells_are_inside_its_tile_download():
    for lat, lng in ((21.7, -158.0), (0.0, 0.0), (-33.9, 151.2), (47.9, -124.7), (3.99, 7.99)):
        clat, clng, half = OR.tile_request(OR.tile_of(lat, lng))
        assert clat - half <= lat - OR.CELL_HALF and lat + OR.CELL_HALF <= clat + half
        assert clng - half <= lng - OR.CELL_HALF and lng + OR.CELL_HALF <= clng + half


def test_parity_precondition_holds_g3ts_26_values():
    sys.path.insert(0, str(BACKEND / "scripts" / "tide_fes"))
    from fes_gate import IDS
    assert set(OR.G3T_M) == set(IDS) and OR.M_PARITY_MAX_M == 0.0001
    build = (BACKEND / "scripts" / "tide_own" / "build_series.py").read_text(encoding="utf-8")
    assert build.index("ok, worst, n = m_parity(work)") < build.index("n_new = compute_m(keys_pts")   # parity first


# ---------------------------------------------------------------- served loader
def test_series_slices_from_00z_today_in_metres_and_truncates():
    now = datetime(2026, 11, 18, 15, tzinfo=UTC)
    vals = list(range(48 * 24))
    t = tide_own.validate(_table(now, {"21.7,-158.0": vals}))
    s = tide_own.series_from_table(t, (21.7, -158.0), 3, now)
    assert s["time"][0] == "2026-11-18T00:00" and len(s["time"]) == 72
    assert s["level"][0] == round(72 / 1000.0, 3)
    s16 = tide_own.series_from_table(t, (21.7, -158.0), 60, now)
    assert len(s16["time"]) == 48 * 24 - 72              # truncated to the table's end
    assert tide_own.series_from_table(t, (1.0, 1.0), 3, now) is None
    # NEVER MISSING: the harmonic tide is deterministic, so an old table still serves for as long as it covers today
    old = tide_own.validate(_table(now, {"21.7,-158.0": vals}, generated=now - timedelta(days=8)))
    assert tide_own.series_from_table(old, (21.7, -158.0), 3, now)["source"] == "am"
    ended = tide_own.validate(_table(now, {"21.7,-158.0": vals}, back_days=60))        # its axis ended before today
    assert tide_own.series_from_table(ended, (21.7, -158.0), 3, now) is None
    assert tide_own.series_from_table(None, (21.7, -158.0), 3, now) is None
    nulls = tide_own.validate(_table(now, {"21.7,-158.0": [None] * (48 * 24)}))
    assert tide_own.series_from_table(nulls, (21.7, -158.0), 3, now) is None


def test_compact_series_round_trip_and_stay_small():
    """The builder writes each series as base64 int16 (the advisor's #1066 point 4: decoding lists of ints peaked at
    about 122 MB in the serving process; the compact form peaks at about 28 MB, measured 2026-11-18, 1,800 keys)."""
    assert OR.MISSING_I16 == tide_own._MISSING == -32768
    now = datetime(2026, 11, 18, 15, tzinfo=UTC)
    vals = [None, 1250, -32767, 32767] + [7] * (48 * 24 - 4)       # the int16 range: +-32.767 m, -32768 = no value
    t = _table(now, {"21.7,-158.0": vals})
    t["cmems"] = {"21.7,-158.0": [None] * (48 * 24)}
    enc = OR.encode_table(t)
    assert isinstance(enc["keys"]["21.7,-158.0"], str) and enc["encoding"] == "i16le-base64"
    got = tide_own.validate(enc)
    a = got["am"]["21.7,-158.0"]
    assert a.typecode == "h" and list(a[:4]) == [-32768, 1250, -32767, 32767]
    for out_of_range in (32768, -32768, 40000):                     # refused at write, never clipped
        with pytest.raises(ValueError):
            OR.encode_i16([0, out_of_range])
    assert tide_own.validate(t)["am"]["21.7,-158.0"][1] == 1250          # the list form still loads
    s = tide_own.series_from_table(got, (21.7, -158.0), 3, now)
    assert s["source"] == "am" and s["level"][0] == 0.007                # CMEMS all-null: falls to A+M
    bad = dict(enc, keys={"21.7,-158.0": enc["keys"]["21.7,-158.0"][:-4]})
    assert tide_own.validate(bad) is None                                # wrong length refused


def test_an_old_schema_table_is_refused_not_misread():
    """The format changed (int16 base64), so the schema is /2; a /1 table is refused rather than misread."""
    assert tide_own.SCHEMA == OR.SCHEMA == "raw-surf/tide-own/2"
    now = datetime(2026, 11, 18, tzinfo=UTC)
    old = dict(_table(now, {"1.0,1.0": [1] * (48 * 24)}), schema="raw-surf/tide-own/1")
    assert tide_own.validate(old) is None


def test_the_product_cleanup_sweep_cannot_touch_the_table():
    """The advisor's condition 2 on PR A: the first build writes to the production bucket under tide_own/. The product
    object GC (#1005) lists only TOP-LEVEL objects and touches only names in the product grammar, so neither object can
    ever be marked or deleted by it."""
    from services.weather_pipeline import product_object_gc as GC
    for name in ("tide_own/series.json.gz", "tide_own/m.json", "series.json.gz", "m.json"):
        assert not GC.is_product_object(name)
    src = (BACKEND / "scripts" / "tide_own" / "storage_io.py").read_text(encoding="utf-8")
    assert 'PREFIX = "tide_own/"' in src                         # every write is under the prefix


def test_validate_rejects_bad_shapes():
    now = datetime(2026, 11, 18, tzinfo=UTC)
    assert tide_own.validate(None) is None and tide_own.validate({"schema": "x"}) is None
    assert tide_own.validate(_table(now, {"1.0,1.0": [1, 2]})) is None          # wrong length
    assert tide_own.validate(_table(now, {}, hours=0)) is None


def test_a_failed_read_keeps_the_last_good_table():
    now = datetime.now(UTC)
    good = _table(now, {"21.7,-158.0": [500] * (48 * 24)})
    calls = {"n": 0}

    def fetcher():
        calls["n"] += 1
        if calls["n"] == 1:
            return good
        raise OSError("storage down")
    tide_own._reset_for_tests(fetcher)
    try:
        assert tide_own._load_sync(1000.0) is not None
        assert tide_own._load_sync(1000.0 + 10 * tide_own._TTL_S) is not None    # failed refresh: last good kept
    finally:
        tide_own._reset_for_tests()


# ---------------------------------------------------------------- CMEMS fill (builder)
def test_cmems_fill_helpers_place_hours_and_pick_the_parity_cell():
    start = datetime(2026, 11, 15, tzinfo=UTC)
    assert OR.hour_index(start, int(start.timestamp()) + 7200) == 2
    assert OR.hour_index(start, int(start.timestamp()) + 1800) is None
    vals = OR.place_hourly(4, [0, 2, 9, None], [0.5, float("nan"), 1.0, 2.0])
    assert vals == [500, None, None, None]
    lats, lons = np.arange(20.0, 22.0, 1 / 12), np.arange(-159.0, -157.0, 1 / 12)
    iy, ix = OR.nearest_cell(lats, lons, (21.3, -157.9))
    assert abs(lats[iy] - 21.3) <= 1 / 24 and abs(lons[ix] + 157.9) <= 1 / 24
    assert OR.CMEMS_DATASET == "cmems_mod_glo_phy_anfc_merged-sl_PT1H-i"
    build = (BACKEND / "scripts" / "tide_own" / "build_series.py").read_text(encoding="utf-8")
    assert 'if args.cmems == "1":' in build                                  # CMEMS only after the parity PASS
    assert "vars.TIDE_CMEMS_PRIMARY || '0'" in WF


# ---------------------------------------------------------------- the served switch (PR B)
# REPLACES PR A's `test_nothing_served_reads_the_table_yet` deliberately (the advisor's condition 4): that pin held the
# served path off the table until a real table existed (run 44681599129 stored the first one, 1,061 keys, 2026-11-20).
# PR B wires tide.fetch_tide_hourly to it, so the pin becomes the opposite guarantee: ONLY tide.py reaches tide_own, and
# no served path reaches Open-Meteo for the tide.
class _NoClient:
    async def get(self, url):                            # the owner: no Open-Meteo in any user-facing number
        raise AssertionError(f"Open-Meteo requested: {url}")


@pytest.fixture
def served(monkeypatch):
    monkeypatch.delenv("TIDE_LEGACY_OPEN_METEO", raising=False)
    monkeypatch.delenv("SURF_TIDE_OWN", raising=False)
    monkeypatch.delenv("SURF_TIDE_CMEMS", raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    tide._reset_tide_cache_for_test()
    yield
    tide_own._reset_for_tests()
    tide._reset_tide_cache_for_test()


def _two_source_table(now, generated=None):
    t = _table(now, {"21.7,-158.0": [250] * (48 * 24), "10.0,10.0": [400] * (48 * 24)}, generated=generated)
    cm = [None] * (48 * 24)
    for i in range(72, 72 + 9 * 24):                     # CMEMS covers today .. +9 days, as the product does
        cm[i] = 1300
    t["cmems"] = {"21.7,-158.0": cm}
    return t


def test_only_tide_py_reads_the_table():
    pat = re.compile(r"^\s*(from|import)\s+.*\btide_own\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    users = [p.name for p in served if p.is_file() and p.name != "tide_own.py"
             and pat.search(p.read_text(encoding="utf-8", errors="ignore"))]
    assert users == ["tide.py"]


def test_the_exact_attribution_is_served_and_stored_with_every_series():
    """The advisor's PR B condition (b): the AVISO acknowledgement, verbatim, plus the Copernicus credit for M, are
    STORED in every table (own_rules.encode_table) and SERVED with every series; one text, pinned equal."""
    from services.weather_pipeline import tide_credits as TC
    exact = "funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available by AVISO"
    assert exact in TC.CREDITS["am"] and "Copernicus Marine" in TC.CREDITS["am"] and TC.FES_LICENCE in TC.CREDITS["am"]
    cite = ("CNES, 2024. FES2022 (Finite Element Solution) Tidal model (Version 2024). CNES. "
            "https://doi.org/10.24400/527896/A01-2024.004")                # licence s.3.1: the citation, in the hub too
    assert TC.FES_CITATION == cite and cite in TC.CREDITS["am"]
    assert "Copernicus Marine" in TC.CREDITS["cmems"]
    assert OR.CREDITS == TC.CREDITS                                        # the CI copy equals the served text
    assert "heights above local mean sea level" in tide_own.LABELS["am"][0]   # the datum users now see, stated
    now = datetime(2026, 11, 20, tzinfo=UTC)
    stored = OR.encode_table(_table(now, {"21.7,-158.0": [250] * (48 * 24)}))
    assert stored["credits"] == TC.CREDITS
    s = tide_own.series_from_table(tide_own.validate(stored), (21.7, -158.0), 3, now)
    assert s["credit"] == TC.CREDITS["am"] and exact in s["credit"]
    import importlib.util                                                  # the readout's full text uses the same ack
    spec = importlib.util.spec_from_file_location("wpt_credit_check", BACKEND / "routes" / "weather_point_tide.py")
    WPT = importlib.util.module_from_spec(spec)                            # by path: not the whole routes package
    spec.loader.exec_module(WPT)
    assert WPT.FES_ACK == TC.FES_ACK and exact in WPT.provider_for({"source": "am"})[2]


def test_served_default_is_our_harmonic_tide_and_never_open_meteo(served):
    """SURF_TIDE_OWN ON, SURF_TIDE_CMEMS held OFF (condition 5): every key with a table row serves A+M."""
    from services.runtime_flags import GUARDED
    assert GUARDED["SURF_TIDE_OWN"] == "1" and GUARDED["SURF_TIDE_CMEMS"] == "0"
    now = datetime.now(UTC)
    tide_own._reset_for_tests(lambda: _two_source_table(now))
    assert tide.tide_source() == "own"
    s = asyncio.run(tide.fetch_tide_hourly(21.66, -158.04, client=_NoClient()))
    assert s["source"] == "am" and s["level"][0] == 0.25 and "FES2022" in s["credit"]
    assert asyncio.run(tide.fetch_tide_hourly(-5.0, -5.0, client=_NoClient())) is None   # no row: unavailable
    assert asyncio.run(tide.prewarm_tide_cache([(21.66, -158.04), (10.0, 10.0), (-5.0, -5.0)],
                                               client=_NoClient())) == 2


def test_cmems_on_prefers_the_cmems_level_where_the_table_has_it(served, monkeypatch):
    monkeypatch.setenv("SURF_TIDE_CMEMS", "1")
    now = datetime.now(UTC)
    tide_own._reset_for_tests(lambda: _two_source_table(now))
    s = asyncio.run(tide.fetch_tide_hourly(21.66, -158.04, client=_NoClient()))
    assert s["source"] == "cmems" and s["level"][0] == 1.3 and "Copernicus" in s["credit"]
    h = asyncio.run(tide.fetch_tide_hourly(10.0, 10.0, client=_NoClient()))          # no CMEMS series for this key
    assert h["source"] == "am" and h["level"][0] == 0.4


def test_a_missing_table_is_unavailable_not_open_meteo(served):
    """Condition 3, the owner's choice to confirm: no table (before a build, or a failed first read) = NO tide shown."""
    tide_own._reset_for_tests(lambda: None)
    assert asyncio.run(tide.fetch_tide_hourly(21.66, -158.04, client=_NoClient())) is None
    assert asyncio.run(tide.prewarm_tide_cache([(21.66, -158.04)], client=_NoClient())) == 0


# ---------------------------------------------------------------- never missing (the owner, 2026-11-22)
def _guard():
    import importlib.util
    spec = importlib.util.spec_from_file_location("publish_guard", BACKEND / "scripts" / "tide_own" / "publish_guard.py")
    PG = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(PG)
    return PG


def test_build_failed_for_weeks_the_tide_still_serves(served, monkeypatch):
    """BUILD FAILED: a table generated 30 days ago still serves the harmonic tide (deterministic) for as long as its
    axis covers today; its CMEMS forecast does NOT serve (it ages past _CMEMS_MAX_AGE_S)."""
    monkeypatch.setenv("SURF_TIDE_CMEMS", "1")
    now = datetime.now(UTC)
    t = _two_source_table(now, generated=now - timedelta(days=30))
    tide_own._reset_for_tests(lambda: t)
    s = asyncio.run(tide.fetch_tide_hourly(21.66, -158.04, client=_NoClient()))
    assert s["source"] == "am" and s["level"][0] == 0.25                     # not the aged CMEMS 1.3
    assert OR.AHEAD_DAYS >= 90                                               # the build publishes months ahead


def test_storage_down_falls_back_to_previous_then_memory_then_disk(served, tmp_path):
    """STORAGE DOWN: the published table unreadable -> the previous good one; both down -> the in-memory table;
    a cold start with both down -> the copy on local disk. Only with all four gone is the tide unavailable."""
    now = datetime.now(UTC)
    good = OR.encode_table(_two_source_table(now))

    def down():
        raise OSError("storage down")
    disk = str(tmp_path / "series.json.gz")
    tide_own._reset_for_tests(down, prev_fetcher=lambda: good, disk_path=disk)       # previous good table
    assert tide_own._load_sync(1000.0) is not None
    assert (tmp_path / "series.json.gz").exists()                                     # and kept on disk
    tide_own._reset_for_tests(down, prev_fetcher=down, disk_path=disk)               # cold start, all storage down
    t = tide_own._load_sync(2000.0)
    assert t is not None and "21.7,-158.0" in t["am"]                                 # served from the disk copy
    tide_own._reset_for_tests(down, prev_fetcher=down, disk_path=str(tmp_path / "none.json.gz"))
    assert tide_own._load_sync(3000.0) is None                                        # nothing anywhere: unavailable


def gzip_bytes(doc):
    import gzip as _gz
    return _gz.compress(json.dumps(doc).encode("utf-8"))


def test_single_flight_one_fetch_however_many_callers(served):
    """The advisor on #1138: during a reload (warm) or a cold start, N concurrent callers cause exactly ONE download
    and decode; warm callers get the current table without waiting."""
    import threading
    import time as _t
    now = datetime.now(UTC)
    calls = {"n": 0}

    def slow():
        calls["n"] += 1
        _t.sleep(0.3)
        return _two_source_table(now)
    for warm in (False, True):
        tide_own._reset_for_tests(slow)
        if warm:
            tide_own._load_sync(1000.0)                                   # a table in memory, then its TTL lapses
        calls["n"] = 0
        t_req = 1000.0 + 10 * tide_own._TTL_S
        out, started = [], _t.monotonic()
        ths = [threading.Thread(target=lambda: out.append(tide_own._load_sync(t_req))) for _ in range(10)]
        for th in ths:
            th.start()
        for th in ths:
            th.join()
        assert calls["n"] == 1, f"warm={warm}: {calls['n']} fetches"
        assert len(out) == 10 and all(t is not None for t in out)
        assert _t.monotonic() - started < 2.0


def test_conditional_get_skips_an_unchanged_table(served, monkeypatch):
    """If-None-Match with the last ETag: a 304 refreshes the TTL without downloading or decoding the table again."""
    import requests
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    body = gzip_bytes(OR.encode_table(_two_source_table(datetime.now(UTC))))
    seen = []

    class R:
        def __init__(self, code, content=b"", etag=None):
            self.status_code, self.content, self.headers = code, content, ({"ETag": etag} if etag else {})

        def raise_for_status(self):
            if self.status_code >= 400:
                raise requests.HTTPError(str(self.status_code))

    def fake_get(url, headers=None, timeout=None):
        seen.append(dict(headers or {}))
        if headers and headers.get("If-None-Match") == '"v1"':
            return R(304)
        return R(200, body, '"v1"') if "prev" not in url else R(404)
    monkeypatch.setattr(requests, "get", fake_get)
    tide_own._reset_for_tests(None, prev_fetcher=lambda: None)
    decodes = {"n": 0}
    real = tide_own.validate
    monkeypatch.setattr(tide_own, "validate", lambda d: (decodes.__setitem__("n", decodes["n"] + 1), real(d))[1])
    first = tide_own._load_sync(1000.0)
    again = tide_own._load_sync(1000.0 + 10 * tide_own._TTL_S)
    assert first is not None and again is first
    assert seen[-1].get("If-None-Match") == '"v1"' and decodes["n"] == 1


def test_an_older_table_never_replaces_a_newer_one(served):
    now = datetime.now(UTC)
    new, old = _two_source_table(now), _two_source_table(now, generated=now - timedelta(days=3))
    seq = iter([new, None])
    tide_own._reset_for_tests(lambda: next(seq), prev_fetcher=lambda: old)
    first = tide_own._load_sync(1000.0)
    second = tide_own._load_sync(1000.0 + 10 * tide_own._TTL_S)                      # published gone, prev is older
    assert second["generated_at"] == first["generated_at"]


def test_partial_short_or_shrunken_tables_are_never_published():
    """PARTIAL BUILD: the publish guard refuses a table that is short, has lost keys, or has keys with no values."""
    PG = _guard()
    assert PG.SCHEMA == OR.SCHEMA == tide_own.SCHEMA
    now = datetime.now(UTC)
    hours = 24 * (OR.BACK_DAYS + OR.AHEAD_DAYS)
    full = OR.encode_table(_table(now, {f"{i}.0,1.0": [100] * hours for i in range(40)}, hours=hours))
    assert PG.check(full, full, now) == [] and PG.check(full, None, now) == []
    short = OR.encode_table(_table(now, {f"{i}.0,1.0": [100] * (30 * 24) for i in range(40)}, hours=30 * 24))
    assert any("days ahead" in w for w in PG.check(short, full, now))
    shrunk = OR.encode_table(_table(now, {f"{i}.0,1.0": [100] * hours for i in range(30)}, hours=hours))
    assert any("fewer than 95%" in w for w in PG.check(shrunk, full, now))
    empty_vals = {f"{i}.0,1.0": ([100] * hours if i < 30 else [None] * hours) for i in range(40)}
    hollow = OR.encode_table(_table(now, empty_vals, hours=hours))
    assert any("have a value" in w for w in PG.check(hollow, full, now))
    assert PG.check(dict(full, schema="raw-surf/tide-own/1"), full, now)


def test_the_horizon_alert_fires_below_30_days(tmp_path, capsys):
    import gzip as _gz
    PG = _guard()
    now = datetime.now(UTC)
    p = tmp_path / "t.json.gz"
    p.write_bytes(_gz.compress(json.dumps(_table(now, {"1.0,1.0": [1] * (20 * 24)}, hours=20 * 24)).encode()))
    assert PG.main(["horizon", str(p), "--min-days", "30"]) == 1 and "::error" in capsys.readouterr().out
    p.write_bytes(_gz.compress(json.dumps(_table(now, {"1.0,1.0": [1] * (60 * 24)}, hours=60 * 24)).encode()))
    assert PG.main(["horizon", str(p), "--min-days", "30"]) == 0
    assert PG.main(["horizon", str(tmp_path / "missing.json.gz")]) == 1          # no table at all also alerts


def test_the_workflow_guards_keeps_the_previous_table_and_always_checks_the_horizon():
    i_guard = WF.index("publish_guard.py guard tide_own_series.json.gz")
    i_prev = WF.index("put current_series.json.gz series.prev.json.gz")
    i_pub = WF.index("put tide_own_series.json.gz series.json.gz")
    assert i_guard < i_prev < i_pub                                  # guard first; the old table kept before the swap
    horizon = WF.split("\n  horizon:")[1]
    assert "needs: build" in horizon and "if: always()" in horizon and "publish_guard.py horizon" in horizon
    steps = re.split(r"\n      - ", WF)
    assert all("secrets." not in s for s in steps if "publish_guard.py" in s)


def test_tide_kill_serves_no_tide_and_never_reads_or_requests(served, monkeypatch):
    monkeypatch.setenv("SURF_TIDE_OWN", "0")
    tide_own._reset_for_tests(lambda: pytest.fail("the table must not be read when killed"))
    assert tide.tide_source() == "off"
    assert asyncio.run(tide.fetch_tide_hourly(21.66, -158.04, client=_NoClient())) is None
    assert asyncio.run(tide.prewarm_tide_cache([(21.66, -158.04)], client=_NoClient())) == 0


def test_no_deploy_or_workflow_sets_the_legacy_open_meteo_path():
    files = [*(REPO / ".github" / "workflows").glob("*.yml"), *REPO.glob("render*.y*ml"), *REPO.glob("netlify.toml"),
             *BACKEND.glob("*.env.example"), *REPO.glob("*.env.example")]
    hits = [p.name for p in files if "TIDE_LEGACY_OPEN_METEO" in p.read_text(encoding="utf-8", errors="ignore")]
    assert hits == []
    src = (BACKEND / "services" / "weather_pipeline" / "tide.py").read_text(encoding="utf-8")
    assert 'os.environ.get("TIDE_LEGACY_OPEN_METEO") == "1"' in src         # raw env only: never the manifest
    from services.runtime_flags import GUARDED
    assert "TIDE_LEGACY_OPEN_METEO" not in GUARDED


def test_served_backend_never_imports_pyfes_or_the_builder():
    pat = re.compile(r"^\s*(from|import)\s+.*\b(pyfes|tide_own\.build_series|own_rules|build_series|storage_io)\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p.name for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []


# ---------------------------------------------------------------- workflow
def test_the_served_delta_keeps_no_file_and_carries_no_credential():
    """The owner, 2026-11-20: "we dont need to let people download anything". The build measures PR B's before/after in
    the job and writes ONLY summary numbers to the step summary: no artifact anywhere in the workflow, no secret on the
    step, and the publish never waits on it."""
    assert "upload-artifact" not in WF
    steps = re.split(r"\n      - ", WF)
    d = [s for s in steps if "served_delta.py" in s]
    assert len(d) == 1 and "secrets." not in d[0] and "env:" not in d[0]
    assert "python3 -I -S backend/scripts/tide_own/served_delta.py" in d[0] and '--summary "$GITHUB_STEP_SUMMARY"' in d[0]
    assert "continue-on-error: true" in d[0]


def test_served_delta_metrics_on_a_known_pair():
    import importlib.util
    spec = importlib.util.spec_from_file_location("served_delta", BACKEND / "scripts" / "tide_own" / "served_delta.py")
    SD = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(SD)
    assert SD.decode_i16(OR.encode_i16([1250, None, -7])) == [1250, None, -7]
    t = [i for i in range(72)]
    before = [math.sin(2 * math.pi * h / 12.42) for h in t]                     # a pure semidiurnal tide, metres
    ours = [0.30 + 1.1 * math.sin(2 * math.pi * (h - 1) / 12.42) for h in t]    # +0.30 m, 10% larger, 1 h later
    r = SD.compare(ours, before)
    assert abs(r["offset_m"] - 0.30) < 0.02 and abs(r["range_ratio"] - 1.1) < 0.02 and r["timing_h"] == 1
    assert SD.compare(ours[:10], before[:10]) is None                           # < 24 paired hours: not compared
    md = SD.summarize([r], 5, 4)
    assert "| +0.3" in md and "| 1.10 |" in md and "Not measured here" in md
    assert "21.7" not in md                                                     # summary numbers only, no per-key rows
    # the advisor's limit 1: the "with a before series" count comes first and flags a thin comparison
    assert md.index("With a before series: 4 of 5 keys (80%)") < md.index("| metric")
    assert "NOT TRUSTED" in md and "NOT TRUSTED" not in SD.summarize([r], 10, 9)
    # the advisor's limit 2: the table must start at or before today's 00Z and cover the 72-hour window
    day0 = datetime(2026, 11, 20, tzinfo=UTC)
    assert SD.window_offset(day0 - timedelta(days=3), day0, 48 * 24) == 72
    for bad_start, hours in ((day0 + timedelta(hours=1), 48 * 24), (day0 - timedelta(days=3), 100)):
        with pytest.raises(ValueError):
            SD.window_offset(bad_start, day0, hours)


def test_workflow_scopes_each_credential_to_its_steps():
    steps = re.split(r"\n      - ", WF)
    for s in steps:
        if "AVISO_PASSWORD" in s:
            assert "--download-fes-only" in s
        if "COPERNICUSMARINE_SERVICE_PASSWORD" in s:
            assert "build_series.py --spots spots.json" in s and "SUPABASE" not in s
        if "SUPABASE_SERVICE_ROLE_KEY" in s:
            runs = re.findall(r"python3? [^\n]*", s)
            assert runs and all(r.startswith("python3 -I -S backend/scripts/tide_own/storage_io.py") for r in runs)
    assert WF.count("secrets.SUPABASE_SERVICE_ROLE_KEY") == 5 and WF.count("secrets.AVISO_PASSWORD") == 1
    code = "\n".join(ln.split("#")[0] for ln in WF.splitlines())
    assert "tags:" not in code and "workflow_dispatch" in code and "contents: read" in WF and "contents: write" not in WF
    build = WF.split("\n  build:")[1]
    assert "environment: supabase-service" in build      # the key lives only in the dev/main environment (#1043)
    cron = re.search(r"cron: '(\d+) (\d+) ", WF)
    assert cron and not (3 <= int(cron.group(2)) <= 5)


def test_storage_io_get_treats_only_a_real_not_found_as_absent():
    """A missing object is absent (Supabase: HTTP 400 with statusCode "404"); any other error, including a bare 400 or
    an auth 401/403, must fail the step instead of silently recomputing the M cache."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("storage_io", BACKEND / "scripts" / "tide_own" / "storage_io.py")
    sio = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sio)
    real = b'{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}'  # seen 2026-11-20
    assert sio.is_not_found(400, real)
    assert sio.is_not_found(400, b'{"error":"not_found"}') and sio.is_not_found(404, b"")
    unseen = b'{"statusCode":"404","error":"Bucket not found","message":"Bucket not found","code":"NoSuchBucket"}'
    assert not sio.is_not_found(400, unseen)                   # a key that cannot see the bucket is a fault
    assert not sio.is_not_found(400, b'{"statusCode":"404"}')  # statusCode alone is not enough
    assert not sio.is_not_found(400, b'{"statusCode":"403","error":"Unauthorized","message":"invalid signature"}')
    assert not sio.is_not_found(400, b"") and not sio.is_not_found(400, b"<html>")
    assert not sio.is_not_found(401, b'{"statusCode":"404"}') and not sio.is_not_found(403, b"")
    src = (BACKEND / "scripts" / "tide_own" / "storage_io.py").read_text(encoding="utf-8")
    assert "treated as absent" not in src and "failing the step" in src


def test_storage_io_writes_only_three_names_under_tide_own():
    src = (BACKEND / "scripts" / "tide_own" / "storage_io.py").read_text(encoding="utf-8")
    assert 'ALLOWED = {"series.json.gz", "series.prev.json.gz", "m.json"}' in src and 'PREFIX = "tide_own/"' in src
    assert re.findall(r"^\s*(?:import|from)\s+(\w+)", src, re.M) == ["json", "os", "sys", "urllib", "urllib"]
    assert "print(key" not in src and "print(base" not in src


def test_t1_cold_waiters_after_a_failed_load_do_not_rerun_the_fetch_chain(served):
    """T1 (the advisor on #1138): cold callers waiting on the gate while the one loader FAILS get the (absent) table
    inside the cooldown; they never re-run the published / previous / disk chain one after another."""
    import threading
    import time as _t
    calls = {"pub": 0, "prev": 0}

    def down():
        calls["pub"] += 1
        _t.sleep(0.3)
        return None

    def prev_down():
        calls["prev"] += 1
        return None
    tide_own._reset_for_tests(down, prev_fetcher=prev_down)
    out = []
    ths = [threading.Thread(target=lambda: out.append(tide_own._load_sync(1000.0))) for _ in range(6)]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    assert calls == {"pub": 1, "prev": 1}, calls                    # one chain, not one per waiter
    assert out == [None] * 6
    assert tide_own._state["fail_until"] == 1000.0 + tide_own._FAIL_COOLDOWN_S


def test_t2_an_etag_is_adopted_only_with_a_valid_published_table(served):
    """T2 (the advisor on #1138): the published read records its ETag before validate; when that table is refused and
    the previous one serves, the refused table's ETag is dropped, never adopted (the next read is unconditional)."""
    now = datetime.now(UTC)

    def refused():
        tide_own._state["pending_etag"] = '"refused"'              # what _fetch_bucket does on a 200
        return {"schema": "not-ours"}                               # ...for a table validate refuses
    tide_own._reset_for_tests(refused, prev_fetcher=lambda: _two_source_table(now))
    got = tide_own._load_sync(1000.0)
    assert got is not None                                          # the previous good table serves
    assert tide_own._state["etag"] is None and "pending_etag" not in tide_own._state

    def valid():
        tide_own._state["pending_etag"] = '"v2"'
        return _two_source_table(now)
    tide_own._reset_for_tests(valid)
    tide_own._load_sync(1000.0)
    assert tide_own._state["etag"] == '"v2"' and "pending_etag" not in tide_own._state   # adopted on the published branch


def test_t3_the_load_runs_on_its_own_single_worker_and_warm_callers_never_queue(served, monkeypatch):
    """T3 (the advisor on #1138): the load never takes a default-executor thread (on 1 CPU those could all park for
    the timeout); it runs on a dedicated one-worker executor, and a caller holding a table while a load runs answers
    at once without the executor."""
    import threading
    assert tide_own._EXECUTOR._max_workers == 1
    monkeypatch.setattr(asyncio, "to_thread", lambda *a, **k: pytest.fail("the default executor must not be used"))
    now = datetime.now(UTC)
    ran_on = []

    def fetch():
        ran_on.append(threading.current_thread().name)
        return _two_source_table(now)
    tide_own._reset_for_tests(fetch)
    s = asyncio.run(tide_own.fetch_series((21.7, -158.0), 3, prefer_cmems=False))
    assert s is not None and s["source"] == "am"
    assert ran_on and ran_on[0].startswith("tide-own-load")         # the dedicated worker, not the default pool
    with tide_own._lock:
        tide_own._state["read_at"] = 0.0                              # the table is now stale...
    assert tide_own._load_gate.acquire(blocking=False)               # ...and a reload is in progress
    try:
        monkeypatch.setattr(tide_own._EXECUTOR, "submit", lambda *a, **k: pytest.fail("a warm caller must not queue"))
        s2 = asyncio.run(tide_own.fetch_series((21.7, -158.0), 3, prefer_cmems=False))
        assert s2 is not None and s2["source"] == "am" and len(ran_on) == 1
    finally:
        tide_own._load_gate.release()
