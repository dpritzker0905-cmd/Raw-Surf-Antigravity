"""The own-data served tide (owner 2026-11-18: "No user data should be open-meteo").

Pins: the table builder's pure rules (keys equal the served cache keys, seam-wrapped FES boxes, the window, A+M in mm,
never A alone, the M tile covers every key's cells, G3t's M values for the parity precondition); the served loader
(shape check, slicing from 00Z today, truncation, staleness, absent key = unavailable, a failed read keeps the last
good table); the dispatch (own by default, the kill switch gives NO tide and NO Open-Meteo request, the legacy path only
through the raw test env, which no deploy or workflow sets); the workflow's credential scoping; and that PyFES and the
builder never enter the served backend."""
import asyncio
import json
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
    assert start == datetime(2026, 11, 15, tzinfo=UTC) and hours == 48 * 24
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
    old = tide_own.validate(_table(now, {"21.7,-158.0": vals}, generated=now - timedelta(days=8)))
    assert tide_own.series_from_table(old, (21.7, -158.0), 3, now) is None
    assert tide_own.series_from_table(None, (21.7, -158.0), 3, now) is None
    nulls = tide_own.validate(_table(now, {"21.7,-158.0": [None] * (48 * 24)}))
    assert tide_own.series_from_table(nulls, (21.7, -158.0), 3, now) is None


def test_compact_series_round_trip_and_stay_small():
    """The builder writes each series as base64 int16 (the advisor's #1066 point 4: decoding lists of ints peaked at
    about 122 MB in the serving process; the compact form peaks at about 28 MB, measured 2026-11-18, 1,800 keys)."""
    assert OR.MISSING_I16 == tide_own._MISSING == -32768
    now = datetime(2026, 11, 18, 15, tzinfo=UTC)
    vals = [None, 1250, -40000, 40000] + [7] * (48 * 24 - 4)
    t = _table(now, {"21.7,-158.0": vals})
    t["cmems"] = {"21.7,-158.0": [None] * (48 * 24)}
    enc = OR.encode_table(t)
    assert isinstance(enc["keys"]["21.7,-158.0"], str) and enc["encoding"] == "i16le-base64"
    got = tide_own.validate(enc)
    a = got["am"]["21.7,-158.0"]
    assert a.typecode == "h" and list(a[:4]) == [-32768, 1250, -32767, 32767]
    assert tide_own.validate(t)["am"]["21.7,-158.0"][1] == 1250          # the list form still loads
    s = tide_own.series_from_table(got, (21.7, -158.0), 3, now)
    assert s["source"] == "am" and s["level"][0] == 0.007                # CMEMS all-null: falls to A+M
    bad = dict(enc, keys={"21.7,-158.0": enc["keys"]["21.7,-158.0"][:-4]})
    assert tide_own.validate(bad) is None                                # wrong length refused


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


def test_nothing_served_reads_the_table_yet():
    """PR A (the builder and the loader) changes no served number: no served module imports tide_own until the
    served switch (PR B) wires tide.fetch_tide_hourly to it, after the first table is in the bucket."""
    pat = re.compile(r"^\s*(from|import)\s+.*\btide_own\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    users = [p.name for p in served if p.is_file() and p.name != "tide_own.py"
             and pat.search(p.read_text(encoding="utf-8", errors="ignore"))]
    assert users == []


def test_served_backend_never_imports_pyfes_or_the_builder():
    pat = re.compile(r"^\s*(from|import)\s+.*\b(pyfes|tide_own\.build_series|own_rules|build_series|storage_io)\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p.name for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []


# ---------------------------------------------------------------- workflow
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
    assert WF.count("secrets.SUPABASE_SERVICE_ROLE_KEY") == 3 and WF.count("secrets.AVISO_PASSWORD") == 1
    code = "\n".join(ln.split("#")[0] for ln in WF.splitlines())
    assert "tags:" not in code and "workflow_dispatch" in code and "contents: read" in WF and "contents: write" not in WF
    build = WF.split("\n  build:")[1]
    assert "environment: supabase-service" in build      # the key lives only in the dev/main environment (#1043)
    cron = re.search(r"cron: '(\d+) (\d+) ", WF)
    assert cron and not (3 <= int(cron.group(2)) <= 5)


def test_storage_io_writes_only_two_names_under_tide_own():
    src = (BACKEND / "scripts" / "tide_own" / "storage_io.py").read_text(encoding="utf-8")
    assert 'ALLOWED = {"series.json.gz", "m.json"}' in src and 'PREFIX = "tide_own/"' in src
    assert re.findall(r"^\s*(?:import|from)\s+(\w+)", src, re.M) == ["json", "os", "sys", "urllib", "urllib"]
    assert "print(key" not in src and "print(base" not in src
