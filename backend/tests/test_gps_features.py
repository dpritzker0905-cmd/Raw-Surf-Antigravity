"""
Test GPS Check-in and Surf Spot Image Features
- GPS check-in API with use_gps=true finds nearest spot using Haversine
- Spot image update API - PATCH /api/surf-spots/{spot_id}/image
- Verify surf spots have Unsplash images after seeding
"""

import pytest
import requests
import os
import uuid
import math

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test coordinates near Sebastian Inlet: 27.8617, -80.4456
SEBASTIAN_INLET_COORDS = {"lat": 27.8617, "lng": -80.4456}
# Far away coordinates (middle of ocean)
MIDDLE_OF_OCEAN = {"lat": 25.0, "lng": -85.0}


class TestGPSCheckIn:
    """GPS check-in functionality tests"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"API not accessible: {response.text}"
        print("PASS: API health check")
    
    def test_get_surf_spots_have_images(self):
        """Verify surf spots have Unsplash images"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Failed to get surf spots: {response.text}"
        
        spots = response.json()
        assert len(spots) > 0, "No surf spots found"
        
        # Check that spots have image_url from Unsplash
        spots_with_images = [s for s in spots if s.get('image_url')]
        assert len(spots_with_images) > 0, "No spots have images"
        
        # Verify images are from Unsplash
        unsplash_images = [s for s in spots_with_images if 'unsplash' in s['image_url'].lower()]
        assert len(unsplash_images) > 10, f"Only {len(unsplash_images)} spots have Unsplash images, expected 10+"
        
        print(f"PASS: {len(unsplash_images)} surf spots have Unsplash images")
    
    def test_sebastian_inlet_exists(self):
        """Verify Sebastian Inlet is seeded with correct coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        sebastian = next((s for s in spots if 'Sebastian' in s.get('name', '')), None)
        
        assert sebastian is not None, "Sebastian Inlet not found in spots"
        assert sebastian.get('latitude') is not None, "Sebastian Inlet missing latitude"
        assert sebastian.get('longitude') is not None, "Sebastian Inlet missing longitude"
        
        # Check coordinates are close to expected
        lat_diff = abs(sebastian['latitude'] - 27.8567)  # Expected: 27.8567
        lng_diff = abs(sebastian['longitude'] - (-80.4489))  # Expected: -80.4489
        
        assert lat_diff < 0.1, f"Sebastian latitude incorrect: {sebastian['latitude']}"
        assert lng_diff < 0.1, f"Sebastian longitude incorrect: {sebastian['longitude']}"
        
        print(f"PASS: Sebastian Inlet found at ({sebastian['latitude']}, {sebastian['longitude']})")
    
    def test_gps_checkin_finds_nearest_spot(self):
        """Test GPS check-in with use_gps=true finds nearest spot via Haversine"""
        # Create a new test user for this test
        unique_email = f"gps_test_{uuid.uuid4().hex[:8]}@rawsurf.com"
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": unique_email,
            "password": "Test123!",
            "full_name": "GPS Test User",
            "role": "surfer"
        })
        assert signup_response.status_code == 200, f"Failed to create test user: {signup_response.text}"
        user_id = signup_response.json()['id']
        
        # Check-in with GPS coordinates near Sebastian Inlet
        checkin_response = requests.post(
            f"{BASE_URL}/api/check-in?user_id={user_id}",
            json={
                "latitude": SEBASTIAN_INLET_COORDS["lat"],
                "longitude": SEBASTIAN_INLET_COORDS["lng"],
                "use_gps": True,
                "conditions": "Clean",
                "wave_height": "3-4ft"
            }
        )
        assert checkin_response.status_code == 200, f"GPS check-in failed: {checkin_response.text}"
        
        data = checkin_response.json()
        assert "spot_name" in data, "Check-in response missing spot_name"
        
        # Should find Sebastian Inlet as nearest spot
        assert "Sebastian" in data.get('spot_name', ''), f"Expected Sebastian Inlet, got: {data.get('spot_name')}"
        
        print(f"PASS: GPS check-in found nearest spot: {data.get('spot_name')}")
        print(f"  Streak: {data.get('current_streak')}, Total: {data.get('total_check_ins')}")
    
    def test_gps_checkin_without_nearby_spot_uses_custom_location(self):
        """Test GPS check-in far from any spot falls back to Custom Location"""
        # Create a new test user
        unique_email = f"gps_test_{uuid.uuid4().hex[:8]}@rawsurf.com"
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": unique_email,
            "password": "Test123!",
            "full_name": "GPS Far User",
            "role": "surfer"
        })
        assert signup_response.status_code == 200, f"Failed to create test user: {signup_response.text}"
        user_id = signup_response.json()['id']
        
        # Check-in with GPS coordinates far from any spot (> 10km)
        checkin_response = requests.post(
            f"{BASE_URL}/api/check-in?user_id={user_id}",
            json={
                "latitude": MIDDLE_OF_OCEAN["lat"],
                "longitude": MIDDLE_OF_OCEAN["lng"],
                "use_gps": True,
                "conditions": "Choppy"
            }
        )
        assert checkin_response.status_code == 200, f"GPS check-in failed: {checkin_response.text}"
        
        data = checkin_response.json()
        # Should use Custom Location since no spot within 10km
        assert data.get('spot_name') == 'Custom Location', f"Expected Custom Location, got: {data.get('spot_name')}"
        
        print(f"PASS: GPS check-in far from spots uses Custom Location")
    
    def test_checkin_manual_spot_selection(self):
        """Test check-in with manual spot selection (no GPS)"""
        # Get a spot ID first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        assert len(spots) > 0
        test_spot = spots[0]
        
        # Create a new test user
        unique_email = f"manual_test_{uuid.uuid4().hex[:8]}@rawsurf.com"
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": unique_email,
            "password": "Test123!",
            "full_name": "Manual Check-in User",
            "role": "surfer"
        })
        assert signup_response.status_code == 200
        user_id = signup_response.json()['id']
        
        # Check-in with manually selected spot
        checkin_response = requests.post(
            f"{BASE_URL}/api/check-in?user_id={user_id}",
            json={
                "spot_id": test_spot['id'],
                "use_gps": False,
                "conditions": "Glassy",
                "wave_height": "2-3ft"
            }
        )
        assert checkin_response.status_code == 200, f"Manual check-in failed: {checkin_response.text}"
        
        data = checkin_response.json()
        assert data.get('spot_name') == test_spot['name'], f"Expected {test_spot['name']}, got {data.get('spot_name')}"
        
        print(f"PASS: Manual spot selection check-in works: {data.get('spot_name')}")


class TestSpotImageAPI:
    """Test surf spot image update API"""
    
    def test_update_spot_image(self):
        """Test PATCH /api/surf-spots/{spot_id}/image"""
        # Get a spot ID first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        assert len(spots) > 0
        test_spot = spots[0]
        
        # Update the spot image
        new_image_url = "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1200"
        update_response = requests.patch(
            f"{BASE_URL}/api/surf-spots/{test_spot['id']}/image",
            json={"image_url": new_image_url}
        )
        assert update_response.status_code == 200, f"Image update failed: {update_response.text}"
        
        data = update_response.json()
        assert data.get('image_url') == new_image_url, f"Image URL not updated"
        assert data.get('spot_id') == test_spot['id'], f"Spot ID mismatch"
        
        print(f"PASS: Spot image updated for {test_spot['name']}")
    
    def test_update_spot_image_not_found(self):
        """Test PATCH with non-existent spot returns 404"""
        fake_spot_id = str(uuid.uuid4())
        response = requests.patch(
            f"{BASE_URL}/api/surf-spots/{fake_spot_id}/image",
            json={"image_url": "https://example.com/image.jpg"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Non-existent spot returns 404")
    
    def test_seed_images_endpoint_exists(self):
        """Test POST /api/surf-spots/seed-images endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/surf-spots/seed-images")
        assert response.status_code == 200, f"Seed images endpoint failed: {response.text}"
        
        data = response.json()
        assert 'message' in data, "Missing message in response"
        print(f"PASS: Seed images endpoint: {data.get('message')}")


class TestHaversineDistanceCalculation:
    """Verify Haversine formula is used correctly for distance"""
    
    def test_haversine_calculation_accuracy(self):
        """Test that GPS check-in uses Haversine formula correctly"""
        # The API should find the correct nearest spot based on Haversine distance
        # Let's test with coordinates that are closer to one spot than another
        
        # Get surf spots
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        
        # Find Sebastian Inlet
        sebastian = next((s for s in spots if 'Sebastian' in s.get('name', '')), None)
        if not sebastian:
            pytest.skip("Sebastian Inlet not found")
        
        # Create test user very close to Sebastian
        unique_email = f"haversine_test_{uuid.uuid4().hex[:8]}@rawsurf.com"
        signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": unique_email,
            "password": "Test123!",
            "full_name": "Haversine Test",
            "role": "surfer"
        })
        assert signup_response.status_code == 200
        user_id = signup_response.json()['id']
        
        # Check-in at exactly Sebastian's coordinates
        checkin_response = requests.post(
            f"{BASE_URL}/api/check-in?user_id={user_id}",
            json={
                "latitude": sebastian['latitude'],
                "longitude": sebastian['longitude'],
                "use_gps": True
            }
        )
        assert checkin_response.status_code == 200
        
        data = checkin_response.json()
        # At exact coordinates, should find Sebastian Inlet
        assert 'Sebastian' in data.get('spot_name', ''), f"Expected Sebastian Inlet at exact coords, got: {data.get('spot_name')}"
        
        print(f"PASS: Haversine calculation correctly identifies nearest spot at exact coordinates")


class TestExplorePageImages:
    """Test that Explore page trending spots have images"""
    
    def test_explore_trending_spots_have_images(self):
        """Test GET /api/explore/trending returns spots with images"""
        response = requests.get(f"{BASE_URL}/api/explore/trending")
        assert response.status_code == 200, f"Trending endpoint failed: {response.text}"
        
        data = response.json()
        assert 'trending_spots' in data, "Missing trending_spots in response"
        
        trending_spots = data['trending_spots']
        if len(trending_spots) > 0:
            # Check that spots have image_url
            spots_with_images = [s for s in trending_spots if s.get('image_url')]
            print(f"PASS: {len(spots_with_images)}/{len(trending_spots)} trending spots have images")
            
            # At least some should have Unsplash images
            unsplash_images = [s for s in spots_with_images if 'unsplash' in s['image_url'].lower()]
            assert len(unsplash_images) > 0, "No trending spots have Unsplash images"
        else:
            print("PASS: No trending spots returned (empty list)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
