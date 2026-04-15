"""
Test Signup Redirect Logic - Iteration 283

Tests that after signup, users are redirected to the correct page based on their role:
- Surfer roles (Grom, Surfer, Comp Surfer, Pro) → /surfer-subscription
- Photographer → /photographer-subscription
- Hobbyist → /photographer-subscription
- Verified Pro Photographer (Approved Pro) → /pro-onboarding
- Business roles (School, Coach, Shop, Shaper, Resort) → /business-onboarding

Also verifies:
- Username is required during signup
- User is logged in after signup (returns user data)
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSignupRedirectLogic:
    """Test signup API returns correct redirect paths for each user type"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.test_password = "Test123!"
        self.test_email_prefix = f"signuptest_{uuid.uuid4().hex[:8]}"
    
    def test_surfer_signup_redirects_to_surfer_subscription(self):
        """Surfer signup should redirect to /surfer-subscription"""
        email = f"{self.test_email_prefix}_surfer@test.rawsurf.io"
        username = f"testsurfer{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Surfer",
            "username": username,
            "role": "Surfer"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Verify redirect path
        assert data.get("redirect_path") == "/surfer-subscription", f"Expected /surfer-subscription, got {data.get('redirect_path')}"
        assert data.get("requires_subscription") == True
        assert data.get("role") == "Surfer"
        # Verify user is logged in (has id)
        assert "id" in data
        print(f"✓ Surfer signup redirects to: {data.get('redirect_path')}")
    
    def test_photographer_signup_redirects_to_photographer_subscription(self):
        """Photographer signup should redirect to /photographer-subscription"""
        email = f"{self.test_email_prefix}_photo@test.rawsurf.io"
        username = f"testphoto{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Photographer",
            "username": username,
            "role": "Photographer"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/photographer-subscription", f"Expected /photographer-subscription, got {data.get('redirect_path')}"
        assert data.get("requires_subscription") == True
        assert data.get("role") == "Photographer"
        assert "id" in data
        print(f"✓ Photographer signup redirects to: {data.get('redirect_path')}")
    
    def test_verified_pro_photographer_signup_redirects_to_pro_onboarding(self):
        """Verified Pro Photographer (Approved Pro) signup should redirect to /pro-onboarding"""
        email = f"{self.test_email_prefix}_pro@test.rawsurf.io"
        username = f"testpro{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Pro Photographer",
            "username": username,
            "role": "Approved Pro"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/pro-onboarding", f"Expected /pro-onboarding, got {data.get('redirect_path')}"
        assert data.get("requires_onboarding") == True
        assert data.get("role") == "Approved Pro"
        assert "id" in data
        print(f"✓ Verified Pro Photographer signup redirects to: {data.get('redirect_path')}")
    
    def test_hobbyist_signup_redirects_to_feed(self):
        """Hobbyist signup should redirect to /feed (free tier, no subscription needed)"""
        email = f"{self.test_email_prefix}_hobby@test.rawsurf.io"
        username = f"testhobby{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Hobbyist",
            "username": username,
            "role": "Hobbyist"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Hobbyist gets free tier and goes to feed
        assert data.get("redirect_path") == "/feed", f"Expected /feed, got {data.get('redirect_path')}"
        assert data.get("subscription_tier") == "free"
        assert data.get("role") == "Hobbyist"
        assert "id" in data
        print(f"✓ Hobbyist signup redirects to: {data.get('redirect_path')}")
    
    def test_business_school_signup_redirects_to_feed(self):
        """Business (School) signup should redirect to /feed with business tier"""
        email = f"{self.test_email_prefix}_school@test.rawsurf.io"
        username = f"testschool{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test School Owner",
            "username": username,
            "role": "School",
            "company_name": "Test Surf School"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Business roles get business tier and go to feed
        assert data.get("redirect_path") == "/feed", f"Expected /feed, got {data.get('redirect_path')}"
        assert data.get("subscription_tier") == "business"
        assert data.get("role") == "School"
        assert "id" in data
        print(f"✓ Business (School) signup redirects to: {data.get('redirect_path')}")
    
    def test_business_coach_signup_redirects_to_feed(self):
        """Business (Coach) signup should redirect to /feed with business tier"""
        email = f"{self.test_email_prefix}_coach@test.rawsurf.io"
        username = f"testcoach{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Coach",
            "username": username,
            "role": "Coach",
            "company_name": "Test Coaching"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/feed", f"Expected /feed, got {data.get('redirect_path')}"
        assert data.get("subscription_tier") == "business"
        assert data.get("role") == "Coach"
        print(f"✓ Business (Coach) signup redirects to: {data.get('redirect_path')}")
    
    def test_grom_signup_redirects_to_surfer_subscription(self):
        """Grom signup should redirect to /surfer-subscription"""
        email = f"{self.test_email_prefix}_grom@test.rawsurf.io"
        username = f"testgrom{uuid.uuid4().hex[:6]}"
        parent_email = f"{self.test_email_prefix}_parent@test.rawsurf.io"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Grom",
            "username": username,
            "role": "Grom",
            "parent_email": parent_email,
            "birthdate": "2015-01-15"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/surfer-subscription", f"Expected /surfer-subscription, got {data.get('redirect_path')}"
        assert data.get("requires_subscription") == True
        assert data.get("role") == "Grom"
        print(f"✓ Grom signup redirects to: {data.get('redirect_path')}")
    
    def test_comp_surfer_signup_redirects_to_surfer_subscription(self):
        """Competitive Surfer signup should redirect to /surfer-subscription"""
        email = f"{self.test_email_prefix}_comp@test.rawsurf.io"
        username = f"testcomp{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Comp Surfer",
            "username": username,
            "role": "Comp Surfer"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/surfer-subscription", f"Expected /surfer-subscription, got {data.get('redirect_path')}"
        assert data.get("requires_subscription") == True
        assert data.get("role") == "Comp Surfer"
        print(f"✓ Comp Surfer signup redirects to: {data.get('redirect_path')}")
    
    def test_pro_surfer_signup_redirects_to_surfer_subscription(self):
        """Pro Surfer signup should redirect to /surfer-subscription"""
        email = f"{self.test_email_prefix}_prosurfer@test.rawsurf.io"
        username = f"testprosurfer{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": self.test_password,
            "full_name": "Test Pro Surfer",
            "username": username,
            "role": "Pro"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        assert data.get("redirect_path") == "/surfer-subscription", f"Expected /surfer-subscription, got {data.get('redirect_path')}"
        assert data.get("requires_subscription") == True
        assert data.get("role") == "Pro"
        print(f"✓ Pro Surfer signup redirects to: {data.get('redirect_path')}")


class TestSignupUsernameValidation:
    """Test that username is required during signup"""
    
    def test_signup_without_username_fails(self):
        """Signup without username should fail with 422"""
        email = f"nousername_{uuid.uuid4().hex[:8]}@test.rawsurf.io"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "Test123!",
            "full_name": "No Username User",
            "role": "Surfer"
            # Missing username
        })
        
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("✓ Signup without username correctly returns 422")
    
    def test_signup_with_short_username_fails(self):
        """Signup with username < 3 chars should fail"""
        email = f"shortuser_{uuid.uuid4().hex[:8]}@test.rawsurf.io"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "Test123!",
            "full_name": "Short Username User",
            "username": "ab",  # Too short
            "role": "Surfer"
        })
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Signup with short username correctly returns 400")


class TestSignupUserLoggedIn:
    """Test that user is logged in after signup (returns user data)"""
    
    def test_signup_returns_user_id(self):
        """Signup should return user id (indicating logged in state)"""
        email = f"loggedin_{uuid.uuid4().hex[:8]}@test.rawsurf.io"
        username = f"loggedin{uuid.uuid4().hex[:6]}"
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "Test123!",
            "full_name": "Logged In User",
            "username": username,
            "role": "Surfer"
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Verify user data is returned (indicating logged in)
        assert "id" in data, "User id not returned"
        assert "email" in data, "Email not returned"
        assert "role" in data, "Role not returned"
        assert data["email"] == email
        print(f"✓ Signup returns user data: id={data['id']}, email={data['email']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
