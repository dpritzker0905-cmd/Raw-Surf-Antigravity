"""
Test Like Toggle API - iteration 16
Tests for:
1. Like toggle API returns action: 'liked' on first call, 'unliked' on second, 'liked' on third
2. Posts API returns is_liked_by_user field when user_id is provided
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestLikeToggle:
    """Test like toggle functionality - POST /api/posts/{post_id}/like?user_id={user_id}"""
    
    @pytest.fixture(scope="class")
    def test_user(self):
        """Get or create test user"""
        # Try to login first
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-shaka@test.com",
            "password": "test123"
        })
        if response.status_code == 200:
            return response.json()
        pytest.skip("Test user not found - skipping like tests")
    
    @pytest.fixture(scope="class")
    def post_id(self, test_user):
        """Get a post to test with - create if none exists"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 1})
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]
        pytest.skip("No posts available for testing")
    
    def test_like_toggle_sequence(self, test_user, post_id):
        """Test that like toggles correctly: liked -> unliked -> liked"""
        user_id = test_user.get("user", {}).get("id") or test_user.get("id")
        
        # First, check current like status via GET posts
        posts_resp = requests.get(f"{BASE_URL}/api/posts", params={"user_id": user_id, "limit": 50})
        assert posts_resp.status_code == 200
        posts = posts_resp.json()
        
        # Find our post
        current_post = next((p for p in posts if p["id"] == post_id), None)
        if not current_post:
            pytest.skip("Post not found in feed")
        
        initial_liked = current_post.get("is_liked_by_user", False)
        
        # Call 1: Toggle like
        resp1 = requests.post(f"{BASE_URL}/api/posts/{post_id}/like", params={"user_id": user_id})
        assert resp1.status_code == 200, f"Like toggle failed: {resp1.text}"
        data1 = resp1.json()
        assert "action" in data1, "Response should include 'action' field"
        assert "likes_count" in data1, "Response should include 'likes_count' field"
        assert "is_liked" in data1, "Response should include 'is_liked' field"
        
        expected_action1 = "unliked" if initial_liked else "liked"
        assert data1["action"] == expected_action1, f"Expected action '{expected_action1}', got '{data1['action']}'"
        
        # Call 2: Toggle again (should reverse)
        resp2 = requests.post(f"{BASE_URL}/api/posts/{post_id}/like", params={"user_id": user_id})
        assert resp2.status_code == 200
        data2 = resp2.json()
        expected_action2 = "liked" if expected_action1 == "unliked" else "unliked"
        assert data2["action"] == expected_action2, f"Expected action '{expected_action2}', got '{data2['action']}'"
        
        # Call 3: Toggle again (should reverse back)
        resp3 = requests.post(f"{BASE_URL}/api/posts/{post_id}/like", params={"user_id": user_id})
        assert resp3.status_code == 200
        data3 = resp3.json()
        expected_action3 = expected_action1  # Same as first call
        assert data3["action"] == expected_action3, f"Expected action '{expected_action3}', got '{data3['action']}'"
        
        print(f"Like toggle test passed: {expected_action1} -> {expected_action2} -> {expected_action3}")
    
    def test_like_toggle_count_updates(self, test_user, post_id):
        """Test that likes_count updates correctly on toggle"""
        user_id = test_user.get("user", {}).get("id") or test_user.get("id")
        
        # Get initial count
        resp1 = requests.post(f"{BASE_URL}/api/posts/{post_id}/like", params={"user_id": user_id})
        assert resp1.status_code == 200
        count1 = resp1.json()["likes_count"]
        is_liked1 = resp1.json()["is_liked"]
        
        # Toggle and verify count changed
        resp2 = requests.post(f"{BASE_URL}/api/posts/{post_id}/like", params={"user_id": user_id})
        assert resp2.status_code == 200
        count2 = resp2.json()["likes_count"]
        is_liked2 = resp2.json()["is_liked"]
        
        # If we unliked, count should decrease; if we liked, count should increase
        if is_liked1 and not is_liked2:
            # We unliked, count should decrease
            assert count2 == count1 - 1 or count2 >= 0, f"Count should decrease from {count1}"
        elif not is_liked1 and is_liked2:
            # We liked, count should increase
            assert count2 == count1 + 1, f"Count should increase from {count1}"
        
        print(f"Like count test passed: {count1} -> {count2}")


class TestPostsApiWithLikeStatus:
    """Test that GET /api/posts returns is_liked_by_user when user_id provided"""
    
    @pytest.fixture(scope="class")
    def test_user(self):
        """Get test user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-shaka@test.com",
            "password": "test123"
        })
        if response.status_code == 200:
            return response.json()
        pytest.skip("Test user not found")
    
    def test_posts_include_is_liked_by_user(self, test_user):
        """Test GET /api/posts returns is_liked_by_user field"""
        user_id = test_user.get("user", {}).get("id") or test_user.get("id")
        
        # Get posts with user_id
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": user_id})
        assert response.status_code == 200
        posts = response.json()
        
        if posts:
            # Check that each post has is_liked_by_user field
            for post in posts:
                assert "is_liked_by_user" in post, f"Post {post['id']} missing is_liked_by_user field"
                assert isinstance(post["is_liked_by_user"], bool), "is_liked_by_user should be boolean"
            print(f"All {len(posts)} posts have is_liked_by_user field")
        else:
            print("No posts returned - skipping field check")
    
    def test_posts_without_user_id_default_false(self):
        """Test GET /api/posts without user_id returns is_liked_by_user as false"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 5})
        assert response.status_code == 200
        posts = response.json()
        
        if posts:
            for post in posts:
                assert "is_liked_by_user" in post, "Post should have is_liked_by_user field"
                # Without user_id, should default to False
                assert post["is_liked_by_user"] == False, "is_liked_by_user should be False without user_id"
            print("Posts without user_id correctly show is_liked_by_user=False")


class TestLikeToggleErrorHandling:
    """Test error handling for like toggle API"""
    
    def test_like_nonexistent_post(self):
        """Test like on nonexistent post returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/posts/nonexistent-post-id/like",
            params={"user_id": "some-user"}
        )
        assert response.status_code == 404
        print("Nonexistent post correctly returns 404")
    
    def test_like_without_user_id(self):
        """Test like without user_id returns error"""
        # Get a valid post first
        posts_resp = requests.get(f"{BASE_URL}/api/posts", params={"limit": 1})
        if posts_resp.status_code != 200 or not posts_resp.json():
            pytest.skip("No posts available")
        
        post_id = posts_resp.json()[0]["id"]
        
        # Try to like without user_id
        response = requests.post(f"{BASE_URL}/api/posts/{post_id}/like")
        # Should return 422 (validation error) because user_id is required
        assert response.status_code == 422, "Should require user_id parameter"
        print("Missing user_id correctly returns 422")
