"""
Test Saved Crews API - Iteration 129
Tests for Pro/Comp surfer saved crew presets feature
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user from review request
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
# Test saved crew from agent context
TEST_SAVED_CREW_ID = "5957d07c-d023-43b9-8349-54f17ff549bb"


class TestSavedCrewsAPI:
    """Test Saved Crews CRUD operations"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.created_crew_ids = []
        yield
        # Cleanup: Delete any crews created during tests
        for crew_id in self.created_crew_ids:
            try:
                self.session.delete(f"{BASE_URL}/api/crews/saved/{crew_id}?user_id={TEST_USER_ID}")
            except:
                pass
    
    def test_get_saved_crews_returns_array(self):
        """GET /api/crews/saved returns crews array for user"""
        response = self.session.get(f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "crews" in data, "Response should contain 'crews' key"
        assert "total" in data, "Response should contain 'total' key"
        assert isinstance(data["crews"], list), "crews should be a list"
        print(f"✓ GET /api/crews/saved returned {data['total']} crews")
    
    def test_get_saved_crews_empty_for_new_user(self):
        """GET /api/crews/saved returns empty array for user with no saved crews"""
        # Use a random UUID that likely has no saved crews
        fake_user_id = "00000000-0000-0000-0000-000000000001"
        response = self.session.get(f"{BASE_URL}/api/crews/saved?user_id={fake_user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["crews"] == [], "New user should have empty crews array"
        assert data["total"] == 0, "New user should have total=0"
        print("✓ GET /api/crews/saved returns empty array for new users")
    
    def test_create_saved_crew(self):
        """POST /api/crews/saved creates a new saved crew preset"""
        payload = {
            "name": "TEST_Morning Crew",
            "members": [
                {"name": "Test Surfer 1", "email": "test1@example.com"},
                {"name": "Test Surfer 2", "username": "testsurfer2"}
            ],
            "is_default": False
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Response should indicate success"
        assert "crew" in data, "Response should contain 'crew' key"
        assert data["crew"]["name"] == "TEST_Morning Crew", "Crew name should match"
        assert data["crew"]["member_count"] == 2, "Should have 2 members"
        
        # Track for cleanup
        self.created_crew_ids.append(data["crew"]["id"])
        print(f"✓ POST /api/crews/saved created crew with id: {data['crew']['id']}")
    
    def test_create_saved_crew_as_default(self):
        """POST /api/crews/saved with is_default=True sets crew as default"""
        payload = {
            "name": "TEST_Default Crew",
            "members": [
                {"name": "Default Member", "email": "default@example.com"}
            ],
            "is_default": True
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["crew"]["is_default"] == True, "Crew should be marked as default"
        
        # Track for cleanup
        self.created_crew_ids.append(data["crew"]["id"])
        print(f"✓ POST /api/crews/saved created default crew: {data['crew']['id']}")
    
    def test_get_default_crew(self):
        """GET /api/crews/saved/default returns the default crew"""
        response = self.session.get(f"{BASE_URL}/api/crews/saved/default?user_id={TEST_USER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "default_crew" in data, "Response should contain 'default_crew' key"
        
        if data["default_crew"]:
            assert "id" in data["default_crew"], "Default crew should have id"
            assert "name" in data["default_crew"], "Default crew should have name"
            assert "members" in data["default_crew"], "Default crew should have members"
            print(f"✓ GET /api/crews/saved/default returned: {data['default_crew']['name']}")
        else:
            print("✓ GET /api/crews/saved/default returned null (no default set)")
    
    def test_set_default_crew(self):
        """POST /api/crews/saved/{id}/set-default sets a crew as default"""
        # First create a crew to set as default
        create_payload = {
            "name": "TEST_Set Default Crew",
            "members": [{"name": "Member", "email": "member@example.com"}],
            "is_default": False
        }
        
        create_response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=create_payload
        )
        
        assert create_response.status_code == 200, f"Failed to create crew: {create_response.text}"
        crew_id = create_response.json()["crew"]["id"]
        self.created_crew_ids.append(crew_id)
        
        # Now set it as default
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved/{crew_id}/set-default?user_id={TEST_USER_ID}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Response should indicate success"
        assert data["default_crew_id"] == crew_id, "default_crew_id should match"
        print(f"✓ POST /api/crews/saved/{crew_id}/set-default succeeded")
    
    def test_delete_saved_crew(self):
        """DELETE /api/crews/saved/{id} deletes a saved crew"""
        # First create a crew to delete
        create_payload = {
            "name": "TEST_Delete Me Crew",
            "members": [{"name": "Delete Member", "email": "delete@example.com"}],
            "is_default": False
        }
        
        create_response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=create_payload
        )
        
        assert create_response.status_code == 200, f"Failed to create crew: {create_response.text}"
        crew_id = create_response.json()["crew"]["id"]
        
        # Now delete it
        response = self.session.delete(
            f"{BASE_URL}/api/crews/saved/{crew_id}?user_id={TEST_USER_ID}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Response should indicate success"
        print(f"✓ DELETE /api/crews/saved/{crew_id} succeeded")
        
        # Verify it's actually deleted
        get_response = self.session.get(f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}")
        crews = get_response.json()["crews"]
        crew_ids = [c["id"] for c in crews]
        assert crew_id not in crew_ids, "Deleted crew should not appear in list"
        print("✓ Verified crew is no longer in list after deletion")
    
    def test_delete_nonexistent_crew_returns_404(self):
        """DELETE /api/crews/saved/{id} returns 404 for nonexistent crew"""
        fake_crew_id = "00000000-0000-0000-0000-000000000000"
        
        response = self.session.delete(
            f"{BASE_URL}/api/crews/saved/{fake_crew_id}?user_id={TEST_USER_ID}"
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ DELETE nonexistent crew returns 404")
    
    def test_mark_crew_used(self):
        """POST /api/crews/saved/{id}/use increments usage counter"""
        # First create a crew
        create_payload = {
            "name": "TEST_Usage Tracking Crew",
            "members": [{"name": "Usage Member", "email": "usage@example.com"}],
            "is_default": False
        }
        
        create_response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=create_payload
        )
        
        assert create_response.status_code == 200, f"Failed to create crew: {create_response.text}"
        crew_id = create_response.json()["crew"]["id"]
        self.created_crew_ids.append(crew_id)
        
        # Mark as used
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved/{crew_id}/use?user_id={TEST_USER_ID}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Response should indicate success"
        assert data["times_used"] == 1, "times_used should be 1 after first use"
        print(f"✓ POST /api/crews/saved/{crew_id}/use incremented times_used to 1")
        
        # Mark as used again
        response2 = self.session.post(
            f"{BASE_URL}/api/crews/saved/{crew_id}/use?user_id={TEST_USER_ID}"
        )
        
        assert response2.status_code == 200
        assert response2.json()["times_used"] == 2, "times_used should be 2 after second use"
        print("✓ Second use incremented times_used to 2")
    
    def test_existing_dawn_patrol_crew(self):
        """Verify the existing 'Dawn Patrol Crew' from seed data"""
        response = self.session.get(f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}")
        
        assert response.status_code == 200
        
        data = response.json()
        crews = data["crews"]
        
        # Look for Dawn Patrol Crew
        dawn_patrol = next((c for c in crews if c["name"] == "Dawn Patrol Crew"), None)
        
        if dawn_patrol:
            assert dawn_patrol["id"] == TEST_SAVED_CREW_ID, "Dawn Patrol Crew ID should match"
            print(f"✓ Found existing 'Dawn Patrol Crew' with id: {dawn_patrol['id']}")
        else:
            print("⚠ 'Dawn Patrol Crew' not found - may have been deleted in previous tests")


class TestSavedCrewsValidation:
    """Test validation and error handling for Saved Crews API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_create_crew_requires_name(self):
        """POST /api/crews/saved requires name field"""
        payload = {
            "members": [{"name": "Test", "email": "test@example.com"}],
            "is_default": False
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=payload
        )
        
        # Should fail validation
        assert response.status_code == 422, f"Expected 422 validation error, got {response.status_code}"
        print("✓ Create crew without name returns 422 validation error")
    
    def test_create_crew_requires_members(self):
        """POST /api/crews/saved requires members field"""
        payload = {
            "name": "TEST_No Members Crew",
            "is_default": False
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={TEST_USER_ID}",
            json=payload
        )
        
        # Should fail validation
        assert response.status_code == 422, f"Expected 422 validation error, got {response.status_code}"
        print("✓ Create crew without members returns 422 validation error")
    
    def test_create_crew_invalid_user_returns_404(self):
        """POST /api/crews/saved with invalid user_id returns 404"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        payload = {
            "name": "TEST_Invalid User Crew",
            "members": [{"name": "Test", "email": "test@example.com"}],
            "is_default": False
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/crews/saved?user_id={fake_user_id}",
            json=payload
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Create crew with invalid user returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
