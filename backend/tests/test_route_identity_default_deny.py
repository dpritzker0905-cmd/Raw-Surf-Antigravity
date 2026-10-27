"""Default-deny identity guard for write routes (scripts/check_route_identity.py).

Controls first, on a synthetic app, so the classifier is proven to flag and to clear before it is trusted on the
real one: a write route with no identity dependency is flagged (positive control); the same route with each
enforcing dependency, directly or through a sub-dependency, is not; reads, optional identity and a lookalike
function are handled as documented (null controls). Then the real app: nothing new may appear, nothing may be
bound without shrinking the baseline, and the public list may not rot.
"""
import json
import os
import re
import sys

import pytest
from fastapi import APIRouter, Depends, FastAPI

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from core.security import get_current_user_id, get_optional_user_id, get_user_id_from_jwt_or_query  # noqa: E402
from deps.admin_auth import get_current_admin  # noqa: E402
from scripts import check_route_identity as G  # noqa: E402


def _app(*routes):
    app = FastAPI()
    router = APIRouter()
    for method, path, dependency in routes:
        deps = [Depends(dependency)] if dependency else []
        router.add_api_route(path, lambda: {}, methods=[method], dependencies=deps)
    app.include_router(router, prefix="/api")
    return app


@pytest.mark.parametrize("method", sorted(G.WRITE_METHODS))
def test_an_unbound_write_route_is_flagged(method):
    assert G.scan(_app((method, "/x", None)), public={}) == [f"{method} /api/x"]


@pytest.mark.parametrize("dependency", [get_current_user_id, get_user_id_from_jwt_or_query, get_current_admin])
def test_each_enforcing_dependency_clears_a_write_route(dependency):
    assert G.scan(_app(("POST", "/x", dependency)), public={}) == []


def test_a_sub_dependency_counts():
    def wrapper(user=Depends(get_current_user_id)):
        return user

    assert G.scan(_app(("POST", "/x", wrapper)), public={}) == []


def test_optional_identity_does_not_clear_a_write_route():
    # an anonymous caller gets None from it and the handler still runs
    assert G.scan(_app(("POST", "/x", get_optional_user_id)), public={}) == ["POST /api/x"]


def test_a_lookalike_dependency_does_not_clear_a_write_route():
    def get_current_user_id():  # same name, different module  # noqa: F811
        return "anyone"

    assert G.scan(_app(("POST", "/x", get_current_user_id)), public={}) == ["POST /api/x"]


def test_reads_are_out_of_scope():
    assert G.scan(_app(("GET", "/x", None)), public={}) == []


def test_a_public_entry_is_honoured_only_for_its_own_method_and_path():
    app = _app(("POST", "/login", None), ("DELETE", "/login", None), ("POST", "/other", None))
    assert G.scan(app, public={("POST", "/api/login"): "why"}) == ["DELETE /api/login", "POST /api/other"]


def test_compare_names_new_routes_and_counts_bound_ones():
    base = {G.route_key_hash("POST /api/old"), G.route_key_hash("POST /api/fixed")}
    new, bound, size = G.compare(["POST /api/old", "POST /api/added"], base)
    assert (new, bound, size) == (["POST /api/added"], 1, 2)


def test_baseline_round_trip_stores_no_route_text(tmp_path):
    path = str(tmp_path / "b.json")
    G.write_baseline(["POST /api/pay", "PUT /api/refund"], path)
    text = open(path, encoding="utf-8").read()
    assert "/api" not in text and "refund" not in text
    assert G.load_baseline(path) == {G.route_key_hash("POST /api/pay"), G.route_key_hash("PUT /api/refund")}


# --- the real app -------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def real_app():
    from server import app
    return app


def test_no_new_write_route_is_served_without_identity(real_app):
    new, _bound, _size = G.compare(G.scan(real_app), G.load_baseline())
    assert new == [], f"write routes with no identity dependency (bind them to the token): {new}"


def test_the_baseline_shrinks_when_a_route_is_bound(real_app):
    _new, bound, _size = G.compare(G.scan(real_app), G.load_baseline())
    assert bound == 0, (f"{bound} baseline route(s) are now bound; run `python scripts/check_route_identity.py "
                        f"--write-baseline` so they cannot regress")


def test_the_committed_baseline_is_hashed():
    data = json.load(open(G.BASELINE_PATH, encoding="utf-8"))
    assert data["count"] == len(data["hashes"]) == len(set(data["hashes"]))
    assert all(re.fullmatch(r"[0-9a-f]{16}", h) for h in data["hashes"])
    assert "routes" not in data


def test_every_public_entry_is_mounted_unbound_and_explained(real_app):
    mounted = G.mounted_write_routes(real_app)
    bound = {(m, r.path) for r in real_app.routes if hasattr(r, "dependant") and G.has_enforcing_identity(r)
             for m in r.methods}
    for key, reason in G.PUBLIC_WRITES.items():
        assert key in mounted, f"{key} is listed as public but no longer exists: remove it"
        assert key not in bound, f"{key} now requires identity: remove it from PUBLIC_WRITES"
        assert len(reason) > 20, f"{key} needs a real reason"
