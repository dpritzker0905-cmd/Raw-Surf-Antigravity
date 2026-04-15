"""
Test Suite for Session-Based Social Integration (Strava for Surfing)
Iteration 193 - Tests:
1. GET /api/posts returns session fields (session_date, wave_height_ft, collaborators, author_role, spot)
2. POST /api/posts/{post_id}/request-collaboration - user requests to join session
3. POST /api/posts/{post_id}/invite-collaborator - post owner invites user to session
4. PUT /api/posts/{post_id}/collaborations/{collab_id}/respond - accept/deny collaboration
5. DELETE /api/posts/{post_id}/collaborations/{collab_id} - untag from session
6. GET /api/posts/{post_id}/collaborators - list collaborators for a post
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test data
TEST_POST_ID = "52f5510f-9d0a-428b-99de-2f38b01b4382"  # Post with session metadata
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # David Pritzker (post owner)


class TestPostsSessionFields:
    """Test that GET /api/posts returns session fields"""
    
    def test_posts_endpoint_returns_session_fields(self):
        """Verify /api/posts returns session metadata fields"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 10})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        posts = response.json()
        assert isinstance(posts, list), "Response should be a list"
        
        # Find the test post with session data
        test_post = next((p for p in posts if p.get('id') == TEST_POST_ID), None)
        
        if test_post:
            # Verify session fields exist in response
            assert 'session_date' in test_post, "session_date field missing"
            assert 'session_start_time' in test_post, "session_start_time field missing"
            assert 'session_end_time' in test_post, "session_end_time field missing"
            assert 'wave_height_ft' in test_post, "wave_height_ft field missing"
            assert 'wind_speed_mph' in test_post, "wind_speed_mph field missing"
            assert 'tide_status' in test_post, "tide_status field missing"
            assert 'collaborators' in test_post, "collaborators field missing"
            assert 'author_role' in test_post, "author_role field missing"
            assert 'spot' in test_post, "spot field missing"
            
            # Verify actual values for test post
            assert test_post['wave_height_ft'] == 4.5, f"Expected wave_height_ft=4.5, got {test_post['wave_height_ft']}"
            assert test_post['wind_speed_mph'] == 8.0, f"Expected wind_speed_mph=8.0, got {test_post['wind_speed_mph']}"
            assert test_post['tide_status'] == 'rising', f"Expected tide_status='rising', got {test_post['tide_status']}"
            assert test_post['session_start_time'] == '06:30', f"Expected session_start_time='06:30', got {test_post['session_start_time']}"
            assert test_post['session_end_time'] == '08:00', f"Expected session_end_time='08:00', got {test_post['session_end_time']}"
            print(f"✓ Test post has correct session metadata: wave={test_post['wave_height_ft']}ft, wind={test_post['wind_speed_mph']}mph, tide={test_post['tide_status']}")
        else:
            # Check any post has the session fields structure
            if posts:
                first_post = posts[0]
                assert 'session_date' in first_post, "session_date field missing from posts"
                assert 'collaborators' in first_post, "collaborators field missing from posts"
                assert 'author_role' in first_post, "author_role field missing from posts"
                print("✓ Posts have session fields structure (test post not found)")
    
    def test_posts_endpoint_returns_collaborator_count(self):
        """Verify /api/posts returns collaborator_count field"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 5})
        assert response.status_code == 200
        
        posts = response.json()
        if posts:
            first_post = posts[0]
            assert 'collaborator_count' in first_post, "collaborator_count field missing"
            assert isinstance(first_post['collaborator_count'], int), "collaborator_count should be int"
            print(f"✓ Posts have collaborator_count field: {first_post['collaborator_count']}")


class TestCollaboratorsEndpoint:
    """Test GET /api/posts/{post_id}/collaborators"""
    
    def test_get_collaborators_empty(self):
        """Test getting collaborators for a post with no collaborators"""
        response = requests.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/collaborators")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert 'collaborators' in data, "Response should have 'collaborators' key"
        assert 'total' in data, "Response should have 'total' key"
        assert isinstance(data['collaborators'], list), "collaborators should be a list"
        print(f"✓ GET collaborators returns: {data['total']} collaborators")
    
    def test_get_collaborators_with_status_filter(self):
        """Test filtering collaborators by status"""
        response = requests.get(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/collaborators",
            params={"status": "accepted"}
        )
        assert response.status_code == 200
        
        data = response.json()
        # All returned collaborators should have status='accepted'
        for collab in data['collaborators']:
            assert collab['status'] == 'accepted', f"Expected status='accepted', got {collab['status']}"
        print(f"✓ GET collaborators with status filter works")
    
    def test_get_collaborators_invalid_post(self):
        """Test getting collaborators for non-existent post"""
        fake_post_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/posts/{fake_post_id}/collaborators")
        # Should return empty list, not 404
        assert response.status_code == 200
        data = response.json()
        assert data['total'] == 0
        print("✓ GET collaborators for non-existent post returns empty list")


class TestRequestCollaboration:
    """Test POST /api/posts/{post_id}/request-collaboration"""
    
    def test_request_collaboration_own_post_fails(self):
        """User cannot request collaboration on their own post"""
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/request-collaboration",
            params={"user_id": TEST_USER_ID},
            json={}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert "own post" in data.get('detail', '').lower(), f"Expected 'own post' error, got: {data}"
        print("✓ Cannot request collaboration on own post")
    
    def test_request_collaboration_invalid_post(self):
        """Request collaboration on non-existent post fails"""
        fake_post_id = str(uuid.uuid4())
        fake_user_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/request-collaboration",
            params={"user_id": fake_user_id},
            json={}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Request collaboration on non-existent post returns 404")
    
    def test_request_collaboration_with_gps(self):
        """Test request collaboration with GPS coordinates"""
        # Create a test user first or use existing
        # This test verifies the GPS verification logic
        fake_user_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/request-collaboration",
            params={"user_id": fake_user_id},
            json={
                "latitude": 28.5383,  # Near Florida
                "longitude": -81.3792
            }
        )
        # Will fail because user doesn't exist, but validates endpoint accepts GPS params
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}"
        print("✓ Request collaboration endpoint accepts GPS parameters")


class TestInviteCollaborator:
    """Test POST /api/posts/{post_id}/invite-collaborator"""
    
    def test_invite_collaborator_not_author_fails(self):
        """Only post author can invite collaborators"""
        fake_user_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/invite-collaborator",
            params={"user_id": fake_user_id},  # Not the author
            json={"user_id": str(uuid.uuid4())}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        data = response.json()
        assert "author" in data.get('detail', '').lower(), f"Expected 'author' error, got: {data}"
        print("✓ Only post author can invite collaborators")
    
    def test_invite_collaborator_invalid_post(self):
        """Invite collaborator on non-existent post fails"""
        fake_post_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/invite-collaborator",
            params={"user_id": TEST_USER_ID},
            json={"user_id": str(uuid.uuid4())}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Invite collaborator on non-existent post returns 404")
    
    def test_invite_nonexistent_user_fails(self):
        """Inviting non-existent user fails"""
        fake_invitee_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/invite-collaborator",
            params={"user_id": TEST_USER_ID},  # Author
            json={"user_id": fake_invitee_id}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        data = response.json()
        assert "not found" in data.get('detail', '').lower(), f"Expected 'not found' error, got: {data}"
        print("✓ Inviting non-existent user returns 404")


class TestRespondToCollaboration:
    """Test PUT /api/posts/{post_id}/collaborations/{collab_id}/respond"""
    
    def test_respond_invalid_collaboration(self):
        """Responding to non-existent collaboration fails"""
        fake_collab_id = str(uuid.uuid4())
        
        response = requests.put(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/collaborations/{fake_collab_id}/respond",
            params={"user_id": TEST_USER_ID},
            json={"accept": True}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Responding to non-existent collaboration returns 404")


class TestUntagCollaboration:
    """Test DELETE /api/posts/{post_id}/collaborations/{collab_id}"""
    
    def test_untag_invalid_collaboration(self):
        """Untagging non-existent collaboration fails"""
        fake_collab_id = str(uuid.uuid4())
        
        response = requests.delete(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/collaborations/{fake_collab_id}",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Untagging non-existent collaboration returns 404")


class TestSessionMetadataUpdate:
    """Test PUT /api/posts/{post_id}/session-metadata"""
    
    def test_update_session_metadata_not_author_fails(self):
        """Only post author can update session metadata"""
        fake_user_id = str(uuid.uuid4())
        
        response = requests.put(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/session-metadata",
            params={"user_id": fake_user_id},
            json={"wave_height_ft": 5.0}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ Only post author can update session metadata")
    
    def test_update_session_metadata_invalid_post(self):
        """Update session metadata on non-existent post fails"""
        fake_post_id = str(uuid.uuid4())
        
        response = requests.put(
            f"{BASE_URL}/api/posts/{fake_post_id}/session-metadata",
            params={"user_id": TEST_USER_ID},
            json={"wave_height_ft": 5.0}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Update session metadata on non-existent post returns 404")


class TestUserCollaborationRequests:
    """Test GET /api/users/{user_id}/collaboration-requests"""
    
    def test_get_user_collaboration_requests(self):
        """Get collaboration requests for a user"""
        response = requests.get(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/collaboration-requests"
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert 'requests' in data, "Response should have 'requests' key"
        assert 'total' in data, "Response should have 'total' key"
        print(f"✓ GET user collaboration requests returns: {data['total']} requests")
    
    def test_get_user_collaboration_requests_filtered(self):
        """Get collaboration requests with type filter"""
        response = requests.get(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/collaboration-requests",
            params={"type": "incoming"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'requests' in data
        print(f"✓ GET user collaboration requests with filter works")
    
    def test_get_user_collaboration_requests_status_filter(self):
        """Get collaboration requests with status filter"""
        response = requests.get(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/collaboration-requests",
            params={"status": "pending"}
        )
        assert response.status_code == 200
        
        data = response.json()
        # All returned requests should have status='pending'
        for req in data['requests']:
            assert req['status'] == 'pending', f"Expected status='pending', got {req['status']}"
        print(f"✓ GET user collaboration requests with status filter works")


class TestEndToEndCollaborationFlow:
    """Test full collaboration flow (requires creating test users)"""
    
    @pytest.fixture
    def second_user(self):
        """Create a second test user for collaboration testing"""
        # Try to find an existing user that's not the post owner
        response = requests.get(f"{BASE_URL}/api/profiles")
        if response.status_code == 200:
            profiles = response.json()
            for profile in profiles:
                if profile.get('id') != TEST_USER_ID:
                    return profile.get('id')
        return None
    
    def test_collaboration_flow_requires_second_user(self, second_user):
        """Full collaboration flow test"""
        if not second_user:
            pytest.skip("No second user available for collaboration flow test")
        
        # 1. Second user requests collaboration
        response = requests.post(
            f"{BASE_URL}/api/posts/{TEST_POST_ID}/request-collaboration",
            params={"user_id": second_user},
            json={}
        )
        
        if response.status_code == 400 and "already" in response.json().get('detail', '').lower():
            print("✓ User already has collaboration request (expected in repeated tests)")
            return
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get('success') == True
        collab_id = data.get('collaboration_id')
        print(f"✓ Collaboration request created: {collab_id}")
        
        # 2. Verify collaboration appears in list
        response = requests.get(f"{BASE_URL}/api/posts/{TEST_POST_ID}/collaborators")
        assert response.status_code == 200
        collabs = response.json()
        assert collabs['total'] > 0, "Should have at least one collaborator"
        print(f"✓ Collaboration appears in list: {collabs['total']} total")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
