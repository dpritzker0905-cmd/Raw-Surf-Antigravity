"""Maintenance and seed endpoints are admin-only, and the admin bootstrap routes act only for the caller.

LA-SEC-03 (audit 2026-10-18): these write routes used to answer an anonymous POST. Each is now behind
`get_current_admin` (token -> profile -> is_admin). A stub session records every query, so "refused before the
handler ran" is measured: the only query a non-admin may trigger is the admin lookup itself.

The two bootstrap routes cannot be admin-bound (they exist to create the first admin). They are closed unless
ALLOW_ADMIN_BOOTSTRAP=true, require a signed-in caller, and promote only the caller's own account.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from core.security import create_access_token
from database import get_db
from server import app

DENIED = "Cannot act on behalf of another user"

ADMIN_ONLY = [
    ("POST", "/api/impact/seed-causes"),
    ("POST", "/api/gear-hub/seed"),
    ("POST", "/api/stories/cleanup-expired"),
    ("POST", "/api/hashtags/reindex"),
    ("POST", "/api/seed-florida-spots"),
    ("POST", "/api/surf-spots/update-coordinates"),
    ("POST", "/api/surf-spots/seed-images"),
]
BOOTSTRAP = [
    ("POST", "/api/admin/bootstrap", {"email": "me@example.com"}),
    ("POST", "/api/admin/setup/me@example.com", {}),
]


def _make_db(profile=None):
    result = MagicMock()
    result.scalar_one_or_none.return_value = profile
    result.scalar.return_value = 0
    result.scalars.return_value.first.return_value = None
    result.scalars.return_value.all.return_value = []
    result.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    for name in ("get", "commit", "rollback", "flush", "refresh", "delete"):
        setattr(db, name, AsyncMock(return_value=None))
    db.add = MagicMock()
    return db


@pytest.fixture
def use_db():
    def install(profile=None):
        db = _make_db(profile)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        return db

    yield install
    app.dependency_overrides.pop(get_db, None)


def _call(method, url, params=None, subject=None):
    headers = {"Authorization": "Bearer " + create_access_token({"sub": subject})} if subject else {}
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.request(method, url, params=params, headers=headers)


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_anonymous_caller_is_refused_before_any_query(use_db, method, path):
    db = use_db(SimpleNamespace(id="caller", is_admin=True))
    response = _call(method, path)
    assert response.status_code in (401, 403)
    assert db.execute.await_count == 0


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_signed_in_non_admin_is_refused_after_only_the_admin_lookup(use_db, method, path):
    db = use_db(SimpleNamespace(id="caller", is_admin=False))
    response = _call(method, path, subject="caller")
    assert response.status_code == 403
    assert response.json().get("detail") == "Admin privileges required"
    assert db.execute.await_count == 1


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_admin_reaches_the_handler(use_db, method, path):
    db = use_db(SimpleNamespace(id="caller", is_admin=True))
    response = _call(method, path, subject="caller")
    assert response.status_code not in (401, 403, 422), response.status_code
    assert db.execute.await_count >= 2  # the admin lookup, then the handler's own work


@pytest.mark.parametrize("method,path,params", BOOTSTRAP)
def test_bootstrap_needs_a_signed_in_caller(use_db, monkeypatch, method, path, params):
    monkeypatch.setenv("ALLOW_ADMIN_BOOTSTRAP", "true")
    db = use_db(SimpleNamespace(id="victim", email="me@example.com", is_admin=False, full_name="V"))
    response = _call(method, path, params=params)
    assert response.status_code in (401, 403)
    assert db.execute.await_count == 0


@pytest.mark.parametrize("method,path,params", BOOTSTRAP)
def test_bootstrap_stays_closed_unless_enabled(use_db, monkeypatch, method, path, params):
    monkeypatch.delenv("ALLOW_ADMIN_BOOTSTRAP", raising=False)
    db = use_db(SimpleNamespace(id="caller", email="me@example.com", is_admin=False, full_name="C"))
    response = _call(method, path, params=params, subject="caller")
    assert response.status_code == 404
    assert db.execute.await_count == 0


@pytest.mark.parametrize("method,path,params", BOOTSTRAP)
def test_bootstrap_will_not_promote_someone_elses_account(use_db, monkeypatch, method, path, params):
    monkeypatch.setenv("ALLOW_ADMIN_BOOTSTRAP", "true")
    victim = SimpleNamespace(id="victim", email="me@example.com", is_admin=False, full_name="V")
    use_db(victim)
    response = _call(method, path, params=params, subject="attacker")
    assert response.status_code == 403 and response.json().get("detail") == DENIED
    assert victim.is_admin is False


@pytest.mark.parametrize("method,path,params", BOOTSTRAP)
def test_bootstrap_promotes_the_callers_own_account(use_db, monkeypatch, method, path, params):
    monkeypatch.setenv("ALLOW_ADMIN_BOOTSTRAP", "true")
    me = SimpleNamespace(id="caller", email="me@example.com", is_admin=False, full_name="C")
    use_db(me)
    response = _call(method, path, params=params, subject="caller")
    assert response.status_code == 200, response.text
    assert me.is_admin is True
