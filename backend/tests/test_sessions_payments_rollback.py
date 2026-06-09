import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
import stripe

from server import app
from database import get_db

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
    app.dependency_overrides.clear()
