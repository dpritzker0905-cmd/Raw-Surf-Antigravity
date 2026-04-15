"""
Test Grom Safety Gate Logic - Iteration 108
Tests:
1. Unlinked Grom status check
2. Linked and approved Grom status check
3. Pro-Zone check endpoint for Hobbyist/Grom Parent
4. Grom preview feed endpoint
5. Admin bypass verification
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from iteration 107
UNLINKED_GROM = {
    "email": "testgrom3@gmail.com",
    "password": "Test123!",
    "id": "02c7a045-0f74-4636-a200-acad3a175aa5",
    "guardian_code": "P4K7RL"
}

GROM_PARENT = {
    "email": "testgromparent@gmail.com",
    "password": "Test123!",
    "id": "e57e7be6-e217-47f7-9978-b51c469c7bbf"
}

LINKED_GROM = {
    "id": "8bde602b-4d89-4142-a078-d2a048dd4c65",
    "name": "Junior Wave Rider"
}


class TestGromStatusEndpoint:
    """Test /api/grom-hq/grom-status/{grom_id} endpoint"""
    
    def test_unlinked_grom_status(self):
        """Unlinked Grom should have is_linked=false, is_approved=false"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{UNLINKED_GROM['id']}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["is_grom"] == True, "Should be identified as Grom"
        assert data["is_linked"] == False, "Unlinked Grom should have is_linked=false"
        assert data["is_approved"] == False, "Unlinked Grom should have is_approved=false"
        assert data["guardian_code"] == UNLINKED_GROM["guardian_code"], f"Guardian code should be {UNLINKED_GROM['guardian_code']}"
        assert data["parent_info"] is None, "Unlinked Grom should have no parent_info"
        print(f"✓ Unlinked Grom status verified: is_linked={data['is_linked']}, is_approved={data['is_approved']}")
    
    def test_linked_approved_grom_status(self):
        """Linked and approved Grom should have is_linked=true, is_approved=true"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{LINKED_GROM['id']}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["is_grom"] == True, "Should be identified as Grom"
        assert data["is_linked"] == True, "Linked Grom should have is_linked=true"
        assert data["is_approved"] == True, "Approved Grom should have is_approved=true"
        assert data["parent_info"] is not None, "Linked Grom should have parent_info"
        assert data["parent_info"]["id"] == GROM_PARENT["id"], "Parent ID should match"
        print(f"✓ Linked Grom status verified: is_linked={data['is_linked']}, is_approved={data['is_approved']}")
    
    def test_non_grom_user_status(self):
        """Non-Grom user should have is_grom=false"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{GROM_PARENT['id']}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["is_grom"] == False, "Grom Parent should not be identified as Grom"
        assert data["is_approved"] == True, "Non-Grom should have is_approved=true (no restrictions)"
        print(f"✓ Non-Grom user status verified: is_grom={data['is_grom']}")


class TestProZoneCheck:
    """Test /api/social-live/pro-zone-check endpoint"""
    
    def test_pro_zone_check_no_pro_nearby(self):
        """Hobbyist/Grom Parent should be able to go live when no Pro nearby"""
        response = requests.get(
            f"{BASE_URL}/api/social-live/pro-zone-check",
            params={
                "user_id": GROM_PARENT["id"],
                "latitude": 33.8,
                "longitude": -118.4
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["blocked"] == False, "Should not be blocked when no Pro nearby"
        assert data["can_go_live"] == True, "Should be able to go live"
        print(f"✓ Pro-Zone check (no Pro nearby): blocked={data['blocked']}, can_go_live={data['can_go_live']}")
    
    def test_pro_zone_check_non_hobbyist(self):
        """Non-Hobbyist/Grom Parent users should not be blocked"""
        # Using linked Grom (not Hobbyist or Grom Parent)
        response = requests.get(
            f"{BASE_URL}/api/social-live/pro-zone-check",
            params={
                "user_id": LINKED_GROM["id"],
                "latitude": 33.8,
                "longitude": -118.4
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Groms are not in the restricted roles, so they should not be blocked
        assert data["blocked"] == False, "Grom should not be blocked by Pro-Zone"
        print(f"✓ Pro-Zone check (Grom user): blocked={data['blocked']}")


class TestGromPreviewFeed:
    """Test /api/posts/grom-preview endpoint"""
    
    def test_grom_preview_feed_returns_list(self):
        """Grom preview feed should return a list (may be empty)"""
        response = requests.get(
            f"{BASE_URL}/api/posts/grom-preview",
            params={"limit": 3}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) <= 3, "Should return at most 3 posts"
        print(f"✓ Grom preview feed returned {len(data)} posts")
    
    def test_grom_preview_feed_structure(self):
        """Grom preview feed posts should have correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/posts/grom-preview",
            params={"limit": 3}
        )
        assert response.status_code == 200
        
        data = response.json()
        if len(data) > 0:
            post = data[0]
            required_fields = ["id", "author_id", "author_name", "media_url", "likes_count"]
            for field in required_fields:
                assert field in post, f"Post should have {field} field"
            print(f"✓ Grom preview feed post structure verified")
        else:
            print("✓ Grom preview feed is empty (no Grom posts yet)")


class TestAuthLogin:
    """Test login for test accounts"""
    
    def test_unlinked_grom_login(self):
        """Unlinked Grom should be able to login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": UNLINKED_GROM["email"], "password": UNLINKED_GROM["password"]}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == UNLINKED_GROM["id"], "User ID should match"
        assert data["role"] == "Grom", "Role should be Grom"
        print(f"✓ Unlinked Grom login successful: {data['email']}")
    
    def test_grom_parent_login(self):
        """Grom Parent should be able to login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT["email"], "password": GROM_PARENT["password"]}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == GROM_PARENT["id"], "User ID should match"
        assert data["role"] == "Grom Parent", "Role should be Grom Parent"
        print(f"✓ Grom Parent login successful: {data['email']}")


class TestMuxStatus:
    """Test Mux live streaming status"""
    
    def test_mux_status_endpoint(self):
        """Mux status endpoint should return configuration status"""
        response = requests.get(f"{BASE_URL}/api/social-live/mux-status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "configured" in data, "Response should have 'configured' field"
        assert "service_available" in data, "Response should have 'service_available' field"
        print(f"✓ Mux status: configured={data['configured']}, service_available={data['service_available']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
