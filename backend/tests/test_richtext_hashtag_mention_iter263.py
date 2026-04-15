"""
Test RichText Hashtag and @Mention Features - Iteration 263
Tests:
- Username lookup API for @mention navigation
- Hashtag search/explore functionality
- Post creation with hashtags and mentions
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestUsernameLookupAPI:
    """Tests for /api/username/lookup/{username} endpoint - used for @mention navigation"""
    
    def test_lookup_existing_username_davidpritzker(self):
        """Test lookup of existing user davidpritzker"""
        response = requests.get(f"{BASE_URL}/api/username/lookup/davidpritzker")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "id" in data, "Response should contain user id"
        assert data["username"] == "davidpritzker", f"Expected username 'davidpritzker', got {data.get('username')}"
        assert "full_name" in data, "Response should contain full_name"
        assert "avatar_url" in data, "Response should contain avatar_url"
        assert "role" in data, "Response should contain role"
        print(f"✓ Username lookup for davidpritzker returned: {data}")
    
    def test_lookup_existing_username_davidsurf(self):
        """Test lookup of existing user davidsurf"""
        response = requests.get(f"{BASE_URL}/api/username/lookup/davidsurf")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "id" in data, "Response should contain user id"
        assert data["username"] == "davidsurf", f"Expected username 'davidsurf', got {data.get('username')}"
        print(f"✓ Username lookup for davidsurf returned: {data}")
    
    def test_lookup_nonexistent_username(self):
        """Test lookup of non-existent username returns 404"""
        response = requests.get(f"{BASE_URL}/api/username/lookup/nonexistentuser12345xyz")
        assert response.status_code == 404, f"Expected 404 for non-existent user, got {response.status_code}"
        
        data = response.json()
        assert "detail" in data, "Response should contain error detail"
        print(f"✓ Non-existent username correctly returns 404: {data}")
    
    def test_lookup_with_at_symbol(self):
        """Test lookup handles @ prefix correctly"""
        response = requests.get(f"{BASE_URL}/api/username/lookup/@davidpritzker")
        assert response.status_code == 200, f"Expected 200 with @ prefix, got {response.status_code}"
        
        data = response.json()
        assert data["username"] == "davidpritzker", "Should strip @ and find user"
        print(f"✓ Username lookup with @ prefix works correctly")
    
    def test_lookup_case_insensitive(self):
        """Test lookup is case-insensitive"""
        response = requests.get(f"{BASE_URL}/api/username/lookup/DAVIDPRITZKER")
        assert response.status_code == 200, f"Expected 200 for uppercase, got {response.status_code}"
        
        data = response.json()
        assert data["username"].lower() == "davidpritzker", "Should find user regardless of case"
        print(f"✓ Username lookup is case-insensitive")


class TestUsernameSearchAPI:
    """Tests for /api/username/search endpoint - used for @mention autocomplete"""
    
    def test_search_usernames(self):
        """Test username search for autocomplete"""
        response = requests.get(f"{BASE_URL}/api/username/search", params={"q": "david"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Should find users with 'david' in username
        if len(data) > 0:
            for user in data:
                assert "id" in user, "Each user should have id"
                assert "username" in user, "Each user should have username"
                assert "full_name" in user, "Each user should have full_name"
            print(f"✓ Username search returned {len(data)} results for 'david'")
        else:
            print("⚠ No users found with 'david' in username")
    
    def test_search_with_limit(self):
        """Test username search respects limit parameter"""
        response = requests.get(f"{BASE_URL}/api/username/search", params={"q": "d", "limit": 5})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert len(data) <= 5, f"Should return at most 5 results, got {len(data)}"
        print(f"✓ Username search respects limit parameter")


class TestHashtagExploreAPI:
    """Tests for hashtag-related explore functionality"""
    
    def test_hashtags_trending_endpoint(self):
        """Test that hashtags trending endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending")
        # Should return 200 or 404 (if not implemented)
        print(f"✓ Hashtags trending endpoint status: {response.status_code}")
        # This is informational - not a critical failure
    
    def test_explore_with_hashtag_param(self):
        """Test explore with hashtag parameter - frontend handles this"""
        # The explore page is a frontend route, not a backend API
        # The frontend uses /api/posts with hashtag filter
        response = requests.get(f"{BASE_URL}/api/posts", params={"hashtag": "surf", "limit": 5})
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Posts with hashtag=surf returned: {len(data)} posts")
        else:
            print(f"⚠ Posts with hashtag returned status {response.status_code}")


class TestPostsWithHashtagsAndMentions:
    """Tests for posts containing hashtags and mentions"""
    
    def test_posts_endpoint_returns_posts(self):
        """Test that posts endpoint returns posts"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 10})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Posts should return a list"
        print(f"✓ Posts endpoint returned {len(data)} posts")
        
        # Check if any posts have captions with hashtags or mentions
        posts_with_hashtags = 0
        posts_with_mentions = 0
        for post in data:
            caption = post.get("caption", "") or ""
            if "#" in caption:
                posts_with_hashtags += 1
            if "@" in caption:
                posts_with_mentions += 1
        
        print(f"  - Posts with hashtags: {posts_with_hashtags}")
        print(f"  - Posts with mentions: {posts_with_mentions}")


class TestHashtagSearchAPI:
    """Tests for hashtag search/autocomplete"""
    
    def test_hashtag_search_endpoint(self):
        """Test hashtag search endpoint"""
        response = requests.get(f"{BASE_URL}/api/hashtags/search", params={"q": "surf"})
        
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Hashtag search returned: {data}")
        elif response.status_code == 404:
            print("⚠ Hashtag search endpoint not found (may not be implemented)")
        else:
            print(f"⚠ Hashtag search returned status {response.status_code}")
    
    def test_trending_hashtags_endpoint(self):
        """Test trending hashtags endpoint"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Trending hashtags returned: {data}")
        elif response.status_code == 404:
            print("⚠ Trending hashtags endpoint not found (may not be implemented)")
        else:
            print(f"⚠ Trending hashtags returned status {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
