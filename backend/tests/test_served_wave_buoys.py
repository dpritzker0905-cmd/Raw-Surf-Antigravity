"""The frozen served-wave-verify-v1 buoy list (gate sections 0.1, 2a, 3): its hash, its structural rules, and that it is
exactly what the committed pool + catalogue + published box bounds give under the freeze rules (nothing hand-edited)."""
import importlib.util
import json
from pathlib import Path

from services.point_archive import buoys as buoylist

GATES = buoylist.LIST_PATH.parent
FREEZE = Path(__file__).resolve().parents[1] / "scripts" / "served_wave_verify_freeze_buoys.py"


def _freeze_mod():
    spec = importlib.util.spec_from_file_location("swv_freeze", FREEZE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_list_hash_matches_its_committed_sidecar():
    doc = buoylist.load()
    side = (GATES / "served-wave-verify-v1-buoys.json.sha256").read_text(encoding="utf-8").split()
    assert side == [buoylist.list_hash(doc), "served-wave-verify-v1-buoys.json"]


def test_list_obeys_the_gate_rules():
    doc = buoylist.load()
    assert buoylist.validate(doc) == []
    st = doc["stations"]
    assert len(st) == 100
    assert all(s["exam_only"] for s in st if s["source"] == "cdip")
    assert all(s["depth_m"] >= 20 for s in st if s["stratum"] != "nearshore")
    assert all(s["source"] == "cdip" for s in st if s["stratum"] == "nearshore")
    assert len({s["wmo_id"] for s in st}) == len(st)
    assert all(s["purposes"] == ["served"] for s in st)          # nearshore_eval tags are the nearshore lane's (gate 0.4)


def test_list_is_exactly_the_freeze_of_its_committed_inputs():
    mod = _freeze_mod()
    load = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))  # noqa: E731
    doc = buoylist.load()
    again = mod.freeze(load(mod.POOL), load(mod.CATALOGUE), load(mod.BOXES), doc["frozen_at"])
    # version 2 (amendment 2) = the version 1 freeze, unchanged, + the committed fit-used census
    again = mod.tag(again, load(mod.FIT_USED), None)
    # #1199's freeze (amendment 1): the LOCKED list recorded on top, outside list_hash, so the archive's pinned hash holds
    again = mod.record_lock(again, (buoylist.REPO_ROOT / mod.LOCKED_PATH).read_bytes())
    assert again == doc
    assert buoylist.list_hash(doc) == (buoylist.LIST_PATH.parent / (buoylist.LIST_PATH.name + ".sha256")).read_text(
        encoding="utf-8").split()[0]
    assert doc["version"] == "served-wave-verify-v1-buoys/2"


def test_regional_box_rule_farthest_from_edge_then_lexical():
    boxes = {"b_box": {"west": -10.0, "south": -10.0, "east": 10.0, "north": 10.0},
             "a_box": {"west": -10.0, "south": -10.0, "east": 10.0, "north": 10.0},
             "edge": {"west": -1.0, "south": -1.0, "east": 30.0, "north": 30.0}}
    assert buoylist.pick_box(0.0, 0.0, boxes) == "a_box"          # equal distance from the edge -> lexically smallest
    assert buoylist.pick_box(9.0, 9.0, boxes) == "edge"           # farther from its edge in `edge`
    assert buoylist.pick_box(50.0, 50.0, boxes) is None           # in no box: Tier A only


def test_every_assigned_box_is_a_published_box_of_that_set():
    doc = buoylist.load()
    boxes = json.loads((GATES / "served-wave-verify-v1-boxes.json").read_text(encoding="utf-8"))["sets"]
    for s in doc["stations"]:
        for set_key, rid in s["regional_box"].items():
            assert rid in boxes[set_key], (s["id"], set_key, rid)
            assert buoylist.contains(boxes[set_key][rid], s["lat"], s["lon"])
