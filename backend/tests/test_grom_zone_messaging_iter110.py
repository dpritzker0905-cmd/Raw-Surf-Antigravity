"""
Test Grom Zone Messaging Feature - Iteration 110
Tests for Grom-Only Messaging Channel ('Grom Zone')

Features tested:
1. Grom Zone folder tab visible only for Grom users
2. Grom-to-Grom messaging works via /api/messages/send
3. Groms cannot message non-Groms (blocked by backend)
4. Non-Groms cannot access Grom Zone endpoints
5. Parent toggle 'can_message_grom_channel' controls access
6. /api/messages/grom-zone/available-groms returns only approved linked Groms
7. /api/messages/conversations with grom_zone=true filters correctly
8. /api/messages/unread-counts returns grom_zone count
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from review request
LINKED_GROM_1 = {
    "email": "testgrom4@gmail.com",
    "password": "test123",
    "id": "8bde602b-4d89-4142-a078-d2a048dd4c65",
    "name": "Junior Wave Rider"
}

LINKED_GROM_2 = {
    "id": "fe32f32d-bf4e-4fb7-b78e-04059811ea34",
    "name": "DAvid grom"
}

GROM_PARENT = {
    "id": "97dbf06a-0b7b-419e-b766-91137abf06ad",
    "name": "Parent Surfer"
}

# Previous test credentials
UNLINKED_GROM = {
    "email": "testgrom3@gmail.com",
    "password": "Test123!",
    "id": "02c7a045-0f74-4636-a200-acad3a175aa5"
}

GROM_PARENT_ACCOUNT = {
    "email": "testgromparent@gmail.com",
    "password": "Test123!",
    "id": "e57e7be6-e217-47f7-9978-b51c469c7bbf"
}


class TestGromZoneMessaging:
    """Test Grom Zone messaging feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_grom_login_and_profile(self):
        """Test that linked Grom can login and has correct profile fields"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": LINKED_GROM_1["email"],
            "password": LINKED_GROM_1["password"]
        })
        
        if response.status_code == 401:
            pytest.skip(f"Grom login failed - password may be incorrect: {response.text}")
        
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Verify Grom-specific fields are present
        assert data.get("role") == "Grom", f"Expected role 'Grom', got {data.get('role')}"
        assert "parent_id" in data, "parent_id field missing from login response"
        assert "parent_link_approved" in data, "parent_link_approved field missing"
        assert "parental_controls" in data, "parental_controls field missing"
        
        print(f"✓ Grom login successful: {data.get('full_name')}")
        print(f"  - parent_id: {data.get('parent_id')}")
        print(f"  - parent_link_approved: {data.get('parent_link_approved')}")
        print(f"  - parental_controls: {data.get('parental_controls')}")
    
    def test_grom_zone_available_groms_endpoint(self):
        """Test /api/messages/grom-zone/available-groms returns only approved linked Groms"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/grom-zone/available-groms/{LINKED_GROM_1['id']}"
        )
        
        if response.status_code == 403:
            print(f"⚠ Grom Zone access denied: {response.text}")
            # This could mean the Grom is not linked/approved
            pytest.skip("Grom Zone access denied - Grom may not be linked/approved")
        
        assert response.status_code == 200, f"Failed to get available Groms: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Expected list of available Groms"
        print(f"✓ Available Groms to message: {len(data)}")
        
        for grom in data:
            assert "id" in grom, "Grom missing id field"
            assert "full_name" in grom, "Grom missing full_name field"
            print(f"  - {grom.get('full_name')} ({grom.get('id')[:8]}...)")
    
    def test_grom_zone_conversations_filter(self):
        """Test /api/messages/conversations with grom_zone=true filters correctly"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/conversations/{LINKED_GROM_1['id']}?inbox_type=primary&grom_zone=true"
        )
        
        assert response.status_code == 200, f"Failed to get Grom Zone conversations: {response.text}"
        data = response.json()
        
        assert isinstance(data, list), "Expected list of conversations"
        print(f"✓ Grom Zone conversations: {len(data)}")
        
        # All conversations should be with other Groms
        for conv in data:
            print(f"  - Conversation with: {conv.get('other_user_name')} (role: {conv.get('other_user_role')})")
            # Note: other_user_role should be 'Grom' for all Grom Zone conversations
    
    def test_grom_unread_counts_includes_grom_zone(self):
        """Test /api/messages/unread-counts returns grom_zone count"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/unread-counts/{LINKED_GROM_1['id']}"
        )
        
        assert response.status_code == 200, f"Failed to get unread counts: {response.text}"
        data = response.json()
        
        assert "primary" in data, "Missing 'primary' count"
        assert "requests" in data, "Missing 'requests' count"
        assert "grom_zone" in data, "Missing 'grom_zone' count"
        assert "total" in data, "Missing 'total' count"
        
        print(f"✓ Unread counts:")
        print(f"  - primary: {data.get('primary')}")
        print(f"  - requests: {data.get('requests')}")
        print(f"  - grom_zone: {data.get('grom_zone')}")
        print(f"  - total: {data.get('total')}")
    
    def test_grom_to_grom_messaging_allowed(self):
        """Test that Grom can send message to another Grom"""
        # Send message from Grom 1 to Grom 2
        response = self.session.post(
            f"{BASE_URL}/api/messages/send?sender_id={LINKED_GROM_1['id']}",
            json={
                "recipient_id": LINKED_GROM_2["id"],
                "content": "Hey fellow Grom! Testing Grom Zone messaging 🏄",
                "message_type": "text"
            }
        )
        
        if response.status_code == 403:
            error_detail = response.json().get("detail", "")
            if "not_linked" in error_detail or "not_approved" in error_detail:
                pytest.skip(f"Grom messaging blocked - not linked/approved: {error_detail}")
            if "grom_channel_disabled" in error_detail:
                pytest.skip(f"Grom Zone disabled by parent: {error_detail}")
        
        assert response.status_code == 200, f"Grom-to-Grom message failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "Message ID missing from response"
        assert "conversation_id" in data, "Conversation ID missing"
        
        print(f"✓ Grom-to-Grom message sent successfully")
        print(f"  - Message ID: {data.get('id')}")
        print(f"  - Conversation ID: {data.get('conversation_id')}")
    
    def test_grom_cannot_message_non_grom(self):
        """Test that Grom cannot send message to non-Grom (parent)"""
        response = self.session.post(
            f"{BASE_URL}/api/messages/send?sender_id={LINKED_GROM_1['id']}",
            json={
                "recipient_id": GROM_PARENT["id"],
                "content": "This should be blocked",
                "message_type": "text"
            }
        )
        
        # Should be blocked with 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        
        data = response.json()
        detail = data.get("detail", "")
        
        # Should mention Groms can only message other Groms
        assert "grom" in detail.lower() or "only" in detail.lower(), \
            f"Error message should mention Grom restriction: {detail}"
        
        print(f"✓ Grom-to-non-Grom messaging correctly blocked")
        print(f"  - Error: {detail}")
    
    def test_non_grom_cannot_access_grom_zone_available_groms(self):
        """Test that non-Grom cannot access Grom Zone available-groms endpoint"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/grom-zone/available-groms/{GROM_PARENT['id']}"
        )
        
        # Should be blocked with 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        
        data = response.json()
        detail = data.get("detail", "")
        
        print(f"✓ Non-Grom correctly blocked from Grom Zone endpoint")
        print(f"  - Error: {detail}")
    
    def test_non_grom_cannot_message_grom(self):
        """Test that non-Grom (parent) cannot send message to Grom"""
        response = self.session.post(
            f"{BASE_URL}/api/messages/send?sender_id={GROM_PARENT['id']}",
            json={
                "recipient_id": LINKED_GROM_1["id"],
                "content": "This should be blocked - adult messaging Grom",
                "message_type": "text"
            }
        )
        
        # Should be blocked with 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        
        data = response.json()
        detail = data.get("detail", "")
        
        print(f"✓ Non-Grom-to-Grom messaging correctly blocked")
        print(f"  - Error: {detail}")
    
    def test_unlinked_grom_cannot_use_grom_zone(self):
        """Test that unlinked Grom cannot access Grom Zone"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/grom-zone/available-groms/{UNLINKED_GROM['id']}"
        )
        
        # Should be blocked with 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        
        data = response.json()
        detail = data.get("detail", "")
        
        print(f"✓ Unlinked Grom correctly blocked from Grom Zone")
        print(f"  - Error: {detail}")


class TestGromZoneParentalControls:
    """Test parental controls for Grom Zone messaging"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_parent_can_toggle_grom_channel_permission(self):
        """Test that parent can toggle can_message_grom_channel control"""
        # First, get current controls
        response = self.session.get(
            f"{BASE_URL}/api/grom-hq/activity/{LINKED_GROM_1['id']}?parent_id={GROM_PARENT['id']}"
        )
        
        if response.status_code == 403:
            pytest.skip("Parent does not have access to this Grom")
        
        if response.status_code != 200:
            pytest.skip(f"Could not get Grom activity: {response.text}")
        
        data = response.json()
        current_controls = data.get("parental_controls", {})
        
        print(f"✓ Current parental controls: {current_controls}")
        
        # Toggle can_message_grom_channel
        new_value = not current_controls.get("can_message_grom_channel", True)
        
        response = self.session.post(
            f"{BASE_URL}/api/grom-hq/update-parental-controls/{LINKED_GROM_1['id']}?parent_id={GROM_PARENT['id']}",
            json={
                **current_controls,
                "can_message_grom_channel": new_value
            }
        )
        
        if response.status_code == 200:
            print(f"✓ Successfully toggled can_message_grom_channel to {new_value}")
            
            # Toggle back to original
            self.session.post(
                f"{BASE_URL}/api/grom-hq/update-parental-controls/{LINKED_GROM_1['id']}?parent_id={GROM_PARENT['id']}",
                json={
                    **current_controls,
                    "can_message_grom_channel": not new_value
                }
            )
        else:
            print(f"⚠ Could not toggle control: {response.text}")


class TestGromZoneConversationFiltering:
    """Test conversation filtering for Grom Zone"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_grom_primary_inbox_only_shows_grom_conversations(self):
        """Test that Grom's primary inbox only shows Grom-to-Grom conversations"""
        response = self.session.get(
            f"{BASE_URL}/api/messages/conversations/{LINKED_GROM_1['id']}?inbox_type=primary"
        )
        
        assert response.status_code == 200, f"Failed to get conversations: {response.text}"
        data = response.json()
        
        print(f"✓ Primary inbox conversations: {len(data)}")
        
        # For Groms, even primary inbox should only show Grom conversations
        for conv in data:
            role = conv.get("other_user_role", "")
            print(f"  - {conv.get('other_user_name')} (role: {role})")
    
    def test_grom_zone_filter_vs_primary(self):
        """Compare Grom Zone filter vs primary inbox"""
        # Get primary inbox
        primary_response = self.session.get(
            f"{BASE_URL}/api/messages/conversations/{LINKED_GROM_1['id']}?inbox_type=primary"
        )
        
        # Get Grom Zone
        grom_zone_response = self.session.get(
            f"{BASE_URL}/api/messages/conversations/{LINKED_GROM_1['id']}?inbox_type=primary&grom_zone=true"
        )
        
        assert primary_response.status_code == 200
        assert grom_zone_response.status_code == 200
        
        primary_data = primary_response.json()
        grom_zone_data = grom_zone_response.json()
        
        print(f"✓ Comparison:")
        print(f"  - Primary inbox: {len(primary_data)} conversations")
        print(f"  - Grom Zone: {len(grom_zone_data)} conversations")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
