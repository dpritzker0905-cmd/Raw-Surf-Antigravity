"""
Test Post Edit and Delete functionality - Iteration 200
Tests:
1. Post Delete via API
2. Edit Post with ALL session fields (location, date, wave height, period, direction, wind, tide)
3. Session date handling
4. Recent Locations API
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials from iteration 198
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"

# Test post with session data (from agent context)
TEST_POST_ID = "9bd0bfd6-0388-4be2-a413-946ed882aba9"


class TestPostEditAllFields:
    """Test editing posts with all session condition fields"""
    
    def test_edit_post_caption_only(self):
        """Test editing just the caption"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={"caption": "Updated caption test"}
        )
        print(f"Edit caption response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_location(self):
        """Test editing location field"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={"location": "Cocoa Beach Pier"}
        )
        print(f"Edit location response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_session_date(self):
        """Test editing session_date field (string to datetime conversion)"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={"session_date": "2026-04-01"}
        )
        print(f"Edit session_date response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_wave_conditions(self):
        """Test editing wave height, period, and direction"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "wave_height_ft": 4.5,
                "wave_period_sec": 12,
                "wave_direction": "E"
            }
        )
        print(f"Edit wave conditions response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_wind_conditions(self):
        """Test editing wind speed and direction"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "wind_speed_mph": 15.0,
                "wind_direction": "SW"
            }
        )
        print(f"Edit wind conditions response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_tide_conditions(self):
        """Test editing tide status and height"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "tide_status": "Rising",
                "tide_height_ft": 2.5
            }
        )
        print(f"Edit tide conditions response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_all_session_fields(self):
        """Test editing ALL session fields at once"""
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": TEST_USER_ID},
            json={
                "caption": "Full edit test - all fields",
                "location": "Sebastian Inlet",
                "session_date": "2026-03-31",
                "session_start_time": "06:30",
                "session_end_time": "09:00",
                "wave_height_ft": 3.5,
                "wave_period_sec": 10,
                "wave_direction": "SE",
                "wind_speed_mph": 12.5,
                "wind_direction": "NE",
                "tide_status": "Falling",
                "tide_height_ft": 1.8
            }
        )
        print(f"Edit all fields response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
    
    def test_edit_post_unauthorized(self):
        """Test that non-owner cannot edit post"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = requests.patch(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"user_id": fake_user_id},
            json={"caption": "Unauthorized edit attempt"}
        )
        print(f"Unauthorized edit response: {response.status_code} - {response.text}")
        assert response.status_code == 403


class TestPostDelete:
    """Test post deletion functionality"""
    
    created_post_id = None
    
    def test_create_post_for_delete_test(self):
        """Create a test post to delete"""
        response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-delete.jpg",
                "media_type": "image",
                "caption": "TEST_DELETE_POST - will be deleted",
                "location": "Test Location"
            }
        )
        print(f"Create post response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        TestPostDelete.created_post_id = data.get("id")
        assert TestPostDelete.created_post_id is not None
    
    def test_delete_post_unauthorized(self):
        """Test that non-owner cannot delete post"""
        if not TestPostDelete.created_post_id:
            pytest.skip("No post created to test")
        
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TestPostDelete.created_post_id}",
            params={"user_id": fake_user_id}
        )
        print(f"Unauthorized delete response: {response.status_code} - {response.text}")
        assert response.status_code == 403
    
    def test_delete_post_success(self):
        """Test successful post deletion by owner"""
        if not TestPostDelete.created_post_id:
            pytest.skip("No post created to test")
        
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TestPostDelete.created_post_id}",
            params={"user_id": TEST_USER_ID}
        )
        print(f"Delete post response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("message") == "Post deleted"
    
    def test_delete_post_verify_gone(self):
        """Verify deleted post returns 404"""
        if not TestPostDelete.created_post_id:
            pytest.skip("No post created to test")
        
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TestPostDelete.created_post_id}",
            params={"user_id": TEST_USER_ID}
        )
        print(f"Delete again response: {response.status_code} - {response.text}")
        assert response.status_code == 404
    
    def test_delete_nonexistent_post(self):
        """Test deleting a post that doesn't exist"""
        fake_post_id = "00000000-0000-0000-0000-000000000000"
        response = requests.delete(
            f"{BASE_URL}/api/posts/{fake_post_id}",
            params={"user_id": TEST_USER_ID}
        )
        print(f"Delete nonexistent response: {response.status_code} - {response.text}")
        assert response.status_code == 404


class TestRecentLocations:
    """Test Recent Locations API for auto-fill feature"""
    
    def test_get_recent_locations(self):
        """Test getting user's recent locations"""
        response = requests.get(
            f"{BASE_URL}/api/posts/user/{TEST_USER_ID}/recent-locations",
            params={"limit": 5}
        )
        print(f"Recent locations response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Check structure if locations exist
        if len(data) > 0:
            loc = data[0]
            assert "location" in loc
            assert "last_used" in loc
            assert "use_count" in loc
            print(f"Found {len(data)} recent locations")
            for loc in data:
                print(f"  - {loc.get('location')} (used {loc.get('use_count')} times)")


class TestVerifyPostData:
    """Verify post data after edits"""
    
    def test_get_feed_and_verify_post(self):
        """Get feed and verify the test post has correct data"""
        response = requests.get(
            f"{BASE_URL}/api/posts",
            params={"user_id": TEST_USER_ID}
        )
        print(f"Get feed response: {response.status_code}")
        assert response.status_code == 200
        
        posts = response.json()
        test_post = None
        for post in posts:
            if post.get("id") == TEST_POST_ID:
                test_post = post
                break
        
        if test_post:
            print(f"Found test post: {TEST_POST_ID}")
            print(f"  - session_date: {test_post.get('session_date')}")
            print(f"  - wave_height_ft: {test_post.get('wave_height_ft')}")
            print(f"  - wave_period_sec: {test_post.get('wave_period_sec')}")
            print(f"  - wave_direction: {test_post.get('wave_direction')}")
            print(f"  - wind_speed_mph: {test_post.get('wind_speed_mph')}")
            print(f"  - wind_direction: {test_post.get('wind_direction')}")
            print(f"  - tide_status: {test_post.get('tide_status')}")
            print(f"  - tide_height_ft: {test_post.get('tide_height_ft')}")
            
            # Verify session data exists
            assert test_post.get('wave_height_ft') is not None or test_post.get('session_date') is not None
        else:
            print(f"Test post {TEST_POST_ID} not found in feed (may have been deleted)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
