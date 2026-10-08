"""Routes that move credits, grant paid access, or act through another user's account act only for the caller.

Each route either takes the acting user from the JWT (`Depends(get_user_id_from_jwt_or_query)`; a legacy
`user_id` query value is ignored) or compares the client-named actor with the JWT subject and answers 403.
Both happen before any database access. A stub session records every query, so "before any query" is
measured, not assumed. Requests are built from each route's own signature, so the owner case is a valid
request that reaches the handler.
"""
import datetime
import enum
import inspect
import typing
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

from core.security import create_access_token
from database import get_db
from server import app

DENIED = "Cannot act on behalf of another user"

# Identity comes from the token; the client may still send a legacy user_id, which is ignored.
TOKEN_IDENTITY = [
    ("POST", "/api/auth/convert-to-hobbyist"),
    ("POST", "/api/ads/submit"),
    ("DELETE", "/api/ads/my-submissions/{ad_id}"),
    ("POST", "/api/bookings/invites/{invite_id}/respond"),
    ("POST", "/api/dispatch/request/{request_id}/boost"),
    ("POST", "/api/dispatch/{dispatch_id}/cancel"),
    ("POST", "/api/dispatch/{dispatch_id}/request-exception"),
    ("POST", "/api/dispatch/{dispatch_id}/resolve-exception"),
    ("POST", "/api/meta/share-to-facebook"),
    ("POST", "/api/meta/share-to-instagram"),
    ("DELETE", "/api/meta/disconnect"),
]
# The client names the actor (where, which field); it must equal the token's subject.
NAMED_ACTOR = [
    ("POST", "/api/subscriptions/pay-with-credits/{user_id}", "path", "user_id"),
    ("POST", "/api/subscriptions/upgrade-tier/{user_id}", "path", "user_id"),
    ("POST", "/api/dispatch/{dispatch_id}/cover-remaining", "body", "captain_id"),
    ("POST", "/api/bookings/{booking_id}/crew-hub/update-splits", "body", "captain_id"),
    ("POST", "/api/bookings/{booking_id}/crew-hub/captain-hold", "query", "captain_id"),
    ("POST", "/api/bookings/{booking_id}/crew-hub/captain-cover-remaining", "body", "captain_id"),
    ("POST", "/api/bookings/{booking_id}/crew-hub/cancel-refund", "query", "captain_id"),
    ("POST", "/api/gallery/bulk-purchase", "body", "buyer_id"),
    ("POST", "/api/ai/gift-photo", "query", "photographer_id"),
    ("POST", "/api/career/gold-pass/create-slot", "query", "photographer_id"),
    ("POST", "/api/career/gold-pass/{slot_id}/book", "query", "surfer_id"),
    ("POST", "/api/surfer-gallery/self-claim", "query", "surfer_id"),
    ("POST", "/api/notifications/send", "body", "sender_id"),
]
LOGIN_ONLY = [("POST", "/api/notifications")]
ALL = TOKEN_IDENTITY + [(m, p) for m, p, _w, _f in NAMED_ACTOR] + LOGIN_ONLY


def _route(method, path):
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path == path and method in r.methods:
            return r
    raise AssertionError(f"route not registered: {method} {path}")


def _dummy(annotation):
    origin = typing.get_origin(annotation)
    if origin is typing.Union:
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        return _dummy(args[0]) if args else None
    if origin in (list, typing.List, set, tuple):
        return []
    if origin in (dict, typing.Dict):
        return {}
    if origin is typing.Literal:
        return typing.get_args(annotation)[0]
    if annotation is dict:
        return {}
    if annotation in (list, set, tuple):
        return []
    if inspect.isclass(annotation):
        if issubclass(annotation, datetime.datetime):
            return "2026-10-08T12:00:00+00:00"
        if issubclass(annotation, datetime.date):
            return "2026-10-08"
        if issubclass(annotation, bool):
            return True
        if issubclass(annotation, enum.Enum):
            return next(iter(annotation)).value
        if issubclass(annotation, (int, float)):
            return 1
        if issubclass(annotation, BaseModel):
            return _minimal(annotation)
    return "x"


def _minimal(model):
    return {name: _dummy(f.annotation) for name, f in model.model_fields.items() if f.is_required()}


def _request(method, path, actor=None, where=None, field=None):
    """A valid request for this route, with the actor (if any) placed where the route reads it."""
    route = _route(method, path)
    url = path
    for p in route.dependant.path_params:
        value = actor if (where == "path" and p.name == field) else "p1"
        url = url.replace("{" + p.name + "}", value)
    params = {}
    for q in route.dependant.query_params:
        if where == "query" and q.name == field:
            params[q.name] = actor
        elif q.required:
            params[q.name] = "true" if q.field_info.annotation is bool else "x"
    body = None
    if route.dependant.body_params:
        b = route.dependant.body_params[0]
        model = b.field_info.annotation
        body = _minimal(model) if inspect.isclass(model) and issubclass(model, BaseModel) else {}
        if where == "body":
            body[field] = actor
    return url, params, body


@pytest.fixture
def stub_db():
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    result.scalar.return_value = None
    result.first.return_value = None
    result.scalars.return_value.all.return_value = []
    result.scalars.return_value.first.return_value = None
    result.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    for name in ("get", "commit", "rollback", "flush", "refresh", "delete"):
        setattr(db, name, AsyncMock(return_value=None))

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    yield db
    app.dependency_overrides.pop(get_db, None)


def _call(method, url, params, body, subject=None):
    headers = {"Authorization": "Bearer " + create_access_token({"sub": subject})} if subject else {}
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.request(method, url, params=params, json=body, headers=headers)


@pytest.mark.parametrize("method,path", ALL)
def test_no_token_is_refused_before_any_query(stub_db, method, path):
    url, params, body = _request(method, path, actor="victim", where=None)
    response = _call(method, url, params, body)
    assert response.status_code in (401, 403)
    assert stub_db.execute.await_count == 0


@pytest.mark.parametrize("method,path,where,field", NAMED_ACTOR)
def test_another_users_id_is_refused_before_any_query(stub_db, method, path, where, field):
    url, params, body = _request(method, path, actor="victim", where=where, field=field)
    response = _call(method, url, params, body, subject="caller")
    assert response.status_code == 403 and response.json().get("detail") == DENIED
    assert stub_db.execute.await_count == 0


@pytest.mark.parametrize("method,path", TOKEN_IDENTITY)
def test_identity_comes_from_the_token(method, path):
    default = inspect.signature(_route(method, path).endpoint).parameters["user_id"].default
    assert getattr(getattr(default, "dependency", None), "__name__", None) == "get_user_id_from_jwt_or_query"


@pytest.mark.parametrize("method,path,where,field",
                         [(m, p, None, None) for m, p in TOKEN_IDENTITY + LOGIN_ONLY] + NAMED_ACTOR)
def test_owner_passes_the_binding(stub_db, method, path, where, field):
    url, params, body = _request(method, path, actor="caller", where=where, field=field)
    response = _call(method, url, params, body, subject="caller")
    detail = response.json().get("detail") if response.headers.get("content-type", "").startswith("application/json") else None
    assert response.status_code not in (401, 422), (response.status_code, detail)
    assert detail != DENIED
