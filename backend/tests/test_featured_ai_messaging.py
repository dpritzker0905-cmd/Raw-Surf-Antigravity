"""
Test file for iteration 22 features:
1. Featured Photographers API - GET /api/photographers/featured
2. AI Photo Tagging APIs - analyze-photo, suggest-tags, confirm-tags, my-tagged-photos
3. Messaging APIs - start-conversation, unread-counts, decline

Test credentials:
- Photographer: ff99d26b-f1cb-4970-9275-7f6ff5e91efc
- User (Sarah Waters): 04503c29-dc37-4f8c-a462-4177c4a54096
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
PHOTOGRAPHER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"
USER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters

# Sample surf photo URL for AI testing
SAMPLE_SURF_PHOTO = "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800"


class TestFeaturedPhotographers:
    """Test Featured Photographers API"""
    
    def test_get_featured_photographers_success(self):
        """Test GET /api/photographers/featured returns ranked photographers"""
        response = requests.get(f"{BASE_URL}/api/photographers/featured?limit=10")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # If there are photographers, verify the response structure
        if len(data) > 0:
            photographer = data[0]
            assert "id" in photographer
            assert "full_name" in photographer
            assert "role" in photographer
            assert "is_live" in photographer
            assert "score" in photographer
            # Score should be calculated based on: earnings * 2 + sessions * 10 + gallery * 5 + (100 if live)
            print(f"Top photographer: {photographer['full_name']} with score {photographer['score']}")
    
    def test_featured_photographers_limit_parameter(self):
        """Test limit parameter works correctly"""
        response = requests.get(f"{BASE_URL}/api/photographers/featured?limit=3")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data) <= 3
    
    def test_featured_photographers_structure(self):
        """Test each photographer has the expected fields"""
        response = requests.get(f"{BASE_URL}/api/photographers/featured?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        expected_fields = [
            "id", "full_name", "avatar_url", "role", "is_verified",
            "is_live", "location", "current_spot", "session_price",
            "total_earnings", "total_sessions", "gallery_count", "score"
        ]
        
        for photographer in data:
            for field in expected_fields:
                assert field in photographer, f"Missing field: {field}"
            print(f"Photographer {photographer['full_name']}: sessions={photographer['total_sessions']}, gallery={photographer['gallery_count']}, earnings=${photographer['total_earnings']}")


class TestAIPhotoTagging:
    """Test AI Photo Tagging APIs using GPT-4o Vision"""
    
    def test_analyze_photo_with_url(self):
        """Test POST /api/ai/analyze-photo with image URL"""
        response = requests.post(
            f"{BASE_URL}/api/ai/analyze-photo",
            json={"image_url": SAMPLE_SURF_PHOTO}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] == True
        assert "analysis" in data
        
        analysis = data["analysis"]
        # Check for expected fields in analysis
        if not analysis.get("raw_response"):
            assert "people_count" in analysis
            assert "people" in analysis
            assert "overall_description" in analysis
            print(f"AI detected {analysis.get('people_count', 0)} people in the photo")
    
    def test_analyze_photo_missing_input(self):
        """Test analyze-photo returns 400 when no image provided"""
        response = requests.post(
            f"{BASE_URL}/api/ai/analyze-photo",
            json={}
        )
        assert response.status_code == 400
        assert "Provide either image_url or image_base64" in response.json().get("detail", "")
    
    def test_suggest_tags(self):
        """Test POST /api/ai/suggest-tags returns analysis and suggestions"""
        response = requests.post(
            f"{BASE_URL}/api/ai/suggest-tags",
            json={"image_url": SAMPLE_SURF_PHOTO}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] == True
        assert "analysis" in data
        assert "suggested_tags" in data
        assert "people_detected" in data
        print(f"Suggested tags: {len(data['suggested_tags'])} potential matches")
    
    def test_confirm_tags_invalid_gallery_item(self):
        """Test confirm-tags returns 404 for invalid gallery item"""
        response = requests.post(
            f"{BASE_URL}/api/ai/confirm-tags?photographer_id={PHOTOGRAPHER_ID}",
            json={
                "gallery_item_id": "nonexistent-id",
                "surfer_ids": [USER_ID]
            }
        )
        assert response.status_code == 404
        assert "Gallery item not found" in response.json().get("detail", "")
    
    def test_my_tagged_photos(self):
        """Test GET /api/ai/my-tagged-photos returns user's tagged photos"""
        response = requests.get(f"{BASE_URL}/api/ai/my-tagged-photos?user_id={USER_ID}&limit=20")
        assert response.status_code == 200
        
        data = response.json()
        assert "tagged_photos" in data
        assert "total_count" in data
        assert isinstance(data["tagged_photos"], list)
        print(f"User has {data['total_count']} tagged photos")


class TestMessagingAPIs:
    """Test Messaging APIs including start-conversation, unread-counts, decline"""
    
    def test_start_conversation_success(self):
        """Test POST /api/messages/start-conversation creates or gets existing conversation"""
        response = requests.post(
            f"{BASE_URL}/api/messages/start-conversation?sender_id={USER_ID}&recipient_id={PHOTOGRAPHER_ID}"
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "conversation_id" in data
        assert data["recipient_id"] == PHOTOGRAPHER_ID
        assert "recipient_name" in data
        assert "is_new" in data
        print(f"Conversation ID: {data['conversation_id']}, is_new: {data['is_new']}")
        return data["conversation_id"]
    
    def test_start_conversation_same_user(self):
        """Test cannot start conversation with yourself"""
        response = requests.post(
            f"{BASE_URL}/api/messages/start-conversation?sender_id={USER_ID}&recipient_id={USER_ID}"
        )
        assert response.status_code == 400
        assert "Cannot message yourself" in response.json().get("detail", "")
    
    def test_start_conversation_invalid_sender(self):
        """Test start-conversation returns 404 for invalid sender"""
        response = requests.post(
            f"{BASE_URL}/api/messages/start-conversation?sender_id=invalid-id&recipient_id={PHOTOGRAPHER_ID}"
        )
        assert response.status_code == 404
        assert "Sender not found" in response.json().get("detail", "")
    
    def test_start_conversation_invalid_recipient(self):
        """Test start-conversation returns 404 for invalid recipient"""
        response = requests.post(
            f"{BASE_URL}/api/messages/start-conversation?sender_id={USER_ID}&recipient_id=invalid-id"
        )
        assert response.status_code == 404
        assert "Recipient not found" in response.json().get("detail", "")
    
    def test_unread_counts(self):
        """Test GET /api/messages/unread-counts/{user_id} returns primary and request counts"""
        response = requests.get(f"{BASE_URL}/api/messages/unread-counts/{USER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        assert "primary" in data
        assert "requests" in data
        assert "total" in data
        assert data["total"] == data["primary"] + data["requests"]
        print(f"Unread counts - Primary: {data['primary']}, Requests: {data['requests']}, Total: {data['total']}")
    
    def test_decline_conversation_invalid_id(self):
        """Test decline returns 404 for invalid conversation ID"""
        response = requests.post(
            f"{BASE_URL}/api/messages/decline/invalid-conversation-id?user_id={USER_ID}"
        )
        assert response.status_code == 404
        assert "Conversation not found" in response.json().get("detail", "")
    
    def test_conversations_list(self):
        """Test GET /api/messages/conversations returns user's conversations"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{USER_ID}?inbox_type=primary")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        for conv in data:
            assert "id" in conv
            assert "other_user_id" in conv
            assert "other_user_name" in conv
            assert "unread_count" in conv
            assert "is_request" in conv
        print(f"User has {len(data)} conversations in primary inbox")


class TestFullMessagingFlow:
    """Test full messaging flow: start conversation → send message → check unread"""
    
    def test_full_message_flow(self):
        """Test complete messaging flow"""
        # Step 1: Start a new conversation
        start_response = requests.post(
            f"{BASE_URL}/api/messages/start-conversation?sender_id={PHOTOGRAPHER_ID}&recipient_id={USER_ID}"
        )
        assert start_response.status_code == 200
        conversation_id = start_response.json()["conversation_id"]
        print(f"Started conversation: {conversation_id}")
        
        # Step 2: Send a message
        send_response = requests.post(
            f"{BASE_URL}/api/messages/send?sender_id={PHOTOGRAPHER_ID}",
            json={
                "recipient_id": USER_ID,
                "content": "Test message for iteration 22"
            }
        )
        assert send_response.status_code == 200
        message_data = send_response.json()
        assert "id" in message_data
        assert "conversation_id" in message_data
        print(f"Sent message: {message_data['id']}")
        
        # Step 3: Check unread counts for recipient
        unread_response = requests.get(f"{BASE_URL}/api/messages/unread-counts/{USER_ID}")
        assert unread_response.status_code == 200
        # Should have at least 1 unread in either primary or requests
        unread_data = unread_response.json()
        print(f"Unread counts after send: {unread_data}")
        
        # Step 4: Get conversation detail
        detail_response = requests.get(
            f"{BASE_URL}/api/messages/conversation/{conversation_id}?user_id={PHOTOGRAPHER_ID}"
        )
        assert detail_response.status_code == 200
        detail_data = detail_response.json()
        assert len(detail_data["messages"]) > 0
        print(f"Conversation has {len(detail_data['messages'])} messages")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
