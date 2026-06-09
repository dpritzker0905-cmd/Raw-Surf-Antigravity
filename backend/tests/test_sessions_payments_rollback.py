import pytest
import sqlite3
import json
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import HTTPException
import stripe
import stripe_mcp_server

from server import app
from database import get_db
from models import PaymentTransaction, LiveSessionParticipant, Profile

# Create FastAPI TestClient
client = TestClient(app)

@pytest.mark.asyncio
async def test_complete_payment_stripe_error_triggers_rollback(monkeypatch):
    # Mock db dependency
    mock_db = MagicMock()
    mock_db.rollback = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.execute = AsyncMock()
    
    async def mock_get_db():
        yield mock_db
        
    app.dependency_overrides[get_db] = mock_get_db
    
    # Mock STRIPE_API_KEY in payments module
    from routes.sessions import payments
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "sk_test_mock")
    
    # Mock stripe.checkout.Session.retrieve to raise StripeError
    stripe_error = stripe.error.StripeError("Mock Stripe Error")
    
    with patch("stripe.checkout.Session.retrieve", side_effect=stripe_error):
        response = client.post(
            "/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_actual_test_id"}
        )
        
    assert response.status_code == 500
    assert "Payment verification failed: Mock Stripe Error" in response.json()["detail"]
    
    # Assert rollback was called
    mock_db.rollback.assert_called_once()
    
    # Clean up overrides
    app.dependency_overrides[get_db] = get_db


@pytest.mark.asyncio
async def test_complete_payment_database_error_refunds_stripe_live(monkeypatch):
    # Mock db dependency
    mock_db = MagicMock()
    mock_db.rollback = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.refresh = AsyncMock()
    
    # Setup mock transaction
    mock_tx = MagicMock(spec=PaymentTransaction)
    mock_tx.payment_status = "Pending"
    mock_tx.status = "Pending"
    mock_tx.transaction_metadata = json.dumps({
        "type": "live_session_join",
        "surfer_id": "usr_surfer",
        "photographer_id": "usr_photog",
        "selfie_url": "https://example.com/selfie.jpg",
        "amount": 25.0
    })

    async def mock_execute(statement, *args, **kwargs):
        query_str = str(statement).lower()
        if "payment_transactions" in query_str:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_tx
            return mock_result
        elif "live_session_participants" in query_str:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            return mock_result
        elif "profiles" in query_str:
            # Surfer lookup (no with_for_update)
            if "for update" not in query_str:
                mock_result = MagicMock()
                mock_result.scalar_one_or_none.return_value = None  # surfer not found -> raise 404
                return mock_result
            else:
                mock_result = MagicMock()
                mock_result.scalar_one_or_none.return_value = MagicMock(spec=Profile)
                return mock_result
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        return mock_result
        
    mock_db.execute = mock_execute
    
    async def mock_get_db():
        yield mock_db
        
    app.dependency_overrides[get_db] = mock_get_db
    
    # Mock STRIPE_API_KEY
    from routes.sessions import payments
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "sk_test_mock")
    
    # Mock retrieve to return paid session
    mock_checkout_session = MagicMock()
    mock_checkout_session.payment_status = "paid"
    mock_checkout_session.payment_intent = "pi_live_1234"
    mock_checkout_session.metadata = {
        "type": "live_session_join",
        "surfer_id": "usr_surfer",
        "photographer_id": "usr_photog",
        "amount": "25.0"
    }
    
    with patch("stripe.checkout.Session.retrieve", return_value=mock_checkout_session) as mock_retrieve, \
         patch("stripe.Refund.create") as mock_refund:
        
        response = client.post(
            "/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_live_1234"}
        )
        
        assert response.status_code == 404
        assert "User or photographer not found. Payment refunded." in response.json()["detail"]
        
        mock_retrieve.assert_called_once_with("cs_live_1234")
        mock_refund.assert_called_once_with(payment_intent="pi_live_1234")
        mock_db.commit.assert_called_once()
        assert mock_tx.payment_status == "Refunded"
        assert mock_tx.status == "Refunded"
        
    app.dependency_overrides[get_db] = get_db


@pytest.mark.asyncio
async def test_complete_payment_database_error_refunds_stripe_mock(monkeypatch):
    # Initialize stripe billing cache db for testing
    stripe_mcp_server.init_db()
    
    # Seed a pending payment in stripe_payments cache
    conn = sqlite3.connect(stripe_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO stripe_payments (payment_intent_id, customer_id, amount, currency, status, commission_platform, commission_provider, provider_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        ("pi_test_5678", "cus_test", 25.0, "usd", "requires_payment_method", 5.0, 20.0, "usr_photog", '{"surfer_id": "usr_surfer", "photographer_id": "usr_photog"}')
    )
    conn.commit()
    conn.close()
    
    # Mock db dependency
    mock_db = MagicMock()
    mock_db.rollback = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.refresh = AsyncMock()
    
    # Setup mock transaction
    mock_tx = MagicMock(spec=PaymentTransaction)
    mock_tx.payment_status = "Pending"
    mock_tx.status = "Pending"
    mock_tx.transaction_metadata = json.dumps({
        "type": "live_session_join",
        "surfer_id": "usr_surfer",
        "photographer_id": "usr_photog",
        "selfie_url": "https://example.com/selfie.jpg",
        "amount": 25.0
    })

    async def mock_execute(statement, *args, **kwargs):
        query_str = str(statement).lower()
        if "payment_transactions" in query_str:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = mock_tx
            return mock_result
        elif "live_session_participants" in query_str:
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            return mock_result
        elif "profiles" in query_str:
            # Surfer lookup (no with_for_update)
            if "for update" not in query_str:
                mock_result = MagicMock()
                mock_result.scalar_one_or_none.return_value = None  # surfer not found -> raise 404
                return mock_result
            else:
                mock_result = MagicMock()
                mock_result.scalar_one_or_none.return_value = MagicMock(spec=Profile)
                return mock_result
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        return mock_result
        
    mock_db.execute = mock_execute
    
    async def mock_get_db():
        yield mock_db
        
    app.dependency_overrides[get_db] = mock_get_db
    
    # Mock STRIPE_API_KEY
    from routes.sessions import payments
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "sk_test_mock")
    
    with patch("stripe_mcp_server.stripe_refund_payment", wraps=stripe_mcp_server.stripe_refund_payment) as mock_refund:
        response = client.post(
            "/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_test_mock_123"}
        )
        
        assert response.status_code == 404
        assert "User or photographer not found. Payment refunded." in response.json()["detail"]
        
        mock_refund.assert_called_once_with("pi_test_5678")
        mock_db.commit.assert_called_once()
        assert mock_tx.payment_status == "Refunded"
        assert mock_tx.status == "Refunded"
        
        # Verify status in stripe cache is indeed refunded
        conn = sqlite3.connect(stripe_mcp_server.DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM stripe_payments WHERE payment_intent_id = 'pi_test_5678'")
        status_in_cache = cursor.fetchone()[0]
        conn.close()
        assert status_in_cache == "refunded"
        
    app.dependency_overrides[get_db] = get_db
