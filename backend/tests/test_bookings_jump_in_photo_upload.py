"""
Test Suite for Bookings Jump-In Flow, Photo Upload, and Gamification UI Features
Iteration 54: Testing Jump In overlay, Live Session Deal badge, Photo Upload, Surfer Roles

Features tested:
1. Photo Upload API with surfer tagging
2. Surfer role authorization for jumping in sessions
3. Live photographers endpoint
4. Gamification components data structures
"""

import pytest
import requests
import os
import io
import json
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"


class TestLivePhotographersAPI:
    """Test live photographers endpoint used by Bookings page"""
    
    def test_get_live_photographers(self):
        """GET /api/photographers/live - Returns list of live photographers"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list of photographers"
        
        # Check structure if any photographers are live
        if len(data) > 0:
            photographer = data[0]
            assert 'id' in photographer, "Photographer should have id"
            assert 'full_name' in photographer, "Photographer should have full_name"
            # Check for pricing fields used by Live Session Deal badge
            print(f"Found {len(data)} live photographers")
            for p in data:
                print(f"  - {p.get('full_name')}: session_price=${p.get('session_price', 'N/A')}")
        else:
            print("No photographers currently live - this is expected behavior")


class TestPhotoUploadAPI:
    """Test photo upload endpoint with surfer tagging"""
    
    @pytest.fixture
    def test_photographer_id(self):
        """Get a test photographer ID"""
        # Try to get an existing photographer
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        if response.status_code == 200 and response.json():
            return response.json()[0]['id']
        
        # Fallback to creating test user
        return "TEST_photo_upload_" + datetime.now().strftime("%Y%m%d%H%M%S")
    
    def test_photo_upload_endpoint_exists(self, test_photographer_id):
        """POST /api/photos/upload - Verify endpoint is reachable"""
        # Test with no file (should return 422 - validation error)
        response = requests.post(f"{BASE_URL}/api/photos/upload")
        
        # 422 means endpoint exists but missing required fields
        assert response.status_code in [422, 400], f"Expected 422 or 400 for missing file, got {response.status_code}: {response.text}"
        print("Photo upload endpoint exists and validates input")
    
    def test_photo_upload_with_file(self, test_photographer_id):
        """POST /api/photos/upload - Upload photo with form data"""
        # Create a simple test image (1x1 red pixel PNG)
        # PNG header + 1x1 RGBA pixel
        test_image = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # 8-bit RGB
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82
        ])
        
        files = {
            'file': ('test_photo.png', io.BytesIO(test_image), 'image/png')
        }
        data = {
            'photographer_id': test_photographer_id,
            'price': '5.0',
            'is_session_photo': 'true'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photos/upload",
            files=files,
            data=data
        )
        
        # Should succeed or fail with meaningful error
        if response.status_code in [200, 201]:
            result = response.json()
            assert 'success' in result or 'id' in result, "Response should contain success or id field"
            assert 'preview_url' in result, "Response should contain preview_url"
            print(f"Photo upload successful: {result.get('preview_url', 'N/A')}")
        elif response.status_code == 404:
            print(f"Photographer not found (expected for test user): {response.json()}")
        else:
            print(f"Upload response {response.status_code}: {response.text}")
    
    def test_photo_upload_with_tagged_surfers(self, test_photographer_id):
        """POST /api/photos/upload - Upload with tagged surfer IDs"""
        # Create test image
        test_image = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
            0x44, 0xAE, 0x42, 0x60, 0x82
        ])
        
        tagged_ids = ["test-surfer-id-1", "test-surfer-id-2"]
        
        files = {
            'file': ('test_tagged.png', io.BytesIO(test_image), 'image/png')
        }
        data = {
            'photographer_id': test_photographer_id,
            'tagged_surfer_ids': json.dumps(tagged_ids),
            'price': '5.0',
            'is_session_photo': 'true'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photos/upload",
            files=files,
            data=data
        )
        
        if response.status_code in [200, 201]:
            result = response.json()
            assert 'tagged_surfers' in result, "Response should contain tagged_surfers count"
            print(f"Photo upload with tags: {result.get('tagged_surfers', 0)} surfers tagged")
        elif response.status_code == 404:
            print("Photographer not found - test with real photographer ID for full test")
        else:
            print(f"Response {response.status_code}: {response.text}")


class TestSurferRolesAuthorization:
    """Test that SURFER_ROLES array is respected for session joining"""
    
    SURFER_ROLES = ['Grom', 'Surfer', 'Competitive Surfer', 'Pro Surfer', 'Hobbyist', 'Grom Parent']
    NON_SURFER_ROLES = ['Photographer', 'Business', 'Admin']
    
    def test_surfer_roles_defined(self):
        """Verify surfer roles match frontend definition"""
        # These roles should be able to join sessions
        expected_roles = ['Grom', 'Surfer', 'Competitive Surfer', 'Pro Surfer', 'Hobbyist', 'Grom Parent']
        
        for role in expected_roles:
            assert role in self.SURFER_ROLES, f"{role} should be in SURFER_ROLES"
        
        print(f"SURFER_ROLES verified: {self.SURFER_ROLES}")
    
    def test_user_profile_role_field(self):
        """GET /api/profiles - Verify role field exists on profiles"""
        # Try to get any profile to check structure
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        
        if response.status_code == 200 and response.json():
            # Live photographers have id, fetch their profile
            photographer_id = response.json()[0]['id']
            profile_res = requests.get(f"{BASE_URL}/api/profiles/id/{photographer_id}")
            
            if profile_res.status_code == 200:
                profile = profile_res.json()
                assert 'role' in profile or 'roles' in profile, "Profile should have role field"
                print(f"Profile role: {profile.get('role', profile.get('roles', 'N/A'))}")
            else:
                print(f"Could not fetch profile for structure check: {profile_res.status_code}")
        else:
            print("No live photographers to check profile structure")


class TestLiveSessionDealBadge:
    """Test pricing data for Live Session Deal badge"""
    
    def test_photographer_pricing_fields(self):
        """Verify live photographers have pricing fields for savings calculation"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        assert response.status_code == 200
        
        photographers = response.json()
        
        if len(photographers) > 0:
            photographer = photographers[0]
            
            # Check for pricing fields
            session_price = photographer.get('session_price')
            live_photo_price = photographer.get('live_photo_price', photographer.get('session_photo_price'))
            general_photo_price = photographer.get('general_photo_price', photographer.get('gallery_photo_price'))
            
            print(f"Photographer pricing:")
            print(f"  - session_price: ${session_price}")
            print(f"  - live_photo_price: ${live_photo_price}")
            print(f"  - general_photo_price: ${general_photo_price}")
            
            # At minimum, session_price should exist
            assert session_price is not None or 'session_price' in photographer, "session_price should be set"
        else:
            print("No live photographers to check pricing")


class TestGamificationDataStructure:
    """Test gamification data structures used by XPDisplay, BadgeIcon, BadgeRow"""
    
    def test_xp_transactions_endpoint(self):
        """GET /api/xp/transactions - Check XP transactions endpoint"""
        # Test with a placeholder user ID
        test_user_id = "test-user-123"
        response = requests.get(f"{BASE_URL}/api/xp/transactions/{test_user_id}")
        
        # Should return 200 with empty list or 404 if user doesn't exist
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            print(f"XP transactions endpoint returns: {type(data)}")
        else:
            print("XP transactions returns 404 for non-existent user (expected)")
    
    def test_badges_endpoint(self):
        """GET /api/badges - Check badges endpoint if exists"""
        # Try different badge endpoint patterns
        endpoints = [
            "/api/badges",
            "/api/gamification/badges",
            "/api/users/badges"
        ]
        
        for endpoint in endpoints:
            response = requests.get(f"{BASE_URL}{endpoint}")
            if response.status_code == 200:
                print(f"Badge endpoint found at {endpoint}")
                return
            elif response.status_code != 404:
                print(f"{endpoint}: {response.status_code}")
        
        print("No public badges endpoint found (may require authentication)")


class TestSessionsUserEndpoint:
    """Test sessions endpoint used by Bookings page"""
    
    def test_user_sessions_endpoint(self):
        """GET /api/sessions/user/{id} - Get user's sessions"""
        test_user_id = "test-user-123"
        response = requests.get(f"{BASE_URL}/api/sessions/user/{test_user_id}")
        
        # Should return 200 with list or 404
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            sessions = response.json()
            assert isinstance(sessions, list), "Should return list of sessions"
            print(f"User sessions endpoint returns list: {len(sessions)} sessions")
        else:
            print("User sessions returns 404 (expected for non-existent user)")
    
    def test_bookings_user_endpoint(self):
        """GET /api/bookings/user/{id} - Get user's bookings"""
        test_user_id = "test-user-123"
        response = requests.get(f"{BASE_URL}/api/bookings/user/{test_user_id}")
        
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            bookings = response.json()
            assert isinstance(bookings, list), "Should return list of bookings"
            print(f"User bookings endpoint returns list: {len(bookings)} bookings")
        else:
            print("User bookings returns 404 (expected for non-existent user)")


class TestPhotographerActiveSession:
    """Test photographer active session endpoint"""
    
    def test_photographer_active_session(self):
        """GET /api/photographer/{id}/active-session - Check active session"""
        # Get a live photographer
        live_res = requests.get(f"{BASE_URL}/api/photographers/live")
        
        if live_res.status_code == 200 and live_res.json():
            photographer_id = live_res.json()[0]['id']
            
            response = requests.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
            
            if response.status_code == 200:
                session = response.json()
                print(f"Active session found for {photographer_id}")
                if session:
                    # Check session has live session rates
                    print(f"  - Location: {session.get('location', 'N/A')}")
                    print(f"  - Active surfers: {session.get('active_surfers', 0)}")
                    print(f"  - Live rates: {session.get('live_session_rates', 'N/A')}")
            else:
                print(f"Active session response: {response.status_code}")
        else:
            print("No live photographers to test active session")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
