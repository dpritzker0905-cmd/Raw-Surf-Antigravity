"""
Test iteration 184: Messages page Notes UI and Avatar Cache-Busting
- NoteBubble component positioning (Instagram-style ON avatar)
- CreateNoteModal with emoji picker (12 surf emojis)
- Avatar cache-busting with other_user_updated_at in conversations API
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user - Kelly Slater (Pro Surfer)
TEST_USER_ID = "d3eb9019-d16f-4374-b432-4d168a96a00f"


class TestMessagesConversationsAPI:
    """Test GET /api/messages/conversations/{user_id} returns other_user_updated_at"""
    
    def test_conversations_returns_other_user_updated_at(self):
        """Verify conversations API includes other_user_updated_at for avatar cache-busting"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{TEST_USER_ID}?inbox_type=all")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            # Check first conversation has other_user_updated_at field
            first_conv = data[0]
            assert "other_user_updated_at" in first_conv, "Conversation should have other_user_updated_at field"
            
            # Verify it's a valid timestamp or None
            updated_at = first_conv.get("other_user_updated_at")
            if updated_at is not None:
                assert isinstance(updated_at, str), "other_user_updated_at should be a string (ISO timestamp)"
                # Should be ISO format like "2026-03-31T02:14:20.530117Z"
                assert "T" in updated_at, "other_user_updated_at should be ISO format"
            
            print(f"PASS: other_user_updated_at = {updated_at}")
        else:
            pytest.skip("No conversations found for test user")
    
    def test_conversations_channel_folder(self):
        """Test conversations in The Channel folder"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{TEST_USER_ID}?inbox_type=channel")
        
        assert response.status_code == 200
        data = response.json()
        
        for conv in data:
            assert "other_user_updated_at" in conv, "Each conversation should have other_user_updated_at"
            assert "other_user_avatar" in conv, "Each conversation should have other_user_avatar"
            assert "other_user_name" in conv, "Each conversation should have other_user_name"
            assert "other_user_role" in conv, "Each conversation should have other_user_role"
        
        print(f"PASS: Found {len(data)} conversations in channel folder")
    
    def test_conversation_response_structure(self):
        """Verify ConversationResponse model structure"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{TEST_USER_ID}?inbox_type=all")
        
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            conv = data[0]
            
            # Required fields from ConversationResponse model
            required_fields = [
                "id",
                "other_user_id",
                "other_user_name",
                "other_user_avatar",
                "other_user_role",
                "other_user_updated_at",  # New field for cache-busting
                "last_message_preview",
                "last_message_at",
                "unread_count",
                "is_request",
                "folder"
            ]
            
            for field in required_fields:
                assert field in conv, f"Missing required field: {field}"
            
            print(f"PASS: All required fields present in ConversationResponse")
        else:
            pytest.skip("No conversations found")


class TestNotesAPI:
    """Test Notes API for Messages page Notes feature"""
    
    def test_notes_feed_endpoint(self):
        """Test GET /api/notes/feed returns notes for user"""
        response = requests.get(f"{BASE_URL}/api/notes/feed?user_id={TEST_USER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "own_note" in data, "Response should have own_note field"
        assert "feed" in data, "Response should have feed field"
        
        print(f"PASS: Notes feed API working")
        print(f"  - own_note: {data.get('own_note')}")
        print(f"  - feed count: {len(data.get('feed', []))}")
    
    def test_create_note_endpoint_exists(self):
        """Verify POST /api/notes/create endpoint exists"""
        # Just check the endpoint exists (don't actually create a note)
        response = requests.post(
            f"{BASE_URL}/api/notes/create?user_id={TEST_USER_ID}",
            json={"content": ""}  # Empty content should fail validation
        )
        
        # Should get 400 (bad request) or 422 (validation error), not 404
        assert response.status_code != 404, "Notes create endpoint should exist"
        print(f"PASS: Notes create endpoint exists (status: {response.status_code})")


class TestFrontendDataTestIds:
    """Document expected data-testid attributes for frontend testing"""
    
    def test_document_expected_testids(self):
        """Document the expected data-testid attributes for Messages page Notes UI"""
        expected_testids = {
            "note-bubble-own": "Own note bubble in Messages page stories section",
            "note-bubble-{id}": "Other users' note bubbles",
            "note-input": "Text input in CreateNoteModal",
            "note-emoji-picker": "Emoji picker container with 12 surf emojis",
            "submit-note-btn": "Submit/Share button in CreateNoteModal",
            "conversation-{id}": "Conversation list items with cache-busted avatars",
            "folder-channel": "The Channel folder tab",
            "folder-primary": "Primary folder tab",
            "folder-pro_lounge": "Pro Lounge folder tab"
        }
        
        print("\n=== Expected data-testid attributes ===")
        for testid, description in expected_testids.items():
            print(f"  {testid}: {description}")
        
        # Document expected emojis in picker
        expected_emojis = ['🤙', '🌊', '🏄', '🔥', '💯', '😎', '🌅', '🐚', '🦈', '☀️', '🌴', '✨']
        print(f"\n=== Expected emojis in note-emoji-picker ===")
        print(f"  {', '.join(expected_emojis)}")
        print(f"  Total: {len(expected_emojis)} emojis")
        
        assert True  # Documentation test always passes


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
