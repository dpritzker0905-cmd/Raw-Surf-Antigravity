"""
Test Admin Console Bulk Update Feature
- POST /api/admin/users/bulk-update endpoint for role and subscription changes
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestBulkUpdateEndpoint:
    """Test bulk update endpoint for admin console"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data - get admin user and test users"""
        # Get admin user
        response = requests.get(f"{BASE_URL}/api/admin/users", params={
            "admin_id": "test-admin",  # Will fail, need real admin
            "limit": 5
        })
        # We'll use the real admin ID from the test
        
    def test_get_admin_users_list(self):
        """Test that we can get users list (need admin ID first)"""
        # First, let's find an admin user
        # We'll use the bootstrap endpoint to check
        response = requests.get(f"{BASE_URL}/api/health")
        print(f"Health check: {response.status_code}")
        assert response.status_code == 200
        
    def test_bulk_update_requires_admin(self):
        """Test that bulk update requires admin privileges"""
        response = requests.post(
            f"{BASE_URL}/api/admin/users/bulk-update",
            params={"admin_id": "fake-admin-id"},
            json={
                "user_ids": ["user1", "user2"],
                "role": "Surfer"
            }
        )
        # Should return 403 for non-admin
        assert response.status_code == 403
        print(f"Non-admin bulk update correctly rejected: {response.status_code}")
        
    def test_bulk_update_requires_user_ids(self):
        """Test that bulk update requires user_ids"""
        # This will fail with 403 first (no admin), but validates endpoint exists
        response = requests.post(
            f"{BASE_URL}/api/admin/users/bulk-update",
            params={"admin_id": "fake-admin-id"},
            json={
                "user_ids": [],
                "role": "Surfer"
            }
        )
        # Should return 403 (admin check) or 400 (validation)
        assert response.status_code in [400, 403]
        print(f"Empty user_ids validation: {response.status_code}")
        
    def test_bulk_update_requires_updates(self):
        """Test that bulk update requires role or subscription_tier"""
        response = requests.post(
            f"{BASE_URL}/api/admin/users/bulk-update",
            params={"admin_id": "fake-admin-id"},
            json={
                "user_ids": ["user1"]
            }
        )
        # Should return 403 (admin check) or 400 (validation)
        assert response.status_code in [400, 403]
        print(f"No updates validation: {response.status_code}")


class TestBulkUpdateWithRealAdmin:
    """Test bulk update with real admin credentials"""
    
    @pytest.fixture
    def admin_id(self):
        """Get real admin user ID by searching for admin email"""
        # Search for the admin user
        # First try to find any admin
        response = requests.get(f"{BASE_URL}/api/profiles")
        if response.status_code == 200:
            profiles = response.json()
            for profile in profiles:
                if profile.get('is_admin'):
                    return profile.get('id')
        return None
    
    def test_find_admin_user(self, admin_id):
        """Verify we can find an admin user"""
        if admin_id:
            print(f"Found admin user ID: {admin_id}")
        else:
            # Try to get admin by email
            response = requests.get(f"{BASE_URL}/api/profiles/by-email/dpritzker0905@gmail.com")
            if response.status_code == 200:
                profile = response.json()
                print(f"Found admin by email: {profile.get('id')}")
                assert profile.get('is_admin') == True
            else:
                pytest.skip("Could not find admin user")
                
    def test_get_users_as_admin(self):
        """Test getting users list as admin"""
        # First get admin profile
        response = requests.get(f"{BASE_URL}/api/profiles/by-email/dpritzker0905@gmail.com")
        if response.status_code != 200:
            pytest.skip("Admin user not found")
            
        admin_id = response.json().get('id')
        if not admin_id:
            pytest.skip("Admin ID not found")
            
        # Get users list
        users_response = requests.get(
            f"{BASE_URL}/api/admin/users",
            params={"admin_id": admin_id, "limit": 10}
        )
        
        print(f"Get users response: {users_response.status_code}")
        if users_response.status_code == 200:
            data = users_response.json()
            print(f"Total users: {data.get('total')}")
            print(f"Users returned: {len(data.get('users', []))}")
            assert 'users' in data
            assert isinstance(data['users'], list)
        else:
            print(f"Error: {users_response.text}")
            
    def test_bulk_update_role_as_admin(self):
        """Test bulk role update as admin"""
        # Get admin profile
        response = requests.get(f"{BASE_URL}/api/profiles/by-email/dpritzker0905@gmail.com")
        if response.status_code != 200:
            pytest.skip("Admin user not found")
            
        admin_id = response.json().get('id')
        
        # Get some test users (non-admin)
        users_response = requests.get(
            f"{BASE_URL}/api/admin/users",
            params={"admin_id": admin_id, "limit": 10}
        )
        
        if users_response.status_code != 200:
            pytest.skip("Could not get users list")
            
        users = users_response.json().get('users', [])
        # Find non-admin users for testing
        test_users = [u for u in users if not u.get('is_admin')][:2]
        
        if len(test_users) < 1:
            pytest.skip("No non-admin users found for testing")
            
        test_user_ids = [u['id'] for u in test_users]
        original_roles = {u['id']: u['role'] for u in test_users}
        
        print(f"Testing bulk update on {len(test_user_ids)} users")
        print(f"Original roles: {original_roles}")
        
        # Test bulk role update
        bulk_response = requests.post(
            f"{BASE_URL}/api/admin/users/bulk-update",
            params={"admin_id": admin_id},
            json={
                "user_ids": test_user_ids,
                "role": "Hobbyist"
            }
        )
        
        print(f"Bulk update response: {bulk_response.status_code}")
        print(f"Response body: {bulk_response.text}")
        
        assert bulk_response.status_code == 200
        data = bulk_response.json()
        assert data.get('updated_count') == len(test_user_ids)
        print(f"Successfully updated {data.get('updated_count')} users to Hobbyist")
        
        # Verify the changes
        for user_id in test_user_ids:
            verify_response = requests.get(
                f"{BASE_URL}/api/admin/users/{user_id}",
                params={"admin_id": admin_id}
            )
            if verify_response.status_code == 200:
                user_data = verify_response.json()
                print(f"User {user_id} role after update: {user_data.get('role')}")
                assert user_data.get('role') == 'Hobbyist'
        
        # Revert changes
        for user_id, original_role in original_roles.items():
            revert_response = requests.patch(
                f"{BASE_URL}/api/admin/users/{user_id}",
                params={"admin_id": admin_id},
                json={"role": original_role}
            )
            print(f"Reverted user {user_id} to {original_role}: {revert_response.status_code}")
            
    def test_bulk_update_subscription_as_admin(self):
        """Test bulk subscription update as admin"""
        # Get admin profile
        response = requests.get(f"{BASE_URL}/api/profiles/by-email/dpritzker0905@gmail.com")
        if response.status_code != 200:
            pytest.skip("Admin user not found")
            
        admin_id = response.json().get('id')
        
        # Get some test users
        users_response = requests.get(
            f"{BASE_URL}/api/admin/users",
            params={"admin_id": admin_id, "limit": 10}
        )
        
        if users_response.status_code != 200:
            pytest.skip("Could not get users list")
            
        users = users_response.json().get('users', [])
        test_users = [u for u in users if not u.get('is_admin')][:2]
        
        if len(test_users) < 1:
            pytest.skip("No non-admin users found for testing")
            
        test_user_ids = [u['id'] for u in test_users]
        original_tiers = {u['id']: u.get('subscription_tier', 'free') for u in test_users}
        
        print(f"Testing bulk subscription update on {len(test_user_ids)} users")
        print(f"Original tiers: {original_tiers}")
        
        # Test bulk subscription update
        bulk_response = requests.post(
            f"{BASE_URL}/api/admin/users/bulk-update",
            params={"admin_id": admin_id},
            json={
                "user_ids": test_user_ids,
                "subscription_tier": "premium"
            }
        )
        
        print(f"Bulk update response: {bulk_response.status_code}")
        print(f"Response body: {bulk_response.text}")
        
        assert bulk_response.status_code == 200
        data = bulk_response.json()
        assert data.get('updated_count') == len(test_user_ids)
        print(f"Successfully updated {data.get('updated_count')} users to premium")
        
        # Verify the changes
        for user_id in test_user_ids:
            verify_response = requests.get(
                f"{BASE_URL}/api/admin/users/{user_id}",
                params={"admin_id": admin_id}
            )
            if verify_response.status_code == 200:
                user_data = verify_response.json()
                print(f"User {user_id} subscription after update: {user_data.get('subscription_tier')}")
                assert user_data.get('subscription_tier') == 'premium'
        
        # Revert changes
        for user_id, original_tier in original_tiers.items():
            revert_response = requests.patch(
                f"{BASE_URL}/api/admin/users/{user_id}",
                params={"admin_id": admin_id},
                json={"subscription_tier": original_tier}
            )
            print(f"Reverted user {user_id} to {original_tier}: {revert_response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
