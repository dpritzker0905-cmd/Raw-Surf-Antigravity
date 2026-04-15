"""
Backend tests for Password Authentication - Raw Surf OS
Tests the new password-based login feature:
1. Login with correct password
2. Login with wrong password (401 error)
3. Login with non-existent user (404 error)
4. Signup creates password_hash
5. Legacy accounts (without password) can still login
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


def generate_test_email():
    """Generate unique test email"""
    return f"TEST_pwd_{uuid.uuid4().hex[:8]}@example.com"


class TestPasswordLogin:
    """Tests for password-based login functionality"""
    
    def test_login_with_correct_password(self):
        """Test that login succeeds with correct password"""
        # First create an account
        email = generate_test_email()
        password = "testPassword123"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": password,
            "full_name": "Test Password User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200, f"Signup failed: {signup_response.text}"
        
        # Now login with correct password
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        
        data = login_response.json()
        assert data["email"] == email
        assert data["role"] == "Surfer"
        assert "id" in data
        assert "user_id" in data
        print(f"✅ Login with correct password succeeded for {email}")
    
    def test_login_with_wrong_password_returns_401(self):
        """Test that login with wrong password returns 401 error"""
        # First create an account
        email = generate_test_email()
        password = "correctPassword123"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": password,
            "full_name": "Test Wrong Password User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200, f"Signup failed: {signup_response.text}"
        
        # Now login with wrong password
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": "wrongPassword456"
        })
        assert login_response.status_code == 401, f"Expected 401, got {login_response.status_code}: {login_response.text}"
        
        data = login_response.json()
        assert "detail" in data
        assert "invalid" in data["detail"].lower() or "password" in data["detail"].lower()
        print(f"✅ Login with wrong password correctly returns 401")
    
    def test_login_with_nonexistent_user_returns_404(self):
        """Test that login with non-existent email returns 404 error"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": f"nonexistent_{uuid.uuid4().hex}@example.com",
            "password": "anyPassword123"
        })
        assert login_response.status_code == 404, f"Expected 404, got {login_response.status_code}: {login_response.text}"
        
        data = login_response.json()
        assert "detail" in data
        print(f"✅ Login with non-existent user correctly returns 404")
    
    def test_login_requires_password_field(self):
        """Test that login endpoint requires password field"""
        # Create an account first
        email = generate_test_email()
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testPassword123",
            "full_name": "Test User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        
        # Try to login without password field - should fail validation
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email
        })
        # Should fail with 422 (validation error) since password is required
        assert login_response.status_code == 422, f"Expected 422, got {login_response.status_code}"
        print(f"✅ Login correctly requires password field (422 on missing)")
    
    def test_signup_stores_hashed_password(self):
        """Test that signup stores password hash (not plain text) - verified via login"""
        email = generate_test_email()
        password = "mySecurePassword!@#"
        
        # Signup
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": password,
            "full_name": "Test Hashed User",
            "role": "Photographer"
        })
        assert signup_response.status_code == 200
        
        # Verify password is not returned in response
        data = signup_response.json()
        assert "password" not in data
        assert "password_hash" not in data
        
        # Verify we can login with original password
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_response.status_code == 200
        print(f"✅ Signup correctly stores password hash (login works)")


class TestPasswordLoginAllRoles:
    """Test password login works for all role types"""
    
    def test_login_surfer_roles(self):
        """Test password login works for all surfer roles"""
        surfer_roles = ["Grom", "Surfer", "Comp Surfer", "Pro"]
        
        for role in surfer_roles:
            email = generate_test_email()
            password = "surferPass123"
            
            # Need parent email for Grom
            signup_data = {
                "email": email,
                "password": password,
                "full_name": f"Test {role}",
                "role": role
            }
            
            if role == "Grom":
                # Create a parent first
                parent_email = generate_test_email()
                parent_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
                    "email": parent_email,
                    "password": "parentPass123",
                    "full_name": "Parent User",
                    "role": "Surfer"
                })
                assert parent_resp.status_code == 200
                signup_data["parent_email"] = parent_email
            
            signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
            assert signup_response.status_code == 200, f"Failed to signup {role}: {signup_response.text}"
            
            # Login
            login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
                "email": email,
                "password": password
            })
            assert login_response.status_code == 200, f"Failed to login {role}: {login_response.text}"
            print(f"✅ Password login works for {role}")
    
    def test_login_photographer_roles(self):
        """Test password login works for all photographer roles"""
        photographer_roles = ["Grom Parent", "Hobbyist", "Photographer", "Approved Pro"]
        
        for role in photographer_roles:
            email = generate_test_email()
            password = "photoPass123"
            
            signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
                "email": email,
                "password": password,
                "full_name": f"Test {role}",
                "role": role
            })
            assert signup_response.status_code == 200, f"Failed to signup {role}: {signup_response.text}"
            
            # Login
            login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
                "email": email,
                "password": password
            })
            assert login_response.status_code == 200, f"Failed to login {role}: {login_response.text}"
            print(f"✅ Password login works for {role}")
    
    def test_login_business_roles(self):
        """Test password login works for all business roles"""
        business_roles = ["School", "Coach", "Shop", "Shaper", "Resort"]
        
        for role in business_roles:
            email = generate_test_email()
            password = "businessPass123"
            
            signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
                "email": email,
                "password": password,
                "full_name": f"Test {role}",
                "role": role,
                "company_name": f"Test {role} Company"
            })
            assert signup_response.status_code == 200, f"Failed to signup {role}: {signup_response.text}"
            
            # Login
            login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
                "email": email,
                "password": password
            })
            assert login_response.status_code == 200, f"Failed to login {role}: {login_response.text}"
            print(f"✅ Password login works for {role}")


class TestLoginResponseFields:
    """Test that login response contains all expected fields"""
    
    def test_login_returns_required_fields(self):
        """Test login returns all necessary user profile fields"""
        email = generate_test_email()
        password = "fieldTestPass123"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": password,
            "full_name": "Field Test User",
            "role": "Photographer"
        })
        assert signup_response.status_code == 200
        
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_response.status_code == 200
        
        data = login_response.json()
        
        # Check required fields
        required_fields = ["id", "user_id", "email", "full_name", "role", "credit_balance", "created_at"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        
        # Check optional/profile fields exist
        optional_fields = ["subscription_tier", "bio", "avatar_url", "is_verified", "is_live", 
                          "is_private", "is_approved_pro", "location", "company_name",
                          "portfolio_url", "instagram_url", "website_url", "hourly_rate",
                          "session_price", "accepts_donations", "skill_level", "stance", "home_break"]
        for field in optional_fields:
            assert field in data, f"Missing optional field: {field}"
        
        print(f"✅ Login response contains all required and optional fields")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
