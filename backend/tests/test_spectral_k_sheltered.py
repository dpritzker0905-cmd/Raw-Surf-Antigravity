"""SURF_SPECTRAL_K rework (2026-11-04): K only at HEADLAND-SHELTERED points outside the Bight.

Pins the pre-registered eligibility (docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/
spectral-k-sheltered-preregistration.md): the rule's two inputs (the Bight polygon and K's height ratio for a 14 s,
290 deg reference swell, threshold 0.5), the exact set it selects on the committed table, the default scope, the
`SURF_SPECTRAL_K_ALL_SPOTS=1` escape to #706's scope, and that both serving entry points (the spot and the buoy
instrument) obey it.
"""
import types

import pytest

from services.weather_pipeline import spectral_k_serving as S

FLAGS = ("SURF_SPECTRAL_K", "SURF_SPECTRAL_K_ALL_SPOTS")
VT = "2026-10-06T00:00:00Z"
BLACKS = (32.8925, -117.2536)       # in the table, inside the Bight: out of scope by rule 1
PREREGISTERED = {"Rodeo Beach", "Fort Point", "Pismo Beach Pier", "285p1"}
PARTS = {"waves": (1.6, 13.0, 285.0), "swell_1": (1.3, 14.0, 290.0), "swell_2": (0.5, 18.0, 205.0),
         "wind_waves": (0.7, 6.0, 300.0)}


@pytest.fixture
def clean(monkeypatch):
    for k in FLAGS:
        monkeypatch.delenv(k, raising=False)
    S._reset_for_test()
    yield monkeypatch
    S._reset_for_test()


async def raw(model, layer, lat, lng, vt):
    h, tp, d = PARTS[layer]
    return types.SimpleNamespace(point=types.SimpleNamespace(speed=h, period=tp, direction=d), estimate_basis=None)


def _name(e):
    return e.get("name") or e["key"].split(":", 1)[1]


def _entry(name):
    return next(e for e in S.load_table()["entries"] if _name(e) == name)


def test_the_rule_is_the_preregistered_one(clean):
    assert S.SHELTER_MAX_RATIO == 0.5
    assert S.SHELTER_REF == {"h": 1.0, "tp": 14.0, "dir": 290.0, "kind": "swell"}
    assert S.scope() == "sheltered", "the rework's default scope"
    clean.setenv("SURF_SPECTRAL_K_ALL_SPOTS", "1")
    assert S.scope() == "all"
    clean.setenv("SURF_SPECTRAL_K_ALL_SPOTS", "yes")
    assert S.scope() == "sheltered", "anything but '1' keeps the narrow scope"


def test_the_rule_selects_exactly_the_preregistered_points(clean):
    t = S.load_table()
    got = {_name(e) for e in t["entries"] if S.is_sheltered(e, t)}
    assert got == PREREGISTERED


def test_every_bight_entry_is_out_of_scope_whatever_its_ratio(clean):
    from services.weather_pipeline.bight_hs_consensus import inside_bight
    t = S.load_table()
    bight = [e for e in t["entries"] if inside_bight(e["mop_lat"], e["mop_lng"])]
    assert len(bight) >= 25
    assert any(S.shelter_ratio(t["transfers"][e["key"]]) < S.SHELTER_MAX_RATIO for e in bight), \
        "rule 1 must be doing work: Bight entries with a low ratio exist"
    assert not any(S.is_sheltered(e, t) for e in bight)


def test_the_ratio_reads_open_coast_as_open_and_the_headland_as_sheltered(clean):
    t = S.load_table()
    assert S.shelter_ratio(t["transfers"][_entry("Fort Bragg - Glass Beach")["key"]]) > 0.9
    assert S.shelter_ratio(t["transfers"][_entry("285p1")["key"]]) == pytest.approx(0.36, abs=0.02)
    assert S.shelter_ratio(t["transfers"][_entry("Steamer Lane")["key"]]) == pytest.approx(0.53, abs=0.02), \
        "the nearest miss stays a miss"


@pytest.mark.asyncio
async def test_a_bight_spot_keeps_the_bulk_chain_unless_all_spots(clean):
    clean.setenv("SURF_SPECTRAL_K", "1")
    assert await S.nearshore_for_point("GFS", *BLACKS, VT, raw) is None
    clean.setenv("SURF_SPECTRAL_K_ALL_SPOTS", "1")
    assert await S.nearshore_for_point("GFS", *BLACKS, VT, raw) is not None


@pytest.mark.asyncio
async def test_a_sheltered_spot_takes_k_by_default_and_the_kill_switch_restores_bulk(clean):
    e = _entry("Pismo Beach Pier")
    sea = await S.nearshore_for_point("GFS", e["lat"], e["lng"], VT, raw)
    assert sea and sea["region"] == "central" and 0 < sea["hs"] < 3, "default ON (D-065)"
    clean.setenv("SURF_SPECTRAL_K", "0")
    assert await S.nearshore_for_point("GFS", e["lat"], e["lng"], VT, raw) is None, "the kill switch"


@pytest.mark.asyncio
async def test_the_buoy_instrument_obeys_the_scope(clean):
    clean.setenv("SURF_SPECTRAL_K", "1")
    assert await S.station_hs("GFS", "285p1", 15.0, VT, raw) is not None, "Avila is in scope"
    assert await S.station_hs("GFS", "153p1", 17.0, VT, raw) is None, "Del Mar (Bight) is not"
    clean.setenv("SURF_SPECTRAL_K_ALL_SPOTS", "1")
    assert await S.station_hs("GFS", "153p1", 17.0, VT, raw) is not None


def test_the_scope_flag_is_registered_and_declared_in_every_rating_lane():
    import os
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(repo, "backend", "routes", "admin", "surf_forecast.py"), encoding="utf-8") as f:
        assert '"SURF_SPECTRAL_K_ALL_SPOTS":   ("0",' in f.read()
    for lane in ("precompute.yml", "forecast-ingest.yml", "sim-parity-monitor.yml"):
        with open(os.path.join(repo, ".github", "workflows", lane), encoding="utf-8") as f:
            assert "SURF_SPECTRAL_K_ALL_SPOTS: '0'" in f.read(), lane
