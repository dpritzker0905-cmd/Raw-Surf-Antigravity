"""B2 spot classes: the pre-registered rules (log 2026-11-16-claude-surf-spot-classes.md section 0b) and asset parity."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import build_spot_class as b  # noqa: E402
import score_spot_class as sc  # noqa: E402


def S(**kw):
    return dict({"id": "x", "wave_type": "", "kw": [], "spread_deg": None}, **kw)


@pytest.mark.parametrize("ev,want", [
    ({"structure_m": 400}, ("inlet_jetty", 0.85, "osm_structure")),
    ({"pier_m": 900}, ("inlet_jetty", 0.70, "osm_structure")),          # piers count, as section 0 registered them
    ({"structure_m": 1001, "river_mouth_m": 300}, ("river_mouth", 0.80, "osm_river_mouth")),
    ({"structure_m": 800, "river_mouth_m": 100}, ("inlet_jetty", 0.70, "osm_structure")),   # structure first
])
def test_tier1_osm(ev, want):
    assert b.classify(S(wave_type="Reef Break"), ev) == want


def test_tier2_tag_beats_keywords_and_natural():
    assert b.classify(S(wave_type="Point Break", kw=["beach"]), {"reef_m": 10}) == ("point_headland", 0.70, "catalogue_tag")
    assert b.normalise_wave_type("Jetty Break") == "inlet_jetty" and b.normalise_wave_type("sandbar") == "beach"
    assert b.normalise_wave_type("slab") == "reef" and b.normalise_wave_type("mystery") is None


def test_tier3_keywords_order():
    assert b.classify(S(kw=["beach"]), {}) == ("beach", 0.60, "keyword")
    assert b.classify(S(kw=["beach", "reef"]), {}) == ("reef", 0.55, "keywords")


def test_tier4_5_and_unknown():
    assert b.classify(S(), {"reef_m": 500, "cape_m": 10}) == ("reef", 0.55, "osm_reef")
    assert b.classify(S(), {"reef_m": 501, "cape_m": 1000}) == ("point_headland", 0.55, "osm_cape")
    assert b.classify(S(spread_deg=60), {}) == ("point_headland", 0.50, "spread")
    assert b.classify(S(spread_deg=59.9), {"structure_m": None}) == ("unknown", 0.0, "none")


def test_comparator_switches_use_the_tag_only():
    spot = S(wave_type="", kw=["reef"])
    assert b.classify(spot, {"structure_m": 1}, use_osm=False, use_keywords=False, use_spread=False)[0] == "unknown"


def test_wilson_and_null_sane():
    lo, hi = sc.wilson(8, 10)
    assert 0.48 < lo < 0.5 and 0.94 < hi < 0.95
    pairs = [("beach", "beach")] * 5 + [("reef", "reef")] * 5
    assert sc.null_precision(pairs, ["A"] * 10)["reef"] < 0.75   # shuffling destroys a perfect classifier


@pytest.mark.skipif(not os.path.exists(b.ASSET), reason="asset not built yet")
def test_asset_parity():
    snap = json.load(open(b.SNAPSHOT, encoding="utf-8"))
    ev = json.load(open(b.EVIDENCE, encoding="utf-8"))
    assert open(b.ASSET, encoding="utf-8").read() == b.render(b.build(snap, ev))


# ---- B2 v2 (log section 2) -------------------------------------------------------------------------------------------------------
def test_v2_structure_needs_300m_no_pier_and_an_inlet_signal():
    # a pier alone, however close: no class from structure (v1 sent 18 non-inlet spots here)
    assert b.classify_v2(S(name="Main St Pier"), {"pier_m": 50})[0] == "unknown"
    # a breakwater within 300 m but no inlet signal: not inlet_jetty
    assert b.classify_v2(S(name="Harbour Reef"), {"structure_m": 200}) == ("unknown", 0.0, "none")
    # the three inlet signals, each alone, with a breakwater within 300 m
    assert b.classify_v2(S(name="Sebastian Inlet"), {"structure_m": 250})[:2] == ("inlet_jetty", 0.80)
    assert b.classify_v2(S(), {"structure_m": 250, "river_mouth_m": 900})[0] == "inlet_jetty"
    assert b.classify_v2(S(wave_type="Jetty Break"), {"structure_m": 250})[0] == "inlet_jetty"
    # 301 m: no longer the structure tier (the tag tier then speaks)
    assert b.classify_v2(S(name="Sebastian Inlet", wave_type="Beach Break"), {"structure_m": 301})[0] == "beach"


def test_v2_river_mouth_500m_and_name_only_inlet_keyword():
    assert b.classify_v2(S(), {"river_mouth_m": 500}) == ("river_mouth", 0.75, "osm_river_mouth")
    assert b.classify_v2(S(), {"river_mouth_m": 501})[0] == "unknown"
    # keyword inlet_jetty from the DESCRIPTION only (e.g. "next to the pier") no longer counts; from the name it does
    assert b.classify_v2(S(name="Cocoa Beach Pier", kw=["inlet_jetty", "beach"]), {})[0] == "beach"
    assert b.classify_v2(S(name="Ponce Inlet", kw=["inlet_jetty"]), {})[0] == "inlet_jetty"


def test_v2_weighted_gate_stratified_and_undetermined():
    """Amendment 2a: weight = frame size / frame sample. 25 correct inlet calls from a 30-spot inlet frame plus ONE wrong inlet call
    from a 600-spot beach frame sampled at 2: raw precision 25/26 = 0.96, weighted 30 / (30 + 300) = 0.09 -> FAIL. A class with
    fewer than 25 predictions is UNDETERMINED and cannot pass."""
    rows = {
        "inlet_jetty": (30, [("inlet_jetty", "inlet_jetty")] * 25),
        "beach": (600, [("beach", "inlet_jetty"), ("beach", "beach")]),
        "reef": (100, [("reef", "reef")] * 10),
    }
    r = sc.score_v2(rows)
    w = r["weighted"]["classes"]["inlet_jetty"]
    assert w["predicted_raw"] == 26 and abs(w["precision"] - 30 / 330) < 1e-9
    assert r["verdicts"]["inlet_jetty"] == "FAIL"                       # raw 0.96 would have passed; weighted does not
    assert r["verdicts"]["reef"] == "UNDETERMINED" and "reef" in r["undetermined"]   # 10 predicted < 25
    assert r["verdicts"]["point_headland"] == "UNDETERMINED"
    assert r["overall"] == "FAIL"
