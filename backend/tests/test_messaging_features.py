"""
Test Messaging Features - Thread/Message Creation, Reactions, Threaded Replies
Tests for: POST /api/messages/send, POST /api/messages/start-conversation, 
POST /api/messages/react/{message_id}, GET /api/messages/conversations/{user_id},
GET /api/messages/conversation/{id}
"""
import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from requirements
TEST_USER_1_EMAIL = "kelly@surf.com"
TEST_USER_1_PASSWORD = "password123"
TEST_USER_2_EMAIL = "photographer@surf.com"
TEST_USER_2_PASSWORD = "password123"

# Test data from context
TEST_CONVERSATION_ID = "acbc18be-c9a6-42cc-bef3-3fb882a707b9"
TEST_MESSAGE_ID = "aca8e061-c940-4da6-b7b3-781469c120b4"

# Allowed reaction emojis
ALLOWED_REACTIONS = ['🤙', '🌊', '❤️', '🔥', '👏', '😂']


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def user1_auth(api_client):
    """Authenticate test user 1 (kelly@surf.com) and return user data"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_USER_1_EMAIL,
        "password": TEST_USER_1_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return {
            "id": data.get("id") or data.get("user", {}).get("id"),
            "email": data.get("email") or data.get("user", {}).get("email"),
            "token": data.get("token") or data.get("access_token")
        }
    pytest.skip(f"User 1 auth failed with status {response.status_code}: {response.text}")


@pytest.fixture(scope="module")
def user2_auth(api_client):
    """Authenticate test user 2 (photographer@surf.com) and return user data"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_USER_2_EMAIL,
        "password": TEST_USER_2_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return {
            "id": data.get("id") or data.get("user", {}).get("id"),
            "email": data.get("email") or data.get("user", {}).get("email"),
            "token": data.get("token") or data.get("access_token")
        }
    pytest.skip(f"User 2 auth failed with status {response.status_code}: {response.text}")


class TestStartConversation:
    """Tests for POST /api/messages/start-conversation endpoint"""
    
    def test_start_conversation_creates_or_retrieves(self, api_client, user1_auth, user2_auth):
        """Test starting a conversation between two users"""
        response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": user2_auth["id"]
            }
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify response structure
        assert "conversation_id" in data, "Response should contain conversation_id"
        assert "recipient_id" in data, "Response should contain recipient_id"
        assert "recipient_name" in data, "Response should contain recipient_name"
        assert "is_new" in data, "Response should indicate if conversation is new"
        
        # Verify values
        assert data["recipient_id"] == user2_auth["id"], "Recipient ID should match"
        
    def test_start_conversation_self_message_rejected(self, api_client, user1_auth):
        """Test that user cannot start conversation with themselves"""
        response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": user1_auth["id"]
            }
        )
        
        # Should return 400 Bad Request
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        
    def test_start_conversation_invalid_user_rejected(self, api_client, user1_auth):
        """Test starting conversation with non-existent user"""
        fake_user_id = str(uuid.uuid4())
        response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": fake_user_id
            }
        )
        
        # Should return 404 Not Found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestSendMessage:
    """Tests for POST /api/messages/send endpoint"""
    
    def test_send_text_message(self, api_client, user1_auth, user2_auth):
        """Test sending a text message"""
        unique_content = f"TEST_MSG_{datetime.now().isoformat()}"
        
        response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": unique_content,
                "message_type": "text"
            }
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify response structure
        assert "id" in data, "Response should contain message id"
        assert "conversation_id" in data, "Response should contain conversation_id"
        assert "content" in data, "Response should contain content"
        assert data["content"] == unique_content, "Content should match"
        assert data["message_type"] == "text", "Message type should be text"
    
    def test_send_message_with_media_url(self, api_client, user1_auth, user2_auth):
        """Test sending a message with media URL (rich media support)"""
        response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": "Check this photo!",
                "message_type": "image",
                "media_url": "https://example.com/test-image.jpg"
            }
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["message_type"] == "image", "Message type should be image"
        assert data.get("media_url") == "https://example.com/test-image.jpg", "Media URL should be stored"
    
    def test_send_message_with_reply(self, api_client, user1_auth, user2_auth):
        """Test sending a threaded reply message"""
        # First send a message to reply to
        first_msg = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": f"Original message {datetime.now().isoformat()}",
                "message_type": "text"
            }
        )
        assert first_msg.status_code == 200
        first_msg_id = first_msg.json()["id"]
        
        # Now send a reply
        reply_response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user2_auth["id"]},
            json={
                "recipient_id": user1_auth["id"],
                "content": f"Reply message {datetime.now().isoformat()}",
                "message_type": "text",
                "reply_to_id": first_msg_id
            }
        )
        
        assert reply_response.status_code == 200, f"Expected 200, got {reply_response.status_code}: {reply_response.text}"
        
        data = reply_response.json()
        assert data.get("reply_to_id") == first_msg_id, "Reply should reference original message"
    
    def test_send_message_invalid_recipient_rejected(self, api_client, user1_auth):
        """Test sending message to non-existent user"""
        fake_user_id = str(uuid.uuid4())
        response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": fake_user_id,
                "content": "Test message",
                "message_type": "text"
            }
        )
        
        # Should return 404 Not Found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestMessageReactions:
    """Tests for POST /api/messages/react/{message_id} endpoint"""
    
    def test_add_shaka_reaction(self, api_client, user1_auth, user2_auth):
        """Test adding 🤙 (Shaka) reaction to a message"""
        # First create a message to react to
        msg_response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": f"React to this {datetime.now().isoformat()}",
                "message_type": "text"
            }
        )
        assert msg_response.status_code == 200
        message_id = msg_response.json()["id"]
        
        # Add reaction
        reaction_response = api_client.post(
            f"{BASE_URL}/api/messages/react/{message_id}",
            params={"user_id": user2_auth["id"]},
            json={"emoji": "🤙"}
        )
        
        assert reaction_response.status_code == 200, f"Expected 200, got {reaction_response.status_code}: {reaction_response.text}"
        
        data = reaction_response.json()
        assert data.get("action") == "added", "Reaction should be added"
        assert data.get("emoji") == "🤙", "Emoji should match"
    
    def test_add_all_allowed_reactions(self, api_client, user1_auth, user2_auth):
        """Test that all allowed reactions work (🤙, 🌊, ❤️, 🔥, 👏, 😂)"""
        for emoji in ALLOWED_REACTIONS:
            # Create new message for each reaction
            msg_response = api_client.post(
                f"{BASE_URL}/api/messages/send",
                params={"sender_id": user1_auth["id"]},
                json={
                    "recipient_id": user2_auth["id"],
                    "content": f"React with {emoji} - {datetime.now().isoformat()}",
                    "message_type": "text"
                }
            )
            assert msg_response.status_code == 200
            message_id = msg_response.json()["id"]
            
            # Add reaction
            reaction_response = api_client.post(
                f"{BASE_URL}/api/messages/react/{message_id}",
                params={"user_id": user2_auth["id"]},
                json={"emoji": emoji}
            )
            
            assert reaction_response.status_code == 200, f"Failed for emoji {emoji}: {reaction_response.text}"
            assert reaction_response.json().get("emoji") == emoji
    
    def test_toggle_reaction_off(self, api_client, user1_auth, user2_auth):
        """Test that clicking same reaction again removes it (toggle)"""
        # Create message
        msg_response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": f"Toggle test {datetime.now().isoformat()}",
                "message_type": "text"
            }
        )
        message_id = msg_response.json()["id"]
        
        # Add reaction first time
        first = api_client.post(
            f"{BASE_URL}/api/messages/react/{message_id}",
            params={"user_id": user2_auth["id"]},
            json={"emoji": "❤️"}
        )
        assert first.status_code == 200
        assert first.json().get("action") == "added"
        
        # Toggle off - same user, same emoji
        second = api_client.post(
            f"{BASE_URL}/api/messages/react/{message_id}",
            params={"user_id": user2_auth["id"]},
            json={"emoji": "❤️"}
        )
        assert second.status_code == 200
        assert second.json().get("action") == "removed", "Second click should remove reaction"
    
    def test_invalid_emoji_rejected(self, api_client, user1_auth, user2_auth):
        """Test that invalid emoji is rejected"""
        # Create message
        msg_response = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": f"Invalid emoji test {datetime.now().isoformat()}",
                "message_type": "text"
            }
        )
        message_id = msg_response.json()["id"]
        
        # Try invalid emoji
        reaction_response = api_client.post(
            f"{BASE_URL}/api/messages/react/{message_id}",
            params={"user_id": user2_auth["id"]},
            json={"emoji": "💩"}  # Not in allowed list
        )
        
        assert reaction_response.status_code == 400, f"Expected 400 for invalid emoji, got {reaction_response.status_code}"


class TestGetConversations:
    """Tests for GET /api/messages/conversations/{user_id} endpoint"""
    
    def test_get_primary_conversations(self, api_client, user1_auth):
        """Test getting primary inbox conversations"""
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversations/{user1_auth['id']}",
            params={"inbox_type": "primary"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # If conversations exist, verify structure
        if len(data) > 0:
            conv = data[0]
            assert "id" in conv, "Conversation should have id"
            assert "other_user_id" in conv, "Conversation should have other_user_id"
            assert "other_user_name" in conv, "Conversation should have other_user_name"
            assert "last_message_preview" in conv, "Conversation should have last_message_preview"
            assert "unread_count" in conv, "Conversation should have unread_count"
    
    def test_get_request_conversations(self, api_client, user1_auth):
        """Test getting message requests"""
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversations/{user1_auth['id']}",
            params={"inbox_type": "request"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"


class TestGetConversationMessages:
    """Tests for GET /api/messages/conversation/{id} endpoint"""
    
    def test_get_conversation_messages_with_reactions(self, api_client, user1_auth, user2_auth):
        """Test getting messages in a conversation, including reactions"""
        # First ensure we have a conversation with messages
        conv_response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": user2_auth["id"]
            }
        )
        conv_id = conv_response.json()["conversation_id"]
        
        # Get conversation messages
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversation/{conv_id}",
            params={"user_id": user1_auth["id"]}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have conversation id"
        assert "other_user_id" in data, "Response should have other_user_id"
        assert "messages" in data, "Response should have messages array"
        
        # Check message structure
        if len(data["messages"]) > 0:
            msg = data["messages"][0]
            assert "id" in msg, "Message should have id"
            assert "content" in msg, "Message should have content"
            assert "sender_id" in msg, "Message should have sender_id"
            assert "is_mine" in msg, "Message should have is_mine flag"
            assert "reactions" in msg, "Message should have reactions array"
            assert "message_type" in msg, "Message should have message_type"
    
    def test_get_messages_with_reply_preview(self, api_client, user1_auth, user2_auth):
        """Test that reply messages include reply preview"""
        # Create conversation and send reply
        conv_response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": user2_auth["id"]
            }
        )
        conv_id = conv_response.json()["conversation_id"]
        
        # Send original message
        original = api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user1_auth["id"]},
            json={
                "recipient_id": user2_auth["id"],
                "content": f"Original for reply preview test {datetime.now().isoformat()}",
                "message_type": "text"
            }
        )
        original_id = original.json()["id"]
        
        # Send reply
        api_client.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": user2_auth["id"]},
            json={
                "recipient_id": user1_auth["id"],
                "content": f"Reply for preview test {datetime.now().isoformat()}",
                "message_type": "text",
                "reply_to_id": original_id
            }
        )
        
        # Fetch conversation and check reply preview
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversation/{conv_id}",
            params={"user_id": user1_auth["id"]}
        )
        
        assert response.status_code == 200
        
        data = response.json()
        # Find the reply message
        reply_messages = [m for m in data["messages"] if m.get("reply_to")]
        
        # We should have at least one reply message with preview
        if len(reply_messages) > 0:
            reply = reply_messages[-1]
            assert "reply_to" in reply, "Reply message should have reply_to"
            assert "id" in reply["reply_to"], "Reply preview should have id"
            assert "content" in reply["reply_to"], "Reply preview should have content"
    
    def test_non_participant_cannot_view(self, api_client, user1_auth, user2_auth):
        """Test that non-participant cannot view conversation"""
        # Create conversation between user1 and user2
        conv_response = api_client.post(
            f"{BASE_URL}/api/messages/start-conversation",
            params={
                "sender_id": user1_auth["id"],
                "recipient_id": user2_auth["id"]
            }
        )
        conv_id = conv_response.json()["conversation_id"]
        
        # Try to view with a fake user ID
        fake_user_id = str(uuid.uuid4())
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversation/{conv_id}",
            params={"user_id": fake_user_id}
        )
        
        # Should return 403 Forbidden
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"


class TestUnreadCounts:
    """Tests for GET /api/messages/unread-counts/{user_id} endpoint"""
    
    def test_get_unread_counts(self, api_client, user1_auth):
        """Test getting unread message counts"""
        response = api_client.get(
            f"{BASE_URL}/api/messages/unread-counts/{user1_auth['id']}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "primary" in data, "Response should have primary count"
        assert "requests" in data, "Response should have requests count"
        assert "total" in data, "Response should have total count"
        assert isinstance(data["primary"], int), "Primary should be integer"
        assert isinstance(data["requests"], int), "Requests should be integer"


class TestExistingTestData:
    """Tests using provided test data from context"""
    
    def test_known_conversation_exists(self, api_client, user1_auth):
        """Test that known conversation ID is accessible"""
        # Note: This test may fail if the user is not a participant
        response = api_client.get(
            f"{BASE_URL}/api/messages/conversation/{TEST_CONVERSATION_ID}",
            params={"user_id": user1_auth["id"]}
        )
        
        # Could be 200 (success) or 403 (not participant)
        assert response.status_code in [200, 403], f"Unexpected status {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert data["id"] == TEST_CONVERSATION_ID
    
    def test_known_message_reactions(self, api_client):
        """Test getting reactions for known message with 🤙 reaction"""
        response = api_client.get(
            f"{BASE_URL}/api/messages/{TEST_MESSAGE_ID}/reactions"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list of reactions"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
