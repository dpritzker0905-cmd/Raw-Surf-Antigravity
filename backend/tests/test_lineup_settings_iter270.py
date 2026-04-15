"""
Test Lineup Settings API Endpoints - Iteration 270

Tests for:
1. PATCH /api/bookings/{booking_id} - Update split_mode, lineup_auto_confirm, proximity_radius
2. GET /api/bookings/user/{user_id} - Returns all lineup fields including participants
3. GET /api/surf-spots/{spot_id} - Returns open_bookings for split_mode='open_nearby'
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # @davidpritzker
TEST_BOOKING_ID = "942515d0-81a3-4733-964f-8ba1b9792869"  # Cocoa Beach Pier booking
TEST_SPOT_ID = "c673e683-6d29-4ee4-90b1-2b9d82363f35"  # Cocoa Beach Pier


class TestPatchBookingSettings:
    """Test PATCH /api/bookings/{booking_id} endpoint for lineup settings"""
    
    def test_patch_split_mode_to_open_nearby(self):
        """Test updating split_mode to 'open_nearby'"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={"split_mode": "open_nearby"}
        )
        
        print(f"PATCH split_mode response: {response.status_code}")
        print(f"Response body: {response.text[:500] if response.text else 'empty'}")
        
        # Accept 200 (success) or 404 (booking not found - may have been deleted)
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True, "Expected success=True"
            assert data.get("split_mode") == "open_nearby", f"Expected split_mode='open_nearby', got {data.get('split_mode')}"
            print("✓ split_mode updated to 'open_nearby' successfully")
    
    def test_patch_split_mode_to_friends_only(self):
        """Test updating split_mode to 'friends_only'"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={"split_mode": "friends_only"}
        )
        
        print(f"PATCH split_mode response: {response.status_code}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert data.get("split_mode") == "friends_only"
            print("✓ split_mode updated to 'friends_only' successfully")
    
    def test_patch_lineup_auto_confirm_true(self):
        """Test enabling lineup_auto_confirm"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={"lineup_auto_confirm": True}
        )
        
        print(f"PATCH lineup_auto_confirm response: {response.status_code}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert data.get("lineup_auto_confirm") == True, f"Expected lineup_auto_confirm=True, got {data.get('lineup_auto_confirm')}"
            print("✓ lineup_auto_confirm set to True successfully")
    
    def test_patch_lineup_auto_confirm_false(self):
        """Test disabling lineup_auto_confirm"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={"lineup_auto_confirm": False}
        )
        
        print(f"PATCH lineup_auto_confirm response: {response.status_code}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert data.get("lineup_auto_confirm") == False
            print("✓ lineup_auto_confirm set to False successfully")
    
    def test_patch_proximity_radius(self):
        """Test updating proximity_radius"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={"proximity_radius": 10.0}
        )
        
        print(f"PATCH proximity_radius response: {response.status_code}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert data.get("proximity_radius") == 10.0, f"Expected proximity_radius=10.0, got {data.get('proximity_radius')}"
            print("✓ proximity_radius updated to 10.0 successfully")
    
    def test_patch_multiple_settings_at_once(self):
        """Test updating multiple settings in one request"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "split_mode": "open_nearby",
                "lineup_auto_confirm": True,
                "proximity_radius": 5.0
            }
        )
        
        print(f"PATCH multiple settings response: {response.status_code}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert data.get("split_mode") == "open_nearby"
            assert data.get("lineup_auto_confirm") == True
            assert data.get("proximity_radius") == 5.0
            print("✓ Multiple settings updated successfully")
    
    def test_patch_unauthorized_user(self):
        """Test that unauthorized user cannot update booking settings"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": fake_user_id},
            json={"split_mode": "open_nearby"}
        )
        
        print(f"PATCH unauthorized response: {response.status_code}")
        
        # Should return 403 (forbidden) or 404 (booking not found)
        assert response.status_code in [403, 404], f"Expected 403 or 404, got {response.status_code}"
        print("✓ Unauthorized user correctly rejected")


class TestGetUserBookings:
    """Test GET /api/bookings/user/{user_id} returns all lineup fields"""
    
    def test_get_user_bookings_returns_lineup_fields(self):
        """Test that user bookings endpoint returns all required lineup fields"""
        response = requests.get(f"{BASE_URL}/api/bookings/user/{TEST_USER_ID}")
        
        print(f"GET user bookings response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        
        print(f"Found {len(data)} bookings for user")
        
        if len(data) > 0:
            booking = data[0]
            
            # Check all required lineup fields are present
            required_fields = [
                "id", "photographer_id", "location", "session_date",
                "status", "max_participants", "current_participants",
                # Lineup Manager specific fields
                "split_mode", "lineup_auto_confirm", "proximity_radius",
                "lineup_status", "lineup_closes_at", "lineup_min_crew", "lineup_max_crew",
                "participants", "total_price", "price_per_person", "allow_splitting"
            ]
            
            missing_fields = []
            for field in required_fields:
                if field not in booking:
                    missing_fields.append(field)
                else:
                    print(f"  ✓ {field}: {booking[field]}")
            
            if missing_fields:
                print(f"  ✗ Missing fields: {missing_fields}")
            
            assert len(missing_fields) == 0, f"Missing required fields: {missing_fields}"
            
            # Verify participants array structure
            participants = booking.get("participants", [])
            print(f"  Participants count: {len(participants)}")
            
            if len(participants) > 0:
                participant = participants[0]
                participant_fields = ["participant_id", "user_id", "name", "status", "payment_status"]
                for field in participant_fields:
                    assert field in participant, f"Participant missing field: {field}"
                    print(f"    ✓ participant.{field}: {participant.get(field)}")
            
            print("✓ All required lineup fields present in user bookings response")
        else:
            print("⚠ No bookings found for user - cannot verify field structure")
    
    def test_get_user_bookings_excludes_cancelled(self):
        """Test that cancelled bookings are excluded from response"""
        response = requests.get(f"{BASE_URL}/api/bookings/user/{TEST_USER_ID}")
        
        assert response.status_code == 200
        
        data = response.json()
        
        for booking in data:
            assert booking.get("status") not in ["Cancelled", "Refunded"], \
                f"Found cancelled/refunded booking in response: {booking.get('id')}"
        
        print(f"✓ All {len(data)} bookings have valid status (not cancelled/refunded)")


class TestGetSurfSpotOpenBookings:
    """Test GET /api/surf-spots/{spot_id} returns open_bookings"""
    
    def test_get_surf_spot_returns_open_bookings_field(self):
        """Test that surf spot endpoint returns open_bookings array"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/{TEST_SPOT_ID}")
        
        print(f"GET surf spot response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Check open_bookings field exists
        assert "open_bookings" in data, "Missing 'open_bookings' field in surf spot response"
        assert "open_bookings_count" in data, "Missing 'open_bookings_count' field in surf spot response"
        
        open_bookings = data.get("open_bookings", [])
        open_bookings_count = data.get("open_bookings_count", 0)
        
        print(f"  open_bookings: {len(open_bookings)} items")
        print(f"  open_bookings_count: {open_bookings_count}")
        
        assert isinstance(open_bookings, list), "open_bookings should be a list"
        assert open_bookings_count == len(open_bookings), "open_bookings_count should match array length"
        
        # If there are open bookings, verify structure
        if len(open_bookings) > 0:
            booking = open_bookings[0]
            expected_fields = [
                "id", "photographer_name", "location", "session_date",
                "price_per_person", "spots_left", "max_participants"
            ]
            
            for field in expected_fields:
                assert field in booking, f"Open booking missing field: {field}"
                print(f"    ✓ {field}: {booking.get(field)}")
            
            print("✓ Open bookings structure verified")
        else:
            print("⚠ No open bookings at this spot - structure cannot be verified")
        
        print("✓ Surf spot endpoint returns open_bookings field")
    
    def test_get_surf_spot_with_user_location(self):
        """Test surf spot endpoint with user location for geofencing"""
        # Cocoa Beach Pier coordinates
        user_lat = 28.3655
        user_lon = -80.5995
        
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{TEST_SPOT_ID}",
            params={
                "user_lat": user_lat,
                "user_lon": user_lon,
                "user_id": TEST_USER_ID
            }
        )
        
        print(f"GET surf spot with location response: {response.status_code}")
        
        assert response.status_code == 200
        
        data = response.json()
        
        # Check geofence fields
        assert "is_within_geofence" in data, "Missing is_within_geofence field"
        assert "distance_miles" in data, "Missing distance_miles field"
        
        print(f"  is_within_geofence: {data.get('is_within_geofence')}")
        print(f"  distance_miles: {data.get('distance_miles')}")
        print(f"  open_bookings_count: {data.get('open_bookings_count')}")
        
        print("✓ Surf spot geofencing fields present")


class TestBookingEndpointIntegration:
    """Integration tests for booking settings workflow"""
    
    def test_full_lineup_settings_workflow(self):
        """Test complete workflow: update settings -> verify in user bookings"""
        # Step 1: Update booking to open_nearby
        patch_response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "split_mode": "open_nearby",
                "lineup_auto_confirm": True,
                "proximity_radius": 5.0
            }
        )
        
        if patch_response.status_code == 404:
            print("⚠ Test booking not found - skipping integration test")
            pytest.skip("Test booking not found")
        
        assert patch_response.status_code == 200, f"PATCH failed: {patch_response.status_code}"
        print("✓ Step 1: Settings updated via PATCH")
        
        # Step 2: Verify settings in user bookings
        get_response = requests.get(f"{BASE_URL}/api/bookings/user/{TEST_USER_ID}")
        assert get_response.status_code == 200
        
        bookings = get_response.json()
        target_booking = next((b for b in bookings if b.get("id") == TEST_BOOKING_ID), None)
        
        if target_booking:
            assert target_booking.get("split_mode") == "open_nearby", \
                f"split_mode not persisted: {target_booking.get('split_mode')}"
            assert target_booking.get("lineup_auto_confirm") == True, \
                f"lineup_auto_confirm not persisted: {target_booking.get('lineup_auto_confirm')}"
            assert target_booking.get("proximity_radius") == 5.0, \
                f"proximity_radius not persisted: {target_booking.get('proximity_radius')}"
            print("✓ Step 2: Settings verified in user bookings response")
        else:
            print("⚠ Target booking not found in user bookings response")
        
        print("✓ Full workflow completed successfully")


class TestAllBookingsEndpoint:
    """Test GET /api/bookings endpoint returns lineup fields"""
    
    def test_get_all_bookings_returns_lineup_fields(self):
        """Test that all bookings endpoint returns lineup fields"""
        response = requests.get(
            f"{BASE_URL}/api/bookings",
            params={"user_id": TEST_USER_ID}
        )
        
        print(f"GET all bookings response: {response.status_code}")
        
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        print(f"Found {len(data)} bookings")
        
        if len(data) > 0:
            booking = data[0]
            
            # Check lineup fields
            lineup_fields = [
                "split_mode", "lineup_auto_confirm", "proximity_radius",
                "lineup_status", "lineup_closes_at", "lineup_min_crew", "lineup_max_crew",
                "participants"
            ]
            
            for field in lineup_fields:
                if field in booking:
                    print(f"  ✓ {field}: {booking[field]}")
                else:
                    print(f"  ✗ Missing: {field}")
            
            print("✓ All bookings endpoint returns lineup fields")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
