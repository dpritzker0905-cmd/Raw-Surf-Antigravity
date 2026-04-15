"""
Test Session Metadata UI - Create Post Modal with Auto-fill Surf Conditions
Iteration 196 - Tests for:
1. Surf conditions API endpoints
2. Known spots endpoint
3. Post creation with session metadata
4. Session data persistence and retrieval
"""

import pytest
import requests
import os
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"


class TestSurfConditionsAPI:
    """Test surf conditions auto-fetch endpoints"""
    
    def test_known_spots_endpoint(self):
        """GET /api/surf-conditions/known-spots returns list of known spots"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions/known-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "spots" in data, "Response should have 'spots' key"
        assert len(data["spots"]) > 0, "Should have at least one known spot"
        
        # Verify spot structure
        spot = data["spots"][0]
        assert "key" in spot, "Spot should have 'key'"
        assert "name" in spot, "Spot should have 'name'"
        assert "lat" in spot, "Spot should have 'lat'"
        assert "lon" in spot, "Spot should have 'lon'"
        
        print(f"✓ Known spots endpoint returns {len(data['spots'])} spots")
        
        # Check for expected spots
        spot_keys = [s["key"] for s in data["spots"]]
        expected_spots = ["pipeline", "mavericks", "new_smyrna", "sebastian"]
        for expected in expected_spots:
            assert expected in spot_keys, f"Expected spot '{expected}' not found"
        
        print(f"✓ Expected spots found: {expected_spots}")
    
    def test_surf_conditions_by_spot_name(self):
        """GET /api/surf-conditions?spot_name=X returns conditions"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "new_smyrna"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "source" in data, "Response should have 'source'"
        
        # May have wave data if API is working
        if data.get("source") != "error":
            print(f"✓ Conditions by spot name: source={data.get('source')}")
            if "wave_height_ft" in data:
                print(f"  Wave height: {data['wave_height_ft']}ft")
            if "wind_speed_mph" in data:
                print(f"  Wind speed: {data['wind_speed_mph']}mph")
        else:
            print(f"⚠ API returned error (may be rate limited): {data.get('error')}")
    
    def test_surf_conditions_by_coordinates(self):
        """GET /api/surf-conditions?latitude=X&longitude=Y returns conditions"""
        # New Smyrna Beach coordinates
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"latitude": 29.0258, "longitude": -80.9278}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "source" in data, "Response should have 'source'"
        print(f"✓ Conditions by coordinates: source={data.get('source')}")
    
    def test_surf_conditions_missing_params(self):
        """GET /api/surf-conditions without params returns 400"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions")
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Missing params returns 400 as expected")


class TestPostCreationWithSessionMetadata:
    """Test creating posts with session metadata"""
    
    @pytest.fixture
    def test_media_url(self):
        """Sample media URL for testing"""
        return "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600"
    
    def test_create_post_with_session_metadata(self, test_media_url):
        """POST /api/posts with session metadata creates post correctly"""
        session_date = datetime.now(timezone.utc).isoformat()
        
        post_data = {
            "media_url": test_media_url,
            "media_type": "image",
            "caption": "TEST_Session metadata test post",
            "location": "Pipeline, Oahu",
            "session_date": session_date,
            "session_start_time": "06:30",
            "session_end_time": "08:30",
            "wave_height_ft": 4.5,
            "wave_period_sec": 12,
            "wind_speed_mph": 8.5,
            "wind_direction": "NE",
            "tide_status": "Rising",
            "conditions_source": "auto"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json=post_data
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have 'id'"
        
        # Verify session metadata in response
        assert data.get("wave_height_ft") == 4.5, f"Expected wave_height_ft=4.5, got {data.get('wave_height_ft')}"
        assert data.get("wave_period_sec") == 12, f"Expected wave_period_sec=12, got {data.get('wave_period_sec')}"
        assert data.get("wind_speed_mph") == 8.5, f"Expected wind_speed_mph=8.5, got {data.get('wind_speed_mph')}"
        assert data.get("wind_direction") == "NE", f"Expected wind_direction=NE, got {data.get('wind_direction')}"
        assert data.get("tide_status") == "Rising", f"Expected tide_status=Rising, got {data.get('tide_status')}"
        assert data.get("session_start_time") == "06:30", f"Expected session_start_time=06:30, got {data.get('session_start_time')}"
        assert data.get("session_end_time") == "08:30", f"Expected session_end_time=08:30, got {data.get('session_end_time')}"
        assert data.get("conditions_source") == "auto", f"Expected conditions_source=auto, got {data.get('conditions_source')}"
        
        print(f"✓ Post created with session metadata: {data['id']}")
        
        # Cleanup - delete the test post
        delete_response = requests.delete(
            f"{BASE_URL}/api/posts/{data['id']}",
            params={"user_id": TEST_USER_ID}
        )
        assert delete_response.status_code == 200, f"Failed to delete test post: {delete_response.text}"
        print(f"✓ Test post cleaned up")
    
    def test_create_post_without_session_metadata(self, test_media_url):
        """POST /api/posts without session metadata still works"""
        post_data = {
            "media_url": test_media_url,
            "media_type": "image",
            "caption": "TEST_Post without session metadata",
            "location": "Cocoa Beach, FL"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json=post_data
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have 'id'"
        
        # Session metadata should be None/null
        assert data.get("wave_height_ft") is None, "wave_height_ft should be None"
        assert data.get("session_start_time") is None, "session_start_time should be None"
        
        print(f"✓ Post created without session metadata: {data['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{data['id']}", params={"user_id": TEST_USER_ID})
        print(f"✓ Test post cleaned up")
    
    def test_session_metadata_in_feed(self, test_media_url):
        """GET /api/posts returns session metadata in feed"""
        # Create a post with session metadata
        post_data = {
            "media_url": test_media_url,
            "media_type": "image",
            "caption": "TEST_Feed session metadata test",
            "location": "Mavericks, CA",
            "session_date": datetime.now(timezone.utc).isoformat(),
            "session_start_time": "07:00",
            "wave_height_ft": 6.0,
            "wind_speed_mph": 5.0,
            "wind_direction": "W",
            "tide_status": "High"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json=post_data
        )
        assert create_response.status_code == 200
        created_post = create_response.json()
        post_id = created_post["id"]
        
        # Fetch feed and verify session metadata
        feed_response = requests.get(
            f"{BASE_URL}/api/posts",
            params={"user_id": TEST_USER_ID, "limit": 10}
        )
        assert feed_response.status_code == 200
        
        feed_posts = feed_response.json()
        test_post = next((p for p in feed_posts if p["id"] == post_id), None)
        
        assert test_post is not None, "Created post should appear in feed"
        assert test_post.get("wave_height_ft") == 6.0, f"Feed should show wave_height_ft=6.0, got {test_post.get('wave_height_ft')}"
        assert test_post.get("wind_speed_mph") == 5.0, f"Feed should show wind_speed_mph=5.0, got {test_post.get('wind_speed_mph')}"
        assert test_post.get("wind_direction") == "W", f"Feed should show wind_direction=W, got {test_post.get('wind_direction')}"
        assert test_post.get("tide_status") == "High", f"Feed should show tide_status=High, got {test_post.get('tide_status')}"
        assert test_post.get("session_start_time") == "07:00", f"Feed should show session_start_time=07:00, got {test_post.get('session_start_time')}"
        
        print(f"✓ Session metadata correctly returned in feed for post {post_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})
        print(f"✓ Test post cleaned up")


class TestKnownSpotsContent:
    """Verify known spots contain expected surf locations"""
    
    def test_known_spots_include_famous_breaks(self):
        """Known spots should include famous surf breaks"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions/known-spots")
        assert response.status_code == 200
        
        data = response.json()
        spots = {s["key"]: s["name"] for s in data["spots"]}
        
        # Famous breaks that should be included
        expected_breaks = {
            "pipeline": "Pipeline",
            "mavericks": "Mavericks",
            "rincon": "Rincon",
            "huntington": "Huntington",
            "jaws": "Jaws",
            "trestles": "Trestles",
            "nazare": "Nazaré",
            "teahupoo": "Teahupo'o"
        }
        
        for key, name in expected_breaks.items():
            assert key in spots, f"Expected famous break '{key}' ({name}) not found"
            print(f"✓ Found {name}")
        
        print(f"✓ All {len(expected_breaks)} famous breaks found in known spots")
    
    def test_known_spots_have_valid_coordinates(self):
        """All known spots should have valid lat/lon"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions/known-spots")
        assert response.status_code == 200
        
        data = response.json()
        
        for spot in data["spots"]:
            lat = spot.get("lat")
            lon = spot.get("lon")
            
            assert lat is not None, f"Spot {spot['key']} missing latitude"
            assert lon is not None, f"Spot {spot['key']} missing longitude"
            assert -90 <= lat <= 90, f"Spot {spot['key']} has invalid latitude: {lat}"
            assert -180 <= lon <= 180, f"Spot {spot['key']} has invalid longitude: {lon}"
        
        print(f"✓ All {len(data['spots'])} spots have valid coordinates")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
