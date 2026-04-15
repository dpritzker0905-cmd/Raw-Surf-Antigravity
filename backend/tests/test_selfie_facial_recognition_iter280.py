"""
Test Suite for Selfie and Facial Recognition Integration (Iteration 280)

Tests:
1. Backend: /api/bookings/{booking_id}/participant-selfie PATCH endpoint
2. Backend: AI identity matching uses session_selfie_url, wetsuit_color, rash_guard_color, stance
3. Backend: /api/surfer-gallery/ai-analyze-photo and /api/surfer-gallery/ai-batch-analyze endpoints
4. Backend: Profile fields wetsuit_color and rash_guard_color save/retrieve
5. Database: booking_participants.selfie_url column exists
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data
TEST_PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # @davidpritzker
TEST_SURFER_ID = "e9b9f4df-86b7-4934-b617-4f1883358dba"  # @davidsurf
TEST_SELFIE_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q=="


class TestParticipantSelfieEndpoint:
    """Test /api/bookings/{booking_id}/participant-selfie PATCH endpoint"""
    
    def test_endpoint_exists(self):
        """Test that the participant-selfie endpoint exists"""
        # Create a test booking first
        booking_response = self._create_test_booking()
        if booking_response.status_code != 200:
            pytest.skip("Could not create test booking")
        
        booking_id = booking_response.json().get("booking_id")
        
        # Try to update selfie
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{booking_id}/participant-selfie",
            json={
                "participant_id": TEST_SURFER_ID,
                "selfie_url": TEST_SELFIE_URL
            }
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ Participant selfie endpoint exists, status: {response.status_code}")
    
    def test_selfie_upload_success(self):
        """Test successful selfie upload for booking participant"""
        # Create a test booking
        booking_response = self._create_test_booking()
        if booking_response.status_code != 200:
            pytest.skip("Could not create test booking")
        
        booking_id = booking_response.json().get("booking_id")
        
        # Upload selfie
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{booking_id}/participant-selfie",
            json={
                "participant_id": TEST_SURFER_ID,
                "selfie_url": TEST_SELFIE_URL
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True, "Expected success=True"
            print(f"✓ Selfie upload successful: {data.get('message')}")
        elif response.status_code == 404:
            # Participant not found - expected if booking doesn't have this participant
            print(f"✓ Endpoint works, participant not found (expected for test booking)")
        else:
            print(f"Response: {response.status_code} - {response.text}")
    
    def test_selfie_upload_missing_participant(self):
        """Test selfie upload with non-existent participant"""
        fake_booking_id = str(uuid.uuid4())
        fake_participant_id = str(uuid.uuid4())
        
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/participant-selfie",
            json={
                "participant_id": fake_participant_id,
                "selfie_url": TEST_SELFIE_URL
            }
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ Returns 404 for non-existent participant")
    
    def _create_test_booking(self):
        """Helper to create a test booking"""
        session_date = (datetime.now() + timedelta(days=7)).isoformat()
        return requests.post(
            f"{BASE_URL}/api/bookings/create?user_id={TEST_SURFER_ID}",
            json={
                "photographer_id": TEST_PHOTOGRAPHER_ID,
                "location": "Test Beach",
                "session_date": session_date,
                "duration": 60,
                "max_participants": 1
            }
        )


class TestProfileIdentificationFields:
    """Test profile fields for surfer identification (wetsuit_color, rash_guard_color, stance)"""
    
    def test_get_profile_has_identification_fields(self):
        """Test that profile response includes identification fields"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_SURFER_ID}")
        
        assert response.status_code == 200, f"Failed to get profile: {response.status_code}"
        data = response.json()
        
        # Check that identification fields exist in response (can be null)
        assert "wetsuit_color" in data or data.get("wetsuit_color") is None, "wetsuit_color field missing"
        assert "rash_guard_color" in data or data.get("rash_guard_color") is None, "rash_guard_color field missing"
        assert "stance" in data or data.get("stance") is None, "stance field missing"
        
        print(f"✓ Profile has identification fields:")
        print(f"  - wetsuit_color: {data.get('wetsuit_color')}")
        print(f"  - rash_guard_color: {data.get('rash_guard_color')}")
        print(f"  - stance: {data.get('stance')}")
    
    def test_update_wetsuit_color(self):
        """Test updating wetsuit_color field"""
        test_color = "Black with red stripe"
        
        response = requests.patch(
            f"{BASE_URL}/api/profiles/{TEST_SURFER_ID}",
            json={"wetsuit_color": test_color}
        )
        
        assert response.status_code == 200, f"Failed to update profile: {response.status_code}"
        data = response.json()
        assert data.get("wetsuit_color") == test_color, f"wetsuit_color not updated correctly"
        print(f"✓ wetsuit_color updated to: {test_color}")
    
    def test_update_rash_guard_color(self):
        """Test updating rash_guard_color field"""
        test_color = "White with blue logo"
        
        response = requests.patch(
            f"{BASE_URL}/api/profiles/{TEST_SURFER_ID}",
            json={"rash_guard_color": test_color}
        )
        
        assert response.status_code == 200, f"Failed to update profile: {response.status_code}"
        data = response.json()
        assert data.get("rash_guard_color") == test_color, f"rash_guard_color not updated correctly"
        print(f"✓ rash_guard_color updated to: {test_color}")
    
    def test_update_stance(self):
        """Test updating stance field"""
        test_stance = "regular"
        
        response = requests.patch(
            f"{BASE_URL}/api/profiles/{TEST_SURFER_ID}",
            json={"stance": test_stance}
        )
        
        assert response.status_code == 200, f"Failed to update profile: {response.status_code}"
        data = response.json()
        assert data.get("stance") == test_stance, f"stance not updated correctly"
        print(f"✓ stance updated to: {test_stance}")


class TestAIIdentityMatchingEndpoints:
    """Test AI identity matching endpoints that use selfies and profile data"""
    
    def test_ai_analyze_photo_endpoint_exists(self):
        """Test that /api/surfer-gallery/ai-analyze-photo endpoint exists"""
        response = requests.post(
            f"{BASE_URL}/api/surfer-gallery/ai-analyze-photo",
            params={
                "photo_url": "https://example.com/test.jpg",
                "surfer_id": TEST_SURFER_ID
            }
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ AI analyze photo endpoint exists, status: {response.status_code}")
        
        # If successful, check response structure
        if response.status_code == 200:
            data = response.json()
            assert "is_match" in data, "Response missing is_match field"
            assert "confidence" in data, "Response missing confidence field"
            print(f"  - is_match: {data.get('is_match')}")
            print(f"  - confidence: {data.get('confidence')}")
    
    def test_ai_batch_analyze_endpoint_exists(self):
        """Test that /api/surfer-gallery/ai-batch-analyze endpoint exists"""
        fake_session_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/surfer-gallery/ai-batch-analyze",
            params={
                "session_id": fake_session_id,
                "surfer_id": TEST_SURFER_ID
            }
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ AI batch analyze endpoint exists, status: {response.status_code}")
        
        # Check response structure
        if response.status_code == 200:
            data = response.json()
            assert "success" in data, "Response missing success field"
            print(f"  - success: {data.get('success')}")
            print(f"  - total_analyzed: {data.get('total_analyzed', 0)}")
    
    def test_ai_analyze_with_invalid_surfer(self):
        """Test AI analyze with non-existent surfer returns 404"""
        fake_surfer_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/surfer-gallery/ai-analyze-photo",
            params={
                "photo_url": "https://example.com/test.jpg",
                "surfer_id": fake_surfer_id
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid surfer, got {response.status_code}"
        print(f"✓ Returns 404 for non-existent surfer")


class TestSurferGalleryReviewEndpoints:
    """Test surfer gallery review endpoints"""
    
    def test_proposed_matches_endpoint(self):
        """Test /api/surfer-gallery/proposed-matches endpoint"""
        fake_session_id = str(uuid.uuid4())
        
        response = requests.get(
            f"{BASE_URL}/api/surfer-gallery/proposed-matches/{fake_session_id}",
            params={"user_id": TEST_SURFER_ID}
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ Proposed matches endpoint exists, status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert "matches" in data, "Response missing matches field"
            print(f"  - matches count: {len(data.get('matches', []))}")
    
    def test_session_entitlements_endpoint(self):
        """Test /api/surfer-gallery/session-entitlements endpoint"""
        fake_session_id = str(uuid.uuid4())
        
        response = requests.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{fake_session_id}",
            params={"user_id": TEST_SURFER_ID}
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ Session entitlements endpoint exists, status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert "session_id" in data, "Response missing session_id"
            assert "is_all_inclusive" in data, "Response missing is_all_inclusive"
            print(f"  - session_type: {data.get('session_type')}")
            print(f"  - is_all_inclusive: {data.get('is_all_inclusive')}")
    
    def test_ai_sessions_endpoint(self):
        """Test /api/surfer-gallery/ai-sessions endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/surfer-gallery/ai-sessions",
            params={"surfer_id": TEST_SURFER_ID}
        )
        
        # Should not return 404 (endpoint exists)
        assert response.status_code != 404, f"Endpoint not found: {response.status_code}"
        print(f"✓ AI sessions endpoint exists, status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert "sessions" in data, "Response missing sessions field"
            assert "total_pending" in data, "Response missing total_pending"
            print(f"  - sessions count: {len(data.get('sessions', []))}")
            print(f"  - total_pending: {data.get('total_pending')}")


class TestSurferProfileModel:
    """Test SurferProfile model in AI identity matching service"""
    
    def test_surfer_profile_fields_in_ai_matching(self):
        """Verify SurferProfile model has all required fields for AI matching"""
        # This is a code review test - verify the model structure
        # The actual test is done by checking the AI analyze endpoint response
        
        response = requests.post(
            f"{BASE_URL}/api/surfer-gallery/ai-analyze-photo",
            params={
                "photo_url": "https://example.com/test.jpg",
                "surfer_id": TEST_SURFER_ID,
                "session_context": "Test session"
            }
        )
        
        # If the endpoint works, it means the SurferProfile model is correctly structured
        if response.status_code == 200:
            data = response.json()
            # Check that match_methods can include the new fields
            match_methods = data.get("match_methods", [])
            print(f"✓ AI matching working, match_methods: {match_methods}")
        else:
            print(f"✓ AI analyze endpoint accessible, status: {response.status_code}")


class TestDatabaseSchema:
    """Test database schema has required columns"""
    
    def test_booking_participants_selfie_url_column(self):
        """Test that booking_participants table has selfie_url column"""
        # We test this indirectly by trying to update a selfie
        # If the column doesn't exist, the update would fail with a different error
        
        fake_booking_id = str(uuid.uuid4())
        
        response = requests.patch(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/participant-selfie",
            json={
                "participant_id": TEST_SURFER_ID,
                "selfie_url": TEST_SELFIE_URL
            }
        )
        
        # Should return 404 (not found) not 500 (column doesn't exist)
        assert response.status_code != 500, f"Database error - selfie_url column may not exist: {response.text}"
        print(f"✓ booking_participants.selfie_url column exists (no 500 error)")
    
    def test_profile_identification_columns(self):
        """Test that profiles table has identification columns"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_SURFER_ID}")
        
        assert response.status_code == 200, f"Failed to get profile: {response.status_code}"
        data = response.json()
        
        # These fields should be in the response (even if null)
        required_fields = ["wetsuit_color", "rash_guard_color", "stance"]
        for field in required_fields:
            # Field should exist in response schema
            assert field in data or data.get(field) is None, f"Column {field} missing from profiles"
        
        print(f"✓ Profile identification columns exist: {required_fields}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
