"""A parent spends credits only on a Grom linked to that parent -- for EVERY role the route allows.

LA-SEC-03 (audit 2026-10-18): `grom-pay-with-credits` skipped the parent-grom link check for Hobbyists, so a
Hobbyist could debit their own credits to upgrade any Grom account. The route is also token-bound (see
tests/test_actor_route_binding.py); this file pins the link rule itself, with the caller's own token.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from core.security import create_access_token
from database import get_db
from models import RoleEnum
from server import app

PATH = "/api/subscriptions/grom-pay-with-credits/caller"


def _result(row):
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    return result


@pytest.fixture
def pay():
    def run(parent, grom):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_result(parent), _result(grom)])
        db.commit = AsyncMock()
        db.add = MagicMock()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        headers = {"Authorization": "Bearer " + create_access_token({"sub": "caller"})}
        try:
            with TestClient(app, raise_server_exceptions=False) as client:
                return client.post(PATH, json={"grom_id": "g1", "tier_id": "tier_3"}, headers=headers), db
        finally:
            app.dependency_overrides.pop(get_db, None)

    return run


def _parent(role, is_grom_parent=False):
    return SimpleNamespace(id="caller", role=role, is_grom_parent=is_grom_parent, credit_balance=100)


def _grom(parent_id):
    return SimpleNamespace(id="g1", role=RoleEnum.GROM, parent_id=parent_id, full_name="G", subscription_tier="free",
                           is_ad_supported=True)


@pytest.mark.parametrize("role", [RoleEnum.HOBBYIST, RoleEnum.GROM_PARENT])
def test_unlinked_grom_is_refused_and_no_credits_move(pay, role):
    parent = _parent(role)
    response, db = pay(parent, _grom("someone-else"))
    assert response.status_code == 403
    assert response.json().get("detail") == "Grom is not linked to this parent"
    assert parent.credit_balance == 100
    assert db.commit.await_count == 0


@pytest.mark.parametrize("role", [RoleEnum.HOBBYIST, RoleEnum.GROM_PARENT])
def test_linked_grom_is_paid_for(pay, role):
    parent = _parent(role)
    grom = _grom("caller")
    response, _db = pay(parent, grom)
    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert parent.credit_balance < 100
    assert grom.subscription_tier != "free"
