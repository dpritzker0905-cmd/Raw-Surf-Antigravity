"""
Test Credit Subscription Payment - Iteration 139
Tests the POST /api/subscriptions/pay-with-credits/{user_id} endpoint
Bug fix: CreditTransaction model now uses reference_type instead of related_entity_type
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user - David Pritzker (admin)
ADMIN_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestCreditSubscriptionPayment:
    """Test credit payment for subscription upgrades"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get initial user state before tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Get initial state
        response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        if response.status_code == 200:
            self.initial_credits = response.json().get("credit_balance", 0)
            self.initial_tier = response.json().get("subscription_tier", "free")
        else:
            pytest.skip("Could not get user profile")
    
    def test_get_account_billing_status(self):
        """Test GET /api/subscriptions/account-billing/{user_id} returns correct data"""
        response = self.session.get(f"{BASE_URL}/api/subscriptions/account-billing/{ADMIN_USER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "user_id" in data
        assert "role" in data
        assert "subscription_tier" in data
        assert "credit_balance" not in data  # This endpoint doesn't return credit_balance directly
        assert "available_tiers" in data
        assert "tier_1" in data["available_tiers"]
        assert "tier_2" in data["available_tiers"]
        assert "tier_3" in data["available_tiers"]
        
        print(f"Account billing status: role={data['role']}, tier={data['subscription_tier']}")
    
    def test_credit_payment_info(self):
        """Test GET /api/subscriptions/credit-payment-info/{user_id} returns correct info"""
        response = self.session.get(
            f"{BASE_URL}/api/subscriptions/credit-payment-info/{ADMIN_USER_ID}",
            params={"tier_id": "tier_3"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["tier_id"] == "tier_3"
        assert data["tier_name"] == "Premium"
        assert data["price_usd"] == 10
        assert data["credits_required"] == 10  # 1:1 ratio
        assert "current_balance" in data
        assert "can_afford" in data
        
        print(f"Credit payment info: {data['credits_required']} credits needed, can_afford={data['can_afford']}")
    
    def test_pay_with_credits_upgrade_to_premium(self):
        """Test POST /api/subscriptions/pay-with-credits/{user_id} - upgrade to premium"""
        # Get current balance
        profile_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert profile_response.status_code == 200
        balance_before = profile_response.json().get("credit_balance", 0)
        
        # Pay for tier_3 (premium) - costs 10 credits
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{ADMIN_USER_ID}",
            json={"tier_id": "tier_3", "use_credits": True}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, f"Payment failed: {data}"
        assert data["tier_id"] == "tier_3"
        assert data["new_tier"] == "premium"
        assert data["credits_used"] == 10
        assert data["new_balance"] == balance_before - 10
        
        print(f"Upgraded to premium: credits_used={data['credits_used']}, new_balance={data['new_balance']}")
        
        # Verify subscription was updated in profile
        verify_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data["subscription_tier"] == "premium", f"Expected premium, got {verify_data['subscription_tier']}"
        assert verify_data["credit_balance"] == balance_before - 10
        
        print(f"Verified: subscription_tier={verify_data['subscription_tier']}, credit_balance={verify_data['credit_balance']}")
    
    def test_pay_with_credits_downgrade_to_basic(self):
        """Test POST /api/subscriptions/pay-with-credits/{user_id} - downgrade to basic"""
        # Get current balance
        profile_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert profile_response.status_code == 200
        balance_before = profile_response.json().get("credit_balance", 0)
        
        # Pay for tier_2 (basic) - costs 5 credits
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{ADMIN_USER_ID}",
            json={"tier_id": "tier_2", "use_credits": True}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, f"Payment failed: {data}"
        assert data["tier_id"] == "tier_2"
        assert data["new_tier"] == "basic"
        assert data["credits_used"] == 5
        
        print(f"Changed to basic: credits_used={data['credits_used']}, new_balance={data['new_balance']}")
        
        # Verify subscription was updated
        verify_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data["subscription_tier"] == "basic"
        
        print(f"Verified: subscription_tier={verify_data['subscription_tier']}")
    
    def test_pay_with_credits_free_tier_no_charge(self):
        """Test switching to free tier doesn't charge credits"""
        # Get current balance
        profile_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert profile_response.status_code == 200
        balance_before = profile_response.json().get("credit_balance", 0)
        
        # Switch to tier_1 (free) - should cost 0 credits
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{ADMIN_USER_ID}",
            json={"tier_id": "tier_1", "use_credits": True}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True
        assert data["credits_used"] == 0
        
        print(f"Switched to free: credits_used={data['credits_used']}")
        
        # Verify balance unchanged
        verify_response = self.session.get(f"{BASE_URL}/api/profiles/{ADMIN_USER_ID}")
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data["credit_balance"] == balance_before, "Credits should not be deducted for free tier"
        assert verify_data["subscription_tier"] == "free"
        
        print(f"Verified: subscription_tier={verify_data['subscription_tier']}, balance unchanged")
    
    def test_pay_with_credits_invalid_tier(self):
        """Test invalid tier returns error"""
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{ADMIN_USER_ID}",
            json={"tier_id": "invalid_tier", "use_credits": True}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("Invalid tier correctly rejected")
    
    def test_pay_with_credits_user_not_found(self):
        """Test non-existent user returns 404"""
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/non-existent-user-id",
            json={"tier_id": "tier_2", "use_credits": True}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("Non-existent user correctly returns 404")
    
    def test_restore_user_to_basic(self):
        """Cleanup: Restore user to basic tier"""
        response = self.session.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{ADMIN_USER_ID}",
            json={"tier_id": "tier_2", "use_credits": True}
        )
        
        # This might fail if already on basic, that's ok
        if response.status_code == 200:
            print("Restored user to basic tier")
        else:
            print(f"Could not restore to basic: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
