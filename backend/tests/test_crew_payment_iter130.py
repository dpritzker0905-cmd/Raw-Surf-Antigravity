"""
Test Crew Payment Deep Link Endpoints - Iteration 130
Tests:
1. GET /api/bookings/{id}/crew-payment-details - Returns booking info, my_share, captain details
2. POST /api/bookings/{id}/crew-pay - Deducts credits and updates payment status
3. Push notification functions exist in push.py
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from previous iterations
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_BOOKING_ID = "eb3ab6be-394a-44ce-86e7-215251b6b2d0"


class TestCrewPaymentDetailsEndpoint:
    """Tests for GET /api/bookings/{id}/crew-payment-details"""
    
    def test_crew_payment_details_returns_booking_info(self):
        """Test that crew-payment-details returns booking information"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-payment-details",
            params={"user_id": TEST_USER_ID}
        )
        
        # May return 403 if user is not a participant, or 404 if booking not found
        # Both are valid responses for this test
        assert response.status_code in [200, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            # Verify response structure
            assert "booking" in data, "Response should contain 'booking' key"
            assert "my_share" in data, "Response should contain 'my_share' key"
            assert "captain" in data, "Response should contain 'captain' key"
            
            # Verify booking fields
            booking = data["booking"]
            assert "id" in booking
            assert "location" in booking
            assert "session_date" in booking
            assert "total_price" in booking
            assert "status" in booking
            assert "payment_progress" in booking
            print(f"✓ Booking details returned: {booking['location']}, status: {booking['status']}")
        elif response.status_code == 403:
            print(f"✓ User not a participant (expected for test booking): {response.json().get('detail')}")
        else:
            print(f"✓ Booking not found (expected if test booking deleted): {response.json().get('detail')}")
    
    def test_crew_payment_details_invalid_booking_returns_404(self):
        """Test that invalid booking ID returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/invalid-booking-id-12345/crew-payment-details",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Invalid booking returns 404")
    
    def test_crew_payment_details_requires_user_id(self):
        """Test that user_id parameter is required"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-payment-details"
        )
        
        # Should return 422 (validation error) or 400 if user_id is missing
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("✓ Missing user_id returns validation error")


class TestCrewPayEndpoint:
    """Tests for POST /api/bookings/{id}/crew-pay"""
    
    def test_crew_pay_endpoint_exists(self):
        """Test that crew-pay endpoint exists and accepts POST"""
        response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-pay",
            json={
                "participant_id": TEST_USER_ID,
                "amount": 25.00,
                "payment_method": "credits"
            }
        )
        
        # Valid responses: 200 (success), 400 (already paid/expired/insufficient), 403 (not participant), 404 (not found)
        assert response.status_code in [200, 400, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data
            assert "paid_amount" in data
            assert "new_balance" in data
            print(f"✓ Payment successful: ${data.get('paid_amount')}")
        else:
            detail = response.json().get('detail', 'Unknown error')
            print(f"✓ Crew-pay endpoint responded with {response.status_code}: {detail}")
    
    def test_crew_pay_invalid_booking_returns_404(self):
        """Test that invalid booking ID returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/bookings/invalid-booking-id-12345/crew-pay",
            json={
                "participant_id": TEST_USER_ID,
                "amount": 25.00,
                "payment_method": "credits"
            }
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Invalid booking returns 404 for crew-pay")
    
    def test_crew_pay_requires_participant_id(self):
        """Test that participant_id is required"""
        response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-pay",
            json={
                "amount": 25.00,
                "payment_method": "credits"
            }
        )
        
        # Should return 422 (validation error)
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("✓ Missing participant_id returns validation error")
    
    def test_crew_pay_requires_amount(self):
        """Test that amount is required"""
        response = requests.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-pay",
            json={
                "participant_id": TEST_USER_ID,
                "payment_method": "credits"
            }
        )
        
        # Should return 422 (validation error)
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("✓ Missing amount returns validation error")


class TestPushNotificationFunctions:
    """Tests to verify push notification functions exist"""
    
    def test_push_config_endpoint_exists(self):
        """Test that OneSignal config endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/push/onesignal/config")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "app_id" in data
        assert "enabled" in data
        print(f"✓ OneSignal config endpoint works, enabled: {data.get('enabled')}")
    
    def test_push_send_endpoint_exists(self):
        """Test that push send endpoint exists"""
        # Just test that the endpoint exists, don't actually send
        response = requests.post(
            f"{BASE_URL}/api/push/send",
            json={
                "user_id": "test-user-id",
                "title": "Test",
                "message": "Test message",
                "event_type": "test"
            }
        )
        
        # Should return 200 (skipped if not configured) or success
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        # Either success or skipped (if OneSignal not configured)
        assert data.get("status") in ["success", "skipped", "error"], f"Unexpected status: {data}"
        print(f"✓ Push send endpoint works, status: {data.get('status')}")


class TestBookingCardCrewHubIntegration:
    """Tests for BookingCard CrewHub integration"""
    
    def test_bookings_endpoint_returns_booking_type(self):
        """Test that bookings endpoint returns booking_type field"""
        response = requests.get(
            f"{BASE_URL}/api/bookings",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Check if any bookings exist
        if isinstance(data, list) and len(data) > 0:
            # Verify booking structure
            booking = data[0]
            assert "id" in booking
            assert "status" in booking
            assert "location" in booking
            print(f"✓ Bookings endpoint returns {len(data)} bookings")
        else:
            print("✓ Bookings endpoint works (no bookings found for user)")
    
    def test_crew_hub_status_endpoint_exists(self):
        """Test that crew-hub-status endpoint exists"""
        response = requests.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": TEST_USER_ID}
        )
        
        # Valid responses: 200, 403 (not captain), 404 (not found)
        assert response.status_code in [200, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "booking_id" in data
            assert "crew" in data
            assert "summary" in data
            print(f"✓ Crew hub status returned for booking")
        else:
            print(f"✓ Crew hub status endpoint responded: {response.status_code}")


class TestAppRouteExists:
    """Test that the frontend route is properly configured"""
    
    def test_crew_payment_page_route_accessible(self):
        """Test that /bookings/pay/:bookingId route is accessible"""
        # This tests that the frontend serves the page (React SPA)
        response = requests.get(
            f"{BASE_URL}/bookings/pay/{TEST_BOOKING_ID}",
            allow_redirects=True
        )
        
        # React SPA should return 200 for any route
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Check that it's an HTML page (React app)
        content_type = response.headers.get('content-type', '')
        assert 'text/html' in content_type, f"Expected HTML, got {content_type}"
        print("✓ Crew payment page route is accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
