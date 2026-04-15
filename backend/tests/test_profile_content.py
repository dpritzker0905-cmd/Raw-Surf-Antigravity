"""
Test Profile Content Endpoints - Instagram-style profile tabs
Tests: Posts, Session Shots, Videos, Saved Posts, Tagged Media, Stats
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user - will be created/retrieved for testing
TEST_USER_EMAIL = "TEST_profile_content@example.com"
TEST_USER_PASSWORD = "TestPass123!"
TEST_USER_NAME = "Profile Content Test User"

class TestProfileContentSetup:
    """Setup test user and get auth token"""
    
    @pytest.fixture(scope="class")
    def test_user(self, request):
        """Create or get test user for profile content tests"""
        # Try to login first
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code == 200:
            return login_resp.json()
        
        # Create new user if login fails
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD,
            "full_name": TEST_USER_NAME,
            "role": "Surfer"
        })
        
        if signup_resp.status_code in [200, 201]:
            return signup_resp.json()
        
        pytest.skip(f"Could not create/login test user: {signup_resp.text}")


class TestProfileStats:
    """Test GET /api/profile/{user_id}/stats - returns all profile content counts"""
    
    def test_profile_stats_endpoint_exists(self):
        """Verify stats endpoint returns properly structured response"""
        # First get a user
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            # Create user if needed
            signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
                "email": TEST_USER_EMAIL,
                "password": TEST_USER_PASSWORD,
                "full_name": TEST_USER_NAME,
                "role": "Surfer"
            })
            assert signup_resp.status_code in [200, 201], f"Failed to create user: {signup_resp.text}"
            user_data = signup_resp.json()
        else:
            user_data = login_resp.json()
        
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        assert user_id, "No user ID found"
        
        # Test stats endpoint
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/stats")
        assert response.status_code == 200, f"Stats endpoint failed: {response.status_code} - {response.text}"
        
        data = response.json()
        # Validate all required fields exist
        assert "posts" in data, "Missing 'posts' count in stats"
        assert "videos" in data, "Missing 'videos' count in stats"
        assert "session_shots" in data, "Missing 'session_shots' count in stats"
        assert "saved" in data, "Missing 'saved' count in stats"
        assert "tagged" in data, "Missing 'tagged' count in stats"
        
        # All counts should be non-negative integers
        assert isinstance(data["posts"], int) and data["posts"] >= 0
        assert isinstance(data["videos"], int) and data["videos"] >= 0
        assert isinstance(data["session_shots"], int) and data["session_shots"] >= 0
        assert isinstance(data["saved"], int) and data["saved"] >= 0
        assert isinstance(data["tagged"], int) and data["tagged"] >= 0
        
        print(f"Stats endpoint working: {data}")


class TestProfilePosts:
    """Test GET /api/profile/{user_id}/posts - returns user's posts for grid"""
    
    def test_profile_posts_endpoint(self):
        """Test posts endpoint returns user's posts"""
        # Get user
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/posts")
        assert response.status_code == 200, f"Posts endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Posts should return a list"
        
        # If posts exist, validate structure
        if len(data) > 0:
            post = data[0]
            assert "id" in post, "Post missing 'id'"
            assert "media_url" in post, "Post missing 'media_url'"
            assert "media_type" in post, "Post missing 'media_type'"
        
        print(f"Profile posts endpoint working, found {len(data)} posts")


class TestProfileVideos:
    """Test GET /api/profile/{user_id}/videos - returns only video posts"""
    
    def test_profile_videos_endpoint(self):
        """Test videos endpoint returns video-only posts"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/videos")
        assert response.status_code == 200, f"Videos endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Videos should return a list"
        
        print(f"Profile videos endpoint working, found {len(data)} videos")


class TestProfileSessionShots:
    """Test GET /api/profile/{user_id}/session-shots - returns photographer transfers"""
    
    def test_profile_session_shots_endpoint(self):
        """Test session-shots endpoint returns photographer transfers"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/session-shots")
        assert response.status_code == 200, f"Session shots endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Session shots should return a list"
        
        # If items exist, validate structure
        if len(data) > 0:
            item = data[0]
            assert "id" in item, "Session shot missing 'id'"
            assert "media_url" in item, "Session shot missing 'media_url'"
        
        print(f"Profile session-shots endpoint working, found {len(data)} items")


class TestProfileSaved:
    """Test GET /api/profile/{user_id}/saved - returns saved posts"""
    
    def test_profile_saved_endpoint(self):
        """Test saved endpoint returns bookmarked posts"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/saved")
        assert response.status_code == 200, f"Saved endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Saved should return a list"
        
        print(f"Profile saved endpoint working, found {len(data)} saved posts")


class TestProfileTagged:
    """Test GET /api/profile/{user_id}/tagged - returns tagged media"""
    
    def test_profile_tagged_endpoint(self):
        """Test tagged endpoint returns media where user is tagged"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.get(f"{BASE_URL}/api/profile/{user_id}/tagged")
        assert response.status_code == 200, f"Tagged endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Tagged should return a list"
        
        print(f"Profile tagged endpoint working, found {len(data)} tagged items")


class TestSavePostFunctionality:
    """Test POST/DELETE/GET /api/posts/{post_id}/save - save/unsave/check saved"""
    
    def get_user_and_post(self):
        """Helper to get user and a valid post"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            return None, None
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        # Get posts from feed
        posts_resp = requests.get(f"{BASE_URL}/api/posts")
        if posts_resp.status_code != 200:
            return user_id, None
        
        posts = posts_resp.json()
        if len(posts) == 0:
            return user_id, None
        
        return user_id, posts[0].get('id')
    
    def test_check_if_saved_endpoint(self):
        """Test GET /api/posts/{post_id}/is-saved endpoint"""
        user_id, post_id = self.get_user_and_post()
        
        if not user_id or not post_id:
            pytest.skip("No user or posts available for testing")
        
        response = requests.get(f"{BASE_URL}/api/posts/{post_id}/is-saved", params={"user_id": user_id})
        assert response.status_code == 200, f"Is-saved check failed: {response.text}"
        
        data = response.json()
        assert "is_saved" in data, "Response missing 'is_saved' field"
        assert isinstance(data["is_saved"], bool), "is_saved should be boolean"
        
        print(f"Check is-saved endpoint working: is_saved={data['is_saved']}")
    
    def test_save_post_endpoint(self):
        """Test POST /api/posts/{post_id}/save - save a post"""
        user_id, post_id = self.get_user_and_post()
        
        if not user_id or not post_id:
            pytest.skip("No user or posts available for testing")
        
        # First unsave to ensure clean state (ignore errors)
        requests.delete(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Now save the post
        response = requests.post(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Could be 200 (success) or 400 (already saved)
        if response.status_code == 200:
            data = response.json()
            assert "message" in data, "Save response missing 'message'"
            print(f"Save post endpoint working: {data}")
        elif response.status_code == 400:
            # Already saved is acceptable
            print("Post already saved (expected if test ran before)")
        else:
            pytest.fail(f"Save post failed unexpectedly: {response.status_code} - {response.text}")
    
    def test_unsave_post_endpoint(self):
        """Test DELETE /api/posts/{post_id}/save - unsave a post"""
        user_id, post_id = self.get_user_and_post()
        
        if not user_id or not post_id:
            pytest.skip("No user or posts available for testing")
        
        # First ensure post is saved
        requests.post(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Now unsave
        response = requests.delete(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Could be 200 (success) or 404 (not saved)
        if response.status_code == 200:
            data = response.json()
            assert "message" in data, "Unsave response missing 'message'"
            print(f"Unsave post endpoint working: {data}")
        elif response.status_code == 404:
            print("Post not saved (expected if test order changed)")
        else:
            pytest.fail(f"Unsave post failed unexpectedly: {response.status_code} - {response.text}")
    
    def test_save_and_verify_in_saved_list(self):
        """Test that saving a post makes it appear in saved list"""
        user_id, post_id = self.get_user_and_post()
        
        if not user_id or not post_id:
            pytest.skip("No user or posts available for testing")
        
        # Unsave first to ensure clean state
        requests.delete(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Save the post
        save_resp = requests.post(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        # Verify it appears in saved list
        saved_resp = requests.get(f"{BASE_URL}/api/profile/{user_id}/saved")
        assert saved_resp.status_code == 200, f"Saved list fetch failed: {saved_resp.text}"
        
        saved_posts = saved_resp.json()
        saved_post_ids = [s.get('post', {}).get('id') for s in saved_posts]
        
        # Check if our post is in the saved list
        assert post_id in saved_post_ids, f"Saved post {post_id} not found in saved list"
        
        # Cleanup - unsave
        requests.delete(f"{BASE_URL}/api/posts/{post_id}/save", params={"user_id": user_id})
        
        print(f"Save->Verify flow working, post {post_id} appeared in saved list")


class TestTagUserInPost:
    """Test POST /api/posts/{post_id}/tag - tag user in post"""
    
    def test_tag_user_endpoint(self):
        """Test tagging a user in a post"""
        # Login test user
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        # Get a post
        posts_resp = requests.get(f"{BASE_URL}/api/posts")
        if posts_resp.status_code != 200 or len(posts_resp.json()) == 0:
            pytest.skip("No posts available for tagging test")
        
        post_id = posts_resp.json()[0].get('id')
        
        # Try to tag self (should work)
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/tag",
            params={
                "tagged_user_id": user_id,
                "tagged_by_id": user_id
            }
        )
        
        # Could be 200 (success) or 400 (already tagged)
        if response.status_code == 200:
            data = response.json()
            assert "message" in data, "Tag response missing 'message'"
            print(f"Tag user endpoint working: {data}")
        elif response.status_code == 400:
            # Already tagged is acceptable
            print("User already tagged in post (expected if test ran before)")
        else:
            pytest.fail(f"Tag user failed unexpectedly: {response.status_code} - {response.text}")


class TestPaginationSupport:
    """Test pagination parameters work correctly"""
    
    def test_posts_pagination(self):
        """Test limit and offset work for posts endpoint"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        # Test with limit
        response = requests.get(
            f"{BASE_URL}/api/profile/{user_id}/posts",
            params={"limit": 5, "offset": 0}
        )
        assert response.status_code == 200, f"Pagination test failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        assert len(data) <= 5, "Limit should be respected"
        
        print(f"Pagination working, returned {len(data)} posts with limit=5")


class TestErrorHandling:
    """Test error handling for profile content endpoints"""
    
    def test_nonexistent_user_stats(self):
        """Test stats endpoint with invalid user ID"""
        response = requests.get(f"{BASE_URL}/api/profile/nonexistent-user-id-12345/stats")
        # Should return 200 with zero counts or 404
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            # All counts should be 0 for nonexistent user
            assert data.get("posts", 0) == 0
        
        print(f"Nonexistent user stats handled correctly: {response.status_code}")
    
    def test_save_nonexistent_post(self):
        """Test saving a nonexistent post"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_resp.status_code != 200:
            pytest.skip("Test user not available")
        
        user_data = login_resp.json()
        user_id = user_data.get('user', {}).get('id') or user_data.get('id')
        
        response = requests.post(
            f"{BASE_URL}/api/posts/nonexistent-post-id-12345/save",
            params={"user_id": user_id}
        )
        
        assert response.status_code == 404, f"Expected 404 for nonexistent post, got {response.status_code}"
        print("Nonexistent post save handled correctly with 404")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
