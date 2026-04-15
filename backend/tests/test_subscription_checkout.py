"""
Test file for Subscription Checkout endpoints
Tests: Surfer and Photographer subscription tiers, free tier, paid tier Stripe checkout
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test user IDs from existing database
SURFER_ID = "90d2c43c-026e-4800-bc93-796921f410fe"  # testuser@rawsurf.com
PHOTOGRAPHER_ID = "92e628c9-8ef5-42cc-8fbc-9ecf94725f5d"  # testphotog@rawsurf.com


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestSubscriptionCheckout:
    """Subscription checkout endpoint tests"""
    
    def test_health_check(self, api_client):
        """Test API is running"""
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        print("PASS: API health check")
    
    # ============== FREE TIER TESTS ==============
    
    def test_surfer_free_tier_returns_feed_redirect(self, api_client):
        """Free tier should directly redirect to /feed without Stripe"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
            json={
                "tier_id": "surfer_free",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "/feed" in data["checkout_url"]
        assert data["session_id"] == "free"
        print("PASS: Free tier returns /feed redirect")
    
    def test_free_tier_status_returns_completed(self, api_client):
        """Free tier status should return completed"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/status/free")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "completed"
        assert data["tier"] == "free"
        print("PASS: Free tier status returns completed")
    
    # ============== SURFER PAID TIER TESTS ==============
    
    def test_surfer_basic_tier_creates_stripe_session(self, api_client):
        """Surfer Basic ($1.99/mo) should create Stripe checkout"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
            json={
                "tier_id": "surfer_basic",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "stripe.com" in data["checkout_url"]
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_")
        print("PASS: Surfer Basic creates Stripe session")
    
    def test_surfer_premium_tier_creates_stripe_session(self, api_client):
        """Surfer Premium ($9.99/mo) should create Stripe checkout"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
            json={
                "tier_id": "surfer_premium",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "stripe.com" in data["checkout_url"]
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_")
        print("PASS: Surfer Premium creates Stripe session")
    
    # ============== PHOTOGRAPHER TIER TESTS ==============
    
    def test_photographer_basic_tier_creates_stripe_session(self, api_client):
        """Photographer Basic ($18/mo) should create Stripe checkout"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={PHOTOGRAPHER_ID}",
            json={
                "tier_id": "photographer_basic",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "stripe.com" in data["checkout_url"]
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_")
        print("PASS: Photographer Basic creates Stripe session")
    
    def test_photographer_premium_tier_creates_stripe_session(self, api_client):
        """Photographer Premium ($30/mo) should create Stripe checkout"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={PHOTOGRAPHER_ID}",
            json={
                "tier_id": "photographer_premium",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "stripe.com" in data["checkout_url"]
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_")
        print("PASS: Photographer Premium creates Stripe session")
    
    # ============== ERROR HANDLING TESTS ==============
    
    def test_invalid_tier_returns_400(self, api_client):
        """Invalid tier ID should return 400 error"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
            json={
                "tier_id": "invalid_tier",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "Invalid subscription tier" in data["detail"]
        print("PASS: Invalid tier returns 400")
    
    def test_nonexistent_user_returns_404(self, api_client):
        """Non-existent user should return 404 for paid tiers"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id=00000000-0000-0000-0000-000000000000",
            json={
                "tier_id": "surfer_basic",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 404
        data = response.json()
        assert "User not found" in data["detail"]
        print("PASS: Nonexistent user returns 404")
    
    def test_invalid_session_status_returns_404(self, api_client):
        """Invalid session ID should return 404"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/status/invalid_session_id")
        assert response.status_code == 404
        data = response.json()
        assert "Transaction not found" in data["detail"]
        print("PASS: Invalid session status returns 404")
    
    # ============== STATUS CHECK TESTS ==============
    
    def test_pending_session_returns_unpaid(self, api_client):
        """Newly created session should return unpaid status"""
        # Create a session first
        create_response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
            json={
                "tier_id": "surfer_basic",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert create_response.status_code == 200
        session_id = create_response.json()["session_id"]
        
        # Check status
        status_response = api_client.get(f"{BASE_URL}/api/subscriptions/status/{session_id}")
        assert status_response.status_code == 200
        data = status_response.json()
        assert data["status"] in ["unpaid", "pending"]
        print("PASS: Pending session returns unpaid status")


class TestSubscriptionPricing:
    """Tests to verify subscription pricing matches spec"""
    
    def test_surfer_tiers_exist(self, api_client):
        """All surfer tiers should be valid"""
        surfer_tiers = ["surfer_free", "surfer_basic", "surfer_premium"]
        for tier in surfer_tiers:
            response = api_client.post(
                f"{BASE_URL}/api/subscriptions/checkout?user_id={SURFER_ID}",
                json={
                    "tier_id": tier,
                    "origin_url": "https://raw-surf-os.preview.emergentagent.com"
                }
            )
            assert response.status_code == 200, f"Tier {tier} failed"
        print("PASS: All surfer tiers exist")
    
    def test_photographer_tiers_exist(self, api_client):
        """All photographer tiers should be valid"""
        photographer_tiers = ["photographer_basic", "photographer_premium"]
        for tier in photographer_tiers:
            response = api_client.post(
                f"{BASE_URL}/api/subscriptions/checkout?user_id={PHOTOGRAPHER_ID}",
                json={
                    "tier_id": tier,
                    "origin_url": "https://raw-surf-os.preview.emergentagent.com"
                }
            )
            assert response.status_code == 200, f"Tier {tier} failed"
        print("PASS: All photographer tiers exist")


class TestCreditsPurchase:
    """Tests for credits purchase endpoint (using standard Stripe SDK)"""
    
    def test_credits_purchase_creates_stripe_session(self, api_client):
        """Credits purchase should create Stripe checkout session"""
        response = api_client.post(
            f"{BASE_URL}/api/credits/purchase?user_id={SURFER_ID}",
            json={
                "amount": 25.0,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "checkout_url" in data
        assert "stripe.com" in data["checkout_url"]
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_")
        print("PASS: Credits purchase creates Stripe session")
    
    def test_credits_status_check_returns_unpaid(self, api_client):
        """Credits status for new session should return unpaid"""
        # Create session first
        create_response = api_client.post(
            f"{BASE_URL}/api/credits/purchase?user_id={SURFER_ID}",
            json={
                "amount": 10.0,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert create_response.status_code == 200
        session_id = create_response.json()["session_id"]
        
        # Check status
        status_response = api_client.get(f"{BASE_URL}/api/credits/status/{session_id}")
        assert status_response.status_code == 200
        data = status_response.json()
        assert data["payment_status"] == "unpaid"
        assert data["amount"] == 10.0
        print("PASS: Credits status returns unpaid for new session")
    
    def test_credits_purchase_nonexistent_user(self, api_client):
        """Credits purchase for non-existent user should return 404"""
        response = api_client.post(
            f"{BASE_URL}/api/credits/purchase?user_id=00000000-0000-0000-0000-000000000000",
            json={
                "amount": 25.0,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 404
        data = response.json()
        assert "Profile not found" in data["detail"]
        print("PASS: Credits purchase returns 404 for non-existent user")
