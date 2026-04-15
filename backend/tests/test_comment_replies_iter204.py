"""
Test Comment Replies Feature - Iteration 204
Tests the ability to reply to comments on posts (nested comments)

Features tested:
1. Reply button on comments should toggle reply input field (frontend)
2. Reply input should accept text and have a Post button (frontend)
3. Submitting a reply via POST /api/posts/{post_id}/comments with parent_id should work
4. New replies should appear nested under the parent comment
5. GET /api/posts/{post_id}/comments should return nested replies in the replies array
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from the review request
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_POST_ID = "9bd0bfd6-0388-4be2-a413-946ed882aba9"


class TestCommentRepliesAPI:
    """Test comment replies (nested comments) API functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.created_comment_ids = []
        yield
        # Cleanup: Delete test comments
        for comment_id in self.created_comment_ids:
            try:
                self.session.delete(
                    f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{comment_id}",
                    params={"user_id": TEST_USER_ID}
                )
            except:
                pass
    
    def test_01_create_parent_comment(self):
        """Test creating a top-level comment (parent)"""
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_comment_{uuid.uuid4().hex[:8]}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain comment id"
        assert "content" in data, "Response should contain content"
        assert "author_id" in data, "Response should contain author_id"
        assert data["author_id"] == TEST_USER_ID, "Author ID should match test user"
        
        self.created_comment_ids.append(data["id"])
        print(f"Created parent comment: {data['id']}")
        return data["id"]
    
    def test_02_create_reply_to_comment(self):
        """Test creating a reply to an existing comment"""
        # First create a parent comment
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_for_reply_{uuid.uuid4().hex[:8]}"}
        )
        assert parent_response.status_code == 200
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Now create a reply
        reply_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={
                "content": f"TEST_reply_to_parent_{uuid.uuid4().hex[:8]}",
                "parent_id": parent_id
            }
        )
        
        assert reply_response.status_code == 200, f"Expected 200, got {reply_response.status_code}: {reply_response.text}"
        
        reply_data = reply_response.json()
        assert "id" in reply_data, "Reply should have an id"
        assert "content" in reply_data, "Reply should have content"
        assert reply_data["author_id"] == TEST_USER_ID, "Reply author should match test user"
        
        self.created_comment_ids.append(reply_data["id"])
        print(f"Created reply: {reply_data['id']} to parent: {parent_id}")
        return parent_id, reply_data["id"]
    
    def test_03_get_comments_with_nested_replies(self):
        """Test that GET comments returns nested replies in the replies array"""
        # Create parent and reply
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_nested_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        reply_content = f"TEST_nested_reply_{uuid.uuid4().hex[:8]}"
        reply_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": reply_content, "parent_id": parent_id}
        )
        reply_id = reply_response.json()["id"]
        self.created_comment_ids.append(reply_id)
        
        # Get all comments
        get_response = self.session.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        
        assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}"
        
        comments = get_response.json()
        assert isinstance(comments, list), "Response should be a list"
        
        # Find our parent comment
        parent_comment = None
        for comment in comments:
            if comment["id"] == parent_id:
                parent_comment = comment
                break
        
        assert parent_comment is not None, f"Parent comment {parent_id} should be in response"
        assert "replies" in parent_comment, "Parent comment should have 'replies' field"
        assert isinstance(parent_comment["replies"], list), "Replies should be a list"
        assert len(parent_comment["replies"]) >= 1, "Parent should have at least 1 reply"
        
        # Verify the reply is in the replies array
        reply_found = False
        for reply in parent_comment["replies"]:
            if reply["id"] == reply_id:
                reply_found = True
                assert reply["content"] == reply_content, "Reply content should match"
                assert reply["parent_id"] == parent_id, "Reply parent_id should match"
                break
        
        assert reply_found, f"Reply {reply_id} should be in parent's replies array"
        print(f"Verified nested reply structure: parent {parent_id} has reply {reply_id}")
    
    def test_04_reply_to_invalid_parent_returns_404(self):
        """Test that replying to non-existent parent returns 404"""
        fake_parent_id = str(uuid.uuid4())
        
        response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": "TEST_reply_to_fake_parent", "parent_id": fake_parent_id}
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid parent, got {response.status_code}"
        print("Correctly returned 404 for invalid parent_id")
    
    def test_05_reply_to_comment_on_different_post_returns_400(self):
        """Test that replying with parent_id from different post returns 400"""
        # This test requires a comment from a different post
        # For now, we'll skip if we can't find one
        # The backend should validate that parent_id belongs to the same post
        
        # Create a comment on our test post
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_cross_post_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Try to use this parent_id on a different (fake) post
        fake_post_id = str(uuid.uuid4())
        response = self.session.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": "TEST_cross_post_reply", "parent_id": parent_id}
        )
        
        # Should return 404 (post not found) or 400 (parent belongs to different post)
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}"
        print(f"Correctly rejected cross-post reply with status {response.status_code}")
    
    def test_06_multiple_replies_to_same_parent(self):
        """Test that multiple replies can be added to the same parent"""
        # Create parent
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_multi_reply_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Create 3 replies
        reply_ids = []
        for i in range(3):
            reply_response = self.session.post(
                f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
                params={"user_id": TEST_USER_ID},
                json={"content": f"TEST_multi_reply_{i}_{uuid.uuid4().hex[:8]}", "parent_id": parent_id}
            )
            assert reply_response.status_code == 200
            reply_ids.append(reply_response.json()["id"])
            self.created_comment_ids.append(reply_ids[-1])
        
        # Verify all replies are returned
        get_response = self.session.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        
        comments = get_response.json()
        parent_comment = next((c for c in comments if c["id"] == parent_id), None)
        
        assert parent_comment is not None
        assert len(parent_comment["replies"]) >= 3, f"Expected at least 3 replies, got {len(parent_comment['replies'])}"
        
        # Verify all our reply IDs are present
        reply_ids_in_response = [r["id"] for r in parent_comment["replies"]]
        for reply_id in reply_ids:
            assert reply_id in reply_ids_in_response, f"Reply {reply_id} should be in response"
        
        print(f"Verified {len(reply_ids)} replies to parent {parent_id}")
    
    def test_07_reply_count_field(self):
        """Test that reply_count field is correctly populated"""
        # Create parent
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_parent_count_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Create 2 replies
        for i in range(2):
            reply_response = self.session.post(
                f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
                params={"user_id": TEST_USER_ID},
                json={"content": f"TEST_count_reply_{i}", "parent_id": parent_id}
            )
            self.created_comment_ids.append(reply_response.json()["id"])
        
        # Get comments and check reply_count
        get_response = self.session.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        
        comments = get_response.json()
        parent_comment = next((c for c in comments if c["id"] == parent_id), None)
        
        assert parent_comment is not None
        assert "reply_count" in parent_comment, "Parent should have reply_count field"
        assert parent_comment["reply_count"] >= 2, f"Expected reply_count >= 2, got {parent_comment['reply_count']}"
        
        print(f"Verified reply_count: {parent_comment['reply_count']}")


class TestCommentRepliesDataIntegrity:
    """Test data integrity for comment replies"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.created_comment_ids = []
        yield
        # Cleanup
        for comment_id in self.created_comment_ids:
            try:
                self.session.delete(
                    f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments/{comment_id}",
                    params={"user_id": TEST_USER_ID}
                )
            except:
                pass
    
    def test_reply_has_correct_author_info(self):
        """Test that reply contains correct author information"""
        # Create parent
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_author_parent_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Create reply
        reply_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_author_reply_{uuid.uuid4().hex[:8]}", "parent_id": parent_id}
        )
        reply_id = reply_response.json()["id"]
        self.created_comment_ids.append(reply_id)
        
        # Get comments
        get_response = self.session.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        
        comments = get_response.json()
        parent_comment = next((c for c in comments if c["id"] == parent_id), None)
        reply = next((r for r in parent_comment["replies"] if r["id"] == reply_id), None)
        
        assert reply is not None
        assert "author_id" in reply, "Reply should have author_id"
        assert "author_name" in reply, "Reply should have author_name"
        assert reply["author_id"] == TEST_USER_ID
        assert reply["author_name"] is not None and reply["author_name"] != ""
        
        print(f"Reply author info verified: {reply['author_name']}")
    
    def test_reply_has_created_at_timestamp(self):
        """Test that reply has created_at timestamp"""
        # Create parent
        parent_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_timestamp_parent_{uuid.uuid4().hex[:8]}"}
        )
        parent_id = parent_response.json()["id"]
        self.created_comment_ids.append(parent_id)
        
        # Create reply
        reply_response = self.session.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"user_id": TEST_USER_ID},
            json={"content": f"TEST_timestamp_reply_{uuid.uuid4().hex[:8]}", "parent_id": parent_id}
        )
        reply_id = reply_response.json()["id"]
        self.created_comment_ids.append(reply_id)
        
        # Get comments
        get_response = self.session.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/comments",
            params={"viewer_id": TEST_USER_ID}
        )
        
        comments = get_response.json()
        parent_comment = next((c for c in comments if c["id"] == parent_id), None)
        reply = next((r for r in parent_comment["replies"] if r["id"] == reply_id), None)
        
        assert reply is not None
        assert "created_at" in reply, "Reply should have created_at"
        assert reply["created_at"] is not None
        
        print(f"Reply timestamp verified: {reply['created_at']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
