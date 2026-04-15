"""
Test Grom HQ Activity Monitoring & Spending Controls - Iteration 107
Tests for parent dashboard, activity monitoring, spending controls, and parental controls
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
GROM_PARENT_EMAIL = "testgromparent@gmail.com"
GROM_PARENT_PASSWORD = "Test123!"
LINKED_GROM_ID = "8bde602b-4d89-4142-a078-d2a048dd4c65"


class TestGromHQAuthentication:
    """Test Grom Parent login and authentication"""
    
    def test_grom_parent_login(self):
        """Test Grom Parent can login successfully"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == GROM_PARENT_EMAIL
        assert data["role"] == "Grom Parent"
        assert "id" in data
        # Store parent_id for other tests
        TestGromHQAuthentication.parent_id = data["id"]
        print(f"Grom Parent login successful: {data['full_name']} (ID: {data['id']})")


class TestLinkedGroms:
    """Test linked Groms endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_get_linked_groms(self):
        """Test fetching linked Groms for parent"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/linked-groms/{self.parent_id}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "linked_groms" in data
        assert "pending_requests" in data
        assert "stats" in data
        
        # Verify linked grom exists
        assert len(data["linked_groms"]) >= 1
        grom = data["linked_groms"][0]
        assert grom["id"] == LINKED_GROM_ID
        assert grom["full_name"] == "Little Wave Rider"
        assert "credits_balance" in grom
        assert "achievements_count" in grom
        print(f"Found {len(data['linked_groms'])} linked Grom(s)")
    
    def test_linked_groms_stats(self):
        """Test aggregate stats for linked Groms"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/linked-groms/{self.parent_id}")
        assert response.status_code == 200
        data = response.json()
        
        stats = data["stats"]
        assert "totalEarnings" in stats
        assert "totalSessions" in stats
        assert "totalScreenTime" in stats
        assert "achievementsUnlocked" in stats
        print(f"Stats: Earnings=${stats['totalEarnings']}, Sessions={stats['totalSessions']}")


class TestGromActivity:
    """Test Grom activity monitoring endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_get_grom_activity(self):
        """Test fetching activity data for a linked Grom"""
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/activity/{LINKED_GROM_ID}?parent_id={self.parent_id}"
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert data["grom_id"] == LINKED_GROM_ID
        assert data["grom_name"] == "Little Wave Rider"
        assert "activity" in data
        assert "recent_transactions" in data
        assert "parental_controls" in data
        
        # Verify activity fields
        activity = data["activity"]
        assert "total_posts" in activity
        assert "posts_this_week" in activity
        assert "sessions_joined" in activity
        assert "credits_balance" in activity
        print(f"Activity: Posts={activity['total_posts']}, Sessions={activity['sessions_joined']}")
    
    def test_activity_unauthorized_parent(self):
        """Test that unauthorized parent cannot view Grom activity"""
        fake_parent_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/activity/{LINKED_GROM_ID}?parent_id={fake_parent_id}"
        )
        assert response.status_code == 403
        print("Unauthorized parent correctly blocked from viewing activity")


class TestSpendingSummary:
    """Test Grom spending summary endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_get_spending_summary(self):
        """Test fetching spending summary for a linked Grom"""
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/spending-summary/{LINKED_GROM_ID}?parent_id={self.parent_id}"
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert data["grom_id"] == LINKED_GROM_ID
        assert data["grom_name"] == "Little Wave Rider"
        assert "credits_balance" in data
        assert "spending_by_category" in data
        assert "monthly_spending" in data
        assert "recent_gear_purchases" in data
        print(f"Spending: Monthly=${data['monthly_spending']}, Balance=${data['credits_balance']}")
    
    def test_spending_unauthorized_parent(self):
        """Test that unauthorized parent cannot view spending"""
        fake_parent_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/spending-summary/{LINKED_GROM_ID}?parent_id={fake_parent_id}"
        )
        assert response.status_code == 403
        print("Unauthorized parent correctly blocked from viewing spending")


class TestSpendingControls:
    """Test spending controls update endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_update_spending_controls(self):
        """Test updating spending limits for a Grom"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/spending-controls/{LINKED_GROM_ID}?parent_id={self.parent_id}",
            json={
                "monthly_limit": 75.0,
                "require_approval_above": 15.0
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] == True
        assert "parental_controls" in data
        assert data["parental_controls"]["spending_limit"] == 75.0
        assert data["parental_controls"]["require_approval_above"] == 15.0
        print(f"Spending controls updated: Limit=${data['parental_controls']['spending_limit']}")
    
    def test_spending_controls_persist(self):
        """Test that spending controls persist after update"""
        # First update
        requests.post(
            f"{BASE_URL}/api/grom-hq/spending-controls/{LINKED_GROM_ID}?parent_id={self.parent_id}",
            json={"monthly_limit": 100.0, "require_approval_above": 25.0}
        )
        
        # Verify via spending-summary
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/spending-summary/{LINKED_GROM_ID}?parent_id={self.parent_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["spending_limit"] == 100.0
        print("Spending controls persisted correctly")


class TestParentalControls:
    """Test parental controls (feature permissions) endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_update_parental_controls(self):
        """Test updating feature permissions for a Grom"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/update-parental-controls/{LINKED_GROM_ID}?parent_id={self.parent_id}",
            json={
                "can_post": True,
                "can_stream": False,
                "can_message": True,
                "can_comment": True,
                "view_only": False
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] == True
        assert "parental_controls" in data
        controls = data["parental_controls"]
        assert controls["can_post"] == True
        assert controls["can_stream"] == False
        assert controls["can_message"] == True
        assert controls["can_comment"] == True
        assert controls["view_only"] == False
        print(f"Parental controls updated: can_post={controls['can_post']}")
    
    def test_parental_controls_persist(self):
        """Test that parental controls persist after update"""
        # Update controls
        requests.post(
            f"{BASE_URL}/api/grom-hq/update-parental-controls/{LINKED_GROM_ID}?parent_id={self.parent_id}",
            json={"can_post": False, "can_stream": True}
        )
        
        # Verify via activity endpoint
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/activity/{LINKED_GROM_ID}?parent_id={self.parent_id}"
        )
        assert response.status_code == 200
        data = response.json()
        controls = data["parental_controls"]
        assert controls["can_post"] == False
        assert controls["can_stream"] == True
        print("Parental controls persisted correctly")
    
    def test_parental_controls_unauthorized(self):
        """Test that unauthorized parent cannot update controls"""
        fake_parent_id = "00000000-0000-0000-0000-000000000000"
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/update-parental-controls/{LINKED_GROM_ID}?parent_id={fake_parent_id}",
            json={"can_post": True}
        )
        assert response.status_code == 403
        print("Unauthorized parent correctly blocked from updating controls")


class TestGromNotFound:
    """Test error handling for non-existent Grom"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get parent ID from login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        self.parent_id = response.json()["id"]
    
    def test_activity_grom_not_found(self):
        """Test 404 for non-existent Grom activity"""
        fake_grom_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/activity/{fake_grom_id}?parent_id={self.parent_id}"
        )
        assert response.status_code == 404
        print("Non-existent Grom correctly returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
