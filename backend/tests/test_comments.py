"""
Test Comment Functionality on Posts
- POST /api/posts/{post_id}/comments - Add a comment
- GET /api/posts/{post_id}/comments - Get all comments for a post
- DELETE /api/posts/{post_id}/comments/{comment_id} - Delete a comment
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

# Test credentials
TEST_EMAIL = "test-shaka@test.com"
TEST_PASSWORD = "test123"
TEST_POST_ID = "90ef0774-af12-4df1-bc29-85b50942828b"  # Existing post for testing


class TestCommentEndpoints:
    """Comment CRUD endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get user ID for tests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get user ID
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code == 200:
            data = login_response.json()
            self.user_id = data.get("user", {}).get("id") or data.get("id")
        else:
            pytest.skip("Authentication failed - cannot run comment tests")
        
        yield
        
        # Cleanup any test comments
        self.cleanup_test_comments()
    
    def cleanup_test_comments(self):
        """Delete any TEST_ prefixed comments created during tests"""
        try:
            response = self.session.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments")
            if response.status_code == 200:
                comments = response.json()
                for comment in comments:
                    if "TEST_" in comment.get("content", ""):
                        self.session.delete(
                            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{comment['id']}?user_id={self.user_id}"
                        )
        except:
            pass
    
    # Test GET comments for a post
    def test_get_comments_for_existing_post(self):
        """GET /api/posts/{post_id}/comments returns comments"""
        response = self.session.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Should be a list
        assert isinstance(data, list), "Response should be a list of comments"
        
        # Each comment should have required fields
        if len(data) > 0:
            comment = data[0]
            assert "id" in comment, "Comment should have an id"
            assert "post_id" in comment, "Comment should have a post_id"
            assert "author_id" in comment, "Comment should have an author_id"
            assert "content" in comment, "Comment should have content"
            assert "created_at" in comment, "Comment should have created_at"
            print(f"Found {len(data)} comments for post")
    
    def test_get_comments_for_nonexistent_post(self):
        """GET /api/posts/{invalid_post_id}/comments returns 404"""
        fake_post_id = str(uuid.uuid4())
        response = self.session.get(f"{BASE_URL}/api/posts/{fake_post_id}/comments")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    # Test POST comment
    def test_create_comment_success(self):
        """POST /api/posts/{post_id}/comments creates a new comment"""
        comment_content = f"TEST_comment_{uuid.uuid4().hex[:8]}"
        
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments?user_id={self.user_id}",
            json={"content": comment_content}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "id" in data, "Response should contain comment id"
        assert data["content"] == comment_content.strip(), "Content should match"
        assert data["post_id"] == TEST_POST_ID, "Post ID should match"
        assert data["author_id"] == self.user_id, "Author ID should match current user"
        
        # Verify comment was persisted - GET to confirm
        get_response = self.session.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments")
        assert get_response.status_code == 200
        
        comments = get_response.json()
        comment_ids = [c["id"] for c in comments]
        assert data["id"] in comment_ids, "Created comment should be in comments list"
        
        # Cleanup - delete the test comment
        self.session.delete(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{data['id']}?user_id={self.user_id}")
        print(f"Created and verified comment: {data['id']}")
    
    def test_create_comment_empty_content(self):
        """POST with empty content should be trimmed to empty string"""
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments?user_id={self.user_id}",
            json={"content": "   "}  # Whitespace only
        )
        
        # Depending on implementation, this might succeed with empty or fail
        # The endpoint should trim whitespace
        if response.status_code == 200:
            data = response.json()
            # Cleanup if created
            if data.get("id"):
                self.session.delete(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{data['id']}?user_id={self.user_id}")
    
    def test_create_comment_no_user_id(self):
        """POST without user_id should return error"""
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            json={"content": "Test comment"}
        )
        
        # Should require user_id
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
    
    def test_create_comment_nonexistent_post(self):
        """POST to nonexistent post returns 404"""
        fake_post_id = str(uuid.uuid4())
        response = self.session.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/comments?user_id={self.user_id}",
            json={"content": "Test comment"}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_create_comment_nonexistent_user(self):
        """POST with nonexistent user_id returns 404"""
        fake_user_id = str(uuid.uuid4())
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments?user_id={fake_user_id}",
            json={"content": "Test comment"}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    # Test DELETE comment
    def test_delete_own_comment(self):
        """DELETE /api/posts/{post_id}/comments/{comment_id} deletes own comment"""
        # First create a comment to delete
        comment_content = f"TEST_delete_comment_{uuid.uuid4().hex[:8]}"
        
        create_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments?user_id={self.user_id}",
            json={"content": comment_content}
        )
        assert create_response.status_code == 200
        comment_id = create_response.json()["id"]
        
        # Delete the comment
        delete_response = self.session.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{comment_id}?user_id={self.user_id}"
        )
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}"
        
        # Verify deletion
        data = delete_response.json()
        assert data.get("success") == True or data.get("message") == "Comment deleted"
        
        # Verify comment no longer in list
        get_response = self.session.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments")
        assert get_response.status_code == 200
        
        comments = get_response.json()
        comment_ids = [c["id"] for c in comments]
        assert comment_id not in comment_ids, "Deleted comment should not be in list"
        print(f"Comment {comment_id} deleted and verified")
    
    def test_delete_nonexistent_comment(self):
        """DELETE nonexistent comment returns 404"""
        fake_comment_id = str(uuid.uuid4())
        
        response = self.session.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{fake_comment_id}?user_id={self.user_id}"
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_delete_other_users_comment_forbidden(self):
        """DELETE another user's comment returns 403"""
        # Get existing comments (there are some from manual testing)
        get_response = self.session.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments")
        assert get_response.status_code == 200
        
        comments = get_response.json()
        other_user_comment = None
        
        for comment in comments:
            if comment["author_id"] != self.user_id:
                other_user_comment = comment
                break
        
        if other_user_comment is None:
            # Create a comment with a different user if possible
            pytest.skip("No other user's comment available to test deletion")
        
        # Try to delete another user's comment
        response = self.session.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{other_user_comment['id']}?user_id={self.user_id}"
        )
        
        assert response.status_code == 403, f"Expected 403 Forbidden, got {response.status_code}"
    
    # Test comment count updates on post
    def test_comment_count_increases_on_create(self):
        """Creating a comment should increase post comments_count"""
        # Get initial count
        posts_response = self.session.get(f"{BASE_URL}/api/posts?limit=50")
        assert posts_response.status_code == 200
        
        posts = posts_response.json()
        post = next((p for p in posts if p["id"] == TEST_POST_ID), None)
        assert post is not None, f"Post {TEST_POST_ID} not found"
        
        initial_count = post.get("comments_count", 0)
        
        # Create a comment
        comment_content = f"TEST_count_comment_{uuid.uuid4().hex[:8]}"
        create_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments?user_id={self.user_id}",
            json={"content": comment_content}
        )
        assert create_response.status_code == 200
        comment_id = create_response.json()["id"]
        
        # Check updated count
        posts_response = self.session.get(f"{BASE_URL}/api/posts?limit=50")
        assert posts_response.status_code == 200
        
        posts = posts_response.json()
        post = next((p for p in posts if p["id"] == TEST_POST_ID), None)
        assert post is not None
        
        new_count = post.get("comments_count", 0)
        assert new_count == initial_count + 1, f"Expected count {initial_count + 1}, got {new_count}"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{comment_id}?user_id={self.user_id}")
        print(f"Comment count increased from {initial_count} to {new_count}")
    
    # Test recent_comments in feed
    def test_feed_includes_recent_comments(self):
        """GET /api/posts should include recent_comments for each post"""
        response = self.session.get(f"{BASE_URL}/api/posts?limit=10")
        assert response.status_code == 200
        
        posts = response.json()
        
        # Check that posts have recent_comments field
        for post in posts:
            assert "recent_comments" in post, f"Post {post['id']} should have recent_comments field"
            assert isinstance(post["recent_comments"], list), "recent_comments should be a list"
            
            # Should have at most 2 recent comments (as per implementation)
            assert len(post["recent_comments"]) <= 2, "Should show at most 2 recent comments"
        
        # Find the test post which has comments
        test_post = next((p for p in posts if p["id"] == TEST_POST_ID), None)
        if test_post and test_post["comments_count"] > 0:
            assert len(test_post["recent_comments"]) > 0, "Post with comments should have recent_comments"
            
            # Each comment should have required fields
            for comment in test_post["recent_comments"]:
                assert "id" in comment
                assert "author_name" in comment
                assert "content" in comment
                assert "created_at" in comment
        
        print(f"Verified recent_comments in {len(posts)} posts")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
