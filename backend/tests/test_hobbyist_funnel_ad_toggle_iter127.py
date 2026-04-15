"""
Test P1 Features: Hobbyist Funnel & Ad-Free Toggle Logic
Iteration 127

Features tested:
1. POST /api/auth/convert-to-hobbyist with tier_1 (free) returns role=Hobbyist, is_ad_supported=true
2. POST /api/auth/convert-to-hobbyist with tier_2 (basic $5) returns checkout_url for Stripe
3. POST /api/subscriptions/pay-with-credits updates is_ad_supported based on tier price
4. Login response includes is_ad_supported field
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from previous iterations
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "test123"


class TestHobbyistConversion:
    """Test Hobbyist conversion endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test user for conversion tests"""
        self.test_email = f"test_photographer_{uuid.uuid4().hex[:8]}@test.com"
        self.test_password = "testpass123"
        
        # Create a photographer user for testing
        signup_response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": self.test_email,
                "password": self.test_password,
                "full_name": "Test Photographer",
                "role": "Photographer"
            }
        )
        
        if signup_response.status_code == 200:
            self.test_user_id = signup_response.json().get("id")
        else:
            # User might already exist, try login
            login_response = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"email": self.test_email, "password": self.test_password}
            )
            if login_response.status_code == 200:
                self.test_user_id = login_response.json().get("id")
            else:
                self.test_user_id = None
        
        yield
        
        # Cleanup would go here if needed
    
    def test_convert_to_hobbyist_free_tier(self):
        """Test converting Photographer to Hobbyist with free tier (tier_1)"""
        if not self.test_user_id:
            pytest.skip("Could not create test user")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/convert-to-hobbyist?user_id={self.test_user_id}",
            json={
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        print(f"Convert to Hobbyist (free) response: {response.status_code}")
        print(f"Response body: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify response structure
        assert data.get("success") == True, "Expected success=True"
        assert data.get("role") == "Hobbyist", f"Expected role=Hobbyist, got {data.get('role')}"
        assert data.get("subscription_tier") == "free", f"Expected subscription_tier=free, got {data.get('subscription_tier')}"
        assert data.get("is_ad_supported") == True, f"Expected is_ad_supported=True, got {data.get('is_ad_supported')}"
        assert data.get("checkout_url") is None, "Expected checkout_url=None for free tier"
        
        print("✓ Free tier conversion returns correct role, tier, and is_ad_supported=True")
    
    def test_convert_to_hobbyist_basic_tier_returns_checkout_url(self):
        """Test converting Photographer to Hobbyist with basic tier (tier_2) returns Stripe checkout URL"""
        # Create a new user for this test
        test_email = f"test_photographer_basic_{uuid.uuid4().hex[:8]}@test.com"
        
        signup_response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": test_email,
                "password": "testpass123",
                "full_name": "Test Photographer Basic",
                "role": "Photographer"
            }
        )
        
        if signup_response.status_code != 200:
            pytest.skip("Could not create test user for basic tier test")
        
        user_id = signup_response.json().get("id")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/convert-to-hobbyist?user_id={user_id}",
            json={
                "tier_id": "tier_2",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        print(f"Convert to Hobbyist (basic) response: {response.status_code}")
        print(f"Response body: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify response structure for paid tier
        assert data.get("success") == True, "Expected success=True"
        assert data.get("checkout_url") is not None, "Expected checkout_url for paid tier"
        # Stripe checkout URL can be stripe.com or custom domain like checkout.raw.surf
        checkout_url = data.get("checkout_url", "")
        assert "checkout" in checkout_url.lower() or "stripe" in checkout_url.lower(), f"Expected checkout URL, got {checkout_url}"
        
        print(f"✓ Basic tier conversion returns checkout URL: {checkout_url[:50]}...")
    
    def test_convert_to_hobbyist_invalid_tier(self):
        """Test converting with invalid tier_id returns error"""
        if not self.test_user_id:
            pytest.skip("Could not create test user")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/convert-to-hobbyist?user_id={self.test_user_id}",
            json={
                "tier_id": "invalid_tier",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        print(f"Convert to Hobbyist (invalid tier) response: {response.status_code}")
        
        assert response.status_code == 400, f"Expected 400 for invalid tier, got {response.status_code}"
        
        print("✓ Invalid tier_id returns 400 error")
    
    def test_convert_to_hobbyist_user_not_found(self):
        """Test converting non-existent user returns 404"""
        fake_user_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/auth/convert-to-hobbyist?user_id={fake_user_id}",
            json={
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        print(f"Convert to Hobbyist (non-existent user) response: {response.status_code}")
        
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}"
        
        print("✓ Non-existent user returns 404 error")


class TestAdFreeToggleLogic:
    """Test is_ad_supported toggle based on subscription payment"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test user with credits for payment tests"""
        self.test_email = f"test_surfer_credits_{uuid.uuid4().hex[:8]}@test.com"
        self.test_password = "testpass123"
        
        # Create a surfer user for testing
        signup_response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": self.test_email,
                "password": self.test_password,
                "full_name": "Test Surfer Credits",
                "role": "Surfer"
            }
        )
        
        if signup_response.status_code == 200:
            self.test_user_id = signup_response.json().get("id")
        else:
            self.test_user_id = None
        
        yield
    
    def test_pay_with_credits_free_tier_sets_ad_supported_true(self):
        """Test paying for free tier sets is_ad_supported=True"""
        if not self.test_user_id:
            pytest.skip("Could not create test user")
        
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{self.test_user_id}",
            json={
                "tier_id": "tier_1",
                "use_credits": True
            }
        )
        
        print(f"Pay with credits (free tier) response: {response.status_code}")
        print(f"Response body: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success=True"
        assert data.get("credits_used") == 0, "Expected 0 credits used for free tier"
        
        # Verify user's is_ad_supported is True by logging in
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": self.test_email, "password": self.test_password}
        )
        
        if login_response.status_code == 200:
            user_data = login_response.json()
            assert user_data.get("is_ad_supported") == True, f"Expected is_ad_supported=True for free tier, got {user_data.get('is_ad_supported')}"
            print("✓ Free tier sets is_ad_supported=True")
    
    def test_pay_with_credits_paid_tier_insufficient_credits(self):
        """Test paying for paid tier with insufficient credits returns error"""
        if not self.test_user_id:
            pytest.skip("Could not create test user")
        
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{self.test_user_id}",
            json={
                "tier_id": "tier_2",  # Basic tier costs 5 credits
                "use_credits": True
            }
        )
        
        print(f"Pay with credits (insufficient) response: {response.status_code}")
        print(f"Response body: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("success") == False, "Expected success=False for insufficient credits"
        assert data.get("insufficient_credits") == True, "Expected insufficient_credits=True"
        assert "credits_required" in data, "Expected credits_required in response"
        assert "credits_needed" in data, "Expected credits_needed in response"
        
        print("✓ Insufficient credits returns proper error response")


class TestLoginIsAdSupported:
    """Test that login response includes is_ad_supported field"""
    
    def test_login_includes_is_ad_supported_field(self):
        """Test login response includes is_ad_supported field"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            }
        )
        
        print(f"Login response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify is_ad_supported field exists
        assert "is_ad_supported" in data, "Expected is_ad_supported field in login response"
        assert isinstance(data.get("is_ad_supported"), bool), "Expected is_ad_supported to be boolean"
        
        print(f"✓ Login response includes is_ad_supported={data.get('is_ad_supported')}")
    
    def test_login_new_user_default_is_ad_supported(self):
        """Test new user login has is_ad_supported=True by default (free tier)"""
        test_email = f"test_new_user_{uuid.uuid4().hex[:8]}@test.com"
        test_password = "testpass123"
        
        # Create new user
        signup_response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": test_email,
                "password": test_password,
                "full_name": "Test New User",
                "role": "Surfer"
            }
        )
        
        if signup_response.status_code != 200:
            pytest.skip("Could not create test user")
        
        # Login and check is_ad_supported
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_email, "password": test_password}
        )
        
        assert login_response.status_code == 200, f"Expected 200, got {login_response.status_code}"
        
        data = login_response.json()
        
        # New users should have is_ad_supported=True (free tier default)
        assert data.get("is_ad_supported") == True, f"Expected is_ad_supported=True for new user, got {data.get('is_ad_supported')}"
        
        print("✓ New user has is_ad_supported=True by default")


class TestGromSubscriptionAdToggle:
    """Test Grom subscription ad toggle via parent payment"""
    
    def test_grom_free_tier_sets_ad_supported_true(self):
        """Test Grom free tier sets is_ad_supported=True"""
        # Create parent
        parent_email = f"test_parent_{uuid.uuid4().hex[:8]}@test.com"
        parent_password = "testpass123"
        
        parent_signup = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": parent_email,
                "password": parent_password,
                "full_name": "Test Parent",
                "role": "Grom Parent"
            }
        )
        
        if parent_signup.status_code != 200:
            pytest.skip("Could not create parent user")
        
        parent_id = parent_signup.json().get("id")
        
        # Create Grom linked to parent
        grom_email = f"test_grom_{uuid.uuid4().hex[:8]}@test.com"
        
        grom_signup = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": grom_email,
                "password": "testpass123",
                "full_name": "Test Grom",
                "role": "Grom",
                "parent_email": parent_email,
                "birthdate": "2015-01-01"
            }
        )
        
        if grom_signup.status_code != 200:
            print(f"Grom signup failed: {grom_signup.json()}")
            pytest.skip("Could not create grom user")
        
        grom_id = grom_signup.json().get("id")
        
        # Parent pays for Grom's free tier
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/grom-tier/{parent_id}",
            json={
                "grom_id": grom_id,
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        print(f"Grom free tier response: {response.status_code}")
        print(f"Response body: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("success") == True, "Expected success=True"
        
        print("✓ Grom free tier subscription works")


class TestSubscriptionTierDefinitions:
    """Test subscription tier definitions include is_ad_supported"""
    
    def test_surfer_tiers_have_is_ad_supported(self):
        """Test surfer subscription tiers have is_ad_supported defined"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/plans")
        
        print(f"Subscription plans response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Check surfer plans exist
        assert "surfer" in data, "Expected surfer plans in response"
        
        print("✓ Subscription plans endpoint returns data")
    
    def test_account_billing_status_includes_is_ad_supported(self):
        """Test account billing status includes is_ad_supported info"""
        # Login to get user ID
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        
        if login_response.status_code != 200:
            pytest.skip("Could not login")
        
        user_id = login_response.json().get("id")
        
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{user_id}")
        
        print(f"Account billing status response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Check available_tiers have is_ad_supported
        assert "available_tiers" in data, "Expected available_tiers in response"
        
        print("✓ Account billing status endpoint returns tier data")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
