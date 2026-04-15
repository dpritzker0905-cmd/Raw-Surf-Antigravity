"""
Test Comment Reactions API - Iteration 203
Tests for emoji reactions on user comments in post threads

Endpoints tested:
- POST /api/comments/{comment_id}/reactions - Toggle reaction on comment
- GET /api/comments/{comment_id}/reactions - Get reactions for a comment
- GET /api/posts/{post_id}/comments - Should return reaction_count and viewer_reaction
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test user from credentials
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"

# Valid comment reaction emojis
VALID_COMMENT_REACTIONS = ['❤️', '🤙', '🌊', '🔥', '👍', '😂']


class TestCommentReactionsAPI:
    """Test comment reaction endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.base_url = BASE_URL.rstrip('/')
        
    def test_get_posts_feed(self):
        """Test that we can get posts from the feed"""
        response = self.session.get(f"{self.base_url}/api/posts?user_id={TEST_USER_ID}&limit=5")
        assert response.status_code == 200, f"Failed to get posts: {response.text}"
        posts = response.json()
        assert isinstance(posts, list), "Posts should be a list"
        print(f"✓ Got {len(posts)} posts from feed")
        return posts
    
    def test_get_post_comments_with_reactions(self):
        """Test GET /api/posts/{post_id}/comments returns reaction data"""
        # First get a post
        posts = self.test_get_posts_feed()
        if not posts:
            pytest.skip("No posts available for testing")
        
        post_id = posts[0]['id']
        
        # Get comments for the post
        response = self.session.get(
            f"{self.base_url}/api/posts/{post_id}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Failed to get comments: {response.text}"
        
        comments = response.json()
        assert isinstance(comments, list), "Comments should be a list"
        
        # Check that comments have reaction fields
        if comments:
            comment = comments[0]
            assert "reaction_count" in comment, "Comment should have reaction_count field"
            assert "viewer_reaction" in comment, "Comment should have viewer_reaction field"
            print(f"✓ Comment has reaction_count: {comment['reaction_count']}, viewer_reaction: {comment['viewer_reaction']}")
        else:
            print("✓ No comments on this post, but endpoint works")
        
        return comments, post_id
    
    def test_toggle_comment_reaction_add(self):
        """Test POST /api/comments/{comment_id}/reactions - Add reaction"""
        # Get a post with comments
        posts_response = self.session.get(f"{self.base_url}/api/posts?user_id={TEST_USER_ID}&limit=20")
        posts = posts_response.json()
        
        # Find a post with comments
        comment_id = None
        for post in posts:
            if post.get('comments_count', 0) > 0:
                comments_response = self.session.get(
                    f"{self.base_url}/api/posts/{post['id']}/comments",
                    params={"viewer_id": TEST_USER_ID}
                )
                comments = comments_response.json()
                if comments:
                    comment_id = comments[0]['id']
                    break
        
        if not comment_id:
            # Create a comment to test with
            post_id = posts[0]['id'] if posts else None
            if not post_id:
                pytest.skip("No posts available for testing")
            
            # Create a test comment
            comment_response = self.session.post(
                f"{self.base_url}/api/posts/{post_id}/comments?user_id={TEST_USER_ID}",
                json={"content": f"Test comment for reaction testing {uuid.uuid4().hex[:8]}"}
            )
            if comment_response.status_code == 200:
                comment_id = comment_response.json()['id']
            else:
                pytest.skip("Could not create test comment")
        
        # Test adding a reaction
        response = self.session.post(
            f"{self.base_url}/api/comments/{comment_id}/reactions?user_id={TEST_USER_ID}",
            json={"emoji": "❤️"}
        )
        assert response.status_code == 200, f"Failed to add reaction: {response.text}"
        
        data = response.json()
        assert "action" in data, "Response should have action field"
        assert data["action"] in ["added", "updated", "removed"], f"Unexpected action: {data['action']}"
        assert data["emoji"] == "❤️", "Emoji should match"
        print(f"✓ Reaction action: {data['action']}, emoji: {data['emoji']}")
        
        return comment_id
    
    def test_toggle_comment_reaction_remove(self):
        """Test POST /api/comments/{comment_id}/reactions - Remove reaction (toggle off)"""
        comment_id = self.test_toggle_comment_reaction_add()
        
        # Toggle the same reaction again to remove it
        response = self.session.post(
            f"{self.base_url}/api/comments/{comment_id}/reactions?user_id={TEST_USER_ID}",
            json={"emoji": "❤️"}
        )
        assert response.status_code == 200, f"Failed to toggle reaction: {response.text}"
        
        data = response.json()
        # Should be removed since we're toggling the same emoji
        assert data["action"] == "removed", f"Expected 'removed' action, got: {data['action']}"
        print(f"✓ Reaction toggled off: {data['action']}")
    
    def test_toggle_comment_reaction_update(self):
        """Test POST /api/comments/{comment_id}/reactions - Update to different emoji"""
        comment_id = self.test_toggle_comment_reaction_add()
        
        # Add a different emoji - should update
        response = self.session.post(
            f"{self.base_url}/api/comments/{comment_id}/reactions?user_id={TEST_USER_ID}",
            json={"emoji": "🤙"}
        )
        assert response.status_code == 200, f"Failed to update reaction: {response.text}"
        
        data = response.json()
        assert data["action"] == "updated", f"Expected 'updated' action, got: {data['action']}"
        assert data["emoji"] == "🤙", "Emoji should be updated"
        print(f"✓ Reaction updated to: {data['emoji']}")
    
    def test_get_comment_reactions(self):
        """Test GET /api/comments/{comment_id}/reactions"""
        comment_id = self.test_toggle_comment_reaction_add()
        
        # Get reactions for the comment
        response = self.session.get(
            f"{self.base_url}/api/comments/{comment_id}/reactions",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Failed to get reactions: {response.text}"
        
        data = response.json()
        assert "reactions" in data, "Response should have reactions field"
        assert "count" in data, "Response should have count field"
        assert "viewer_reaction" in data, "Response should have viewer_reaction field"
        
        print(f"✓ Got {data['count']} reactions, viewer_reaction: {data['viewer_reaction']}")
    
    def test_invalid_emoji_reaction(self):
        """Test that invalid emojis are rejected"""
        # Get a comment
        posts_response = self.session.get(f"{self.base_url}/api/posts?user_id={TEST_USER_ID}&limit=5")
        posts = posts_response.json()
        
        comment_id = None
        for post in posts:
            if post.get('comments_count', 0) > 0:
                comments_response = self.session.get(f"{self.base_url}/api/posts/{post['id']}/comments")
                comments = comments_response.json()
                if comments:
                    comment_id = comments[0]['id']
                    break
        
        if not comment_id:
            pytest.skip("No comments available for testing")
        
        # Try invalid emoji
        response = self.session.post(
            f"{self.base_url}/api/comments/{comment_id}/reactions?user_id={TEST_USER_ID}",
            json={"emoji": "🎉"}  # Not in valid list
        )
        assert response.status_code == 400, f"Expected 400 for invalid emoji, got: {response.status_code}"
        print("✓ Invalid emoji correctly rejected with 400")
    
    def test_reaction_on_nonexistent_comment(self):
        """Test reaction on non-existent comment returns 404"""
        fake_comment_id = str(uuid.uuid4())
        
        response = self.session.post(
            f"{self.base_url}/api/comments/{fake_comment_id}/reactions?user_id={TEST_USER_ID}",
            json={"emoji": "❤️"}
        )
        assert response.status_code == 404, f"Expected 404 for non-existent comment, got: {response.status_code}"
        print("✓ Non-existent comment correctly returns 404")


class TestSinglePostView:
    """Test single post view endpoint for Go to Post functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.base_url = BASE_URL.rstrip('/')
    
    def test_get_single_post(self):
        """Test GET /api/posts/{post_id} returns single post data"""
        # First get a post from feed
        response = self.session.get(f"{self.base_url}/api/posts?user_id={TEST_USER_ID}&limit=1")
        assert response.status_code == 200
        posts = response.json()
        
        if not posts:
            pytest.skip("No posts available for testing")
        
        post_id = posts[0]['id']
        
        # Get single post
        response = self.session.get(
            f"{self.base_url}/api/posts/{post_id}",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Failed to get single post: {response.text}"
        
        post = response.json()
        assert post['id'] == post_id, "Post ID should match"
        assert 'author_id' in post, "Post should have author_id"
        assert 'media_url' in post, "Post should have media_url"
        print(f"✓ Single post retrieved: {post_id}")
        
        return post_id
    
    def test_get_nonexistent_post(self):
        """Test GET /api/posts/{post_id} returns 404 for non-existent post"""
        fake_post_id = str(uuid.uuid4())
        
        response = self.session.get(f"{self.base_url}/api/posts/{fake_post_id}")
        assert response.status_code == 404, f"Expected 404, got: {response.status_code}"
        print("✓ Non-existent post correctly returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
