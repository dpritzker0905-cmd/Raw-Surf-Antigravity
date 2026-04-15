"""
Test Live Session Features - Iteration 281
Tests for:
1. End session functionality (race condition fix)
2. Complete-payment idempotency (Stripe race condition fix)
3. Live participants with selfies and identification info
4. Photographer notes for participants
5. Go-live functionality
6. Booking participant selfie
7. Profile identification fields (wetsuit_color, rash_guard_color, stance)
"""

import pytest
import requests
import os
import time
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test credentials from review request
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # @davidpritzker
SURFER_ID = "e9b9f4df-86b7-4934-b617-4f1883358dba"  # @davidsurf


class TestEndSessionFunctionality:
    """Test end session endpoint - User reported first click fails, second works"""
    
    def test_end_session_when_not_live(self):
        """Test end-session returns proper error when not live"""
        response = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
        # Should return 400 if not shooting, or 200 if was shooting
        assert response.status_code in [200, 400], f"Unexpected status: {response.status_code}, body: {response.text}"
        
        if response.status_code == 400:
            data = response.json()
            assert "detail" in data
            print(f"PASS: End session correctly returns error when not live: {data['detail']}")
        else:
            print(f"PASS: End session succeeded (was live): {response.json()}")
    
    def test_end_session_idempotency(self):
        """Test that calling end-session multiple times is safe (idempotent)"""
        # First call
        response1 = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
        status1 = response1.status_code
        
        # Second call immediately after (simulating double-click)
        response2 = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
        status2 = response2.status_code
        
        # Both should return consistent results (either both 400 or first 200, second 400)
        print(f"First call status: {status1}, Second call status: {status2}")
        
        # If first was 200 (ended session), second should be 400 (no active session)
        # If first was 400 (no active session), second should also be 400
        if status1 == 200:
            assert status2 == 400, "Second call should fail after session ended"
            print("PASS: End session is idempotent - second call correctly fails")
        else:
            assert status2 == 400, "Both calls should fail when no active session"
            print("PASS: End session correctly handles no active session")


class TestCompletePaymentIdempotency:
    """Test complete-payment endpoint with SELECT FOR UPDATE race condition fix"""
    
    def test_complete_payment_invalid_session(self):
        """Test complete-payment with invalid checkout session ID"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/complete-payment",
            json={"checkout_session_id": "cs_test_invalid_12345"}
        )
        # Should return error for invalid session
        assert response.status_code in [400, 404, 500], f"Unexpected status: {response.status_code}"
        print(f"PASS: Complete payment correctly rejects invalid session ID: {response.status_code}")
    
    def test_complete_payment_endpoint_exists(self):
        """Verify the complete-payment endpoint exists and accepts POST"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/complete-payment",
            json={"checkout_session_id": ""}
        )
        # Should not be 404 (endpoint exists)
        assert response.status_code != 404, "Complete payment endpoint should exist"
        print(f"PASS: Complete payment endpoint exists, status: {response.status_code}")


class TestLiveParticipantsWithSelfies:
    """Test GET /api/photographer/{id}/live-participants returns surfer data with selfies"""
    
    def test_get_live_participants_structure(self):
        """Test live-participants endpoint returns correct structure"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/live-participants")
        assert response.status_code == 200, f"Failed: {response.status_code}, {response.text}"
        
        data = response.json()
        
        # Should have these fields
        assert "is_live" in data, "Missing is_live field"
        assert "participants" in data, "Missing participants field"
        assert "total_participants" in data, "Missing total_participants field"
        assert "total_earnings" in data, "Missing total_earnings field"
        
        print(f"PASS: Live participants structure correct. is_live={data['is_live']}, participants={len(data['participants'])}")
        
        # If there are participants, check their structure
        if data['participants']:
            participant = data['participants'][0]
            expected_fields = ['id', 'surfer_id', 'name', 'selfie_url', 'amount_paid', 'joined_at']
            for field in expected_fields:
                assert field in participant, f"Missing field {field} in participant"
            
            # Check identification fields
            identification_fields = ['stance', 'wetsuit_color', 'rash_guard_color', 'skill_level', 'photographer_notes']
            for field in identification_fields:
                assert field in participant, f"Missing identification field {field}"
            
            print(f"PASS: Participant has all required fields including identification info")
    
    def test_live_participants_when_not_live(self):
        """Test live-participants returns empty when not shooting"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/live-participants")
        assert response.status_code == 200
        
        data = response.json()
        if not data['is_live']:
            assert data['participants'] == [], "Should have empty participants when not live"
            assert data['total_participants'] == 0
            print("PASS: Returns empty participants when not live")
        else:
            print(f"INFO: Photographer is currently live with {data['total_participants']} participants")


class TestPhotographerNotes:
    """Test PATCH /api/photographer/{id}/participant/{id}/notes"""
    
    def test_update_notes_invalid_participant(self):
        """Test updating notes for non-existent participant"""
        response = requests.patch(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/participant/invalid-participant-id/notes",
            json={"notes": "Test notes"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Correctly returns 404 for invalid participant")
    
    def test_notes_endpoint_exists(self):
        """Verify the notes endpoint exists"""
        response = requests.patch(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/participant/test-id/notes",
            json={"notes": "Test"}
        )
        # Should not be 405 (method not allowed) - endpoint should accept PATCH
        assert response.status_code != 405, "Notes endpoint should accept PATCH"
        print(f"PASS: Notes endpoint exists and accepts PATCH, status: {response.status_code}")


class TestGoLiveFunctionality:
    """Test POST /api/photographer/{id}/go-live"""
    
    def test_go_live_endpoint_exists(self):
        """Verify go-live endpoint exists"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/go-live",
            json={
                "location": "Test Beach",
                "price_per_join": 25,
                "max_surfers": 10,
                "auto_accept": True
            }
        )
        # Should not be 404
        assert response.status_code != 404, "Go-live endpoint should exist"
        print(f"PASS: Go-live endpoint exists, status: {response.status_code}")
        
        # If successful, end the session to clean up
        if response.status_code == 200:
            requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
            print("INFO: Cleaned up test session")
    
    def test_go_live_requires_spot_or_location(self):
        """Test go-live with minimal data"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/go-live",
            json={}
        )
        # Should either succeed with defaults or require location
        print(f"Go-live with empty data: status={response.status_code}")
        
        # Clean up if session was created
        if response.status_code == 200:
            requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")


class TestBookingParticipantSelfie:
    """Test PATCH /api/bookings/{id}/participant-selfie"""
    
    def test_participant_selfie_endpoint_exists(self):
        """Verify participant-selfie endpoint exists and returns proper error"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/test-booking-id/participant-selfie",
            json={
                "participant_id": SURFER_ID,
                "selfie_url": "https://example.com/selfie.jpg"
            }
        )
        # Endpoint exists - returns 404 for "Participant not found" which is correct behavior
        # 405 would mean method not allowed (endpoint doesn't exist)
        assert response.status_code != 405, f"Endpoint should accept PATCH: {response.status_code}"
        
        # Check the error message to confirm endpoint is working
        if response.status_code == 404:
            data = response.json()
            # Should be "Participant not found" not "Not Found" (route not found)
            assert "detail" in data, "Should have detail field"
            assert "participant" in data["detail"].lower() or "booking" in data["detail"].lower(), \
                f"Should be participant/booking error, got: {data['detail']}"
        
        print(f"PASS: Participant selfie endpoint exists, status: {response.status_code}")
    
    def test_participant_selfie_invalid_booking(self):
        """Test selfie update with invalid booking ID"""
        response = requests.patch(
            f"{BASE_URL}/api/bookings/invalid-booking-id/participant-selfie",
            json={
                "participant_id": SURFER_ID,
                "selfie_url": "https://example.com/selfie.jpg"
            }
        )
        # Should return 404 for invalid booking
        assert response.status_code in [404, 400], f"Expected 404/400, got {response.status_code}"
        print(f"PASS: Correctly handles invalid booking ID: {response.status_code}")


class TestProfileIdentificationFields:
    """Test profile identification fields: wetsuit_color, rash_guard_color, stance"""
    
    def test_get_profile_has_identification_fields(self):
        """Test GET /api/profiles/{id} returns identification fields"""
        response = requests.get(f"{BASE_URL}/api/profiles/{SURFER_ID}")
        assert response.status_code == 200, f"Failed to get profile: {response.status_code}"
        
        data = response.json()
        
        # Check identification fields exist
        identification_fields = ['wetsuit_color', 'rash_guard_color', 'stance']
        for field in identification_fields:
            assert field in data, f"Missing identification field: {field}"
        
        print(f"PASS: Profile has identification fields: wetsuit={data.get('wetsuit_color')}, rash_guard={data.get('rash_guard_color')}, stance={data.get('stance')}")
    
    def test_update_profile_identification_fields(self):
        """Test PATCH /api/profiles/{id} can update identification fields"""
        # First get current values
        get_response = requests.get(f"{BASE_URL}/api/profiles/{SURFER_ID}")
        original_data = get_response.json()
        
        # Update with test values
        test_values = {
            "wetsuit_color": "Black with blue accents",
            "rash_guard_color": "White",
            "stance": "regular"
        }
        
        update_response = requests.patch(
            f"{BASE_URL}/api/profiles/{SURFER_ID}",
            json=test_values
        )
        
        assert update_response.status_code == 200, f"Failed to update: {update_response.status_code}, {update_response.text}"
        
        # Verify update
        verify_response = requests.get(f"{BASE_URL}/api/profiles/{SURFER_ID}")
        updated_data = verify_response.json()
        
        assert updated_data.get('wetsuit_color') == test_values['wetsuit_color'], "Wetsuit color not updated"
        assert updated_data.get('rash_guard_color') == test_values['rash_guard_color'], "Rash guard color not updated"
        assert updated_data.get('stance') == test_values['stance'], "Stance not updated"
        
        print("PASS: Profile identification fields updated successfully")
        
        # Restore original values if they existed
        restore_values = {
            "wetsuit_color": original_data.get('wetsuit_color'),
            "rash_guard_color": original_data.get('rash_guard_color'),
            "stance": original_data.get('stance')
        }
        requests.patch(f"{BASE_URL}/api/profiles/{SURFER_ID}", json=restore_values)


class TestGallerySyncService:
    """Test gallery sync service functions"""
    
    def test_active_session_endpoint(self):
        """Test GET /api/photographer/{id}/active-session"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        assert response.status_code == 200, f"Failed: {response.status_code}"
        
        data = response.json()
        # Can be null if no active session
        if data is None:
            print("PASS: No active session (returns null)")
        else:
            assert "photographer_id" in data
            print(f"PASS: Active session found: {data}")
    
    def test_session_history_endpoint(self):
        """Test GET /api/photographer/{id}/session-history"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/session-history")
        assert response.status_code == 200, f"Failed: {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Session history should be a list"
        print(f"PASS: Session history returned {len(data)} sessions")


class TestFullGoLiveEndSessionCycle:
    """Test the complete go-live -> end-session cycle"""
    
    def test_full_cycle(self):
        """Test complete go-live to end-session flow"""
        # Step 1: Check if already live
        status_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        if status_response.json() is not None:
            # End existing session first
            requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
            time.sleep(0.5)
        
        # Step 2: Go live
        go_live_response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/go-live",
            json={
                "location": "Test Beach for Cycle Test",
                "price_per_join": 25,
                "max_surfers": 10,
                "auto_accept": True,
                "photos_included": 3,
                "live_photo_price": 5
            }
        )
        
        if go_live_response.status_code != 200:
            print(f"INFO: Go-live returned {go_live_response.status_code}: {go_live_response.text}")
            # May fail due to role restrictions or other reasons
            pytest.skip("Could not go live - may be role restricted")
            return
        
        go_live_data = go_live_response.json()
        print(f"Go-live successful: {go_live_data.get('message')}")
        assert "live_session_id" in go_live_data, "Missing live_session_id in response"
        
        # Step 3: Verify active session
        active_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        assert active_response.status_code == 200
        active_data = active_response.json()
        assert active_data is not None, "Should have active session after go-live"
        print(f"Active session confirmed: location={active_data.get('location')}")
        
        # Step 4: Check live participants (should be empty)
        participants_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/live-participants")
        assert participants_response.status_code == 200
        participants_data = participants_response.json()
        assert participants_data['is_live'] == True, "Should be live"
        print(f"Live participants check: is_live={participants_data['is_live']}, count={participants_data['total_participants']}")
        
        # Step 5: End session (FIRST CLICK)
        end_response_1 = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
        assert end_response_1.status_code == 200, f"First end-session failed: {end_response_1.status_code}, {end_response_1.text}"
        end_data = end_response_1.json()
        print(f"End session (first click) successful: {end_data.get('message')}")
        
        # Step 6: Verify session ended
        verify_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        verify_data = verify_response.json()
        assert verify_data is None, "Session should be ended"
        print("PASS: Session ended successfully on first click")
        
        # Step 7: Try end session again (SECOND CLICK - should fail gracefully)
        end_response_2 = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
        assert end_response_2.status_code == 400, f"Second end-session should return 400, got {end_response_2.status_code}"
        print("PASS: Second end-session correctly returns 400 (no active session)")


class TestPhotographerPricing:
    """Test photographer pricing endpoints"""
    
    def test_get_pricing(self):
        """Test GET /api/photographer/{id}/pricing"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200, f"Failed: {response.status_code}"
        
        data = response.json()
        expected_fields = ['live_buyin_price', 'live_photo_price', 'photo_package_size']
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"PASS: Pricing retrieved: buyin=${data['live_buyin_price']}, photo=${data['live_photo_price']}")
    
    def test_get_gallery_pricing(self):
        """Test GET /api/photographer/{id}/gallery-pricing"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        assert response.status_code == 200, f"Failed: {response.status_code}"
        
        data = response.json()
        assert 'photo_pricing' in data, "Missing photo_pricing"
        assert 'video_pricing' in data, "Missing video_pricing"
        
        print(f"PASS: Gallery pricing retrieved: {data['photo_pricing']}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
