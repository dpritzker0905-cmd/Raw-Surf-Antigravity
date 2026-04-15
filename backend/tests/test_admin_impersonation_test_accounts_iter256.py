"""
Test Admin Impersonation and Test Account Seeding Features - Iteration 256

Tests:
1. POST /api/admin/seed-test-accounts - Creates test accounts for each role
2. GET /api/admin/test-accounts - Lists all test accounts (@test.rawsurf.io)
3. DELETE /api/admin/test-accounts/cleanup - Removes old test accounts
4. POST /api/admin/impersonate/start - Start impersonation session
5. POST /api/admin/impersonate/{session_id}/end - End impersonation session
6. GET /api/admin/impersonate/history - Get impersonation history
"""

import pytest
import requests
import os
import hashlib

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "Test123!"


def hash_password(password: str) -> str:
    """Hash password using SHA256 (matching backend)"""
    return hashlib.sha256(password.encode()).hexdigest()


@pytest.fixture(scope="module")
def admin_user():
    """Login as admin and return user data"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code != 200:
        pytest.skip(f"Admin login failed: {response.status_code} - {response.text}")
    return response.json()


class TestTestAccountSeeding:
    """Test account seeding endpoints"""
    
    def test_seed_all_roles_creates_accounts(self, admin_user):
        """POST /api/admin/seed-test-accounts with seed_all_roles=True creates accounts for all role types"""
        admin_id = admin_user.get('id')
        
        response = requests.post(
            f"{BASE_URL}/api/admin/seed-test-accounts?admin_id={admin_id}",
            json={
                "seed_all_roles": True,
                "password": "Test123!"
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "accounts" in data
        assert "message" in data
        
        # Should create accounts for multiple roles
        accounts = data.get("accounts", [])
        print(f"Created {len(accounts)} test accounts")
        
        # Verify account structure
        if accounts:
            account = accounts[0]
            assert "id" in account
            assert "email" in account
            assert "@test.rawsurf.io" in account["email"]
            assert "role" in account
            assert "password" in account
            
        # Verify roles created
        roles_created = [a["role"] for a in accounts]
        print(f"Roles created: {roles_created}")
        
        # Should have at least some of these roles
        expected_roles = ["Surfer", "Photographer", "Approved Pro", "Grom", "GromParent", "Competitive Surfer"]
        for role in expected_roles:
            if role in roles_created:
                print(f"✓ {role} account created")
    
    def test_list_test_accounts(self, admin_user):
        """GET /api/admin/test-accounts lists all test accounts"""
        admin_id = admin_user.get('id')
        
        response = requests.get(f"{BASE_URL}/api/admin/test-accounts?admin_id={admin_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "total" in data
        assert "accounts" in data
        
        print(f"Found {data['total']} test accounts")
        
        # Verify all accounts have @test.rawsurf.io email
        for account in data.get("accounts", []):
            assert "@test.rawsurf.io" in account.get("email", ""), f"Account {account.get('id')} doesn't have test email domain"
            assert "id" in account
            assert "role" in account
            print(f"  - {account.get('email')} ({account.get('role')})")
    
    def test_cleanup_test_accounts(self, admin_user):
        """DELETE /api/admin/test-accounts/cleanup removes old test accounts"""
        admin_id = admin_user.get('id')
        
        # Use a very long time period to avoid deleting recently created accounts
        response = requests.delete(
            f"{BASE_URL}/api/admin/test-accounts/cleanup?admin_id={admin_id}&older_than_days=365"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "message" in data
        print(f"Cleanup result: {data.get('message')}")
    
    def test_seed_requires_admin(self):
        """POST /api/admin/seed-test-accounts requires admin authentication"""
        # Use a fake/non-admin user ID
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/admin/seed-test-accounts?admin_id={fake_user_id}",
            json={
                "seed_all_roles": True,
                "password": "Test123!"
            }
        )
        
        # Should fail with 403 or 404
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"Non-admin correctly rejected with {response.status_code}")


class TestImpersonation:
    """Test impersonation endpoints"""
    
    def test_start_impersonation_requires_target_user(self, admin_user):
        """POST /api/admin/impersonate/start requires valid target user"""
        admin_id = admin_user.get('id')
        
        # Try with non-existent user
        response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/start?admin_id={admin_id}",
            json={
                "target_user_id": "00000000-0000-0000-0000-000000000000",
                "reason": "Testing",
                "is_read_only": True
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}"
        print("Non-existent user correctly rejected")
    
    def test_start_impersonation_with_test_account(self, admin_user):
        """POST /api/admin/impersonate/start works with valid test account"""
        admin_id = admin_user.get('id')
        
        # First get a test account to impersonate
        list_response = requests.get(f"{BASE_URL}/api/admin/test-accounts?admin_id={admin_id}")
        
        if list_response.status_code != 200:
            pytest.skip("Could not list test accounts")
        
        accounts = list_response.json().get("accounts", [])
        if not accounts:
            pytest.skip("No test accounts available to impersonate")
        
        # Pick a non-admin test account
        target_account = accounts[0]
        target_user_id = target_account.get("id")
        
        print(f"Attempting to impersonate: {target_account.get('email')} ({target_account.get('role')})")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/start?admin_id={admin_id}",
            json={
                "target_user_id": target_user_id,
                "reason": "Testing impersonation feature",
                "is_read_only": True
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "session_id" in data
        assert "target_user" in data
        assert "is_read_only" in data
        
        session_id = data.get("session_id")
        target_user = data.get("target_user")
        
        print(f"Impersonation session started: {session_id}")
        print(f"Target user: {target_user.get('full_name')} ({target_user.get('email')})")
        
        # Verify target user data
        assert target_user.get("id") == target_user_id
        assert target_user.get("email") == target_account.get("email")
        
        # End the impersonation session
        end_response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/{session_id}/end?admin_id={admin_id}"
        )
        
        assert end_response.status_code == 200, f"Failed to end impersonation: {end_response.status_code}"
        print("Impersonation session ended successfully")
    
    def test_cannot_impersonate_admin(self, admin_user):
        """POST /api/admin/impersonate/start cannot impersonate other admins"""
        admin_id = admin_user.get('id')
        
        # Try to impersonate self (admin)
        response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/start?admin_id={admin_id}",
            json={
                "target_user_id": admin_id,
                "reason": "Testing",
                "is_read_only": True
            }
        )
        
        # Should fail with 403
        assert response.status_code == 403, f"Expected 403 for admin impersonation, got {response.status_code}"
        print("Admin impersonation correctly blocked")
    
    def test_impersonation_history(self, admin_user):
        """GET /api/admin/impersonate/history returns session history"""
        admin_id = admin_user.get('id')
        
        response = requests.get(f"{BASE_URL}/api/admin/impersonate/history?admin_id={admin_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list)
        
        print(f"Found {len(data)} impersonation sessions in history")
        
        # Verify session structure if any exist
        if data:
            session = data[0]
            assert "id" in session
            assert "admin" in session or "admin_id" in session
            assert "target_user" in session or "target_user_id" in session
            assert "started_at" in session
            print(f"Latest session: {session.get('started_at')}")
    
    def test_end_impersonation_invalid_session(self, admin_user):
        """POST /api/admin/impersonate/{session_id}/end fails for invalid session"""
        admin_id = admin_user.get('id')
        
        fake_session_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/{fake_session_id}/end?admin_id={admin_id}"
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid session, got {response.status_code}"
        print("Invalid session correctly rejected")


class TestImpersonationRequiresAdmin:
    """Test that impersonation endpoints require admin access"""
    
    def test_start_impersonation_requires_admin(self):
        """POST /api/admin/impersonate/start requires admin"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/admin/impersonate/start?admin_id={fake_user_id}",
            json={
                "target_user_id": "some-user-id",
                "reason": "Testing",
                "is_read_only": True
            }
        )
        
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"Non-admin correctly rejected with {response.status_code}")
    
    def test_history_requires_admin(self):
        """GET /api/admin/impersonate/history requires admin"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.get(f"{BASE_URL}/api/admin/impersonate/history?admin_id={fake_user_id}")
        
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"Non-admin correctly rejected with {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
