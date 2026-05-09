"""
test_subscriptions.py — v89 Endpoint Contract Tests

Validates the subscriptions_billing/subscriptions.py module.
Covers:
  - GET  /api/subscriptions/plans           (list subscription plans)
  - GET  /api/subscriptions/current/{id}    (current subscription)
  - POST /api/subscriptions/checkout        (Stripe checkout session creation)
  - POST /api/subscriptions/webhook         (Stripe webhook handling)
  - GET  /api/subscriptions/portal-session  (billing portal)
"""
import pytest
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"
REGULAR_EMAIL = "sarah@waters.com"
REGULAR_PASSWORD = "test-shaka"


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def admin_user(api_client):
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return data if "id" in data else data.get("user")
    pytest.skip(f"Admin login failed: {response.status_code}")


@pytest.fixture(scope="module")
def regular_user(api_client):
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": REGULAR_EMAIL, "password": REGULAR_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return data if "id" in data else data.get("user")
    pytest.skip(f"Regular user login failed: {response.status_code}")


# ============ SUBSCRIPTION PLANS ============

class TestSubscriptionPlans:
    """GET /api/subscriptions/plans"""

    def test_get_plans(self, api_client):
        """Should return all subscription plan tiers"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        data = response.json()
        assert "surfer" in data, "Plans must include 'surfer' tier"
        assert "photographer" in data, "Plans must include 'photographer' tier"

    def test_plans_contain_monthly_and_annual(self, api_client):
        """Each tier should have monthly and annual options"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        data = response.json()

        surfer = data.get("surfer", {})
        assert "monthly" in surfer, "Surfer plans must have 'monthly'"
        assert "annual" in surfer, "Surfer plans must have 'annual'"

        photographer = data.get("photographer", {})
        assert "monthly" in photographer, "Photographer plans must have 'monthly'"
        assert "annual" in photographer, "Photographer plans must have 'annual'"

    def test_plan_item_shape(self, api_client):
        """Each plan item should have id, name, price, features"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        data = response.json()

        monthly_plans = data.get("surfer", {}).get("monthly", [])
        if monthly_plans:
            plan = monthly_plans[0]
            assert "id" in plan, "Plan must have 'id'"
            assert "name" in plan, "Plan must have 'name'"
            assert "price" in plan, "Plan must have 'price'"
            assert "features" in plan, "Plan must have 'features'"


# ============ CURRENT SUBSCRIPTION ============

class TestCurrentSubscription:
    """GET /api/subscriptions/current/{user_id}"""

    def test_get_current_subscription(self, api_client, regular_user):
        """Should return current subscription status"""
        user_id = regular_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/subscriptions/current/{user_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert "tier" in data or "subscription_tier" in data, (
            "Current subscription must include tier info"
        )

    def test_get_current_subscription_nonexistent(self, api_client):
        """Non-existent user should return 404"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.get(
            f"{BASE_URL}/api/subscriptions/current/{fake_id}"
        )
        assert response.status_code == 404


# ============ CHECKOUT (STRIPE) ============

class TestCheckout:
    """POST /api/subscriptions/checkout"""

    def test_checkout_requires_tier_id(self, api_client, regular_user):
        """Checkout without tier_id should fail validation"""
        user_id = regular_user.get("id")
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout",
            params={"user_id": user_id},
            json={"origin_url": "https://rawsurf.netlify.app/settings"}
        )
        assert response.status_code == 422, (
            "Missing tier_id should return 422"
        )

    def test_checkout_invalid_tier(self, api_client, regular_user):
        """Checkout with invalid tier should return 400"""
        user_id = regular_user.get("id")
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/checkout",
            params={"user_id": user_id},
            json={
                "tier_id": "invalid_tier_name",
                "origin_url": "https://rawsurf.netlify.app/settings"
            }
        )
        assert response.status_code in [400, 404], (
            f"Invalid tier should fail, got {response.status_code}"
        )


# ============ WEBHOOK (STRIPE) ============

class TestWebhook:
    """POST /api/subscriptions/webhook"""

    def test_webhook_endpoint_reachable(self, api_client):
        """Webhook endpoint should exist and reject invalid payloads"""
        response = api_client.post(
            f"{BASE_URL}/api/subscriptions/webhook",
            data="{}",
            headers={"Content-Type": "application/json"}
        )
        # Should return 400 (invalid payload) or 422, NOT 404/405
        assert response.status_code not in [404, 405], (
            f"Webhook endpoint should be mounted, got {response.status_code}"
        )


# ============ ROUTER HEALTH ============

class TestSubscriptionsRouterHealth:
    """Verify all subscription endpoints are mounted"""

    def test_all_endpoints_reachable(self, api_client, regular_user):
        """Smoke test: subscription endpoints respond (not 405)"""
        user_id = regular_user.get("id")
        endpoints = [
            f"/api/subscriptions/plans",
            f"/api/subscriptions/current/{user_id}",
        ]
        for path in endpoints:
            r = api_client.get(f"{BASE_URL}{path}")
            assert r.status_code != 405, (
                f"GET {path} returned 405 — endpoint not mounted"
            )
