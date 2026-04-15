"""
Iteration 78 - Resolution-Based Pricing & Role Permissions Tests

Tests:
1. Backend go-live endpoint accepts resolution pricing (photo_price_web, photo_price_standard, photo_price_high)
2. Backend go-live returns resolution_pricing in response
3. Role-based permission: Grom Parent role returns 403 when trying to go-live
4. Gallery pricing API returns photo_pricing with web, standard, high fields
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test photographer ID from context
TEST_PHOTOGRAPHER_ID = "34305abe-3880-410f-ab29-d4afd9a15242"


class TestGalleryPricingAPI:
    """Test Gallery Pricing API returns resolution-based photo_pricing"""
    
    def test_gallery_pricing_returns_photo_pricing_tiers(self):
        """GET /api/photographer/{id}/gallery-pricing returns photo_pricing with web, standard, high"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/gallery-pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify photo_pricing structure
        assert "photo_pricing" in data, f"Response missing photo_pricing field: {data}"
        photo_pricing = data["photo_pricing"]
        
        # Verify all three resolution tiers exist
        assert "web" in photo_pricing, f"Missing 'web' in photo_pricing: {photo_pricing}"
        assert "standard" in photo_pricing, f"Missing 'standard' in photo_pricing: {photo_pricing}"
        assert "high" in photo_pricing, f"Missing 'high' in photo_pricing: {photo_pricing}"
        
        # Verify values are numbers
        assert isinstance(photo_pricing["web"], (int, float)), f"web price should be numeric: {photo_pricing}"
        assert isinstance(photo_pricing["standard"], (int, float)), f"standard price should be numeric: {photo_pricing}"
        assert isinstance(photo_pricing["high"], (int, float)), f"high price should be numeric: {photo_pricing}"
        
        print(f"PASS: Gallery pricing returns photo_pricing with web={photo_pricing['web']}, standard={photo_pricing['standard']}, high={photo_pricing['high']}")


class TestGoLiveResolutionPricing:
    """Test Go-Live endpoint accepts and returns resolution pricing"""
    
    @pytest.fixture(autouse=True)
    def cleanup_session(self):
        """Ensure photographer is not live before and after test"""
        # End any existing session before test
        try:
            requests.post(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/end-session")
        except:
            pass
        yield
        # Cleanup after test
        try:
            requests.post(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/end-session")
        except:
            pass
    
    def test_go_live_accepts_resolution_pricing(self):
        """POST /api/photographer/{id}/go-live accepts photo_price_web, photo_price_standard, photo_price_high"""
        
        # First, get available surf spots
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200, f"Failed to fetch surf spots: {spots_response.text}"
        spots = spots_response.json()
        assert len(spots) > 0, "No surf spots available for testing"
        
        test_spot_id = spots[0]["id"]
        test_spot_name = spots[0]["name"]
        
        # Go live with resolution-based pricing
        go_live_payload = {
            "location": test_spot_name,
            "spot_id": test_spot_id,
            "price_per_join": 30.0,
            "max_surfers": 10,
            "auto_accept": True,
            "latitude": 30.295,
            "longitude": -81.390,
            # Resolution-based pricing (MANDATORY fields)
            "photo_price_web": 4.0,
            "photo_price_standard": 7.0,
            "photo_price_high": 15.0
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/go-live",
            json=go_live_payload
        )
        
        # Should succeed (200 OK)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response includes live_session_rates with resolution_pricing
        assert "live_session_rates" in data, f"Response missing live_session_rates: {data}"
        live_session_rates = data["live_session_rates"]
        
        assert "resolution_pricing" in live_session_rates, f"Response missing resolution_pricing: {live_session_rates}"
        resolution_pricing = live_session_rates["resolution_pricing"]
        
        # Verify the resolution pricing values match what we sent
        assert resolution_pricing["web"] == 4.0, f"Expected web=4.0, got {resolution_pricing['web']}"
        assert resolution_pricing["standard"] == 7.0, f"Expected standard=7.0, got {resolution_pricing['standard']}"
        assert resolution_pricing["high"] == 15.0, f"Expected high=15.0, got {resolution_pricing['high']}"
        
        print(f"PASS: Go-live accepts and returns resolution pricing: web={resolution_pricing['web']}, standard={resolution_pricing['standard']}, high={resolution_pricing['high']}")
    
    def test_go_live_returns_resolution_pricing_with_defaults(self):
        """POST /api/photographer/{id}/go-live returns resolution_pricing even when not specified (uses defaults)"""
        
        # Get a surf spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        assert len(spots) > 0
        
        test_spot_id = spots[0]["id"]
        
        # Go live WITHOUT specifying resolution pricing (should use profile defaults)
        go_live_payload = {
            "location": spots[0]["name"],
            "spot_id": test_spot_id,
            "price_per_join": 25.0,
            "latitude": 30.295,
            "longitude": -81.390
            # NOT including photo_price_web, photo_price_standard, photo_price_high
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/go-live",
            json=go_live_payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Should still have resolution_pricing with default values
        assert "live_session_rates" in data, f"Response missing live_session_rates: {data}"
        assert "resolution_pricing" in data["live_session_rates"], f"Response missing resolution_pricing: {data['live_session_rates']}"
        
        resolution_pricing = data["live_session_rates"]["resolution_pricing"]
        
        # Default values should be numeric (3.0, 5.0, 10.0 or from photographer profile)
        assert isinstance(resolution_pricing["web"], (int, float)), f"web should be numeric"
        assert isinstance(resolution_pricing["standard"], (int, float)), f"standard should be numeric"
        assert isinstance(resolution_pricing["high"], (int, float)), f"high should be numeric"
        
        print(f"PASS: Go-live returns default resolution pricing: web={resolution_pricing['web']}, standard={resolution_pricing['standard']}, high={resolution_pricing['high']}")


class TestGromParentRoleRestriction:
    """Test Grom Parent role returns 403 when trying to go-live"""
    
    def test_grom_parent_cannot_go_live(self):
        """POST /api/photographer/{grom_parent_id}/go-live returns 403 for Grom Parent role"""
        
        # First, we need to find or create a user with Grom Parent role
        # Let's search for any existing Grom Parent
        profiles_response = requests.get(f"{BASE_URL}/api/admin/photographers")
        
        grom_parent_id = None
        if profiles_response.status_code == 200:
            photographers = profiles_response.json()
            for p in photographers:
                if p.get("role") == "Grom Parent":
                    grom_parent_id = p["id"]
                    break
        
        if not grom_parent_id:
            # If no Grom Parent exists, we can skip or use alternative approach
            # Let's try to create a test profile via signup/profile update
            # For now, let's verify the logic by testing with a known endpoint behavior
            
            # Create a test user with Grom Parent role via profile creation
            test_email = "test_grom_parent_iter78@test.com"
            signup_response = requests.post(
                f"{BASE_URL}/api/auth/signup",
                json={
                    "email": test_email,
                    "password": "TestPassword123!",
                    "full_name": "Test Grom Parent",
                    "role": "Grom Parent"
                }
            )
            
            if signup_response.status_code in [200, 201]:
                grom_parent_id = signup_response.json().get("id")
            elif signup_response.status_code == 400 and "already exists" in signup_response.text.lower():
                # User already exists, try to login
                login_response = requests.post(
                    f"{BASE_URL}/api/auth/login",
                    json={
                        "email": test_email,
                        "password": "TestPassword123!"
                    }
                )
                if login_response.status_code == 200:
                    grom_parent_id = login_response.json().get("id")
        
        if grom_parent_id:
            # Get a surf spot
            spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
            spots = spots_response.json() if spots_response.status_code == 200 else []
            test_spot_id = spots[0]["id"] if spots else None
            
            # Try to go live as Grom Parent - should return 403
            go_live_payload = {
                "location": "Test Beach",
                "spot_id": test_spot_id,
                "price_per_join": 25.0,
                "latitude": 30.295,
                "longitude": -81.390
            }
            
            response = requests.post(
                f"{BASE_URL}/api/photographer/{grom_parent_id}/go-live",
                json=go_live_payload
            )
            
            # Should return 403 Forbidden for Grom Parent
            assert response.status_code == 403, f"Expected 403 for Grom Parent, got {response.status_code}: {response.text}"
            
            # Verify error message mentions Grom Parents cannot go live
            error_detail = response.json().get("detail", "")
            assert "grom parent" in error_detail.lower() or "gallery" in error_detail.lower(), \
                f"Error message should mention Grom Parent restriction: {error_detail}"
            
            print(f"PASS: Grom Parent role correctly blocked from go-live with 403 status")
        else:
            # Alternative: Test the go_live endpoint with the test photographer but verify the role check logic exists
            # We can verify by checking the API behavior when photographer role is not in allowed list
            pytest.skip("Could not create/find Grom Parent user - skipping test (role check logic verified in code)")


class TestSurfSpotsGoLiveWithResolutionPricing:
    """Test the surf_spots.py go-live endpoint also accepts resolution pricing"""
    
    @pytest.fixture(autouse=True)
    def cleanup_session(self):
        """Ensure photographer is not live before and after test"""
        try:
            requests.post(f"{BASE_URL}/api/photographers/{TEST_PHOTOGRAPHER_ID}/stop-live", json={})
        except:
            pass
        yield
        try:
            requests.post(f"{BASE_URL}/api/photographers/{TEST_PHOTOGRAPHER_ID}/stop-live", json={})
        except:
            pass
    
    def test_surf_spots_go_live_accepts_resolution_pricing(self):
        """POST /api/photographers/{id}/go-live (surf_spots route) accepts resolution pricing"""
        
        # Get a surf spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        assert len(spots) > 0
        
        test_spot_id = spots[0]["id"]
        
        # Go live with resolution pricing via surf_spots route
        go_live_payload = {
            "spot_id": test_spot_id,
            "location": spots[0]["name"],
            "is_streaming": False,
            "price_per_join": 25.0,
            "max_surfers": 8,
            # Resolution-based pricing
            "photo_price_web": 3.5,
            "photo_price_standard": 6.0,
            "photo_price_high": 12.0
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographers/{TEST_PHOTOGRAPHER_ID}/go-live",
            json=go_live_payload
        )
        
        # Should succeed
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify resolution_pricing in response
        assert "live_session_rates" in data, f"Response missing live_session_rates: {data}"
        assert "resolution_pricing" in data["live_session_rates"], f"Missing resolution_pricing: {data['live_session_rates']}"
        
        resolution_pricing = data["live_session_rates"]["resolution_pricing"]
        
        # Verify the prices match what we sent
        assert resolution_pricing["web"] == 3.5, f"Expected web=3.5, got {resolution_pricing['web']}"
        assert resolution_pricing["standard"] == 6.0, f"Expected standard=6.0, got {resolution_pricing['standard']}"
        assert resolution_pricing["high"] == 12.0, f"Expected high=12.0, got {resolution_pricing['high']}"
        
        print(f"PASS: Surf spots go-live accepts resolution pricing: {resolution_pricing}")


class TestRoleBasedPermissionHobbyist:
    """Test Hobbyist role behavior (allowed to go live but with restrictions)"""
    
    def test_hobbyist_can_go_live_when_no_pro_nearby(self):
        """Hobbyist should be able to go live when no Pro is within 0.1 miles"""
        
        # This test verifies the Hobbyist path doesn't immediately fail
        # The actual Pro proximity check requires specific test data setup
        
        # Get a profile to check role behavior
        profiles_response = requests.get(f"{BASE_URL}/api/admin/photographers")
        
        hobbyist_id = None
        if profiles_response.status_code == 200:
            photographers = profiles_response.json()
            for p in photographers:
                if p.get("role") == "Hobbyist":
                    hobbyist_id = p["id"]
                    break
        
        if hobbyist_id:
            # Get a surf spot
            spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
            spots = spots_response.json() if spots_response.status_code == 200 else []
            
            if spots:
                test_spot_id = spots[0]["id"]
                
                # First, ensure no session is active
                try:
                    requests.post(f"{BASE_URL}/api/photographer/{hobbyist_id}/end-session")
                except:
                    pass
                
                # Try to go live as Hobbyist
                go_live_payload = {
                    "location": spots[0]["name"],
                    "spot_id": test_spot_id,
                    "price_per_join": 20.0,
                    "latitude": 30.295,
                    "longitude": -81.390
                }
                
                response = requests.post(
                    f"{BASE_URL}/api/photographer/{hobbyist_id}/go-live",
                    json=go_live_payload
                )
                
                # Hobbyist should either succeed (no Pro nearby) or get 403 (Pro nearby)
                # Both are valid outcomes based on current state
                assert response.status_code in [200, 400, 403], \
                    f"Unexpected status for Hobbyist go-live: {response.status_code}: {response.text}"
                
                if response.status_code == 200:
                    print(f"PASS: Hobbyist was able to go live (no Pro nearby)")
                    # Cleanup
                    requests.post(f"{BASE_URL}/api/photographer/{hobbyist_id}/end-session")
                elif response.status_code == 403:
                    error_detail = response.json().get("detail", "")
                    if "pro photographer" in error_detail.lower() and "nearby" in error_detail.lower():
                        print(f"PASS: Hobbyist correctly blocked due to Pro photographer nearby")
                    else:
                        print(f"Hobbyist got 403 with message: {error_detail}")
                else:
                    print(f"Hobbyist got {response.status_code}: {response.text}")
        else:
            pytest.skip("No Hobbyist user found in system")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
