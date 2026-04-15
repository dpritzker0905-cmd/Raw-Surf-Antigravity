"""
Backend tests for Raw Surf OS - Auth and Signup flows
Tests all signup categories: Surfer, Photographer, Business
Validates proper redirect_path and subscription_tier routing
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

def generate_test_email():
    """Generate unique test email"""
    return f"TEST_{uuid.uuid4().hex[:8]}@example.com"


class TestAPIHealth:
    """API health check tests"""
    
    def test_api_root(self):
        """Test API root endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        print(f"API root response: {data}")


class TestSurferSignup:
    """Surfer category signup tests - should redirect to /surfer-subscription"""
    
    def test_signup_grom(self):
        """Test Grom signup requires parent email and redirects to surfer-subscription"""
        # First create a parent account
        parent_email = generate_test_email()
        parent_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": parent_email,
            "password": "testpass123",
            "full_name": "Parent Surfer",
            "role": "Surfer"
        })
        assert parent_response.status_code == 200
        
        # Now create Grom account with parent email
        grom_email = generate_test_email()
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": grom_email,
            "password": "testpass123",
            "full_name": "Test Grom",
            "role": "Grom",
            "parent_email": parent_email
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Grom"
        assert data["redirect_path"] == "/surfer-subscription"
        assert data["requires_subscription"] == True
        assert data["subscription_tier"] is None
        print(f"Grom signup: redirect_path={data['redirect_path']}")
    
    def test_signup_grom_without_parent_fails(self):
        """Test Grom signup without parent email fails"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Grom",
            "role": "Grom"
        })
        assert response.status_code == 400
        print("Grom without parent email correctly rejected")
    
    def test_signup_surfer(self):
        """Test regular Surfer signup redirects to surfer-subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Surfer",
            "role": "Surfer"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Surfer"
        assert data["redirect_path"] == "/surfer-subscription"
        assert data["requires_subscription"] == True
        print(f"Surfer signup: redirect_path={data['redirect_path']}")
    
    def test_signup_comp_surfer(self):
        """Test Competitive Surfer signup redirects to surfer-subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Comp Surfer",
            "role": "Comp Surfer"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Comp Surfer"
        assert data["redirect_path"] == "/surfer-subscription"
        assert data["requires_subscription"] == True
        print(f"Comp Surfer signup: redirect_path={data['redirect_path']}")
    
    def test_signup_pro_surfer(self):
        """Test Pro surfer signup redirects to surfer-subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Pro Surfer",
            "role": "Pro"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Pro"
        assert data["redirect_path"] == "/surfer-subscription"
        assert data["requires_subscription"] == True
        print(f"Pro Surfer signup: redirect_path={data['redirect_path']}")


class TestPhotographerSignup:
    """Photographer category signup tests"""
    
    def test_signup_photographer(self):
        """Test Photographer signup redirects to photographer-subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Photographer",
            "role": "Photographer"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Photographer"
        assert data["redirect_path"] == "/photographer-subscription"
        assert data["requires_subscription"] == True
        print(f"Photographer signup: redirect_path={data['redirect_path']}")
    
    def test_signup_approved_pro(self):
        """Test Approved Pro signup redirects to pro-onboarding"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Approved Pro",
            "role": "Approved Pro"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Approved Pro"
        assert data["redirect_path"] == "/pro-onboarding"
        assert data["requires_onboarding"] == True
        print(f"Approved Pro signup: redirect_path={data['redirect_path']}")
    
    def test_signup_grom_parent(self):
        """Test Grom Parent signup skips subscription and goes to feed"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Grom Parent",
            "role": "Grom Parent"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Grom Parent"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "free"
        assert data["requires_subscription"] == False
        print(f"Grom Parent signup: redirect_path={data['redirect_path']}, tier={data['subscription_tier']}")
    
    def test_signup_hobbyist(self):
        """Test Hobbyist signup skips subscription and goes to feed"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Hobbyist",
            "role": "Hobbyist"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Hobbyist"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "free"
        assert data["requires_subscription"] == False
        print(f"Hobbyist signup: redirect_path={data['redirect_path']}, tier={data['subscription_tier']}")


class TestBusinessSignup:
    """Business category signup tests - all should skip subscription and go to feed"""
    
    def test_signup_school(self):
        """Test Surf School signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test School Owner",
            "role": "School",
            "company_name": "Test Surf School"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "School"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"School signup: redirect_path={data['redirect_path']}, tier={data['subscription_tier']}")
    
    def test_signup_coach(self):
        """Test Surf Coach signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Coach",
            "role": "Coach",
            "company_name": "Test Coaching"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Coach"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"Coach signup: redirect_path={data['redirect_path']}")
    
    def test_signup_resort(self):
        """Test Resort signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Resort Owner",
            "role": "Resort",
            "company_name": "Test Surf Resort"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Resort"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"Resort signup: redirect_path={data['redirect_path']}")
    
    def test_signup_destination(self):
        """Test Destination signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Destination Owner",
            "role": "Destination",
            "company_name": "Test Surf Destination"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Destination"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"Destination signup: redirect_path={data['redirect_path']}")
    
    def test_signup_shop(self):
        """Test Shop signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Shop Owner",
            "role": "Shop",
            "company_name": "Test Surf Shop"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Shop"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"Shop signup: redirect_path={data['redirect_path']}")
    
    def test_signup_shaper(self):
        """Test Shaper signup skips subscription"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": generate_test_email(),
            "password": "testpass123",
            "full_name": "Test Shaper",
            "role": "Shaper",
            "company_name": "Test Surfboards"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert data["role"] == "Shaper"
        assert data["redirect_path"] == "/feed"
        assert data["subscription_tier"] == "business"
        print(f"Shaper signup: redirect_path={data['redirect_path']}")


class TestSubscriptionEndpoints:
    """Test subscription update endpoints"""
    
    def test_update_subscription(self):
        """Test subscription tier update"""
        # Create a surfer first
        email = generate_test_email()
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test Surfer",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        profile_id = signup_response.json()["id"]
        
        # Update subscription to basic
        response = requests.post(f"{BASE_URL}/api/profiles/{profile_id}/subscription", json={
            "subscription_tier": "basic"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["subscription_tier"] == "basic"
        print(f"Subscription updated to: {data['subscription_tier']}")
        
        # Verify via GET profile
        profile_response = requests.get(f"{BASE_URL}/api/profiles/{profile_id}")
        assert profile_response.status_code == 200
        profile_data = profile_response.json()
        assert profile_data["subscription_tier"] == "basic"


class TestProOnboarding:
    """Test Pro Onboarding flow"""
    
    def test_submit_pro_onboarding(self):
        """Test Pro onboarding submission"""
        # Create Approved Pro account
        email = generate_test_email()
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test Pro",
            "role": "Approved Pro"
        })
        assert signup_response.status_code == 200
        profile_id = signup_response.json()["id"]
        
        # Submit pro onboarding
        response = requests.post(f"{BASE_URL}/api/profiles/{profile_id}/pro-onboarding", json={
            "portfolio_url": "https://portfolio.example.com",
            "instagram_url": "https://instagram.com/testpro",
            "bio": "Professional surf photographer"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["portfolio_url"] == "https://portfolio.example.com"
        print(f"Pro onboarding submitted: {data}")
    
    def test_non_pro_cannot_submit_onboarding(self):
        """Test that non-Approved Pro users cannot submit onboarding"""
        # Create regular photographer
        email = generate_test_email()
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test Photographer",
            "role": "Photographer"
        })
        assert signup_response.status_code == 200
        profile_id = signup_response.json()["id"]
        
        # Try to submit pro onboarding - should fail
        response = requests.post(f"{BASE_URL}/api/profiles/{profile_id}/pro-onboarding", json={
            "portfolio_url": "https://portfolio.example.com"
        })
        assert response.status_code == 403
        print("Non-Pro correctly rejected from pro-onboarding")


class TestDuplicateEmail:
    """Test duplicate email handling"""
    
    def test_duplicate_email_fails(self):
        """Test that duplicate email registration fails"""
        email = generate_test_email()
        
        # First signup
        response1 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test User",
            "role": "Surfer"
        })
        assert response1.status_code == 200
        
        # Second signup with same email should fail
        response2 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test User 2",
            "role": "Photographer"
        })
        assert response2.status_code == 400
        print("Duplicate email correctly rejected")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
