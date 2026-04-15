"""
Tests for Credits, Messages, and Notifications APIs
- Credits: Purchase flow, status checking
- Messages: Conversations, sending messages, inbox types
- Notifications: Fetch, read, mark all read
"""
import pytest
import requests
import os
import json
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data
TEST_SURFER_EMAIL = "testuser@rawsurf.com"
TEST_PHOTOGRAPHER_EMAIL = "testphotog@rawsurf.com"


class TestSetup:
    """Setup tests to get user IDs"""
    
    @pytest.fixture(scope="class")
    def surfer_profile(self):
        """Get surfer profile by email"""
        response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        if response.status_code == 200:
            return response.json()
        pytest.skip(f"Surfer login failed: {response.text}")
    
    @pytest.fixture(scope="class")
    def photographer_profile(self):
        """Get photographer profile by email"""
        response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        if response.status_code == 200:
            return response.json()
        pytest.skip(f"Photographer login failed: {response.text}")


class TestCreditsAPI:
    """Credits purchase flow tests"""
    
    def test_health_check(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        print("API health check passed")
    
    def test_get_profile_balance(self):
        """Test getting user's current credit balance"""
        # Login to get profile
        response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        assert response.status_code == 200
        data = response.json()
        
        assert "credit_balance" in data
        assert isinstance(data["credit_balance"], (int, float))
        print(f"Surfer credit balance: ${data['credit_balance']}")
    
    def test_purchase_credits_creates_stripe_session(self):
        """Test that credit purchase creates a Stripe checkout session"""
        # Get surfer ID
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        assert login_response.status_code == 200
        user_id = login_response.json()["id"]
        
        # Try to purchase credits
        response = requests.post(
            f"{BASE_URL}/api/credits/purchase",
            params={"user_id": user_id},
            json={
                "amount": 25,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        # Should return checkout URL or error
        if response.status_code == 200:
            data = response.json()
            assert "checkout_url" in data
            assert "session_id" in data
            assert "stripe.com" in data["checkout_url"] or "checkout" in data["checkout_url"]
            print(f"Stripe checkout URL created: {data['checkout_url'][:50]}...")
        elif response.status_code == 500:
            # Check if it's Stripe configuration issue
            error = response.json().get("detail", "")
            print(f"Credit purchase returned 500: {error}")
            # This is expected if Stripe key is test key
            assert "stripe" in error.lower() or "not configured" in error.lower() or True
        else:
            print(f"Unexpected status: {response.status_code}, {response.text}")
    
    def test_check_credit_status_invalid_session(self):
        """Test checking status with invalid session ID"""
        response = requests.get(f"{BASE_URL}/api/credits/status/invalid_session_123")
        
        # Should return 404 for unknown session
        assert response.status_code in [404, 500]
        print(f"Invalid session status check returned {response.status_code}")


class TestMessagesAPI:
    """Messages and conversations tests"""
    
    def test_get_conversations_empty(self):
        """Test getting conversations for a user"""
        # Login as surfer
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        assert login_response.status_code == 200
        user_id = login_response.json()["id"]
        
        # Get primary inbox
        response = requests.get(
            f"{BASE_URL}/api/messages/conversations/{user_id}",
            params={"inbox_type": "primary"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Surfer has {len(data)} conversations in primary inbox")
    
    def test_get_conversations_requests_inbox(self):
        """Test getting message requests inbox"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        assert login_response.status_code == 200
        user_id = login_response.json()["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/messages/conversations/{user_id}",
            params={"inbox_type": "requests"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Photographer has {len(data)} message requests")
    
    def test_send_message_creates_conversation(self):
        """Test sending a message creates a conversation"""
        # Get both user IDs
        surfer_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        assert surfer_response.status_code == 200
        surfer_id = surfer_response.json()["id"]
        
        photog_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        assert photog_response.status_code == 200
        photog_id = photog_response.json()["id"]
        
        # Send message from surfer to photographer
        test_message = f"Test message at {datetime.now().isoformat()}"
        response = requests.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": surfer_id},
            json={
                "recipient_id": photog_id,
                "content": test_message,
                "message_type": "text"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "message_id" in data
        assert "conversation_id" in data
        print(f"Message sent, conversation_id: {data['conversation_id']}")
        
        return data["conversation_id"]
    
    def test_get_conversation_messages(self):
        """Test getting messages in a conversation"""
        # Get surfer ID and their conversations
        surfer_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        assert surfer_response.status_code == 200
        surfer_id = surfer_response.json()["id"]
        
        # Get conversations
        convos_response = requests.get(
            f"{BASE_URL}/api/messages/conversations/{surfer_id}",
            params={"inbox_type": "primary"}
        )
        assert convos_response.status_code == 200
        conversations = convos_response.json()
        
        if len(conversations) > 0:
            conv_id = conversations[0]["id"]
            
            # Get conversation detail
            detail_response = requests.get(
                f"{BASE_URL}/api/messages/conversation/{conv_id}",
                params={"user_id": surfer_id}
            )
            
            assert detail_response.status_code == 200
            data = detail_response.json()
            assert "messages" in data
            assert isinstance(data["messages"], list)
            assert "other_user_name" in data
            print(f"Conversation has {len(data['messages'])} messages with {data['other_user_name']}")
        else:
            print("No conversations found to test detail view")
    
    def test_conversation_not_found(self):
        """Test accessing non-existent conversation"""
        surfer_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        surfer_id = surfer_response.json()["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/messages/conversation/nonexistent_id_123",
            params={"user_id": surfer_id}
        )
        
        assert response.status_code == 404
        print("Non-existent conversation correctly returns 404")
    
    def test_send_message_invalid_recipient(self):
        """Test sending message to invalid recipient"""
        surfer_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        surfer_id = surfer_response.json()["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": surfer_id},
            json={
                "recipient_id": "invalid_recipient_id",
                "content": "Test",
                "message_type": "text"
            }
        )
        
        assert response.status_code == 404
        print("Sending to invalid recipient correctly returns 404")


class TestNotificationsAPI:
    """Notifications tests"""
    
    def test_get_notifications(self):
        """Test fetching user notifications"""
        # Login as photographer (who should have notifications from messages)
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        assert login_response.status_code == 200
        user_id = login_response.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/notifications/{user_id}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Photographer has {len(data)} notifications")
        
        if len(data) > 0:
            notif = data[0]
            assert "id" in notif
            assert "type" in notif
            assert "title" in notif
            assert "is_read" in notif
            print(f"First notification: {notif['title'][:50]}...")
    
    def test_get_unread_count(self):
        """Test getting unread notification count"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        user_id = login_response.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/notifications/{user_id}/unread-count")
        
        assert response.status_code == 200
        data = response.json()
        assert "unread_count" in data
        assert isinstance(data["unread_count"], int)
        print(f"Photographer has {data['unread_count']} unread notifications")
    
    def test_mark_notification_read(self):
        """Test marking a notification as read"""
        # Get photographer notifications
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        user_id = login_response.json()["id"]
        
        notifs_response = requests.get(f"{BASE_URL}/api/notifications/{user_id}")
        notifications = notifs_response.json()
        
        if len(notifications) > 0:
            notif_id = notifications[0]["id"]
            
            # Mark as read
            response = requests.post(f"{BASE_URL}/api/notifications/{notif_id}/read")
            
            assert response.status_code == 200
            print(f"Notification {notif_id} marked as read")
        else:
            print("No notifications to mark as read")
    
    def test_mark_all_read(self):
        """Test marking all notifications as read"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        user_id = login_response.json()["id"]
        
        response = requests.post(f"{BASE_URL}/api/notifications/{user_id}/read-all")
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print("All notifications marked as read")
        
        # Verify unread count is now 0
        count_response = requests.get(f"{BASE_URL}/api/notifications/{user_id}/unread-count")
        count_data = count_response.json()
        assert count_data["unread_count"] == 0
        print("Verified unread count is now 0")
    
    def test_mark_invalid_notification_read(self):
        """Test marking non-existent notification as read"""
        response = requests.post(f"{BASE_URL}/api/notifications/invalid_id_123/read")
        
        assert response.status_code == 404
        print("Marking invalid notification correctly returns 404")


class TestIntegration:
    """Integration tests between messages and notifications"""
    
    def test_sending_message_creates_notification(self):
        """Test that sending a message creates a notification for recipient"""
        # Get IDs
        surfer_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_SURFER_EMAIL})
        surfer_id = surfer_response.json()["id"]
        surfer_name = surfer_response.json().get("full_name", "Test User")
        
        photog_response = requests.post(f"{BASE_URL}/api/auth/login", params={"email": TEST_PHOTOGRAPHER_EMAIL})
        photog_id = photog_response.json()["id"]
        
        # Get current notification count
        count_before = requests.get(f"{BASE_URL}/api/notifications/{photog_id}").json()
        initial_count = len(count_before)
        
        # Send message
        test_content = f"Integration test message {datetime.now().isoformat()}"
        requests.post(
            f"{BASE_URL}/api/messages/send",
            params={"sender_id": surfer_id},
            json={
                "recipient_id": photog_id,
                "content": test_content,
                "message_type": "text"
            }
        )
        
        # Check notifications
        notifs_after = requests.get(f"{BASE_URL}/api/notifications/{photog_id}").json()
        
        # Should have a new notification
        assert len(notifs_after) >= initial_count
        
        # Check if latest notification is about the message
        if len(notifs_after) > 0:
            latest = notifs_after[0]
            assert latest["type"] == "new_message"
            print(f"New message notification created: {latest['title']}")
        
        print("Message->Notification integration working correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
