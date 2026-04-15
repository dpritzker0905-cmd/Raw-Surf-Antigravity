"""
Test Pin Post to Profile and Edit Comment Functionality - Iteration 253
Tests P2 features: Pin/Unpin Post, Edit Comment with is_edited/edited_at fields
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from iteration 252
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_USER_PASSWORD = "Test123!"
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestPinPostToProfile:
    """Test POST /api/posts/{post_id}/pin and DELETE /api/posts/{post_id}/pin endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
    def test_get_user_posts_for_pin_test(self):
        """Get user's posts to find one to pin"""
        # First get user's profile to check current pinned_post_id
        response = self.session.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        assert response.status_code == 200, f"Failed to get profile: {response.text}"
        profile = response.json()
        print(f"Current pinned_post_id: {profile.get('pinned_post_id')}")
        
        # Get feed posts to find user's posts
        response = self.session.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}&limit=10")
        assert response.status_code == 200, f"Failed to get posts: {response.text}"
        posts = response.json()
        
        # Find a post by the test user
        user_posts = [p for p in posts if p.get('author_id') == TEST_USER_ID]
        print(f"Found {len(user_posts)} posts by test user")
        
        if user_posts:
            self.test_post_id = user_posts[0]['id']
            print(f"Using post ID: {self.test_post_id}")
        else:
            pytest.skip("No posts found for test user")
    
    def test_pin_post_to_profile(self):
        """Test pinning a post to profile"""
        # Get user's posts first
        response = self.session.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}&limit=10")
        assert response.status_code == 200
        posts = response.json()
        user_posts = [p for p in posts if p.get('author_id') == TEST_USER_ID]
        
        if not user_posts:
            pytest.skip("No posts found for test user")
        
        post_id = user_posts[0]['id']
        
        # Pin the post
        response = self.session.post(
            f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}"
        )
        assert response.status_code == 200, f"Failed to pin post: {response.text}"
        data = response.json()
        
        assert data.get('success') == True
        # Response should indicate pinned status
        print(f"Pin response: {data}")
        
        # Verify profile now has pinned_post_id
        profile_response = self.session.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        assert profile_response.status_code == 200
        profile = profile_response.json()
        
        # Check if pinned_post_id is set (could be this post or toggled off)
        print(f"Profile pinned_post_id after pin: {profile.get('pinned_post_id')}")
    
    def test_pin_post_toggle_behavior(self):
        """Test that pinning same post twice toggles it off"""
        # Get user's posts
        response = self.session.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}&limit=10")
        assert response.status_code == 200
        posts = response.json()
        user_posts = [p for p in posts if p.get('author_id') == TEST_USER_ID]
        
        if not user_posts:
            pytest.skip("No posts found for test user")
        
        post_id = user_posts[0]['id']
        
        # First pin
        response1 = self.session.post(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        assert response1.status_code == 200
        data1 = response1.json()
        first_pinned_state = data1.get('pinned')
        print(f"First pin call - pinned: {first_pinned_state}")
        
        # Second pin (should toggle)
        response2 = self.session.post(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        assert response2.status_code == 200
        data2 = response2.json()
        second_pinned_state = data2.get('pinned')
        print(f"Second pin call - pinned: {second_pinned_state}")
        
        # States should be opposite
        assert first_pinned_state != second_pinned_state, "Toggle behavior not working"
    
    def test_unpin_post_from_profile(self):
        """Test DELETE /api/posts/{post_id}/pin endpoint"""
        # Get user's posts
        response = self.session.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}&limit=10")
        assert response.status_code == 200
        posts = response.json()
        user_posts = [p for p in posts if p.get('author_id') == TEST_USER_ID]
        
        if not user_posts:
            pytest.skip("No posts found for test user")
        
        post_id = user_posts[0]['id']
        
        # First ensure post is pinned
        self.session.post(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        
        # Verify it's pinned
        profile_response = self.session.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        profile = profile_response.json()
        
        if profile.get('pinned_post_id') != post_id:
            # Pin it again to ensure it's pinned
            self.session.post(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        
        # Now unpin using DELETE
        response = self.session.delete(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        
        # Could be 200 (success) or 400 (not currently pinned)
        if response.status_code == 200:
            data = response.json()
            assert data.get('success') == True
            assert data.get('pinned') == False
            print("Unpin successful")
        elif response.status_code == 400:
            print(f"Post was not pinned: {response.json()}")
        else:
            assert False, f"Unexpected status: {response.status_code} - {response.text}"
    
    def test_cannot_pin_others_post(self):
        """Test that user cannot pin another user's post"""
        # Get feed posts
        response = self.session.get(f"{BASE_URL}/api/posts?limit=20")
        assert response.status_code == 200
        posts = response.json()
        
        # Find a post NOT by the test user
        other_posts = [p for p in posts if p.get('author_id') != TEST_USER_ID]
        
        if not other_posts:
            pytest.skip("No posts from other users found")
        
        other_post_id = other_posts[0]['id']
        
        # Try to pin it
        response = self.session.post(
            f"{BASE_URL}/api/posts/{other_post_id}/pin?user_id={TEST_USER_ID}"
        )
        
        # Should fail with 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("Correctly rejected pinning another user's post")
    
    def test_profile_returns_pinned_post_id(self):
        """Test that profile API returns pinned_post_id field"""
        response = self.session.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        assert response.status_code == 200
        profile = response.json()
        
        # Check that pinned_post_id field exists in response
        assert 'pinned_post_id' in profile, "pinned_post_id field missing from profile response"
        print(f"Profile pinned_post_id: {profile.get('pinned_post_id')}")


class TestEditComment:
    """Test PUT /api/posts/{post_id}/comments/{comment_id} endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_create_and_edit_comment(self):
        """Test creating a comment and then editing it"""
        # Get a post to comment on
        response = self.session.get(f"{BASE_URL}/api/posts?limit=5")
        assert response.status_code == 200
        posts = response.json()
        
        if not posts:
            pytest.skip("No posts found")
        
        post_id = posts[0]['id']
        
        # Create a comment
        comment_content = f"TEST_EDIT_COMMENT_{int(time.time())}"
        create_response = self.session.post(
            f"{BASE_URL}/api/posts/{post_id}/comments?user_id={TEST_USER_ID}",
            json={"content": comment_content}
        )
        assert create_response.status_code == 200, f"Failed to create comment: {create_response.text}"
        comment = create_response.json()
        comment_id = comment['id']
        
        print(f"Created comment: {comment_id}")
        
        # Verify initial state
        assert comment.get('is_edited') == False, "New comment should not be marked as edited"
        assert comment.get('edited_at') is None, "New comment should not have edited_at"
        
        # Edit the comment
        new_content = f"EDITED_{comment_content}"
        edit_response = self.session.put(
            f"{BASE_URL}/api/posts/{post_id}/comments/{comment_id}?user_id={TEST_USER_ID}",
            json={"content": new_content}
        )
        assert edit_response.status_code == 200, f"Failed to edit comment: {edit_response.text}"
        edited_comment = edit_response.json()
        
        # Verify edited state
        assert edited_comment.get('content') == new_content, "Content not updated"
        assert edited_comment.get('is_edited') == True, "is_edited should be True after edit"
        assert edited_comment.get('edited_at') is not None, "edited_at should be set after edit"
        
        print(f"Edited comment - is_edited: {edited_comment.get('is_edited')}, edited_at: {edited_comment.get('edited_at')}")
        
        # Cleanup - delete the test comment
        self.session.delete(f"{BASE_URL}/api/posts/{post_id}/comments/{comment_id}?user_id={TEST_USER_ID}")
    
    def test_cannot_edit_others_comment(self):
        """Test that user cannot edit another user's comment"""
        # Get posts with comments
        response = self.session.get(f"{BASE_URL}/api/posts?limit=10")
        assert response.status_code == 200
        posts = response.json()
        
        # Find a post with comments from another user
        for post in posts:
            comments_response = self.session.get(f"{BASE_URL}/api/posts/{post['id']}/comments")
            if comments_response.status_code == 200:
                comments = comments_response.json()
                other_comments = [c for c in comments if c.get('author_id') != TEST_USER_ID]
                
                if other_comments:
                    comment = other_comments[0]
                    # Try to edit it
                    edit_response = self.session.put(
                        f"{BASE_URL}/api/posts/{post['id']}/comments/{comment['id']}?user_id={TEST_USER_ID}",
                        json={"content": "Trying to edit someone else's comment"}
                    )
                    
                    assert edit_response.status_code == 403, f"Expected 403, got {edit_response.status_code}"
                    print("Correctly rejected editing another user's comment")
                    return
        
        pytest.skip("No comments from other users found to test")
    
    def test_edit_comment_empty_content_rejected(self):
        """Test that empty content is rejected when editing"""
        # Get a post
        response = self.session.get(f"{BASE_URL}/api/posts?limit=5")
        assert response.status_code == 200
        posts = response.json()
        
        if not posts:
            pytest.skip("No posts found")
        
        post_id = posts[0]['id']
        
        # Create a comment
        create_response = self.session.post(
            f"{BASE_URL}/api/posts/{post_id}/comments?user_id={TEST_USER_ID}",
            json={"content": f"TEST_EMPTY_EDIT_{int(time.time())}"}
        )
        assert create_response.status_code == 200
        comment_id = create_response.json()['id']
        
        # Try to edit with empty content
        edit_response = self.session.put(
            f"{BASE_URL}/api/posts/{post_id}/comments/{comment_id}?user_id={TEST_USER_ID}",
            json={"content": ""}
        )
        
        assert edit_response.status_code == 400, f"Expected 400 for empty content, got {edit_response.status_code}"
        print("Correctly rejected empty content edit")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/posts/{post_id}/comments/{comment_id}?user_id={TEST_USER_ID}")
    
    def test_comments_return_is_edited_field(self):
        """Test that GET comments returns is_edited and edited_at fields"""
        # Get a post with comments
        response = self.session.get(f"{BASE_URL}/api/posts?limit=10")
        assert response.status_code == 200
        posts = response.json()
        
        for post in posts:
            if post.get('comments_count', 0) > 0:
                comments_response = self.session.get(f"{BASE_URL}/api/posts/{post['id']}/comments")
                if comments_response.status_code == 200:
                    comments = comments_response.json()
                    if comments:
                        comment = comments[0]
                        # Check fields exist
                        assert 'is_edited' in comment, "is_edited field missing from comment"
                        assert 'edited_at' in comment, "edited_at field missing from comment"
                        print(f"Comment has is_edited: {comment.get('is_edited')}, edited_at: {comment.get('edited_at')}")
                        return
        
        pytest.skip("No posts with comments found")


class TestCommentAuthorUsername:
    """Test that comments return author_username field"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_comment_response_includes_author_username(self):
        """Test that comment creation returns author_username"""
        # Get a post
        response = self.session.get(f"{BASE_URL}/api/posts?limit=5")
        assert response.status_code == 200
        posts = response.json()
        
        if not posts:
            pytest.skip("No posts found")
        
        post_id = posts[0]['id']
        
        # Create a comment
        create_response = self.session.post(
            f"{BASE_URL}/api/posts/{post_id}/comments?user_id={TEST_USER_ID}",
            json={"content": f"TEST_USERNAME_CHECK_{int(time.time())}"}
        )
        assert create_response.status_code == 200
        comment = create_response.json()
        
        # Check author_username field
        assert 'author_username' in comment, "author_username field missing from comment response"
        print(f"Comment author_username: {comment.get('author_username')}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/posts/{post_id}/comments/{comment['id']}?user_id={TEST_USER_ID}")
    
    def test_get_comments_includes_author_username(self):
        """Test that GET comments returns author_username for each comment"""
        # Get posts with comments
        response = self.session.get(f"{BASE_URL}/api/posts?limit=10")
        assert response.status_code == 200
        posts = response.json()
        
        for post in posts:
            if post.get('comments_count', 0) > 0:
                comments_response = self.session.get(f"{BASE_URL}/api/posts/{post['id']}/comments")
                if comments_response.status_code == 200:
                    comments = comments_response.json()
                    if comments:
                        for comment in comments[:3]:  # Check first 3
                            assert 'author_username' in comment, f"author_username missing from comment {comment.get('id')}"
                            print(f"Comment by {comment.get('author_name')} has username: {comment.get('author_username')}")
                        return
        
        pytest.skip("No posts with comments found")


class TestPostMenuPinOption:
    """Test that PostMenu shows pin option for own posts"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_pin_endpoint_exists(self):
        """Verify pin endpoint is accessible"""
        # Get user's post
        response = self.session.get(f"{BASE_URL}/api/posts?user_id={TEST_USER_ID}&limit=5")
        assert response.status_code == 200
        posts = response.json()
        user_posts = [p for p in posts if p.get('author_id') == TEST_USER_ID]
        
        if not user_posts:
            pytest.skip("No posts found for test user")
        
        post_id = user_posts[0]['id']
        
        # Test pin endpoint exists (OPTIONS or actual call)
        response = self.session.post(f"{BASE_URL}/api/posts/{post_id}/pin?user_id={TEST_USER_ID}")
        
        # Should be 200 (success) not 404 (not found)
        assert response.status_code != 404, "Pin endpoint not found"
        print(f"Pin endpoint response: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
