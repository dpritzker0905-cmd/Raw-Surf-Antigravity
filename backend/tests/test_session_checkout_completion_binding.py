"""Completing a live-session checkout: only its own surfer, and only a payment Stripe confirms.

The route looks up the PaymentTransaction for the checkout id and requires its user to equal the JWT
subject before any verification. The local checkout emulator may stand in for Stripe only where the
process identifies itself as local/test and the key is not live; everywhere else a checkout id is
verified with Stripe whatever it looks like.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from core.security import create_access_token
from database import get_db
from models import PaymentTransaction
from routes.sessions import payments
from server import app

client = TestClient(app)


def bearer(subject):
    return {"Authorization": "Bearer " + create_access_token({"sub": subject})}


@pytest.fixture
def owned_checkout(monkeypatch):
    """A mock DB whose checkout belongs to usr_surfer; restores the override afterwards."""
    tx = MagicMock(spec=PaymentTransaction)
    tx.user_id = "usr_surfer"
    result = MagicMock()
    result.scalar_one_or_none.return_value = tx
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.rollback = AsyncMock()
    db.commit = AsyncMock()

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "sk_test_mock")
    yield db
    app.dependency_overrides.pop(get_db, None)


def test_requires_a_token(owned_checkout):
    response = client.post("/api/sessions/complete-payment", json={"checkout_session_id": "cs_test_abc"})
    assert response.status_code in (401, 403)
    owned_checkout.execute.assert_not_called()


def test_rejects_another_users_checkout(owned_checkout):
    with patch("stripe.checkout.Session.retrieve") as retrieve:
        response = client.post(
            "/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_test_abc"},
            headers=bearer("usr_other"),
        )
    assert response.status_code == 403
    retrieve.assert_not_called()


def test_test_shaped_id_is_verified_with_stripe_when_emulation_is_not_allowed(owned_checkout, monkeypatch):
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: False)
    unpaid = MagicMock(payment_status="unpaid", metadata={}, payment_intent=None)
    with patch("stripe.checkout.Session.retrieve", return_value=unpaid) as retrieve, \
            patch("stripe_mcp_server.stripe_retrieve_checkout_session", create=True) as emulator:
        response = client.post(
            "/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_test_abc"},
            headers=bearer("usr_surfer"),
        )
    assert response.status_code == 400
    retrieve.assert_called_once_with("cs_test_abc")
    emulator.assert_not_called()


@pytest.mark.parametrize("dev_ok, key, expected", [
    (True, "sk_test_x", True),
    (False, "sk_test_x", False),
    (True, "sk_live_x", False),
    (True, "rk_live_x", False),
    (False, "", False),
])
def test_emulation_needs_a_local_process_and_a_non_live_key(monkeypatch, dev_ok, key, expected):
    monkeypatch.setattr(payments, "dev_identity_allowed", lambda: dev_ok)
    monkeypatch.setattr(payments, "STRIPE_API_KEY", key)
    assert payments.checkout_emulation_allowed() is expected
