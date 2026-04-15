"""
Test Username Display in Posts API - Iteration 252
Tests that author_username is correctly returned in PostResponse, CommentResponse, and CollaboratorData
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("✓ API health check passed")


class TestPostsAuthorUsername:
    """Test that posts API returns author_username field"""
    
    def test_posts_feed_returns_author_username(self):
        """GET /api/posts should return author_username in PostResponse"""
        response = requests.get(f"{BASE_URL}/api/posts?limit=10")
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) > 0, "Expected at least one post in feed"
        
        # Check first post has author_username field
        first_post = posts[0]
        assert "author_username" in first_post, "PostResponse should include author_username field"
        print(f"✓ Post has author_username: {first_post.get('author_username')}")
        
        # Verify davidpritzker user has username set
        david_posts = [p for p in posts if p.get('author_name') == 'David Pritzker']
        if david_posts:
            assert david_posts[0].get('author_username') == 'davidpritzker', \
                "David Pritzker should have username 'davidpritzker'"
            print("✓ David Pritzker's username correctly returned as 'davidpritzker'")
    
    def test_post_response_structure(self):
        """Verify PostResponse has all expected username-related fields"""
        response = requests.get(f"{BASE_URL}/api/posts?limit=1")
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) > 0
        
        post = posts[0]
        # Required fields
        assert "id" in post
        assert "author_id" in post
        assert "author_name" in post
        assert "author_username" in post  # New field
        assert "author_avatar" in post
        assert "author_role" in post
        print("✓ PostResponse structure includes author_username")
    
    def test_comments_have_author_username(self):
        """GET /api/posts should return author_username in recent_comments"""
        response = requests.get(f"{BASE_URL}/api/posts?limit=50")
        assert response.status_code == 200
        posts = response.json()
        
        # Find a post with comments
        posts_with_comments = [p for p in posts if p.get('recent_comments') and len(p['recent_comments']) > 0]
        
        if posts_with_comments:
            comment = posts_with_comments[0]['recent_comments'][0]
            assert "author_username" in comment, "CommentResponse should include author_username field"
            print(f"✓ Comment has author_username: {comment.get('author_username')}")
        else:
            print("⚠ No posts with comments found to test CommentResponse.author_username")
    
    def test_collaborators_have_username(self):
        """GET /api/posts should return username in collaborators"""
        response = requests.get(f"{BASE_URL}/api/posts?limit=50")
        assert response.status_code == 200
        posts = response.json()
        
        # Find a post with collaborators
        posts_with_collaborators = [p for p in posts if p.get('collaborators') and len(p['collaborators']) > 0]
        
        if posts_with_collaborators:
            collaborator = posts_with_collaborators[0]['collaborators'][0]
            assert "username" in collaborator, "CollaboratorData should include username field"
            print(f"✓ Collaborator has username: {collaborator.get('username')}")
        else:
            print("⚠ No posts with collaborators found to test CollaboratorData.username")


class TestUserProfileUsername:
    """Test that user profile returns username via username status endpoint"""
    
    def test_username_status_endpoint(self):
        """GET /api/username/status should return username for user"""
        # Use David Pritzker's profile ID
        profile_id = "12dc6786-124f-40b1-8698-a9409f99736f"
        response = requests.get(f"{BASE_URL}/api/username/status?user_id={profile_id}")
        assert response.status_code == 200
        status = response.json()
        
        assert "username" in status, "Username status should include username field"
        assert status.get("username") == "davidpritzker", \
            f"Expected username 'davidpritzker', got '{status.get('username')}'"
        print(f"✓ Username status returns: {status.get('username')}")


class TestUsernameSearch:
    """Test username search for @mentions"""
    
    def test_search_by_username(self):
        """GET /api/username/search should find users by username"""
        response = requests.get(f"{BASE_URL}/api/username/search?q=david&limit=5")
        assert response.status_code == 200
        users = response.json()
        
        # Should find davidpritzker
        usernames = [u.get('username') for u in users if u.get('username')]
        assert 'davidpritzker' in usernames or any('david' in (u.get('username') or '').lower() for u in users), \
            "Search should find users with 'david' in username"
        print(f"✓ Username search returned {len(users)} users")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
