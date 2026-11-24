"""The served table's two A arms (gates/tide-a-harcon-v1.md s2; gates/tide-guard-v1.md s2 and T6; #1283 L1).

T6: serve picks `am_h` only when SURF_TIDE_A_HARCON is ON, `am` otherwise, read at serve time, so the kill acts on the
next request with no rebuild. The build writes `am_h` at every key where w > 0 with the A gate instrument's OWN weight
and blend, carries NOAA's public-domain credit, and adds the TIDE guard's monitor keys. A malformed `am_h` is dropped,
never the table."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts" / "tide_own"))
sys.path.insert(0, str(BACKEND / "scripts" / "tide_datum"))
import harcon_arm as HA                                  # noqa: E402
import own_rules as OR                                   # noqa: E402
import a_harcon_parity as AP                             # noqa: E402
from services import runtime_flags as rf                 # noqa: E402
from services.weather_pipeline import tide, tide_own, tide_credits as TC   # noqa: E402

UTC = timezone.utc
K = "21.7,-158.0"
N = 48 * 24


def _doc(now, am_h=None):
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=3)
    d = {"schema": tide_own.SCHEMA, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "start": start.strftime("%Y-%m-%dT%H:%M:%S"), "hours": N, "keys": {K: [250] * N, "10.0,10.0": [400] * N}}
    d["am_h"] = {K: [300] * N} if am_h is None else am_h
    return d


@pytest.fixture
def served(monkeypatch):
    for v in ("TIDE_LEGACY_OPEN_METEO", "SURF_TIDE_OWN", "SURF_TIDE_CMEMS", "SURF_TIDE_A_HARCON"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    tide._reset_tide_cache_for_test()
    rf._reset_for_tests(snapshot={})
    yield
    tide_own._reset_for_tests()
    tide._reset_tide_cache_for_test()
    rf._reset_for_tests()


def _serve():
    return asyncio.run(tide.fetch_tide_hourly(21.66, -158.04))


# ---- T6: serve selection by flag; the kill acts at once ------------------------------------------------------------
def test_T6_the_flag_off_serves_am_and_on_serves_am_h_with_both_credits(served, monkeypatch):
    now = datetime.now(UTC)
    tide_own._reset_for_tests(lambda: _doc(now))
    assert rf.GUARDED["SURF_TIDE_A_HARCON"] == "0"
    s = _serve()
    assert s["source"] == "am" and s["level"][0] == 0.25                     # code default '0': FES
    monkeypatch.setenv("SURF_TIDE_A_HARCON", "1")
    s = _serve()
    assert s["source"] == "am_h" and s["level"][0] == 0.30
    assert "public domain" in s["credit"] and "FES2022" in s["credit"]
    h = asyncio.run(tide.fetch_tide_hourly(10.0, 10.0))                      # no am_h at this key: am serves
    assert h["source"] == "am" and h["level"][0] == 0.4


def test_T6_a_manifest_kill_returns_the_fes_arm_on_the_next_request_with_no_rebuild(served, monkeypatch):
    now = datetime.now(UTC)
    tide_own._reset_for_tests(lambda: _doc(now))
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "1")
    state = {"flags": {"SURF_TIDE_A_HARCON": {"state": "on"}}}
    rf._reset_for_tests(fetcher=lambda: {"schema": rf.SCHEMA, "flags": dict(state["flags"])}, snapshot={})
    assert _serve()["source"] == "am_h"
    state["flags"] = {"SURF_TIDE_A_HARCON": {"state": "off", "set_by": "flag-guardrail", "reason": "test kill"}}
    rf._reset_for_tests(fetcher=lambda: {"schema": rf.SCHEMA, "flags": dict(state["flags"])}, snapshot={})
    assert _serve()["source"] == "am"                                       # same table object: no rebuild


def test_a_malformed_am_h_is_dropped_never_the_table(served, monkeypatch):
    monkeypatch.setenv("SURF_TIDE_A_HARCON", "1")
    now = datetime.now(UTC)
    tide_own._reset_for_tests(lambda: _doc(now, am_h={K: [300] * 7}))        # wrong length
    s = _serve()
    assert s is not None and s["source"] == "am" and s["level"][0] == 0.25


def test_series_from_table_is_pure_and_defaults_to_fes():
    now = datetime.now(UTC)
    t = tide_own.validate(_doc(now))
    assert tide_own.series_from_table(t, (21.7, -158.0), 3, now)["source"] == "am"
    assert tide_own.series_from_table(t, (21.7, -158.0), 3, now, prefer_harcon=True)["source"] == "am_h"


# ---- the build ------------------------------------------------------------------------------------------------------
UNI = [{"id": "R1", "lat": 30.0, "lng": -80.0}, {"id": "R2", "lat": 31.0, "lng": -80.0}]


def test_build_am_h_uses_the_gate_instruments_weight_and_blend():
    assert HA.AP.weight is AP.weight and HA.AP.blend is AP.blend
    fetched = []

    def harcon(sid):
        fetched.append(sid)
        return [("1", "M2", 1.0, 0.0, 28.98)]
    synth = {"R1": [1.0, -1.0], "R2": [2.0, -2.0]}
    keys = {"a": (30.0, -80.0), "b": (30.0 + 17.5 / 111.195, -80.0), "c": (30.5, -80.0), "d": (30.0, -80.0)}
    a = {"a": [0.2, 0.2], "b": [0.2, 0.2], "c": [0.2, 0.2], "d": [0.2, 0.2]}
    m = {"a": 0.1, "b": 0.1, "c": 0.1, "d": None}
    out, meta = HA.build_am_h(keys, a, m, UNI, harcon, lambda hc, t: synth[fetched[-1]], None, OR.levels_mm)
    assert out["a"] == [1100, -900] and meta["a"] == {"donor": "R1", "km": 0.0, "w": 1.0}       # w = 1: the donor + M
    assert meta["b"]["w"] == pytest.approx(0.5, abs=1e-3) and out["b"] == [int(round((0.5 * 1 + 0.5 * 0.2 + 0.1) * 1000)),
                                                                           int(round((-0.5 + 0.1 + 0.1) * 1000))]
    assert "c" not in out and "d" not in out                               # c: 55 km from both; d: no M
    assert fetched == ["R1"]                                               # one fetch per donor


def test_build_am_h_skips_a_donor_without_constants():
    out, _ = HA.build_am_h({"a": (30.0, -80.0)}, {"a": [0.2]}, {"a": 0.1}, UNI, lambda s: [], lambda hc, t: [1.0],
                           None, OR.levels_mm)
    assert out == {}


def test_the_table_encodes_am_h_and_tide_own_reads_it_back():
    now = datetime.now(UTC)
    doc = _doc(now)
    enc = OR.encode_table(doc)
    assert isinstance(enc["am_h"][K], str)
    t = tide_own.validate(enc)
    assert list(t["am_h"][K][:3]) == [300, 300, 300]


def test_the_build_adds_the_tide_guard_monitor_keys():
    pts = HA.monitor_spots()
    assert len(pts) == 60 and all(len(p) == 2 for p in pts)
    keys = OR.keys_from_spots(pts)
    assert len(keys) == 60                                                 # one station per key (tide-guard-v1 s3)


def test_the_harcon_credit_is_public_domain_and_the_ci_copy_matches():
    assert "public domain" in TC.CREDITS["am_h"] and TC.CREDITS["am"] in TC.CREDITS["am_h"]
    assert OR.CREDITS == TC.CREDITS and tide_own.LABELS["am_h"][1] == TC.CREDITS["am_h"]
