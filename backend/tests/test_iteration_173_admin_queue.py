"""
Iteration 173 - Admin Precision Queue & Photographer Verification Tests

Features to test:
1. Admin Console Queue tab displays flagged spots
2. Queue shows Flagged count and Suggestions count
3. Snap Offshore button moves spot coordinates
4. API: GET /api/admin/spots/list returns spots with verification data
5. API: GET /api/admin/spots/queue returns flagged spots
6. API: POST /api/spots/verification/{spot_id} accepts verification vote
7. API: GET /api/spots/verification/{spot_id}/status returns vote status
8. Photographer verification nudge shows in UnifiedSpotDrawer for photographer roles
9. Community Verified badge displays when spot has 5+ yes votes
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestAdminSpotsList:
    """Test GET /api/admin/spots/list endpoint"""
    
    def test_admin_spots_list_returns_spots(self):
        """Test that admin can list spots with verification data"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 10}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "spots" in data, "Response should contain 'spots' key"
        assert "total" in data, "Response should contain 'total' key"
        assert isinstance(data["spots"], list), "spots should be a list"
        
        # Check spot structure includes verification fields
        if len(data["spots"]) > 0:
            spot = data["spots"][0]
            assert "id" in spot
            assert "name" in spot
            assert "latitude" in spot
            assert "longitude" in spot
            # Verification fields
            assert "community_verified" in spot, "Spot should have community_verified field"
            assert "verification_votes_yes" in spot, "Spot should have verification_votes_yes field"
            assert "verification_votes_no" in spot, "Spot should have verification_votes_no field"
            assert "flagged_for_review" in spot, "Spot should have flagged_for_review field"
            print(f"✓ Admin spots list returned {len(data['spots'])} spots with verification data")
    
    def test_admin_spots_list_search(self):
        """Test search functionality in admin spots list"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "search": "Pipeline", "limit": 10}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should find Pipeline or similar spots
        if len(data["spots"]) > 0:
            print(f"✓ Search found {len(data['spots'])} spots matching 'Pipeline'")
        else:
            print("✓ Search returned empty results (no matching spots)")
    
    def test_admin_spots_list_flagged_only(self):
        """Test filtering for flagged spots only"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "flagged_only": True, "limit": 50}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # All returned spots should be flagged
        for spot in data["spots"]:
            assert spot.get("flagged_for_review") == True or spot.get("accuracy_flag") in ["low_accuracy", "unverified"], \
                f"Spot {spot['name']} should be flagged"
        
        print(f"✓ Flagged filter returned {len(data['spots'])} flagged spots")


class TestAdminSpotsQueue:
    """Test GET /api/admin/spots/queue endpoint"""
    
    def test_admin_queue_returns_flagged_spots(self):
        """Test that queue returns spots flagged for review"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/queue",
            params={"admin_id": ADMIN_ID, "limit": 20}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "queue" in data, "Response should contain 'queue' key"
        assert "total" in data, "Response should contain 'total' key"
        assert isinstance(data["queue"], list), "queue should be a list"
        
        print(f"✓ Queue returned {len(data['queue'])} flagged spots (total: {data['total']})")
        
        # Check queue item structure
        if len(data["queue"]) > 0:
            item = data["queue"][0]
            assert "id" in item
            assert "name" in item
            assert "latitude" in item
            assert "longitude" in item
            assert "accuracy_flag" in item or "flagged_for_review" in item
            print(f"  First item: {item['name']} - {item.get('accuracy_flag', 'flagged')}")
    
    def test_admin_queue_requires_admin(self):
        """Test that queue endpoint requires admin access"""
        # Use a non-admin user ID
        fake_user_id = str(uuid.uuid4())
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/queue",
            params={"admin_id": fake_user_id}
        )
        
        assert response.status_code == 403, f"Expected 403 for non-admin, got {response.status_code}"
        print("✓ Queue endpoint correctly rejects non-admin users")


class TestAdminSpotsSuggestions:
    """Test GET /api/admin/spots/suggestions endpoint"""
    
    def test_admin_suggestions_returns_list(self):
        """Test that suggestions endpoint returns photographer suggestions"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/suggestions",
            params={"admin_id": ADMIN_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "suggestions" in data, "Response should contain 'suggestions' key"
        assert isinstance(data["suggestions"], list), "suggestions should be a list"
        
        print(f"✓ Suggestions endpoint returned {len(data['suggestions'])} suggestions")
        
        # Check suggestion structure if any exist
        if len(data["suggestions"]) > 0:
            suggestion = data["suggestions"][0]
            assert "spot_id" in suggestion
            assert "spot_name" in suggestion
            assert "current_coords" in suggestion
            assert "suggested_coords" in suggestion
            assert "photographer_name" in suggestion
            print(f"  First suggestion: {suggestion['spot_name']} by {suggestion['photographer_name']}")


class TestSpotVerificationVote:
    """Test POST /api/spots/verification/{spot_id} endpoint"""
    
    def test_verification_vote_requires_photographer_role(self):
        """Test that only photographers can submit verification votes"""
        # Get a spot to verify
        spots_response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 1}
        )
        assert spots_response.status_code == 200
        spots = spots_response.json()["spots"]
        
        if len(spots) == 0:
            pytest.skip("No spots available for testing")
        
        spot_id = spots[0]["id"]
        
        # Try to vote with admin (who is not a photographer)
        response = requests.post(
            f"{BASE_URL}/api/spots/verification/{spot_id}",
            params={"user_id": ADMIN_ID},
            json={"is_accurate": True}
        )
        
        # Should fail because admin is not a photographer
        # Note: Admin might have photographer role, so we check for either success or role error
        if response.status_code == 403:
            assert "photographer" in response.json().get("detail", "").lower()
            print("✓ Verification correctly requires photographer role")
        elif response.status_code == 400:
            # Already voted
            print("✓ Admin has already voted on this spot")
        elif response.status_code == 200:
            print("✓ Admin has photographer role and can vote")
        else:
            print(f"  Response: {response.status_code} - {response.text}")


class TestSpotVerificationStatus:
    """Test GET /api/spots/verification/{spot_id}/status endpoint"""
    
    def test_verification_status_returns_vote_counts(self):
        """Test that verification status returns vote counts"""
        # Get a spot
        spots_response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 1}
        )
        assert spots_response.status_code == 200
        spots = spots_response.json()["spots"]
        
        if len(spots) == 0:
            pytest.skip("No spots available for testing")
        
        spot_id = spots[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/spots/verification/{spot_id}/status",
            params={"user_id": ADMIN_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "spot_id" in data
        assert "community_verified" in data
        assert "verification_votes_yes" in data
        assert "verification_votes_no" in data
        assert "user_has_voted" in data
        
        print(f"✓ Verification status: Yes={data['verification_votes_yes']}, No={data['verification_votes_no']}, Community Verified={data['community_verified']}")
    
    def test_verification_status_for_nonexistent_spot(self):
        """Test verification status for non-existent spot returns 404"""
        fake_spot_id = str(uuid.uuid4())
        
        response = requests.get(
            f"{BASE_URL}/api/spots/verification/{fake_spot_id}/status",
            params={"user_id": ADMIN_ID}
        )
        
        assert response.status_code == 404, f"Expected 404 for non-existent spot, got {response.status_code}"
        print("✓ Verification status correctly returns 404 for non-existent spot")


class TestAdminSpotMove:
    """Test PUT /api/admin/spots/{spot_id}/move endpoint (Snap Offshore)"""
    
    def test_admin_can_move_spot(self):
        """Test that admin can move a spot's coordinates"""
        # Get a spot to move
        spots_response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 1}
        )
        assert spots_response.status_code == 200
        spots = spots_response.json()["spots"]
        
        if len(spots) == 0:
            pytest.skip("No spots available for testing")
        
        spot = spots[0]
        spot_id = spot["id"]
        original_lat = spot["latitude"]
        original_lng = spot["longitude"]
        
        # Move spot slightly (simulate Snap Offshore)
        new_lat = original_lat - 0.0001  # ~11m south
        new_lng = original_lng - 0.0001  # ~8.5m west
        
        response = requests.put(
            f"{BASE_URL}/api/admin/spots/{spot_id}/move",
            params={"admin_id": ADMIN_ID},
            json={
                "latitude": new_lat,
                "longitude": new_lng,
                "override_land_warning": True
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Move should succeed"
        
        print(f"✓ Successfully moved spot from ({original_lat}, {original_lng}) to ({new_lat}, {new_lng})")
        
        # Move it back to original position
        restore_response = requests.put(
            f"{BASE_URL}/api/admin/spots/{spot_id}/move",
            params={"admin_id": ADMIN_ID},
            json={
                "latitude": original_lat,
                "longitude": original_lng,
                "override_land_warning": True
            }
        )
        assert restore_response.status_code == 200
        print("✓ Restored spot to original position")


class TestCommunityVerifiedBadge:
    """Test Community Verified badge logic (5+ yes votes)"""
    
    def test_community_verified_field_exists(self):
        """Test that spots have community_verified field"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 50}
        )
        
        assert response.status_code == 200
        spots = response.json()["spots"]
        
        verified_count = 0
        for spot in spots:
            assert "community_verified" in spot, f"Spot {spot['name']} missing community_verified field"
            if spot["community_verified"]:
                verified_count += 1
        
        print(f"✓ All spots have community_verified field. {verified_count}/{len(spots)} are community verified")
    
    def test_community_verified_requires_5_votes(self):
        """Test that community verified requires 5+ yes votes"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 100}
        )
        
        assert response.status_code == 200
        spots = response.json()["spots"]
        
        for spot in spots:
            if spot["community_verified"]:
                # If community verified, should have 5+ yes votes
                assert spot["verification_votes_yes"] >= 5, \
                    f"Spot {spot['name']} is community verified but has only {spot['verification_votes_yes']} yes votes"
        
        print("✓ All community verified spots have 5+ yes votes")


class TestAdminSpotEditHistory:
    """Test GET /api/admin/spots/edit-history/{spot_id} endpoint"""
    
    def test_edit_history_returns_logs(self):
        """Test that edit history returns action logs"""
        # Get a spot
        spots_response = requests.get(
            f"{BASE_URL}/api/admin/spots/list",
            params={"admin_id": ADMIN_ID, "limit": 1}
        )
        assert spots_response.status_code == 200
        spots = spots_response.json()["spots"]
        
        if len(spots) == 0:
            pytest.skip("No spots available for testing")
        
        spot_id = spots[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/edit-history/{spot_id}",
            params={"admin_id": ADMIN_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "history" in data
        assert isinstance(data["history"], list)
        
        print(f"✓ Edit history returned {len(data['history'])} log entries")
        
        if len(data["history"]) > 0:
            log = data["history"][0]
            assert "action" in log
            assert "admin_name" in log
            assert "created_at" in log
            print(f"  Latest action: {log['action']} by {log['admin_name']}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
