"""
Backend Tests for Iteration 35:
1. Stripe Checkout - Payments API for Request a Pro deposits ($25/$35/$50)
2. OneSignal Push - Push notification configuration and subscription
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_USER_ID = "d3eb9019-d16f-4374-b432-4d168a96a00f"  # kelly@surf.com
TEST_ORIGIN = "https://raw-surf-os.preview.emergentagent.com"


class TestPaymentsPackages:
    """Test GET /api/payments/packages - Deposit packages endpoint"""
    
    def test_get_packages_returns_200(self):
        """Verify packages endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        assert response.status_code == 200
        print("✓ GET /api/payments/packages returns 200")
    
    def test_packages_returns_three_packages(self):
        """Verify we get exactly 3 packages (small, medium, large)"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        data = response.json()
        
        assert "packages" in data
        assert len(data["packages"]) == 3
        print(f"✓ Returns {len(data['packages'])} packages")
    
    def test_small_package_25_dollars(self):
        """Verify small package is $25 for 1-hour session"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        packages = response.json()["packages"]
        
        small = next((p for p in packages if p["id"] == "small"), None)
        assert small is not None
        assert small["amount"] == 25.00
        assert small["duration_hours"] == 1
        assert "1-hour" in small["description"].lower()
        print(f"✓ Small package: ${small['amount']} for {small['duration_hours']}h")
    
    def test_medium_package_35_dollars(self):
        """Verify medium package is $35 for 2-hour session"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        packages = response.json()["packages"]
        
        medium = next((p for p in packages if p["id"] == "medium"), None)
        assert medium is not None
        assert medium["amount"] == 35.00
        assert medium["duration_hours"] == 2
        assert "2-hour" in medium["description"].lower()
        print(f"✓ Medium package: ${medium['amount']} for {medium['duration_hours']}h")
    
    def test_large_package_50_dollars(self):
        """Verify large package is $50 for 3-hour session"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        packages = response.json()["packages"]
        
        large = next((p for p in packages if p["id"] == "large"), None)
        assert large is not None
        assert large["amount"] == 50.00
        assert large["duration_hours"] == 3
        assert "3-hour" in large["description"].lower()
        print(f"✓ Large package: ${large['amount']} for {large['duration_hours']}h")


class TestPaymentsCheckout:
    """Test POST /api/payments/checkout - Stripe checkout session creation"""
    
    def test_checkout_with_valid_user(self):
        """Verify checkout session created successfully for valid user"""
        payload = {
            "package_id": "small",
            "origin_url": TEST_ORIGIN,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=payload)
        
        # Should return 200 with stripe URL
        assert response.status_code == 200
        data = response.json()
        
        assert "url" in data
        assert "session_id" in data
        assert "amount" in data
        assert data["amount"] == 25.00
        assert "stripe.com" in data["url"]
        print(f"✓ Checkout session created: {data['session_id'][:20]}...")
        print(f"✓ Stripe URL: {data['url'][:50]}...")
    
    def test_checkout_invalid_package(self):
        """Verify 400 error for invalid package"""
        payload = {
            "package_id": "invalid_package",
            "origin_url": TEST_ORIGIN,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=payload)
        assert response.status_code == 400
        assert "Invalid package" in response.json().get("detail", "")
        print("✓ Invalid package returns 400")
    
    def test_checkout_invalid_user(self):
        """Verify 404 error for non-existent user"""
        payload = {
            "package_id": "small",
            "origin_url": TEST_ORIGIN,
            "user_id": "nonexistent-user-id-12345"
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=payload)
        assert response.status_code == 404
        assert "User not found" in response.json().get("detail", "")
        print("✓ Invalid user returns 404")
    
    def test_checkout_medium_package(self):
        """Verify medium package checkout works"""
        payload = {
            "package_id": "medium",
            "origin_url": TEST_ORIGIN,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 35.00
        assert "2-hour" in data["description"].lower()
        print(f"✓ Medium package checkout: ${data['amount']}")
    
    def test_checkout_large_package(self):
        """Verify large package checkout works"""
        payload = {
            "package_id": "large",
            "origin_url": TEST_ORIGIN,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["amount"] == 50.00
        assert "3-hour" in data["description"].lower()
        print(f"✓ Large package checkout: ${data['amount']}")


class TestOneSignalConfig:
    """Test GET /api/push/onesignal/config - OneSignal configuration endpoint"""
    
    def test_config_returns_200(self):
        """Verify config endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/push/onesignal/config")
        assert response.status_code == 200
        print("✓ GET /api/push/onesignal/config returns 200")
    
    def test_config_returns_app_id(self):
        """Verify config returns app_id"""
        response = requests.get(f"{BASE_URL}/api/push/onesignal/config")
        data = response.json()
        
        assert "app_id" in data
        assert data["app_id"] is not None
        assert len(data["app_id"]) > 10  # Valid UUID-like format
        print(f"✓ OneSignal App ID: {data['app_id'][:20]}...")
    
    def test_config_returns_enabled_status(self):
        """Verify config returns enabled status"""
        response = requests.get(f"{BASE_URL}/api/push/onesignal/config")
        data = response.json()
        
        assert "enabled" in data
        assert isinstance(data["enabled"], bool)
        assert data["enabled"] == True  # Should be enabled per .env
        print(f"✓ OneSignal enabled: {data['enabled']}")


class TestOneSignalSubscribe:
    """Test POST /api/push/onesignal/subscribe - Save OneSignal subscription"""
    
    def test_subscribe_new_subscription(self):
        """Verify new subscription is saved"""
        import uuid
        test_subscription_id = f"test-subscription-{uuid.uuid4().hex[:8]}"
        
        payload = {
            "user_id": TEST_USER_ID,
            "subscription_id": test_subscription_id,
            "token": "test-token"
        }
        
        response = requests.post(f"{BASE_URL}/api/push/onesignal/subscribe", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "subscription saved" in data["message"].lower()
        print(f"✓ OneSignal subscription saved: {test_subscription_id[:20]}...")
    
    def test_subscribe_duplicate_subscription(self):
        """Verify duplicate subscription updates existing"""
        import uuid
        test_subscription_id = f"test-subscription-dup-{uuid.uuid4().hex[:8]}"
        
        payload = {
            "user_id": TEST_USER_ID,
            "subscription_id": test_subscription_id,
            "token": "token-v1"
        }
        
        # First subscription
        response1 = requests.post(f"{BASE_URL}/api/push/onesignal/subscribe", json=payload)
        assert response1.status_code == 200
        
        # Update with new token
        payload["token"] = "token-v2"
        response2 = requests.post(f"{BASE_URL}/api/push/onesignal/subscribe", json=payload)
        assert response2.status_code == 200
        print("✓ Duplicate subscription updates successfully")
    
    def test_subscribe_without_token(self):
        """Verify subscription works without optional token"""
        import uuid
        test_subscription_id = f"test-no-token-{uuid.uuid4().hex[:8]}"
        
        payload = {
            "user_id": TEST_USER_ID,
            "subscription_id": test_subscription_id
        }
        
        response = requests.post(f"{BASE_URL}/api/push/onesignal/subscribe", json=payload)
        assert response.status_code == 200
        print("✓ Subscription without token works")


class TestPaymentHistory:
    """Test GET /api/payments/history/{user_id} - Payment history endpoint"""
    
    def test_payment_history_returns_200(self):
        """Verify payment history endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/payments/history/{TEST_USER_ID}")
        assert response.status_code == 200
        print("✓ GET /api/payments/history returns 200")
    
    def test_payment_history_returns_list(self):
        """Verify payment history returns array"""
        response = requests.get(f"{BASE_URL}/api/payments/history/{TEST_USER_ID}")
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✓ Payment history returns list with {len(data)} transactions")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
