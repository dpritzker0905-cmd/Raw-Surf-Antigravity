"""
Password Reset and Admin Bootstrap API Tests
Tests for:
- POST /api/auth/forgot-password
- POST /api/auth/verify-reset-token
- POST /api/auth/reset-password
- POST /api/admin/bootstrap
- Login is_admin field verification
"""

import pytest
import requests
import os
import time
from datetime import datetime
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestForgotPassword:
    """Tests for POST /api/auth/forgot-password endpoint"""
    
    def setup_method(self):
        """Create test user for password reset tests"""
        self.test_email = f"TEST_pwreset_{uuid.uuid4().hex[:8]}@test.com"
        self.test_password = "testPassword123"
        self.test_name = "Test Password Reset User"
        
        # Create a test user
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.test_email,
            "password": self.test_password,
            "full_name": self.test_name,
            "role": "Surfer"
        })
        assert signup_response.status_code == 200, f"Setup failed: {signup_response.text}"
        self.user_id = signup_response.json().get("id")
    
    def test_forgot_password_returns_success_and_dev_token(self):
        """FORGOT PASSWORD: POST /api/auth/forgot-password - returns success message and dev token"""
        response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": self.test_email
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify success message
        assert data.get("success") == True
        assert "message" in data
        assert "reset link" in data["message"].lower() or "email" in data["message"].lower()
        
        # Verify dev token is returned (for testing purposes)
        assert "_dev_token" in data, "Dev token should be included for testing"
        assert isinstance(data["_dev_token"], str)
        assert len(data["_dev_token"]) > 0
        
        # Store token for further tests
        self.reset_token = data["_dev_token"]
        print(f"PASS: Forgot password returns success and dev token for {self.test_email}")
    
    def test_forgot_password_prevents_email_enumeration(self):
        """Forgot password returns same message for non-existent email (security)"""
        fake_email = f"nonexistent_{uuid.uuid4().hex[:8]}@fake.com"
        
        response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": fake_email
        })
        
        # Should still return 200 to prevent email enumeration
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        print("PASS: Forgot password prevents email enumeration for non-existent email")
    
    def test_forgot_password_invalidates_previous_tokens(self):
        """FORGOT PASSWORD: Generates reset token that expires in 1 hour (invalidates old tokens)"""
        # Request first token
        response1 = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": self.test_email
        })
        token1 = response1.json().get("_dev_token")
        
        # Request second token - should invalidate first
        response2 = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": self.test_email
        })
        token2 = response2.json().get("_dev_token")
        
        # First token should now be invalid (used=True)
        verify_response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": token1
        })
        # Should return error since token was invalidated
        assert verify_response.status_code == 400, f"Old token should be invalidated, got {verify_response.status_code}"
        print("PASS: Multiple reset requests invalidate previous tokens")
        
        # Second token should still be valid
        verify_response2 = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": token2
        })
        assert verify_response2.status_code == 200, "New token should be valid"
        print("PASS: New token remains valid")


class TestVerifyResetToken:
    """Tests for POST /api/auth/verify-reset-token endpoint"""
    
    def setup_method(self):
        """Create test user and get reset token"""
        self.test_email = f"TEST_verify_{uuid.uuid4().hex[:8]}@test.com"
        self.test_password = "testPassword123"
        
        # Create a test user
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.test_email,
            "password": self.test_password,
            "full_name": "Test Verify User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        
        # Get reset token
        reset_response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": self.test_email
        })
        assert reset_response.status_code == 200
        self.reset_token = reset_response.json().get("_dev_token")
    
    def test_verify_token_validates_valid_token(self):
        """VERIFY TOKEN: POST /api/auth/verify-reset-token - validates token"""
        response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": self.reset_token
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("valid") == True
        assert "email" in data
        assert data["email"] == self.test_email
        assert "expires_at" in data
        print(f"PASS: Valid token verification returns email {data['email']}")
    
    def test_verify_token_returns_error_for_invalid_token(self):
        """VERIFY TOKEN: Returns error for invalid/expired tokens"""
        fake_token = "invalid_token_12345abcdef"
        
        response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": fake_token
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "invalid" in data["detail"].lower()
        print("PASS: Invalid token returns 400 error")
    
    def test_verify_token_returns_error_for_used_token(self):
        """VERIFY TOKEN: Returns error for already-used tokens"""
        # First, use the token to reset password
        requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": "newPassword456"
        })
        
        # Now try to verify the used token
        response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": self.reset_token
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "used" in data["detail"].lower() or "already" in data["detail"].lower()
        print("PASS: Used token returns appropriate error")


class TestResetPassword:
    """Tests for POST /api/auth/reset-password endpoint"""
    
    def setup_method(self):
        """Create test user and get reset token"""
        self.test_email = f"TEST_reset_{uuid.uuid4().hex[:8]}@test.com"
        self.original_password = "originalPass123"
        self.new_password = "newPassword456"
        
        # Create a test user
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.test_email,
            "password": self.original_password,
            "full_name": "Test Reset User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        self.user_id = signup_response.json().get("id")
        
        # Get reset token
        reset_response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": self.test_email
        })
        assert reset_response.status_code == 200
        self.reset_token = reset_response.json().get("_dev_token")
    
    def test_reset_password_with_valid_token(self):
        """RESET PASSWORD: POST /api/auth/reset-password - resets password with valid token"""
        response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": self.new_password
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("success") == True
        assert "message" in data
        assert "success" in data["message"].lower() or "reset" in data["message"].lower()
        print("PASS: Password reset successful with valid token")
    
    def test_reset_password_marks_token_as_used(self):
        """RESET PASSWORD: Marks token as used after successful reset"""
        # Reset password
        reset_response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": self.new_password
        })
        assert reset_response.status_code == 200
        
        # Try to verify the same token - should fail
        verify_response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": self.reset_token
        })
        
        assert verify_response.status_code == 400
        data = verify_response.json()
        assert "used" in data["detail"].lower() or "already" in data["detail"].lower()
        print("PASS: Token marked as used after password reset")
    
    def test_reset_password_prevents_token_reuse(self):
        """RESET PASSWORD: Prevents reuse of tokens"""
        # First reset
        response1 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": self.new_password
        })
        assert response1.status_code == 200
        
        # Try to reuse the same token
        response2 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": "anotherNewPass789"
        })
        
        assert response2.status_code == 400
        data = response2.json()
        assert "detail" in data
        print("PASS: Token reuse prevented - second reset attempt rejected")
    
    def test_login_with_new_password_after_reset(self):
        """Complete flow: Reset password and login with new password"""
        # Reset password
        reset_response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": self.new_password
        })
        assert reset_response.status_code == 200
        
        # Try login with OLD password - should fail
        old_login = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.test_email,
            "password": self.original_password
        })
        assert old_login.status_code == 401, "Old password should not work"
        print("PASS: Old password rejected after reset")
        
        # Try login with NEW password - should succeed
        new_login = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.test_email,
            "password": self.new_password
        })
        assert new_login.status_code == 200, f"New password login failed: {new_login.text}"
        data = new_login.json()
        assert data["email"] == self.test_email
        print(f"PASS: Login successful with new password for {self.test_email}")
    
    def test_reset_password_validates_password_length(self):
        """Password must be at least 6 characters"""
        response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": self.reset_token,
            "new_password": "12345"  # Too short
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "6 characters" in data["detail"].lower() or "password" in data["detail"].lower()
        print("PASS: Short password rejected (< 6 chars)")


class TestAdminBootstrap:
    """Tests for POST /api/admin/bootstrap endpoint"""
    
    def test_admin_bootstrap_fails_if_admin_exists(self):
        """ADMIN BOOTSTRAP: Fails if admin already exists"""
        # First, create a user to try making admin
        test_email = f"TEST_bootstrap_{uuid.uuid4().hex[:8]}@test.com"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": test_email,
            "password": "testPassword123",
            "full_name": "Test Bootstrap User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        
        # Try to bootstrap (likely already has an admin)
        response = requests.post(f"{BASE_URL}/api/admin/bootstrap", params={
            "email": test_email
        })
        
        # This test expects either success (no admin exists) or failure (admin exists)
        # In most cases, an admin already exists in the system
        if response.status_code == 400:
            data = response.json()
            assert "admin already exists" in data["detail"].lower() or "use /admin/make-admin" in data["detail"].lower()
            print("PASS: Bootstrap correctly fails when admin already exists")
        elif response.status_code == 200:
            # Bootstrap succeeded - first admin
            data = response.json()
            assert "admin" in data["message"].lower() or "first" in data["message"].lower()
            print(f"PASS: Bootstrap succeeded - {test_email} is first admin")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}, {response.text}")
    
    def test_admin_bootstrap_requires_existing_user(self):
        """ADMIN BOOTSTRAP: Requires existing user account"""
        fake_email = f"nonexistent_{uuid.uuid4().hex[:8]}@fake.com"
        
        response = requests.post(f"{BASE_URL}/api/admin/bootstrap", params={
            "email": fake_email
        })
        
        # Should fail with 404 (user not found) or 400 (admin exists)
        assert response.status_code in [400, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 404:
            data = response.json()
            assert "not found" in data["detail"].lower()
            print("PASS: Bootstrap fails for non-existent user")
        else:
            # Admin exists
            print("PASS: Bootstrap blocked - admin already exists")


class TestLoginIsAdminField:
    """Tests for is_admin field in login response"""
    
    def test_login_response_includes_is_admin_field(self):
        """LOGIN RESPONSE: Includes is_admin field"""
        # Create a regular test user
        test_email = f"TEST_admin_field_{uuid.uuid4().hex[:8]}@test.com"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": test_email,
            "password": "testPassword123",
            "full_name": "Test Admin Field User",
            "role": "Surfer"
        })
        assert signup_response.status_code == 200
        
        # Login
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_email,
            "password": "testPassword123"
        })
        
        assert login_response.status_code == 200
        data = login_response.json()
        
        # Verify is_admin field exists
        assert "is_admin" in data, "Login response should include is_admin field"
        assert isinstance(data["is_admin"], bool)
        
        # Regular user should not be admin
        assert data["is_admin"] == False, "New user should not be admin"
        print(f"PASS: Login response includes is_admin=False for regular user {test_email}")


class TestCompletePasswordResetFlow:
    """End-to-end test for complete password reset flow"""
    
    def test_full_password_reset_flow(self):
        """Complete flow: request reset -> verify token -> reset password -> login with new password"""
        # Step 1: Create user
        test_email = f"TEST_fullflow_{uuid.uuid4().hex[:8]}@test.com"
        original_password = "original123"
        new_password = "newSecure456"
        
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": test_email,
            "password": original_password,
            "full_name": "Test Full Flow User",
            "role": "Photographer"
        })
        assert signup_response.status_code == 200
        print(f"Step 1 PASS: User created: {test_email}")
        
        # Step 2: Request password reset
        forgot_response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": test_email
        })
        assert forgot_response.status_code == 200
        assert forgot_response.json().get("success") == True
        reset_token = forgot_response.json().get("_dev_token")
        assert reset_token, "Reset token should be returned"
        print("Step 2 PASS: Password reset requested, token received")
        
        # Step 3: Verify token
        verify_response = requests.post(f"{BASE_URL}/api/auth/verify-reset-token", json={
            "token": reset_token
        })
        assert verify_response.status_code == 200
        assert verify_response.json().get("valid") == True
        assert verify_response.json().get("email") == test_email
        print("Step 3 PASS: Token verified successfully")
        
        # Step 4: Reset password
        reset_response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": reset_token,
            "new_password": new_password
        })
        assert reset_response.status_code == 200
        assert reset_response.json().get("success") == True
        print("Step 4 PASS: Password reset completed")
        
        # Step 5: Login with new password
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_email,
            "password": new_password
        })
        assert login_response.status_code == 200
        assert login_response.json().get("email") == test_email
        assert "is_admin" in login_response.json()
        print("Step 5 PASS: Login with new password successful")
        
        print(f"\n✅ COMPLETE PASSWORD RESET FLOW VERIFIED for {test_email}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
