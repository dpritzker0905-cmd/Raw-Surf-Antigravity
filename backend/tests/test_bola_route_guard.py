"""The route guard (scripts/check_bola_routes.py) catches every actor-id name, not only `user_id`.

Positive controls: a handler that takes an actor id with no auth marker is flagged, for each name.
Null controls: the same handler with an auth dependency, or with a non-actor id, is not.
The committed baseline is hashed (no readable route list) and the live tree adds nothing to it.
"""
import json
import os
import re
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import check_bola_routes as G  # noqa: E402

HEADER = "from fastapi import APIRouter, Depends\nrouter = APIRouter()\n\n"


def _route(tmp_path, signature, name="handler", fname="area.py"):
    routes = tmp_path / "routes"
    routes.mkdir(exist_ok=True)
    (routes / fname).write_text(
        HEADER + f'@router.post("/x")\nasync def {name}({signature}):\n    return {{}}\n', encoding="utf-8")
    return str(routes)


@pytest.mark.parametrize("actor", sorted(G.ACTOR_ARGS))
def test_flags_each_actor_name_without_auth(tmp_path, actor):
    assert G.scan(_route(tmp_path, f"{actor}: str, db=Depends(get_db)")) == ["area.py::handler"]


@pytest.mark.parametrize("signature", [
    "payer_id: str, current_user_id: str = Depends(get_current_user_id)",
    "user_id: str = Depends(get_user_id_from_jwt_or_query)",
    "captain_id: str, admin=Depends(get_current_admin)",
    "spot_id: str, db=Depends(get_db)",
])
def test_bound_or_non_actor_routes_are_not_flagged(tmp_path, signature):
    assert G.scan(_route(tmp_path, signature)) == []


def test_undecorated_functions_are_ignored(tmp_path):
    routes = tmp_path / "routes"
    routes.mkdir()
    (routes / "helpers.py").write_text("async def helper(payer_id: str):\n    return payer_id\n", encoding="utf-8")
    assert G.scan(str(routes)) == []


def test_baseline_round_trip_stores_no_names(tmp_path):
    path = str(tmp_path / "baseline.json")
    G.write_baseline(["area.py::pay", "area.py::refund"], path)
    text = open(path, encoding="utf-8").read()
    assert "area.py" not in text and "pay" not in json.loads(text)["hashes"]
    assert G.load_baseline(path) == {G.route_key_hash("area.py::pay"), G.route_key_hash("area.py::refund")}


def test_legacy_plain_baseline_is_read_as_hashes(tmp_path):
    path = tmp_path / "legacy.json"
    path.write_text(json.dumps({"count": 1, "routes": ["area.py::pay"]}), encoding="utf-8")
    assert G.load_baseline(str(path)) == {G.route_key_hash("area.py::pay")}


def test_compare_names_new_offenders_and_counts_bound_ones():
    baseline = {G.route_key_hash("a.py::old"), G.route_key_hash("a.py::fixed")}
    new, fixed, size = G.compare(["a.py::old", "a.py::added"], baseline)
    assert (new, fixed, size) == (["a.py::added"], 1, 2)


def test_committed_baseline_is_hashed_and_covers_the_live_tree():
    data = json.load(open(G.BASELINE_PATH, encoding="utf-8"))
    assert "routes" not in data, "the baseline must not publish route names"
    assert data["count"] == len(data["hashes"])
    assert all(re.fullmatch(r"[0-9a-f]{16}", h) for h in data["hashes"])
    new, _fixed, _size = G.compare(G.scan(), G.load_baseline())
    assert new == [], f"routes take an actor id without an auth dependency: {new}"
