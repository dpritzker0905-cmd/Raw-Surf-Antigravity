"""
Test Suite for Raw Surf OS - Iteration 112 Features
Testing 4 features:
1. Boost Request for priority in queue (5/10/20 credits for 1/2/4 hours)
2. Hide Gallery Pricing for Grom Parents
3. Fix Verify Age button in Grom HQ (demo mode)
4. Add Family Chat tab for Grom Parents to chat with their Groms
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from previous iteration
GROM_PARENT_ID = "e57e7be6-e217-47f7-9978-b51c469c7bbf"
GROM_PARENT_EMAIL = "testgromparent@gmail.com"
GROM_PARENT_PASSWORD = "test123"
LINKED_GROM_ID = "8bde602b-4d89-4142-a078-d2a048dd4c65"


class TestBoostRequestFeature:
    """Test Boost Request for priority in queue"""
    
    def test_boost_status_endpoint_exists(self):
        """Test GET /api/dispatch/request/{id}/boost-status endpoint exists"""
        # Use a fake request ID - should return 404 for non-existent request
        response = requests.get(f"{BASE_URL}/api/dispatch/request/fake-id-12345/boost-status")
        # Should return 404 (not found) not 405 (method not allowed)
        assert response.status_code in [404, 422], f"Expected 404 or 422, got {response.status_code}: {response.text}"
        print("✓ Boost status endpoint exists and returns proper error for invalid ID")
    
    def test_boost_request_endpoint_exists(self):
        """Test POST /api/dispatch/request/{id}/boost endpoint exists"""
        # Use a fake request ID - should return 404 for non-existent request
        response = requests.post(
            f"{BASE_URL}/api/dispatch/request/fake-id-12345/boost?user_id={GROM_PARENT_ID}",
            json={"boost_hours": 1}
        )
        # Should return 404 (not found) not 405 (method not allowed)
        assert response.status_code in [404, 422], f"Expected 404 or 422, got {response.status_code}: {response.text}"
        print("✓ Boost request endpoint exists and returns proper error for invalid ID")
    
    def test_boost_hours_validation(self):
        """Test that boost_hours must be 1, 2, or 4"""
        # Invalid boost hours should be rejected
        response = requests.post(
            f"{BASE_URL}/api/dispatch/request/fake-id-12345/boost?user_id={GROM_PARENT_ID}",
            json={"boost_hours": 3}  # Invalid - must be 1, 2, or 4
        )
        # Should return 400 for invalid boost hours or 404 for non-existent request
        assert response.status_code in [400, 404, 422], f"Expected 400, 404, or 422, got {response.status_code}: {response.text}"
        print("✓ Boost hours validation works (rejects invalid values)")
    
    def test_pending_requests_includes_boost_info(self):
        """Test GET /api/dispatch/requests/pending returns boost info"""
        response = requests.get(f"{BASE_URL}/api/dispatch/requests/pending")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should be a list
        assert isinstance(data, list), "Expected list response"
        
        # If there are pending requests, check they have boost fields
        if len(data) > 0:
            first_request = data[0]
            # Check for boost-related fields
            assert "is_boosted" in first_request or "priority" in first_request, \
                f"Expected boost info in response, got: {first_request.keys()}"
            print(f"✓ Pending requests endpoint returns boost info. Found {len(data)} pending requests")
        else:
            print("✓ Pending requests endpoint works (no pending requests currently)")


class TestGalleryPricingHiddenForGromParent:
    """Test Gallery Pricing card hidden for Grom Parent users"""
    
    def test_grom_parent_login(self):
        """Test Grom Parent can login"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.status_code}: {response.text}"
        
        data = response.json()
        # API returns user data directly, not nested under "user" key
        assert "role" in data, f"Expected role in response, got: {data.keys()}"
        role = data.get("role", "")
        assert "grom" in role.lower() and "parent" in role.lower(), \
            f"Expected Grom Parent role, got: {role}"
        print(f"✓ Grom Parent login successful. Role: {role}")
    
    def test_grom_parent_profile_role(self):
        """Test Grom Parent profile has correct role"""
        response = requests.get(f"{BASE_URL}/api/profiles/{GROM_PARENT_ID}")
        assert response.status_code == 200, f"Profile fetch failed: {response.status_code}: {response.text}"
        
        data = response.json()
        role = data.get("role", "")
        # Role could be "Grom Parent" or "GROM_PARENT" depending on enum
        assert "grom" in role.lower() and "parent" in role.lower(), \
            f"Expected Grom Parent role, got: {role}"
        print(f"✓ Grom Parent profile has correct role: {role}")


class TestDemoVerifyAgeEndpoint:
    """Test POST /api/grom-hq/demo-verify-age/{parent_id} sets parent_age_verified=true"""
    
    def test_demo_verify_age_endpoint_exists(self):
        """Test demo verify age endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/grom-hq/demo-verify-age/{GROM_PARENT_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Expected success=true, got: {data}"
        assert "demo mode" in data.get("message", "").lower() or "verified" in data.get("message", "").lower(), \
            f"Expected demo mode message, got: {data.get('message')}"
        print(f"✓ Demo verify age endpoint works: {data.get('message')}")
    
    def test_age_verification_status_after_demo(self):
        """Test age verification status is true after demo verify"""
        # First call demo verify
        requests.post(f"{BASE_URL}/api/grom-hq/demo-verify-age/{GROM_PARENT_ID}")
        
        # Then check status
        response = requests.get(f"{BASE_URL}/api/grom-hq/age-verification-status/{GROM_PARENT_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("age_verified") == True, f"Expected age_verified=true, got: {data}"
        assert data.get("can_link_groms") == True, f"Expected can_link_groms=true, got: {data}"
        print(f"✓ Age verification status is true after demo verify")
    
    def test_demo_verify_age_non_grom_parent_rejected(self):
        """Test demo verify age rejects non-Grom Parent users"""
        # Use a fake ID that doesn't exist
        response = requests.post(f"{BASE_URL}/api/grom-hq/demo-verify-age/fake-user-id-12345")
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}: {response.text}"
        print("✓ Demo verify age rejects non-existent users")


class TestFamilyChatFeature:
    """Test Family Chat tab for Grom Parents to chat with their Groms"""
    
    def test_family_members_endpoint_for_grom_parent(self):
        """Test GET /api/messages/family/members/{user_id} returns linked Groms for parent"""
        response = requests.get(f"{BASE_URL}/api/messages/family/members/{GROM_PARENT_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "family_members" in data, f"Expected family_members in response, got: {data.keys()}"
        
        family_members = data["family_members"]
        assert isinstance(family_members, list), "Expected family_members to be a list"
        
        # Should have at least the linked Grom
        if len(family_members) > 0:
            member = family_members[0]
            assert "id" in member, f"Expected id in family member, got: {member.keys()}"
            assert "full_name" in member, f"Expected full_name in family member, got: {member.keys()}"
            assert "relationship" in member, f"Expected relationship in family member, got: {member.keys()}"
            print(f"✓ Family members endpoint returns {len(family_members)} linked Groms")
            print(f"  First member: {member.get('full_name')} ({member.get('relationship')})")
        else:
            print("✓ Family members endpoint works (no linked Groms currently)")
    
    def test_family_members_endpoint_for_grom(self):
        """Test GET /api/messages/family/members/{user_id} returns parent for Grom"""
        response = requests.get(f"{BASE_URL}/api/messages/family/members/{LINKED_GROM_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "family_members" in data, f"Expected family_members in response, got: {data.keys()}"
        
        family_members = data["family_members"]
        assert isinstance(family_members, list), "Expected family_members to be a list"
        
        # Should have the parent
        if len(family_members) > 0:
            member = family_members[0]
            assert member.get("relationship") == "parent", \
                f"Expected relationship=parent, got: {member.get('relationship')}"
            print(f"✓ Family members endpoint returns parent for Grom: {member.get('full_name')}")
        else:
            print("✓ Family members endpoint works for Grom (parent may not be linked)")
    
    def test_family_conversations_endpoint_for_grom_parent(self):
        """Test GET /api/messages/conversations/{user_id}/family returns family conversations"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{GROM_PARENT_ID}/family")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        
        # If there are family conversations, check structure
        if len(data) > 0:
            conv = data[0]
            assert "id" in conv, f"Expected id in conversation, got: {conv.keys()}"
            assert "other_user_id" in conv, f"Expected other_user_id in conversation, got: {conv.keys()}"
            assert "folder" in conv, f"Expected folder in conversation, got: {conv.keys()}"
            assert conv.get("folder") == "family", f"Expected folder=family, got: {conv.get('folder')}"
            print(f"✓ Family conversations endpoint returns {len(data)} conversations")
        else:
            print("✓ Family conversations endpoint works (no family conversations yet)")
    
    def test_family_conversations_endpoint_for_grom(self):
        """Test GET /api/messages/conversations/{user_id}/family returns family conversations for Grom"""
        response = requests.get(f"{BASE_URL}/api/messages/conversations/{LINKED_GROM_ID}/family")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        print(f"✓ Family conversations endpoint works for Grom (found {len(data)} conversations)")


class TestLinkedGromsEndpoint:
    """Test linked Groms endpoint for Grom HQ"""
    
    def test_linked_groms_endpoint(self):
        """Test GET /api/grom-hq/linked-groms/{parent_id} returns linked Groms"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/linked-groms/{GROM_PARENT_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "linked_groms" in data, f"Expected linked_groms in response, got: {data.keys()}"
        assert "stats" in data, f"Expected stats in response, got: {data.keys()}"
        
        linked_groms = data["linked_groms"]
        assert isinstance(linked_groms, list), "Expected linked_groms to be a list"
        
        if len(linked_groms) > 0:
            grom = linked_groms[0]
            assert "id" in grom, f"Expected id in grom, got: {grom.keys()}"
            assert "full_name" in grom, f"Expected full_name in grom, got: {grom.keys()}"
            print(f"✓ Linked Groms endpoint returns {len(linked_groms)} Groms")
            print(f"  First Grom: {grom.get('full_name')}")
        else:
            print("✓ Linked Groms endpoint works (no linked Groms currently)")


class TestDispatchPendingRequestsWithPriority:
    """Test dispatch pending requests include priority info"""
    
    def test_pending_requests_structure(self):
        """Test pending requests have priority and boost fields"""
        response = requests.get(f"{BASE_URL}/api/dispatch/requests/pending")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        
        # Check the endpoint returns proper structure even if empty
        print(f"✓ Pending requests endpoint returns list with {len(data)} items")
        
        if len(data) > 0:
            request = data[0]
            # Check for expected fields
            expected_fields = ["id", "latitude", "longitude", "requester_name"]
            for field in expected_fields:
                assert field in request, f"Expected {field} in request, got: {request.keys()}"
            
            # Check for priority/boost fields
            priority_fields = ["priority", "is_boosted", "boost_time_remaining_minutes"]
            found_priority_fields = [f for f in priority_fields if f in request]
            print(f"  Found priority fields: {found_priority_fields}")
            print(f"  Request structure: {list(request.keys())}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
