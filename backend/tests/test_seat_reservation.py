"""
Test suite for Poker-Style Seat Reservation System
Tests: reservation-settings, waitlist, keep-seat endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
PHOTOGRAPHER_EMAIL = "photographer@surf.com"
PHOTOGRAPHER_PASSWORD = "password123"
PHOTOGRAPHER_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_BOOKING_ID = "0d576dd3-4d94-4401-8cff-ac54e6e8aadf"


class TestReservationSettings:
    """Test GET and PATCH /bookings/{id}/reservation-settings"""
    
    def test_get_reservation_settings_returns_all_6_fields(self):
        """GET /bookings/{id}/reservation-settings returns all 6 settings"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        
        print(f"GET reservation-settings status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify all 6 settings are present
        required_fields = [
            "invite_expiry_hours",
            "waitlist_enabled",
            "waitlist_claim_minutes",
            "allow_keep_seat",
            "keep_seat_extension_hours",
            "max_keep_seat_extensions"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
            print(f"  {field}: {data[field]}")
        
        # Verify default values are reasonable
        assert isinstance(data["invite_expiry_hours"], (int, float))
        assert isinstance(data["waitlist_enabled"], bool)
        assert isinstance(data["waitlist_claim_minutes"], int)
        assert isinstance(data["allow_keep_seat"], bool)
        assert isinstance(data["keep_seat_extension_hours"], (int, float))
        assert isinstance(data["max_keep_seat_extensions"], int)
        
        print("PASS: All 6 reservation settings returned with correct types")
    
    def test_patch_invite_expiry_hours(self):
        """PATCH /bookings/{id}/reservation-settings updates invite_expiry_hours"""
        # Update to 48 hours
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"invite_expiry_hours": 48.0}
        )
        
        print(f"PATCH invite_expiry_hours status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data.get("invite_expiry_hours") == 48.0
        
        # Verify via GET
        get_response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        assert get_response.status_code == 200
        assert get_response.json()["invite_expiry_hours"] == 48.0
        
        print("PASS: invite_expiry_hours updated and persisted")
    
    def test_patch_waitlist_enabled(self):
        """PATCH /bookings/{id}/reservation-settings updates waitlist_enabled"""
        # Disable waitlist
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"waitlist_enabled": False}
        )
        
        print(f"PATCH waitlist_enabled=False status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data.get("waitlist_enabled") == False
        
        # Re-enable waitlist
        response2 = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"waitlist_enabled": True}
        )
        
        assert response2.status_code == 200
        assert response2.json().get("waitlist_enabled") == True
        
        print("PASS: waitlist_enabled toggle works correctly")
    
    def test_patch_allow_keep_seat(self):
        """PATCH /bookings/{id}/reservation-settings updates allow_keep_seat"""
        # Disable keep seat
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"allow_keep_seat": False}
        )
        
        print(f"PATCH allow_keep_seat=False status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data.get("allow_keep_seat") == False
        
        # Re-enable keep seat
        response2 = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"allow_keep_seat": True}
        )
        
        assert response2.status_code == 200
        assert response2.json().get("allow_keep_seat") == True
        
        print("PASS: allow_keep_seat toggle works correctly")
    
    def test_patch_multiple_settings_at_once(self):
        """PATCH can update multiple settings in one request"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={
                "invite_expiry_hours": 24.0,
                "waitlist_claim_minutes": 45,
                "keep_seat_extension_hours": 3.0,
                "max_keep_seat_extensions": 3
            }
        )
        
        print(f"PATCH multiple settings status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data.get("invite_expiry_hours") == 24.0
        assert data.get("waitlist_claim_minutes") == 45
        assert data.get("keep_seat_extension_hours") == 3.0
        assert data.get("max_keep_seat_extensions") == 3
        
        print("PASS: Multiple settings updated in single request")
    
    def test_patch_invalid_invite_expiry_hours(self):
        """PATCH rejects invalid invite_expiry_hours values"""
        # Too low (< 0.5)
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"invite_expiry_hours": 0.1}
        )
        
        print(f"PATCH invalid invite_expiry_hours (0.1) status: {response.status_code}")
        assert response.status_code == 400, f"Expected 400 for invalid value, got {response.status_code}"
        
        # Too high (> 168)
        response2 = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"invite_expiry_hours": 200}
        )
        
        print(f"PATCH invalid invite_expiry_hours (200) status: {response2.status_code}")
        assert response2.status_code == 400, f"Expected 400 for invalid value, got {response2.status_code}"
        
        print("PASS: Invalid invite_expiry_hours values rejected")
    
    def test_get_reservation_settings_nonexistent_booking(self):
        """GET returns 404 for non-existent booking"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/nonexistent-booking-id/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        
        print(f"GET nonexistent booking status: {response.status_code}")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print("PASS: 404 returned for non-existent booking")


class TestWaitlist:
    """Test waitlist endpoints: join, get, leave"""
    
    def test_get_waitlist(self):
        """GET /bookings/{id}/waitlist returns waitlist entries"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/waitlist",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        
        print(f"GET waitlist status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "waitlist" in data
        assert "total_waiting" in data
        assert "user_position" in data
        assert "waitlist_enabled" in data
        assert "claim_window_minutes" in data
        
        assert isinstance(data["waitlist"], list)
        assert isinstance(data["total_waiting"], int)
        
        print(f"  Total waiting: {data['total_waiting']}")
        print(f"  Waitlist enabled: {data['waitlist_enabled']}")
        print(f"  Claim window: {data['claim_window_minutes']} minutes")
        
        print("PASS: GET waitlist returns correct structure")
    
    def test_join_waitlist_when_session_not_full(self):
        """POST /bookings/{id}/waitlist/join returns error when session has open spots"""
        # Use a different user ID to try joining
        test_user_id = "test-user-for-waitlist-join"
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/waitlist/join",
            params={"user_id": test_user_id}
        )
        
        print(f"POST join waitlist status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # If session is not full, should return 400
        # If session is full, should return 200 with position
        if response.status_code == 400:
            data = response.json()
            # Could be "Session has open spots" or "Already on waitlist" or "Already a participant"
            assert "detail" in data
            print(f"  Error: {data['detail']}")
            print("PASS: Waitlist join correctly handles non-full session or existing user")
        elif response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            assert "position" in data
            print(f"  Joined at position: {data['position']}")
            print("PASS: Successfully joined waitlist")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")
    
    def test_leave_waitlist(self):
        """DELETE /bookings/{id}/waitlist/leave removes user from waitlist"""
        test_user_id = "test-user-for-waitlist-leave"
        
        response = requests.delete(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/waitlist/leave",
            params={"user_id": test_user_id}
        )
        
        print(f"DELETE leave waitlist status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # Could be 200 (success) or 404 (not on waitlist)
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            print("PASS: Successfully left waitlist")
        elif response.status_code == 404:
            data = response.json()
            assert "detail" in data
            print(f"  Not on waitlist: {data['detail']}")
            print("PASS: Correctly returns 404 when not on waitlist")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")
    
    def test_waitlist_disabled_error(self):
        """POST join returns error when waitlist is disabled"""
        # First disable waitlist
        disable_response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"waitlist_enabled": False}
        )
        
        assert disable_response.status_code == 200
        
        # Try to join waitlist
        test_user_id = "test-user-waitlist-disabled"
        join_response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/waitlist/join",
            params={"user_id": test_user_id}
        )
        
        print(f"POST join when disabled status: {join_response.status_code}")
        print(f"Response: {join_response.json()}")
        
        assert join_response.status_code == 400, f"Expected 400, got {join_response.status_code}"
        assert "not enabled" in join_response.json().get("detail", "").lower()
        
        # Re-enable waitlist
        requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"waitlist_enabled": True}
        )
        
        print("PASS: Waitlist join correctly blocked when disabled")


class TestKeepSeat:
    """Test keep-seat extension endpoints"""
    
    def test_get_keep_seat_status(self):
        """GET /bookings/{id}/keep-seat-status returns extension status"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/keep-seat-status",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        
        print(f"GET keep-seat-status status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "allow_keep_seat" in data
        assert "extension_hours" in data
        assert "max_extensions" in data
        assert "extensions_used" in data
        assert "extensions_remaining" in data
        
        print(f"  Allow keep seat: {data['allow_keep_seat']}")
        print(f"  Extension hours: {data['extension_hours']}")
        print(f"  Max extensions: {data['max_extensions']}")
        print(f"  Extensions used: {data['extensions_used']}")
        print(f"  Extensions remaining: {data['extensions_remaining']}")
        
        print("PASS: GET keep-seat-status returns correct structure")
    
    def test_keep_seat_extension_disabled(self):
        """POST keep-seat returns error when feature is disabled"""
        # First disable keep seat
        disable_response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"allow_keep_seat": False}
        )
        
        assert disable_response.status_code == 200
        
        # Try to extend seat
        extend_response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/keep-seat",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        
        print(f"POST keep-seat when disabled status: {extend_response.status_code}")
        print(f"Response: {extend_response.json()}")
        
        assert extend_response.status_code == 400, f"Expected 400, got {extend_response.status_code}"
        
        # Re-enable keep seat
        requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID},
            json={"allow_keep_seat": True}
        )
        
        print("PASS: Keep-seat extension correctly blocked when disabled")


class TestEdgeCases:
    """Test edge cases and error handling"""
    
    def test_unauthorized_user_cannot_update_settings(self):
        """PATCH returns 403 for unauthorized user"""
        unauthorized_user_id = "unauthorized-user-id"
        
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/reservation-settings",
            params={"user_id": unauthorized_user_id},
            json={"invite_expiry_hours": 12.0}
        )
        
        print(f"PATCH unauthorized user status: {response.status_code}")
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        
        print("PASS: Unauthorized user correctly rejected")
    
    def test_nonexistent_booking_returns_404(self):
        """All endpoints return 404 for non-existent booking"""
        fake_booking_id = "fake-booking-id-12345"
        
        # GET reservation-settings
        r1 = requests.get(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/reservation-settings",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        assert r1.status_code == 404, f"GET reservation-settings: Expected 404, got {r1.status_code}"
        
        # GET waitlist
        r2 = requests.get(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/waitlist",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        assert r2.status_code == 404, f"GET waitlist: Expected 404, got {r2.status_code}"
        
        # GET keep-seat-status
        r3 = requests.get(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/keep-seat-status",
            params={"user_id": PHOTOGRAPHER_USER_ID}
        )
        assert r3.status_code == 404, f"GET keep-seat-status: Expected 404, got {r3.status_code}"
        
        print("PASS: All endpoints return 404 for non-existent booking")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
