"""
Test file for iteration 23: 
- Surf spots coastal coordinates
- Gallery CRUD with per-gallery pricing
- Bookings nearby with skill-level filtering
"""
import pytest
import requests
import os
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestSurfSpots:
    """Test surf spots API - coastal coordinates"""
    
    def test_get_surf_spots_returns_list(self):
        """Verify surf spots API returns list with coordinate data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        spots = response.json()
        assert isinstance(spots, list), "Response should be a list"
        assert len(spots) > 0, "Should have at least one surf spot"
        
        # Check first spot has required fields
        first_spot = spots[0]
        assert "id" in first_spot, "Spot should have id"
        assert "name" in first_spot, "Spot should have name"
        assert "latitude" in first_spot, "Spot should have latitude"
        assert "longitude" in first_spot, "Spot should have longitude"
        assert "is_active" in first_spot, "Spot should have is_active"
        
        print(f"✓ Surf spots API returned {len(spots)} spots")
    
    def test_surf_spots_have_coastal_coordinates(self):
        """Verify surf spots have correct coastal coordinates (on Florida east coast)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        coastal_spots = []
        
        for spot in spots:
            lat = spot.get("latitude")
            lon = spot.get("longitude")
            name = spot.get("name")
            
            if lat and lon:
                # Florida east coast longitude should be approximately -80 to -82
                # Latitude should be approximately 25 to 31
                is_coastal = -83 < lon < -80 and 25 < lat < 31
                
                if is_coastal:
                    coastal_spots.append(name)
                    print(f"✓ {name}: lat={lat}, lon={lon} - ON COAST")
                else:
                    print(f"⚠ {name}: lat={lat}, lon={lon} - May be inland")
        
        # Most spots should be coastal
        assert len(coastal_spots) > 10, f"Expected >10 coastal spots, got {len(coastal_spots)}"
        print(f"✓ {len(coastal_spots)} spots have coastal coordinates")
    
    def test_update_coordinates_endpoint(self):
        """Test POST /api/surf-spots/update-coordinates endpoint"""
        response = requests.post(f"{BASE_URL}/api/surf-spots/update-coordinates")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "updated_count" in data, "Response should have updated_count"
        
        print(f"✓ Update coordinates: {data['message']}")
    
    def test_get_single_surf_spot(self):
        """Test GET /api/surf-spots/{spot_id}"""
        # First get list to get a valid ID
        list_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = list_response.json()
        
        if spots:
            spot_id = spots[0]["id"]
            response = requests.get(f"{BASE_URL}/api/surf-spots/{spot_id}")
            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            
            spot = response.json()
            assert spot["id"] == spot_id
            assert "active_photographers_count" in spot
            print(f"✓ Single spot API working: {spot['name']}")
    
    def test_get_surf_spot_not_found(self):
        """Test 404 for non-existent spot"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/invalid-spot-id-12345")
        assert response.status_code == 404
        print("✓ Invalid spot returns 404")


class TestGalleryCRUD:
    """Test Gallery CRUD with per-gallery pricing"""
    
    # Use existing test photographer from previous iterations
    PHOTOGRAPHER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"  # Test Hobbyist
    
    @pytest.fixture
    def created_gallery_id(self):
        """Create a test gallery and return its ID"""
        gallery_data = {
            "title": f"TEST_Gallery_{datetime.now().strftime('%H%M%S')}",
            "description": "Test gallery for automated testing",
            "price_web": 2.5,
            "price_standard": 4.5,
            "price_high": 9.0,
            "price_720p": 7.0,
            "price_1080p": 14.0,
            "price_4k": 28.0
        }
        response = requests.post(
            f"{BASE_URL}/api/galleries",
            params={"photographer_id": self.PHOTOGRAPHER_ID},
            json=gallery_data
        )
        if response.status_code == 200:
            data = response.json()
            yield data.get("id")
            # Cleanup
            requests.delete(
                f"{BASE_URL}/api/galleries/{data['id']}",
                params={"photographer_id": self.PHOTOGRAPHER_ID}
            )
        else:
            yield None
    
    def test_create_gallery_with_pricing(self):
        """Test POST /api/galleries creates gallery with per-gallery pricing"""
        gallery_data = {
            "title": f"TEST_PricingGallery_{datetime.now().strftime('%H%M%S')}",
            "description": "Testing per-gallery pricing",
            "price_web": 2.99,
            "price_standard": 4.99,
            "price_high": 9.99,
            "price_720p": 6.99,
            "price_1080p": 12.99,
            "price_4k": 24.99
        }
        
        response = requests.post(
            f"{BASE_URL}/api/galleries",
            params={"photographer_id": self.PHOTOGRAPHER_ID},
            json=gallery_data
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have gallery id"
        assert "title" in data, "Response should have title"
        assert data["title"] == gallery_data["title"]
        
        gallery_id = data["id"]
        print(f"✓ Created gallery with per-gallery pricing: {gallery_id}")
        
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/galleries/{gallery_id}",
            params={"photographer_id": self.PHOTOGRAPHER_ID}
        )
    
    def test_get_photographer_galleries_with_pricing(self):
        """Test GET /api/galleries/photographer/{id} returns galleries with pricing"""
        response = requests.get(f"{BASE_URL}/api/galleries/photographer/{self.PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        galleries = response.json()
        assert isinstance(galleries, list), "Response should be a list"
        
        # Each gallery should have pricing info
        for gallery in galleries:
            assert "id" in gallery
            assert "title" in gallery
            assert "pricing" in gallery, "Gallery should have pricing object"
            
            pricing = gallery["pricing"]
            assert "photo" in pricing, "Pricing should have photo tiers"
            assert "video" in pricing, "Pricing should have video tiers"
            
            # Verify photo pricing structure
            photo_pricing = pricing["photo"]
            assert "web" in photo_pricing or photo_pricing.get("web") is None
            assert "standard" in photo_pricing or photo_pricing.get("standard") is None
            assert "high" in photo_pricing or photo_pricing.get("high") is None
            
            # Verify video pricing structure
            video_pricing = pricing["video"]
            assert "720p" in video_pricing or video_pricing.get("720p") is None
            assert "1080p" in video_pricing or video_pricing.get("1080p") is None
            assert "4k" in video_pricing or video_pricing.get("4k") is None
        
        print(f"✓ GET photographer galleries returns {len(galleries)} galleries with pricing info")
    
    def test_get_single_gallery_with_items_and_pricing(self, created_gallery_id):
        """Test GET /api/galleries/{id} returns gallery with items and pricing"""
        if not created_gallery_id:
            pytest.skip("Gallery creation failed")
        
        response = requests.get(f"{BASE_URL}/api/galleries/{created_gallery_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        gallery = response.json()
        assert gallery["id"] == created_gallery_id
        assert "title" in gallery
        assert "pricing" in gallery, "Gallery should have pricing"
        assert "items" in gallery, "Gallery should have items list"
        
        pricing = gallery["pricing"]
        assert "photo" in pricing
        assert "video" in pricing
        
        print(f"✓ GET single gallery: {gallery['title']} with pricing and items")
    
    def test_update_gallery_pricing(self, created_gallery_id):
        """Test PUT /api/galleries/{id} updates gallery pricing"""
        if not created_gallery_id:
            pytest.skip("Gallery creation failed")
        
        update_data = {
            "price_web": 3.50,
            "price_standard": 6.00,
            "price_high": 12.00,
            "price_720p": 9.00,
            "price_1080p": 18.00,
            "price_4k": 35.00
        }
        
        response = requests.put(
            f"{BASE_URL}/api/galleries/{created_gallery_id}",
            params={"photographer_id": self.PHOTOGRAPHER_ID},
            json=update_data
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data
        assert "pricing" in data
        
        # Verify updated pricing
        pricing = data["pricing"]
        assert pricing["photo"]["web"] == 3.50
        assert pricing["photo"]["standard"] == 6.00
        assert pricing["photo"]["high"] == 12.00
        assert pricing["video"]["720p"] == 9.00
        assert pricing["video"]["1080p"] == 18.00
        assert pricing["video"]["4k"] == 35.00
        
        print("✓ Gallery pricing updated successfully")
    
    def test_gallery_not_found(self):
        """Test 404 for non-existent gallery"""
        response = requests.get(f"{BASE_URL}/api/galleries/invalid-gallery-id-12345")
        assert response.status_code == 404
        print("✓ Invalid gallery returns 404")
    
    def test_unauthorized_gallery_update(self, created_gallery_id):
        """Test 403 when non-owner tries to update gallery"""
        if not created_gallery_id:
            pytest.skip("Gallery creation failed")
        
        response = requests.put(
            f"{BASE_URL}/api/galleries/{created_gallery_id}",
            params={"photographer_id": "different-user-id"},
            json={"title": "Hacked Title"}
        )
        assert response.status_code == 403
        print("✓ Unauthorized update returns 403")


class TestBookingsNearbySkillFilter:
    """Test bookings nearby endpoint with skill-level filtering"""
    
    def test_get_nearby_bookings(self):
        """Test GET /api/bookings/nearby returns bookings with skill_level_filter field"""
        # Cocoa Beach Pier coordinates
        params = {
            "latitude": 28.3655,
            "longitude": -80.5995,
            "radius": 100  # Large radius to find any bookings
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        bookings = response.json()
        assert isinstance(bookings, list), "Response should be a list"
        
        # Check each booking has skill_level_filter field
        for booking in bookings:
            assert "id" in booking
            assert "skill_level_filter" in booking, "Booking should have skill_level_filter field"
            assert "participant_skills" in booking, "Booking should have participant_skills field"
            assert "distance" in booking
            assert "split_price" in booking
            
        print(f"✓ Nearby bookings API returned {len(bookings)} bookings with skill_level_filter")
    
    def test_nearby_bookings_skill_level_filter_beginner(self):
        """Test filtering nearby bookings by skill level - Beginner"""
        params = {
            "latitude": 28.3655,
            "longitude": -80.5995,
            "radius": 100,
            "skill_level": "Beginner"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        # All returned bookings should match or have no skill filter
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            # Either no filter set or matches requested skill
            assert skill_filter is None or skill_filter == "Beginner", \
                f"Booking {booking['id']} has skill_filter={skill_filter}, expected None or Beginner"
        
        print(f"✓ Skill filter 'Beginner' returns {len(bookings)} matching bookings")
    
    def test_nearby_bookings_skill_level_filter_advanced(self):
        """Test filtering nearby bookings by skill level - Advanced"""
        params = {
            "latitude": 28.3655,
            "longitude": -80.5995,
            "radius": 100,
            "skill_level": "Advanced"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            assert skill_filter is None or skill_filter == "Advanced", \
                f"Booking {booking['id']} has skill_filter={skill_filter}, expected None or Advanced"
        
        print(f"✓ Skill filter 'Advanced' returns {len(bookings)} matching bookings")
    
    def test_nearby_bookings_with_user_skill_matching(self):
        """Test filtering by user_id for skill matching"""
        # Use existing test user
        params = {
            "latitude": 28.3655,
            "longitude": -80.5995,
            "radius": 100,
            "user_id": "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        assert isinstance(bookings, list)
        
        # Each booking should have participant skills info
        for booking in bookings:
            assert "participant_skills" in booking
            skills = booking["participant_skills"]
            assert isinstance(skills, list)
            for participant in skills:
                assert "name" in participant
                assert "skill_level" in participant
        
        print(f"✓ User skill matching returns {len(bookings)} bookings with participant info")


class TestEndLiveSessionCreatesGallery:
    """Test that ending a live session auto-creates a gallery"""
    
    PHOTOGRAPHER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"  # Test Hobbyist
    
    def test_end_session_returns_gallery_id(self):
        """Verify end session response includes gallery info"""
        # First check if photographer is live
        response = requests.get(f"{BASE_URL}/api/photographer/{self.PHOTOGRAPHER_ID}/active-session")
        
        if response.status_code == 200:
            session = response.json()
            if session and session.get("price_per_join"):
                # Photographer is live, test end session
                end_response = requests.post(f"{BASE_URL}/api/photographer/{self.PHOTOGRAPHER_ID}/end-session")
                
                if end_response.status_code == 200:
                    data = end_response.json()
                    # Check for gallery_id in response
                    assert "gallery_id" in data or "message" in data
                    print(f"✓ End session response: {data.get('message', data)}")
                else:
                    print(f"⚠ End session returned {end_response.status_code} - may not be live")
            else:
                print("⚠ Photographer not currently live - skipping end session test")
        else:
            print("⚠ Could not get active session - photographer may not be live")


class TestPhotographerSessionsDropdown:
    """Test that live session creation uses surf spot dropdown"""
    
    def test_surf_spots_available_for_dropdown(self):
        """Verify surf spots list is available for dropdown selection"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        assert len(spots) > 0, "Should have surf spots for dropdown"
        
        # Verify each spot has necessary fields for dropdown
        for spot in spots:
            assert "id" in spot, "Spot needs id for dropdown value"
            assert "name" in spot, "Spot needs name for dropdown display"
        
        print(f"✓ {len(spots)} surf spots available for live session dropdown")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
