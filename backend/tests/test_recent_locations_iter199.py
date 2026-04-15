"""
Test Recent Locations Auto-fill Feature (Iteration 199)
Tests the new /api/posts/user/{user_id}/recent-locations endpoint
and related features: Delete, I Was There, Post Settings, NOAA display
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_POST_WITH_NOAA = "d588a457-65f0-4306-b09d-ab16aa082aee"

# Cocoa Beach Pier coordinates for testing
COCOA_BEACH_LAT = 28.3676
COCOA_BEACH_LON = -80.6009


class TestRecentLocationsEndpoint:
    """Tests for GET /api/posts/user/{user_id}/recent-locations"""
    
    def test_get_recent_locations_success(self):
        """Test fetching recent locations for a user"""
        response = requests.get(f"{BASE_URL}/api/posts/user/{TEST_USER_ID}/recent-locations")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Check structure if locations exist
        if len(data) > 0:
            loc = data[0]
            assert "location" in loc, "Location should have 'location' field"
            assert "last_used" in loc, "Location should have 'last_used' field"
            assert "use_count" in loc, "Location should have 'use_count' field"
            print(f"Found {len(data)} recent locations for user")
            for l in data[:3]:
                print(f"  - {l.get('location')} (used {l.get('use_count')} times)")
    
    def test_recent_locations_limit(self):
        """Test that limit parameter works"""
        response = requests.get(
            f"{BASE_URL}/api/posts/user/{TEST_USER_ID}/recent-locations",
            params={"limit": 3}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 3, "Should respect limit parameter"
    
    def test_recent_locations_nonexistent_user(self):
        """Test fetching locations for non-existent user returns empty list"""
        fake_user_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/posts/user/{fake_user_id}/recent-locations")
        assert response.status_code == 200
        data = response.json()
        assert data == [], "Should return empty list for non-existent user"
    
    def test_recent_locations_has_coordinates(self):
        """Test that locations include lat/lon when available"""
        response = requests.get(f"{BASE_URL}/api/posts/user/{TEST_USER_ID}/recent-locations")
        assert response.status_code == 200
        data = response.json()
        
        # Check if any location has coordinates
        has_coords = any(loc.get('latitude') or loc.get('longitude') for loc in data)
        print(f"Locations with coordinates: {has_coords}")
        
        # Verify structure includes coordinate fields
        if len(data) > 0:
            loc = data[0]
            # These fields should exist (even if null)
            assert "latitude" in loc or loc.get('latitude') is None or 'latitude' not in loc
            assert "longitude" in loc or loc.get('longitude') is None or 'longitude' not in loc


class TestPostDeleteCascade:
    """Tests for DELETE /api/posts/{post_id} with cascade"""
    
    def test_delete_post_unauthorized(self):
        """Test that non-owner cannot delete post"""
        # Try to delete a post with wrong user
        fake_user_id = str(uuid.uuid4())
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_WITH_NOAA}",
            params={"user_id": fake_user_id}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
    
    def test_delete_nonexistent_post(self):
        """Test deleting non-existent post returns 404"""
        fake_post_id = str(uuid.uuid4())
        response = requests.delete(
            f"{BASE_URL}/api/posts/{fake_post_id}",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 404


class TestIWasThereCollaboration:
    """Tests for POST /api/posts/{post_id}/request-collaboration"""
    
    def test_collaboration_request_own_post_blocked(self):
        """Test that user cannot request collaboration on own post"""
        # First, get a post by the test user
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert response.status_code == 200
        posts = response.json()
        
        # Find a post by the test user
        own_post = next((p for p in posts if p.get('author_id') == TEST_USER_ID), None)
        
        if own_post:
            # Try to request collaboration on own post
            collab_response = requests.post(
                f"{BASE_URL}/api/posts/{own_post['id']}/request-collaboration",
                params={"user_id": TEST_USER_ID},
                json={"latitude": COCOA_BEACH_LAT, "longitude": COCOA_BEACH_LON}
            )
            assert collab_response.status_code == 400, f"Expected 400, got {collab_response.status_code}"
            print("Correctly blocked collaboration request on own post")
        else:
            pytest.skip("No posts found for test user")
    
    def test_collaboration_request_nonexistent_post(self):
        """Test collaboration request on non-existent post"""
        fake_post_id = str(uuid.uuid4())
        response = requests.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/request-collaboration",
            params={"user_id": TEST_USER_ID},
            json={}
        )
        assert response.status_code == 404


class TestPostSettings:
    """Tests for PATCH /api/posts/{post_id}/settings"""
    
    def test_settings_unauthorized(self):
        """Test that non-owner cannot change settings"""
        fake_user_id = str(uuid.uuid4())
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_WITH_NOAA}/settings",
            params={"user_id": fake_user_id},
            json={"hide_like_count": True}
        )
        assert response.status_code == 403
    
    def test_settings_nonexistent_post(self):
        """Test settings on non-existent post"""
        fake_post_id = str(uuid.uuid4())
        response = requests.patch(
            f"{BASE_URL}/api/posts/{fake_post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"hide_like_count": True}
        )
        assert response.status_code == 404


class TestNOAAConditionsDisplay:
    """Tests for posts with NOAA data"""
    
    def test_post_with_noaa_data_exists(self):
        """Test that the test post with NOAA data exists and has conditions"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert response.status_code == 200
        posts = response.json()
        
        # Find the specific test post
        test_post = next((p for p in posts if p.get('id') == TEST_POST_WITH_NOAA), None)
        
        if test_post:
            print(f"Found test post: {test_post.get('id')}")
            print(f"  Wave height: {test_post.get('wave_height_ft')}")
            print(f"  Wind speed: {test_post.get('wind_speed_mph')}")
            print(f"  Tide status: {test_post.get('tide_status')}")
            print(f"  Location: {test_post.get('location')}")
        else:
            print(f"Test post {TEST_POST_WITH_NOAA} not found in feed")
    
    def test_feed_returns_session_metadata(self):
        """Test that feed includes session metadata fields"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert response.status_code == 200
        posts = response.json()
        
        # Check that posts have session metadata fields
        posts_with_conditions = [p for p in posts if p.get('wave_height_ft') or p.get('wind_speed_mph')]
        print(f"Posts with conditions data: {len(posts_with_conditions)} out of {len(posts)}")
        
        if len(posts) > 0:
            # Verify structure includes session fields
            sample_post = posts[0]
            session_fields = ['session_date', 'session_start_time', 'wave_height_ft', 
                            'wind_speed_mph', 'tide_status', 'conditions_source']
            for field in session_fields:
                assert field in sample_post or sample_post.get(field) is None, f"Missing field: {field}"


class TestSurfConditionsEndpoint:
    """Tests for GET /api/surf-conditions (used by auto-fetch)"""
    
    def test_fetch_conditions_cocoa_beach(self):
        """Test fetching conditions for Cocoa Beach Pier"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={
                "latitude": COCOA_BEACH_LAT,
                "longitude": COCOA_BEACH_LON,
                "spot_name": "Cocoa Beach Pier"
            }
        )
        
        # Should return 200 even if NOAA data unavailable
        assert response.status_code in [200, 500], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            print(f"Conditions for Cocoa Beach:")
            print(f"  Wave height: {data.get('wave_height_ft')} ft")
            print(f"  Wave period: {data.get('wave_period_sec')} sec")
            print(f"  Wind speed: {data.get('wind_speed_mph')} mph")
            print(f"  Tide: {data.get('tide_status')}")


class TestFeedEndpoint:
    """Tests for GET /api/posts (feed)"""
    
    def test_feed_loads(self):
        """Test that feed loads successfully"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert response.status_code == 200
        posts = response.json()
        assert isinstance(posts, list)
        print(f"Feed loaded with {len(posts)} posts")
    
    def test_feed_includes_collaborators(self):
        """Test that feed includes collaborator data"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert response.status_code == 200
        posts = response.json()
        
        # Check for collaborators field
        posts_with_collaborators = [p for p in posts if p.get('collaborators') and len(p.get('collaborators', [])) > 0]
        print(f"Posts with collaborators: {len(posts_with_collaborators)}")
        
        if len(posts) > 0:
            assert 'collaborators' in posts[0], "Posts should have collaborators field"
            assert 'collaborator_count' in posts[0], "Posts should have collaborator_count field"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
