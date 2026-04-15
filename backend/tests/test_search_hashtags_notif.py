"""
Test Suite for Search, Hashtags, and Notification Preferences APIs
Tests the new features:
1. Global Search API (/api/search/global)
2. Trending Hashtags API (/api/hashtags/trending)
3. Hashtag Posts API (/api/hashtags/{tag}/posts)
4. Notification Preferences with Sound/Vibration/Digest settings
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
TEST_EMAIL = "test@test.com"
TEST_PASSWORD = "test123"


@pytest.fixture(scope="module")
def test_user():
    """Login and get test user data"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        # Use 'id' (profile id) not 'user_id' (auth user id)
        data['profile_id'] = data.get('id')
        return data
    pytest.skip("Could not login test user")


class TestGlobalSearch:
    """Tests for /api/search/global endpoint"""
    
    def test_global_search_returns_categories(self):
        """Global search should return users, spots, posts, hashtags categories"""
        response = requests.get(f"{BASE_URL}/api/search/global", params={"q": "surf", "limit": 5})
        assert response.status_code == 200
        
        data = response.json()
        assert "users" in data
        assert "spots" in data
        assert "posts" in data
        assert "hashtags" in data
        assert isinstance(data["users"], list)
        assert isinstance(data["spots"], list)
        assert isinstance(data["posts"], list)
        assert isinstance(data["hashtags"], list)
    
    def test_global_search_min_query_length(self):
        """Search should require minimum 2 characters"""
        response = requests.get(f"{BASE_URL}/api/search/global", params={"q": "a"})
        # Should return 422 validation error for query too short
        assert response.status_code == 422
    
    def test_global_search_user_results_structure(self):
        """User results should have expected fields"""
        response = requests.get(f"{BASE_URL}/api/search/global", params={"q": "test", "limit": 5})
        assert response.status_code == 200
        
        data = response.json()
        if data["users"]:
            user = data["users"][0]
            assert "id" in user
            assert "full_name" in user
            assert "role" in user
    
    def test_global_search_spot_results_structure(self):
        """Spot results should have expected fields"""
        response = requests.get(f"{BASE_URL}/api/search/global", params={"q": "beach", "limit": 5})
        assert response.status_code == 200
        
        data = response.json()
        if data["spots"]:
            spot = data["spots"][0]
            assert "id" in spot
            assert "name" in spot
            assert "region" in spot


class TestTrendingHashtags:
    """Tests for /api/hashtags/trending endpoint"""
    
    def test_trending_hashtags_returns_list(self):
        """Trending hashtags should return a list"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        assert "hashtags" in data
        assert "period_days" in data
        assert isinstance(data["hashtags"], list)
    
    def test_trending_hashtags_structure(self):
        """Each hashtag should have tag and post_count"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        if data["hashtags"]:
            hashtag = data["hashtags"][0]
            assert "tag" in hashtag
            assert "post_count" in hashtag
    
    def test_trending_hashtags_custom_days(self):
        """Should accept custom days parameter"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 5, "days": 14})
        assert response.status_code == 200
        
        data = response.json()
        assert data["period_days"] == 14


class TestHashtagPosts:
    """Tests for /api/hashtags/{tag}/posts endpoint"""
    
    def test_hashtag_posts_returns_structure(self):
        """Hashtag posts should return expected structure"""
        response = requests.get(f"{BASE_URL}/api/hashtags/surf/posts", params={"limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        assert "tag" in data
        assert "total_posts" in data
        assert "posts" in data
        assert data["tag"] == "surf"
        assert isinstance(data["posts"], list)
    
    def test_hashtag_posts_normalizes_tag(self):
        """Should normalize hashtag (remove # prefix, lowercase)"""
        response = requests.get(f"{BASE_URL}/api/hashtags/%23SURF/posts")
        assert response.status_code == 200
        
        data = response.json()
        assert data["tag"] == "surf"


class TestNotificationPreferences:
    """Tests for notification preferences with new sound/vibration/digest fields"""
    
    def test_get_notification_preferences(self, test_user):
        """Should return notification preferences with all fields"""
        user_id = test_user["profile_id"]
        response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
        assert response.status_code == 200
        
        data = response.json()
        # Check standard fields
        assert "push_messages" in data
        assert "push_reactions" in data
        assert "push_follows" in data
        assert "quiet_hours_enabled" in data
        
        # Check new Sound & Haptics fields
        assert "sound_enabled" in data
        assert "vibration_enabled" in data
        
        # Check new Digest Mode fields
        assert "digest_enabled" in data
        assert "digest_frequency" in data
    
    def test_update_sound_enabled(self, test_user):
        """Should be able to toggle sound_enabled"""
        user_id = test_user["profile_id"]
        
        # Get current value
        get_response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
        current_value = get_response.json().get("sound_enabled", True)
        
        # Toggle it
        new_value = not current_value
        update_response = requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"sound_enabled": new_value}
        )
        assert update_response.status_code == 200
        
        # Verify change
        verify_response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
        assert verify_response.json()["sound_enabled"] == new_value
        
        # Restore original value
        requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"sound_enabled": current_value}
        )
    
    def test_update_vibration_enabled(self, test_user):
        """Should be able to toggle vibration_enabled"""
        user_id = test_user["profile_id"]
        
        update_response = requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"vibration_enabled": False}
        )
        assert update_response.status_code == 200
        
        verify_response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
        assert verify_response.json()["vibration_enabled"] == False
        
        # Restore
        requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"vibration_enabled": True}
        )
    
    def test_update_digest_mode(self, test_user):
        """Should be able to enable digest mode with frequency"""
        user_id = test_user["profile_id"]
        
        # Enable digest mode with weekly frequency
        update_response = requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"digest_enabled": True, "digest_frequency": "weekly"}
        )
        assert update_response.status_code == 200
        
        verify_response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
        data = verify_response.json()
        assert data["digest_enabled"] == True
        assert data["digest_frequency"] == "weekly"
        
        # Restore defaults
        requests.put(
            f"{BASE_URL}/api/notifications/preferences/{user_id}",
            json={"digest_enabled": False, "digest_frequency": "daily"}
        )
    
    def test_digest_frequency_values(self, test_user):
        """Should accept hourly, daily, weekly frequencies"""
        user_id = test_user["profile_id"]
        
        for freq in ["hourly", "daily", "weekly"]:
            update_response = requests.put(
                f"{BASE_URL}/api/notifications/preferences/{user_id}",
                json={"digest_frequency": freq}
            )
            assert update_response.status_code == 200
            
            verify_response = requests.get(f"{BASE_URL}/api/notifications/preferences/{user_id}")
            assert verify_response.json()["digest_frequency"] == freq


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
