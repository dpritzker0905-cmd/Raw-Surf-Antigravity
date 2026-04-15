"""
Test Post Reactions and Save Functionality - Iteration 288
Tests for:
- POST /api/posts/{post_id}/save - Save post endpoint
- DELETE /api/posts/{post_id}/save - Unsave post endpoint
- POST /api/posts/{post_id}/reactions - Add reaction endpoint
- GET /api/posts/{post_id}/is-saved - Check if post is saved
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_POST_ID = "f8112f82-006b-4a3d-8a92-8d8f764df674"

# Valid reaction emojis
VALID_REACTIONS = ['🤙', '🌊', '❤️', '🔥']


class TestPostSaveEndpoints:
    """Test save/unsave post functionality"""
    
    def test_save_post(self):
        """Test saving a post"""
        # First unsave to ensure clean state
        requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Now save the post
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data
        assert data["message"] == "Post saved"
        assert "saved_id" in data
        print(f"✓ Save post: {data}")
    
    def test_check_is_saved(self):
        """Test checking if post is saved"""
        response = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/is-saved",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "is_saved" in data
        assert isinstance(data["is_saved"], bool)
        print(f"✓ Check is saved: {data}")
    
    def test_unsave_post(self):
        """Test unsaving a post"""
        # First ensure post is saved
        requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Now unsave
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data
        assert data["message"] == "Post unsaved"
        print(f"✓ Unsave post: {data}")
    
    def test_verify_unsaved_state(self):
        """Verify post is unsaved after unsave operation"""
        # Ensure unsaved
        requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Check state
        response = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/is-saved",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["is_saved"] == False
        print(f"✓ Verified unsaved state: {data}")
    
    def test_save_already_saved_post(self):
        """Test saving an already saved post returns error"""
        # First save
        requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Try to save again
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "detail" in data
        assert "already saved" in data["detail"].lower()
        print(f"✓ Save already saved post returns error: {data}")
        
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )


class TestPostReactionEndpoints:
    """Test post reaction functionality"""
    
    def test_add_reaction(self):
        """Test adding a reaction to a post"""
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions",
            params={"user_id": TEST_USER_ID},
            json={"emoji": "🔥"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "action" in data
        assert data["action"] in ["added", "removed"]
        assert "emoji" in data
        assert data["emoji"] == "🔥"
        print(f"✓ Add reaction: {data}")
    
    def test_toggle_reaction(self):
        """Test toggling a reaction (add then remove)"""
        # Add reaction
        response1 = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions",
            params={"user_id": TEST_USER_ID},
            json={"emoji": "🌊"}
        )
        assert response1.status_code == 200
        data1 = response1.json()
        first_action = data1["action"]
        
        # Toggle (should be opposite action)
        response2 = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions",
            params={"user_id": TEST_USER_ID},
            json={"emoji": "🌊"}
        )
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Actions should be opposite
        if first_action == "added":
            assert data2["action"] == "removed"
        else:
            assert data2["action"] == "added"
        print(f"✓ Toggle reaction: first={first_action}, second={data2['action']}")
    
    def test_invalid_reaction_emoji(self):
        """Test adding invalid reaction emoji returns error"""
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions",
            params={"user_id": TEST_USER_ID},
            json={"emoji": "😀"}  # Not in valid reactions list
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "detail" in data
        print(f"✓ Invalid emoji returns error: {data}")
    
    def test_get_post_reactions(self):
        """Test getting all reactions for a post"""
        response = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Get reactions: {len(data)} reactions found")
    
    def test_all_valid_reactions(self):
        """Test all valid reaction emojis work"""
        for emoji in VALID_REACTIONS:
            response = requests.post(
                f"{BASE_URL}/api/posts/{TEST_POST_ID}/reactions",
                params={"user_id": TEST_USER_ID},
                json={"emoji": emoji}
            )
            assert response.status_code == 200, f"Failed for emoji {emoji}: {response.text}"
            print(f"✓ Valid reaction {emoji} works")


class TestPostEndpointWithSavedState:
    """Test that post endpoint returns saved state correctly"""
    
    def test_get_post_includes_saved_state(self):
        """Test GET post includes saved field"""
        response = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"viewer_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "saved" in data, "Post response should include 'saved' field"
        assert isinstance(data["saved"], bool)
        print(f"✓ Post includes saved state: {data['saved']}")
    
    def test_saved_state_updates_correctly(self):
        """Test that saved state updates after save/unsave"""
        # Unsave first
        requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Check state is false
        response1 = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response1.json()["saved"] == False
        
        # Save
        requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )
        
        # Check state is true
        response2 = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response2.json()["saved"] == True
        
        print("✓ Saved state updates correctly after save/unsave")
        
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/save",
            params={"user_id": TEST_USER_ID}
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
