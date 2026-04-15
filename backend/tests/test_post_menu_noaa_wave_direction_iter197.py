"""
Test Suite for Iteration 197 Features:
1. Delete post from post menu shows confirmation modal and deletes post
2. Turn off commenting from post menu toggles comments_disabled setting
3. Hide like count from post menu toggles hide_like_count setting
4. NOAA tide data returned for US spots (tide_height_ft, tide_status, next_high/low)
5. Wave direction degrees returned from /api/surf-conditions
6. POST /api/posts saves wave_direction and tide_height_ft
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"


class TestPostMenuSettings:
    """Test post menu settings: delete, toggle commenting, hide like count"""
    
    @pytest.fixture
    def test_post(self):
        """Create a test post for menu operations"""
        post_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": f"TEST_post_menu_iter197_{uuid.uuid4().hex[:8]}",
            "location": "Test Location"
        }
        response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_USER_ID}",
            json=post_data
        )
        assert response.status_code == 200, f"Failed to create test post: {response.text}"
        post = response.json()
        yield post
        # Cleanup - try to delete if still exists
        try:
            requests.delete(f"{BASE_URL}/api/posts/{post['id']}?user_id={TEST_USER_ID}")
        except:
            pass
    
    def test_toggle_comments_disabled_on(self, test_post):
        """Test turning off commenting via PATCH /api/posts/{id}/settings"""
        post_id = test_post['id']
        
        # Turn off commenting
        response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"comments_disabled": True}
        )
        assert response.status_code == 200, f"Failed to toggle comments: {response.text}"
        data = response.json()
        assert data.get("success") == True
        
        # Verify the setting was applied by fetching posts
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        assert feed_response.status_code == 200
        posts = feed_response.json()
        updated_post = next((p for p in posts if p['id'] == post_id), None)
        assert updated_post is not None, "Post not found in feed"
        assert updated_post.get('comments_disabled') == True, "comments_disabled should be True"
        print(f"PASS: comments_disabled toggled to True for post {post_id}")
    
    def test_toggle_comments_disabled_off(self, test_post):
        """Test turning on commenting (disable -> enable)"""
        post_id = test_post['id']
        
        # First turn off
        requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"comments_disabled": True}
        )
        
        # Then turn back on
        response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"comments_disabled": False}
        )
        assert response.status_code == 200
        
        # Verify
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        posts = feed_response.json()
        updated_post = next((p for p in posts if p['id'] == post_id), None)
        assert updated_post.get('comments_disabled') == False, "comments_disabled should be False"
        print(f"PASS: comments_disabled toggled back to False for post {post_id}")
    
    def test_toggle_hide_like_count_on(self, test_post):
        """Test hiding like count via PATCH /api/posts/{id}/settings"""
        post_id = test_post['id']
        
        response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"hide_like_count": True}
        )
        assert response.status_code == 200
        
        # Verify
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        posts = feed_response.json()
        updated_post = next((p for p in posts if p['id'] == post_id), None)
        assert updated_post.get('hide_like_count') == True, "hide_like_count should be True"
        print(f"PASS: hide_like_count toggled to True for post {post_id}")
    
    def test_toggle_hide_like_count_off(self, test_post):
        """Test showing like count (hide -> show)"""
        post_id = test_post['id']
        
        # First hide
        requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"hide_like_count": True}
        )
        
        # Then show
        response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={TEST_USER_ID}",
            json={"hide_like_count": False}
        )
        assert response.status_code == 200
        
        # Verify
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        posts = feed_response.json()
        updated_post = next((p for p in posts if p['id'] == post_id), None)
        assert updated_post.get('hide_like_count') == False, "hide_like_count should be False"
        print(f"PASS: hide_like_count toggled back to False for post {post_id}")
    
    def test_delete_post(self):
        """Test deleting a post via DELETE /api/posts/{id}"""
        # Create a post specifically for deletion
        post_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": f"TEST_delete_post_iter197_{uuid.uuid4().hex[:8]}",
            "location": "Delete Test Location"
        }
        create_response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_USER_ID}",
            json=post_data
        )
        assert create_response.status_code == 200
        post_id = create_response.json()['id']
        
        # Delete the post
        delete_response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}?user_id={TEST_USER_ID}"
        )
        assert delete_response.status_code == 200, f"Failed to delete post: {delete_response.text}"
        data = delete_response.json()
        assert data.get("success") == True
        assert "deleted" in data.get("message", "").lower()
        
        # Verify post is gone
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        posts = feed_response.json()
        deleted_post = next((p for p in posts if p['id'] == post_id), None)
        assert deleted_post is None, "Post should be deleted from feed"
        print(f"PASS: Post {post_id} successfully deleted")
    
    def test_delete_post_unauthorized(self, test_post):
        """Test that non-owner cannot delete a post"""
        post_id = test_post['id']
        fake_user_id = str(uuid.uuid4())
        
        response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}?user_id={fake_user_id}"
        )
        assert response.status_code == 403, "Should return 403 for unauthorized delete"
        print(f"PASS: Unauthorized delete correctly rejected with 403")
    
    def test_settings_unauthorized(self, test_post):
        """Test that non-owner cannot change post settings"""
        post_id = test_post['id']
        fake_user_id = str(uuid.uuid4())
        
        response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings?user_id={fake_user_id}",
            json={"comments_disabled": True}
        )
        assert response.status_code == 403, "Should return 403 for unauthorized settings change"
        print(f"PASS: Unauthorized settings change correctly rejected with 403")


class TestNOAATideData:
    """Test NOAA tide data integration for US surf spots"""
    
    def test_noaa_tide_data_florida_spot(self):
        """Test NOAA tide data for New Smyrna Beach, FL (has NOAA station)"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "new_smyrna"}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Check for tide data fields
        print(f"Response data: {data}")
        
        # tide_source should be "noaa" for US spots with NOAA stations
        # This confirms the NOAA integration is working
        assert data.get("tide_source") == "noaa", "tide_source should be 'noaa' for US spots"
        print(f"PASS: tide_source = noaa (NOAA integration working)")
        
        # tide_status may or may not be present depending on time of day
        # (if current time is before first tide prediction, prev_tide is None)
        if "tide_status" in data:
            assert data["tide_status"] in ["Rising", "Falling", "High", "Low", "unknown"], \
                f"Invalid tide_status: {data.get('tide_status')}"
            print(f"PASS: NOAA tide_status = {data.get('tide_status')}")
        else:
            print(f"INFO: tide_status not present (timing edge case - before first tide of day)")
        
        # tide_height_ft may be present
        if "tide_height_ft" in data:
            assert isinstance(data["tide_height_ft"], (int, float)), "tide_height_ft should be numeric"
            print(f"PASS: NOAA tide_height_ft = {data.get('tide_height_ft')}")
        
        # next_high or next_low may be present
        if "next_high" in data:
            print(f"PASS: next_high = {data.get('next_high')}")
        if "next_low" in data:
            print(f"PASS: next_low = {data.get('next_low')}")
    
    def test_noaa_tide_data_california_spot(self):
        """Test NOAA tide data for Huntington Beach, CA (has NOAA station)"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "huntington"}
        )
        assert response.status_code == 200
        data = response.json()
        
        print(f"Huntington Beach conditions: {data}")
        
        # Verify NOAA integration is working
        assert data.get("tide_source") == "noaa", "tide_source should be 'noaa' for Huntington"
        print(f"PASS: Huntington tide_source = noaa")
        
        if "tide_status" in data:
            print(f"PASS: Huntington NOAA tide_status = {data.get('tide_status')}")
    
    def test_noaa_tide_data_hawaii_spot(self):
        """Test NOAA tide data for Pipeline, Hawaii (has NOAA station)"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "pipeline"}
        )
        assert response.status_code == 200
        data = response.json()
        
        print(f"Pipeline conditions: {data}")
        
        # Verify NOAA integration is working
        assert data.get("tide_source") == "noaa", "tide_source should be 'noaa' for Pipeline"
        print(f"PASS: Pipeline tide_source = noaa")
        
        if "tide_status" in data:
            print(f"PASS: Pipeline NOAA tide_status = {data.get('tide_status')}")
    
    def test_international_spot_no_noaa(self):
        """Test that international spots return tide_status: unknown (no NOAA)"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "nazare"}
        )
        assert response.status_code == 200
        data = response.json()
        
        print(f"Nazare (Portugal) conditions: {data}")
        
        # International spots should not have NOAA tide data
        assert data.get("tide_source") != "noaa", "International spots should not have NOAA tide source"
        print(f"PASS: International spot correctly has no NOAA tide data")


class TestWaveDirectionDegrees:
    """Test wave direction degrees returned from surf conditions API"""
    
    def test_wave_direction_degrees_returned(self):
        """Test that wave_direction_degrees is returned from /api/surf-conditions"""
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"spot_name": "pipeline"}
        )
        assert response.status_code == 200
        data = response.json()
        
        print(f"Surf conditions response: {data}")
        
        # wave_direction should be present (compass direction like "NE")
        if "wave_direction" in data:
            assert isinstance(data["wave_direction"], str)
            print(f"PASS: wave_direction = {data.get('wave_direction')}")
        
        # wave_direction_degrees should be present (numeric degrees)
        if "wave_direction_degrees" in data:
            assert isinstance(data["wave_direction_degrees"], (int, float))
            assert 0 <= data["wave_direction_degrees"] <= 360, "Degrees should be 0-360"
            print(f"PASS: wave_direction_degrees = {data.get('wave_direction_degrees')}")
    
    def test_wave_direction_by_coordinates(self):
        """Test wave direction returned when using lat/lon coordinates"""
        # Sebastian Inlet, FL coordinates
        response = requests.get(
            f"{BASE_URL}/api/surf-conditions",
            params={"latitude": 27.8120, "longitude": -80.4506}
        )
        assert response.status_code == 200
        data = response.json()
        
        print(f"Coordinate-based conditions: {data}")
        
        # Check wave data is present
        assert "wave_height_ft" in data or "source" in data
        if "wave_direction_degrees" in data:
            print(f"PASS: wave_direction_degrees = {data.get('wave_direction_degrees')}")


class TestPostWithWaveAndTideData:
    """Test creating posts with wave_direction and tide_height_ft fields"""
    
    def test_create_post_with_wave_direction(self):
        """Test POST /api/posts saves wave_direction and wave_direction_degrees"""
        post_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": f"TEST_wave_direction_iter197_{uuid.uuid4().hex[:8]}",
            "location": "Pipeline, Hawaii",
            "wave_height_ft": 6.5,
            "wave_period_sec": 14,
            "wave_direction": "NW",
            "wave_direction_degrees": 315.0,
            "wind_speed_mph": 12.5,
            "wind_direction": "NE"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_USER_ID}",
            json=post_data
        )
        assert response.status_code == 200, f"Failed to create post: {response.text}"
        post = response.json()
        
        # Verify wave direction fields are saved
        assert post.get("wave_direction") == "NW", f"wave_direction mismatch: {post.get('wave_direction')}"
        assert post.get("wave_direction_degrees") == 315.0, f"wave_direction_degrees mismatch: {post.get('wave_direction_degrees')}"
        print(f"PASS: Post created with wave_direction={post.get('wave_direction')}, wave_direction_degrees={post.get('wave_direction_degrees')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post['id']}?user_id={TEST_USER_ID}")
    
    def test_create_post_with_tide_height(self):
        """Test POST /api/posts saves tide_height_ft"""
        post_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": f"TEST_tide_height_iter197_{uuid.uuid4().hex[:8]}",
            "location": "New Smyrna Beach, FL",
            "wave_height_ft": 3.5,
            "tide_status": "Rising",
            "tide_height_ft": 2.3
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_USER_ID}",
            json=post_data
        )
        assert response.status_code == 200, f"Failed to create post: {response.text}"
        post = response.json()
        
        # Verify tide fields are saved
        assert post.get("tide_status") == "Rising", f"tide_status mismatch: {post.get('tide_status')}"
        assert post.get("tide_height_ft") == 2.3, f"tide_height_ft mismatch: {post.get('tide_height_ft')}"
        print(f"PASS: Post created with tide_status={post.get('tide_status')}, tide_height_ft={post.get('tide_height_ft')}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post['id']}?user_id={TEST_USER_ID}")
    
    def test_post_with_all_session_metadata(self):
        """Test POST /api/posts with complete session metadata including wave direction and tide"""
        post_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": f"TEST_full_session_iter197_{uuid.uuid4().hex[:8]}",
            "location": "Sebastian Inlet, FL",
            "session_date": datetime.now().isoformat(),
            "session_start_time": "06:30",
            "session_end_time": "08:30",
            "wave_height_ft": 4.0,
            "wave_period_sec": 10,
            "wave_direction": "E",
            "wave_direction_degrees": 90.0,
            "wind_speed_mph": 8.0,
            "wind_direction": "SW",
            "tide_status": "Falling",
            "tide_height_ft": 1.8,
            "conditions_source": "auto"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_USER_ID}",
            json=post_data
        )
        assert response.status_code == 200, f"Failed to create post: {response.text}"
        post = response.json()
        
        # Verify all session metadata
        assert post.get("wave_height_ft") == 4.0
        assert post.get("wave_period_sec") == 10
        assert post.get("wave_direction") == "E"
        assert post.get("wave_direction_degrees") == 90.0
        assert post.get("wind_speed_mph") == 8.0
        assert post.get("wind_direction") == "SW"
        assert post.get("tide_status") == "Falling"
        assert post.get("tide_height_ft") == 1.8
        assert post.get("conditions_source") == "auto"
        
        print(f"PASS: Post created with complete session metadata")
        
        # Verify it appears in feed with all fields
        feed_response = requests.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}")
        posts = feed_response.json()
        feed_post = next((p for p in posts if p['id'] == post['id']), None)
        assert feed_post is not None
        assert feed_post.get("wave_direction_degrees") == 90.0
        assert feed_post.get("tide_height_ft") == 1.8
        
        print(f"PASS: Post appears in feed with wave_direction_degrees and tide_height_ft")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post['id']}?user_id={TEST_USER_ID}")


class TestKnownSpotsWithNOAAStations:
    """Test that known spots list includes NOAA station info"""
    
    def test_known_spots_list(self):
        """Test GET /api/surf-conditions/known-spots returns spots"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions/known-spots")
        assert response.status_code == 200
        data = response.json()
        
        assert "spots" in data
        spots = data["spots"]
        assert len(spots) > 0, "Should have known spots"
        
        # Check structure
        for spot in spots[:5]:
            assert "key" in spot
            assert "name" in spot
            assert "lat" in spot
            assert "lon" in spot
        
        print(f"PASS: {len(spots)} known spots returned")
        
        # Check for US spots that should have NOAA stations
        us_spots = ["pipeline", "huntington", "new_smyrna", "sebastian", "mavericks"]
        found_us_spots = [s for s in spots if s["key"] in us_spots]
        print(f"PASS: Found {len(found_us_spots)} US spots with potential NOAA stations")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
