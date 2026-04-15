"""
Test Crew Chat Emoji Picker and Message Reactions
Tests for iteration 134 - Emoji picker and message reactions feature
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from previous iteration
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_USER_PASSWORD = "test123"
TEST_BOOKING_ID = "eb3ab6be-394a-44ce-86e7-215251b6b2d0"


class TestReactionEmojisEndpoint:
    """Test GET /api/crew-chat/reaction-emojis endpoint"""
    
    def test_get_reaction_emojis_returns_list(self):
        """Verify reaction emojis endpoint returns expected emojis"""
        response = requests.get(f"{BASE_URL}/api/crew-chat/reaction-emojis")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "emojis" in data, "Response should contain 'emojis' key"
        
        emojis = data["emojis"]
        assert isinstance(emojis, list), "Emojis should be a list"
        assert len(emojis) == 8, f"Expected 8 emojis, got {len(emojis)}"
        
        # Verify expected surf-themed emojis
        expected_emojis = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂']
        for emoji in expected_emojis:
            assert emoji in emojis, f"Expected emoji {emoji} not found in response"
        
        print(f"✓ Reaction emojis endpoint returns correct emojis: {emojis}")


class TestMessageReactions:
    """Test message reaction endpoints"""
    
    @pytest.fixture
    def auth_session(self):
        """Get authenticated session"""
        session = requests.Session()
        
        # Login to get user ID
        login_response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        
        if login_response.status_code != 200:
            pytest.skip(f"Login failed: {login_response.status_code} - {login_response.text}")
        
        user_data = login_response.json()
        session.user_id = user_data.get("user", {}).get("id")
        
        if not session.user_id:
            pytest.skip("Could not get user ID from login response")
        
        return session
    
    def test_add_reaction_to_message(self, auth_session):
        """Test adding a reaction to a message"""
        user_id = auth_session.user_id
        
        # First, get messages to find a message ID
        messages_response = auth_session.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages",
            params={"user_id": user_id, "limit": 10}
        )
        
        if messages_response.status_code == 403:
            pytest.skip("User doesn't have access to this booking chat")
        
        assert messages_response.status_code == 200, f"Failed to get messages: {messages_response.text}"
        
        messages_data = messages_response.json()
        messages = messages_data.get("messages", [])
        
        if not messages:
            # Send a test message first
            send_response = auth_session.post(
                f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/send",
                params={"user_id": user_id},
                json={"content": "Test message for reactions", "message_type": "text"}
            )
            
            if send_response.status_code != 200:
                pytest.skip(f"Could not send test message: {send_response.text}")
            
            message_id = send_response.json().get("message_id")
        else:
            message_id = messages[0]["id"]
        
        # Add a reaction
        emoji = "🤙"
        react_response = auth_session.post(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages/{message_id}/react",
            params={"user_id": user_id, "emoji": emoji}
        )
        
        assert react_response.status_code == 200, f"Failed to add reaction: {react_response.text}"
        
        react_data = react_response.json()
        assert react_data.get("success") == True, "Reaction should succeed"
        assert react_data.get("emoji") == emoji, f"Expected emoji {emoji}"
        assert "reactions" in react_data, "Response should contain reactions"
        
        print(f"✓ Successfully added reaction {emoji} to message {message_id}")
        print(f"  Action: {react_data.get('action')}")
        print(f"  Reactions: {react_data.get('reactions')}")
    
    def test_toggle_reaction_removes_it(self, auth_session):
        """Test that clicking same reaction again removes it"""
        user_id = auth_session.user_id
        
        # Get a message
        messages_response = auth_session.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages",
            params={"user_id": user_id, "limit": 10}
        )
        
        if messages_response.status_code == 403:
            pytest.skip("User doesn't have access to this booking chat")
        
        messages = messages_response.json().get("messages", [])
        if not messages:
            pytest.skip("No messages to test reactions on")
        
        message_id = messages[0]["id"]
        emoji = "🌊"
        
        # Add reaction
        react1 = auth_session.post(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages/{message_id}/react",
            params={"user_id": user_id, "emoji": emoji}
        )
        assert react1.status_code == 200
        action1 = react1.json().get("action")
        
        # Toggle (add or remove depending on current state)
        react2 = auth_session.post(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages/{message_id}/react",
            params={"user_id": user_id, "emoji": emoji}
        )
        assert react2.status_code == 200
        action2 = react2.json().get("action")
        
        # Actions should be opposite
        assert action1 != action2, f"Toggle should change action: first={action1}, second={action2}"
        
        print(f"✓ Reaction toggle works: first action={action1}, second action={action2}")
    
    def test_invalid_emoji_rejected(self, auth_session):
        """Test that invalid emojis are rejected"""
        user_id = auth_session.user_id
        
        # Get a message
        messages_response = auth_session.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages",
            params={"user_id": user_id, "limit": 10}
        )
        
        if messages_response.status_code == 403:
            pytest.skip("User doesn't have access to this booking chat")
        
        messages = messages_response.json().get("messages", [])
        if not messages:
            pytest.skip("No messages to test reactions on")
        
        message_id = messages[0]["id"]
        invalid_emoji = "🍕"  # Not in allowed list
        
        react_response = auth_session.post(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages/{message_id}/react",
            params={"user_id": user_id, "emoji": invalid_emoji}
        )
        
        assert react_response.status_code == 400, f"Expected 400 for invalid emoji, got {react_response.status_code}"
        
        print(f"✓ Invalid emoji {invalid_emoji} correctly rejected with 400")
    
    def test_reactions_included_in_messages(self, auth_session):
        """Test that reactions are included when fetching messages"""
        user_id = auth_session.user_id
        
        messages_response = auth_session.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages",
            params={"user_id": user_id, "limit": 10}
        )
        
        if messages_response.status_code == 403:
            pytest.skip("User doesn't have access to this booking chat")
        
        assert messages_response.status_code == 200
        
        messages = messages_response.json().get("messages", [])
        
        # Check that messages have reactions field
        for msg in messages:
            assert "reactions" in msg, f"Message {msg.get('id')} should have reactions field"
            assert isinstance(msg["reactions"], dict), "Reactions should be a dict"
        
        print(f"✓ All {len(messages)} messages include reactions field")


class TestQuickActionsEndpoint:
    """Test quick actions endpoint (related to emoji/reactions feature)"""
    
    def test_get_quick_actions(self):
        """Verify quick actions endpoint returns expected data"""
        response = requests.get(f"{BASE_URL}/api/crew-chat/quick-actions")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "quick_actions" in data, "Response should contain quick_actions"
        assert "categories" in data, "Response should contain categories"
        
        quick_actions = data["quick_actions"]
        assert len(quick_actions) > 0, "Should have at least one quick action"
        
        # Verify structure
        for action in quick_actions:
            assert "id" in action, "Quick action should have id"
            assert "text" in action, "Quick action should have text"
            assert "category" in action, "Quick action should have category"
        
        print(f"✓ Quick actions endpoint returns {len(quick_actions)} actions")
        print(f"  Categories: {data['categories']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
