"""SHORE_NORMAL_MOP_CALIBRATED (2026-11-11): MOP-calibrated swell-EXPOSURE normals for California spots.

The height's swell-angle factor measures against a per-spot effective normal fitted to CDIP MOP v1.1 (held-out MSE vs MOP
0.0234 -> 0.0046 over 77 spots); the COASTLINE normal is untouched, so wind and the rating keep reading the coast. These pin:
the lookup (nearest within 1 km, miss beyond), the kill switch, the coastline normal unchanged, the height using the exposure
normal, and the shipped asset obeying its own gate.
"""
import json
import math
import os

import pytest

from services.weather_pipeline import swell_exposure_normals as sen
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
from services.weather_pipeline.surf_transform import estimate_surf

ASSET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "weather_pipeline", "data",
                     "swell_exposure_normals.json")
RINCON = (34.3735, -119.4775)


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv("SHORE_NORMAL_MOP_CALIBRATED", "1")    # held OFF in code (D-065 WORSE on the arm); these pin it ON
    sen._reset_for_test()


def test_the_code_default_is_held_off(monkeypatch):
    monkeypatch.delenv("SHORE_NORMAL_MOP_CALIBRATED", raising=False)
    from services import runtime_flags as rf
    assert rf.GUARDED["SHORE_NORMAL_MOP_CALIBRATED"] == "0"
    assert sen.exposure_normal_at(34.3735, -119.4775) == (None, None)


def _entry(name):
    doc = json.load(open(ASSET, encoding="utf-8"))
    return next(e for e in doc["entries"] if e["name"] == name)


def test_every_shipped_entry_passed_the_gate():
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
    import build_swell_exposure_normals as b
    doc = json.load(open(ASSET, encoding="utf-8"))
    assert len(doc["entries"]) >= 40
    for e in doc["entries"]:
        assert 0.0 <= e["normal"] < 360.0
        assert e["test_mse_fit"] < e["test_mse_chain"], e["name"]
    assert b.gate({"usable": True, "test_fit": 0.01, "test_chain": 0.02, "curve_width_deg": 5, "mop_km": 0.5})[0]
    assert not b.gate({"usable": True, "test_fit": 0.03, "test_chain": 0.02, "curve_width_deg": 5, "mop_km": 0.5})[0]
    assert not b.gate({"usable": True, "test_fit": 0.01, "test_chain": 0.02, "curve_width_deg": 5, "mop_km": 2.9})[0]
    assert not b.gate({"usable": False, "test_fit": 0.01, "test_chain": 0.02})[0]


def test_lookup_hits_the_spot_and_misses_beyond_a_kilometre():
    e = _entry("Rincon")
    assert sen.exposure_normal_at(e["lat"], e["lng"]) == (e["normal"], "Rincon")
    dlat = 1.5 / 111.2
    assert sen.exposure_normal_at(e["lat"] + dlat, e["lng"]) == (None, None)
    assert sen.exposure_normal_at(21.665, -158.053) == (None, None), "outside California: nothing changes"


def test_the_kill_switch_is_todays_geometry(monkeypatch):
    e = _entry("Rincon")
    monkeypatch.setenv("SHORE_NORMAL_MOP_CALIBRATED", "0")
    assert sen.exposure_normal_at(e["lat"], e["lng"]) == (None, None)
    assert resolve_surf_geometry(e["lat"], e["lng"]).swell_normal_deg is None


def test_the_coastline_normal_is_untouched_and_the_height_uses_the_exposure_normal(monkeypatch):
    e = _entry("Rincon")
    on = resolve_surf_geometry(e["lat"], e["lng"])
    monkeypatch.setenv("SHORE_NORMAL_MOP_CALIBRATED", "0")
    off = resolve_surf_geometry(e["lat"], e["lng"])
    assert on.shore_normal_deg == off.shore_normal_deg, "wind and the rating keep the coastline normal"
    assert on.swell_normal_deg == e["normal"]
    for hs, tp, sdir in ((1.5, 14.0, 270.0), (2.0, 16.0, 290.0)):
        h_on = estimate_surf_at(e["lat"], e["lng"], hs, tp, swell_from_deg=sdir, geometry=on)
        want = estimate_surf(hs, tp, on.depth_m, coastal=on.coastal, shelf_width_km=on.shelf_width_km,
                             swell_from_deg=sdir, shore_normal_deg=e["normal"], magnet_factor=on.magnet_factor,
                             break_depth_m=on.break_depth_m)
        assert h_on == want


def test_west_swell_into_the_santa_barbara_channel_reads_as_more_exposed_at_rincon():
    """The physical claim behind the Rincon entry: the chain's coastline normal (~202) put a 270 deg swell 68 deg off; MOP's
    response says Rincon answers around 240, so the same swell is 30 deg off and keeps more height."""
    e = _entry("Rincon")
    g = resolve_surf_geometry(e["lat"], e["lng"])
    off_angle = lambda n: abs(((270.0 - n) + 180.0) % 360.0 - 180.0)  # noqa: E731
    assert off_angle(e["normal"]) < off_angle(g.shore_normal_deg)
    assert math.isfinite(e["test_mse_fit"])
