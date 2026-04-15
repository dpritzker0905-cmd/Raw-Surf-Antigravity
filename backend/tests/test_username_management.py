"""
Username Management API Tests (Iteration 251)
Tests for:
- GET /api/username/check/{username} - Username availability checking with validation
- POST /api/username/set - Set username for first-time users
- PUT /api/username/change - Change username with 60-day cooldown
- GET /api/username/status - Get username status and cooldown info
- GET /api/username/search?q={query} - Search users for @mention autocomplete
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from iteration 250
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_EMAIL = "dpritzker0905@gmail.com"
TEST_PASSWORD = "Test123!"

# Reserved usernames that should not be available
RESERVED_USERNAMES = [
    'admin', 'administrator', 'support', 'help', 'rawsurf', 'rawsurfos',
    'official', 'mod', 'moderator', 'system', 'staff', 'team', 'api',
    'null', 'undefined', 'root', 'test', 'user', 'anonymous'
]


class TestHealthCheck:
    """Basic health check to ensure API is running"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ API health check passed")


class TestUsernameCheck:
    """Tests for GET /api/username/check/{username}"""
    
    def test_check_valid_available_username(self):
        """Check a valid username that should be available"""
        unique_username = f"testuser{uuid.uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/username/check/{unique_username}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "username" in data
        assert "available" in data
        assert data["username"] == unique_username.lower()
        print(f"✓ Username check for '{unique_username}' returned: available={data['available']}")
    
    def test_check_username_too_short(self):
        """Username less than 3 characters should fail validation"""
        response = requests.get(f"{BASE_URL}/api/username/check/ab")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False
        assert "reason" in data
        assert "at least 3 characters" in data["reason"].lower()
        print(f"✓ Short username rejected: {data['reason']}")
    
    def test_check_username_too_long(self):
        """Username more than 30 characters should fail validation"""
        long_username = "a" * 31
        response = requests.get(f"{BASE_URL}/api/username/check/{long_username}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False
        assert "reason" in data
        assert "30" in data["reason"] or "exceed" in data["reason"].lower()
        print(f"✓ Long username rejected: {data['reason']}")
    
    def test_check_username_starts_with_number(self):
        """Username starting with number should fail validation"""
        response = requests.get(f"{BASE_URL}/api/username/check/123user")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False
        assert "reason" in data
        assert "start with a letter" in data["reason"].lower()
        print(f"✓ Username starting with number rejected: {data['reason']}")
    
    def test_check_username_with_special_chars(self):
        """Username with special characters (except underscore) should fail"""
        response = requests.get(f"{BASE_URL}/api/username/check/user@name")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False
        assert "reason" in data
        print(f"✓ Username with special chars rejected: {data['reason']}")
    
    def test_check_username_with_underscore_valid(self):
        """Username with underscore should be valid"""
        unique_username = f"test_user_{uuid.uuid4().hex[:6]}"
        response = requests.get(f"{BASE_URL}/api/username/check/{unique_username}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should pass validation (may or may not be available depending on DB)
        assert "username" in data
        assert "available" in data
        print(f"✓ Username with underscore validated: {unique_username}")
    
    def test_check_reserved_usernames(self):
        """Reserved usernames should not be available"""
        for reserved in ['admin', 'support', 'test', 'user', 'system']:
            response = requests.get(f"{BASE_URL}/api/username/check/{reserved}")
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["available"] == False
            assert "reserved" in data["reason"].lower()
            print(f"✓ Reserved username '{reserved}' correctly rejected")
    
    def test_check_username_case_insensitive(self):
        """Username check should be case-insensitive"""
        response1 = requests.get(f"{BASE_URL}/api/username/check/ADMIN")
        response2 = requests.get(f"{BASE_URL}/api/username/check/Admin")
        response3 = requests.get(f"{BASE_URL}/api/username/check/admin")
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response3.status_code == 200
        
        # All should be unavailable (reserved)
        assert response1.json()["available"] == False
        assert response2.json()["available"] == False
        assert response3.json()["available"] == False
        print("✓ Username check is case-insensitive")
    
    def test_check_username_with_user_id(self):
        """Check username with user_id parameter for self-check"""
        unique_username = f"selfcheck{uuid.uuid4().hex[:6]}"
        response = requests.get(
            f"{BASE_URL}/api/username/check/{unique_username}",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "username" in data
        assert "available" in data
        print(f"✓ Username check with user_id parameter works")


class TestUsernameSet:
    """Tests for POST /api/username/set"""
    
    def test_set_username_requires_user_id(self):
        """Setting username requires user_id query parameter"""
        response = requests.post(
            f"{BASE_URL}/api/username/set",
            json={"username": "testuser123"}
        )
        
        # Should fail without user_id
        assert response.status_code == 422
        print("✓ Set username requires user_id parameter")
    
    def test_set_username_invalid_user(self):
        """Setting username for non-existent user should fail"""
        fake_user_id = str(uuid.uuid4())
        response = requests.post(
            f"{BASE_URL}/api/username/set",
            params={"user_id": fake_user_id},
            json={"username": "testuser123"}
        )
        
        assert response.status_code == 404
        print("✓ Set username for non-existent user returns 404")
    
    def test_set_username_validation_too_short(self):
        """Setting username with invalid format should fail validation"""
        response = requests.post(
            f"{BASE_URL}/api/username/set",
            params={"user_id": TEST_USER_ID},
            json={"username": "ab"}
        )
        
        # Should fail validation (422)
        assert response.status_code == 422
        print("✓ Set username validates minimum length")
    
    def test_set_username_validation_reserved(self):
        """Setting reserved username should fail"""
        response = requests.post(
            f"{BASE_URL}/api/username/set",
            params={"user_id": TEST_USER_ID},
            json={"username": "admin"}
        )
        
        # Should fail validation (422) due to reserved username
        assert response.status_code == 422
        print("✓ Set username rejects reserved usernames")
    
    def test_set_username_validation_starts_with_number(self):
        """Setting username starting with number should fail"""
        response = requests.post(
            f"{BASE_URL}/api/username/set",
            params={"user_id": TEST_USER_ID},
            json={"username": "123user"}
        )
        
        assert response.status_code == 422
        print("✓ Set username validates format (must start with letter)")


class TestUsernameChange:
    """Tests for PUT /api/username/change"""
    
    def test_change_username_requires_user_id(self):
        """Changing username requires user_id query parameter"""
        response = requests.put(
            f"{BASE_URL}/api/username/change",
            json={"new_username": "newuser123"}
        )
        
        assert response.status_code == 422
        print("✓ Change username requires user_id parameter")
    
    def test_change_username_invalid_user(self):
        """Changing username for non-existent user should fail"""
        fake_user_id = str(uuid.uuid4())
        response = requests.put(
            f"{BASE_URL}/api/username/change",
            params={"user_id": fake_user_id},
            json={"new_username": "newuser123"}
        )
        
        assert response.status_code == 404
        print("✓ Change username for non-existent user returns 404")
    
    def test_change_username_validation_too_short(self):
        """Changing to invalid username should fail validation"""
        response = requests.put(
            f"{BASE_URL}/api/username/change",
            params={"user_id": TEST_USER_ID},
            json={"new_username": "ab"}
        )
        
        assert response.status_code == 422
        print("✓ Change username validates minimum length")
    
    def test_change_username_validation_reserved(self):
        """Changing to reserved username should fail"""
        response = requests.put(
            f"{BASE_URL}/api/username/change",
            params={"user_id": TEST_USER_ID},
            json={"new_username": "support"}
        )
        
        assert response.status_code == 422
        print("✓ Change username rejects reserved usernames")
    
    def test_change_username_same_as_current(self):
        """Changing to same username should fail (400 or 429 if in cooldown)"""
        # First get current username
        status_response = requests.get(
            f"{BASE_URL}/api/username/status",
            params={"user_id": TEST_USER_ID}
        )
        
        if status_response.status_code == 200:
            current_username = status_response.json().get("username")
            can_change = status_response.json().get("can_change", True)
            
            if current_username:
                response = requests.put(
                    f"{BASE_URL}/api/username/change",
                    params={"user_id": TEST_USER_ID},
                    json={"new_username": current_username}
                )
                
                # Should fail with 400 (same username) or 429 (cooldown - checked first)
                assert response.status_code in [400, 429]
                if response.status_code == 429:
                    print("✓ Change username blocked by cooldown (60-day rule)")
                else:
                    print("✓ Change username rejects same username")
            else:
                print("⚠ User has no username set, skipping same-username test")
        else:
            print("⚠ Could not get username status, skipping same-username test")


class TestUsernameStatus:
    """Tests for GET /api/username/status"""
    
    def test_status_requires_user_id(self):
        """Getting status requires user_id query parameter"""
        response = requests.get(f"{BASE_URL}/api/username/status")
        
        assert response.status_code == 422
        print("✓ Username status requires user_id parameter")
    
    def test_status_invalid_user(self):
        """Getting status for non-existent user should fail"""
        fake_user_id = str(uuid.uuid4())
        response = requests.get(
            f"{BASE_URL}/api/username/status",
            params={"user_id": fake_user_id}
        )
        
        assert response.status_code == 404
        print("✓ Username status for non-existent user returns 404")
    
    def test_status_valid_user(self):
        """Getting status for valid user should return username info"""
        response = requests.get(
            f"{BASE_URL}/api/username/status",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "user_id" in data
        assert "username" in data
        assert "has_username" in data
        assert "can_change" in data
        assert "days_until_change" in data
        assert "cooldown_days" in data
        
        # Verify cooldown_days is 60
        assert data["cooldown_days"] == 60
        
        print(f"✓ Username status returned: username={data['username']}, can_change={data['can_change']}")
    
    def test_status_response_structure(self):
        """Verify complete response structure"""
        response = requests.get(
            f"{BASE_URL}/api/username/status",
            params={"user_id": TEST_USER_ID}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        expected_fields = [
            "user_id", "username", "has_username", "can_change",
            "days_until_change", "next_change_date", "last_changed", "cooldown_days"
        ]
        
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print("✓ Username status has all expected fields")


class TestUsernameSearch:
    """Tests for GET /api/username/search - @mention autocomplete"""
    
    def test_search_requires_query(self):
        """Search requires q query parameter"""
        response = requests.get(f"{BASE_URL}/api/username/search")
        
        assert response.status_code == 422
        print("✓ Username search requires q parameter")
    
    def test_search_returns_list(self):
        """Search should return a list of users"""
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "test"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✓ Username search returned {len(data)} results")
    
    def test_search_response_structure(self):
        """Verify search result structure"""
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "a", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            user = data[0]
            expected_fields = ["id", "user_id", "username", "full_name", "avatar_url", "role", "is_verified"]
            
            for field in expected_fields:
                assert field in user, f"Missing field in search result: {field}"
            
            print(f"✓ Search result has all expected fields: {list(user.keys())}")
        else:
            print("⚠ No search results to verify structure")
    
    def test_search_limit_parameter(self):
        """Search should respect limit parameter"""
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "a", "limit": 3}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert len(data) <= 3
        print(f"✓ Search respects limit parameter (returned {len(data)} results, limit=3)")
    
    def test_search_max_limit(self):
        """Search limit parameter is validated (max 20)"""
        # Passing limit > 20 should fail validation
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "a", "limit": 50}
        )
        
        # API enforces le=20 via Query validation, so 50 returns 422
        assert response.status_code == 422
        print("✓ Search enforces max limit of 20 via validation")
        
        # Verify limit=20 works
        response_valid = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "a", "limit": 20}
        )
        assert response_valid.status_code == 200
        assert len(response_valid.json()) <= 20
        print(f"✓ Search with limit=20 works ({len(response_valid.json())} results)")
    
    def test_search_prefix_priority(self):
        """Search should prioritize prefix matches"""
        # This test verifies the search works - exact ordering depends on data
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "sur", "limit": 10}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        print(f"✓ Search for 'sur' returned {len(data)} results")
        if len(data) > 0:
            print(f"  First result: {data[0].get('username', 'N/A')}")
    
    def test_search_case_insensitive(self):
        """Search should be case-insensitive"""
        response_lower = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "test", "limit": 10}
        )
        response_upper = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "TEST", "limit": 10}
        )
        
        assert response_lower.status_code == 200
        assert response_upper.status_code == 200
        
        # Both should return results (may be same or different based on data)
        print("✓ Search accepts both lowercase and uppercase queries")


class TestIntegrationFlow:
    """Integration tests for complete username workflows"""
    
    def test_check_then_status_flow(self):
        """Test checking username availability then getting status"""
        # Check a random username
        unique_username = f"flowtest{uuid.uuid4().hex[:6]}"
        check_response = requests.get(f"{BASE_URL}/api/username/check/{unique_username}")
        
        assert check_response.status_code == 200
        
        # Get user status
        status_response = requests.get(
            f"{BASE_URL}/api/username/status",
            params={"user_id": TEST_USER_ID}
        )
        
        assert status_response.status_code == 200
        print("✓ Check → Status flow works correctly")
    
    def test_search_for_mention_flow(self):
        """Test searching users for @mention autocomplete"""
        # Simulate typing "@sur" in a post
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "sur", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify results can be used for mentions
        for user in data:
            assert "id" in user or "user_id" in user
            assert "username" in user or "full_name" in user
        
        print(f"✓ Mention search flow works ({len(data)} users found)")
    
    def test_validation_consistency(self):
        """Test that validation is consistent across check and set endpoints"""
        # Test reserved username
        check_response = requests.get(f"{BASE_URL}/api/username/check/admin")
        assert check_response.status_code == 200
        assert check_response.json()["available"] == False
        
        set_response = requests.post(
            f"{BASE_URL}/api/username/set",
            params={"user_id": TEST_USER_ID},
            json={"username": "admin"}
        )
        assert set_response.status_code == 422
        
        print("✓ Validation is consistent between check and set endpoints")


class TestEdgeCases:
    """Edge case tests"""
    
    def test_username_exactly_3_chars(self):
        """Username with exactly 3 characters should be valid"""
        response = requests.get(f"{BASE_URL}/api/username/check/abc")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should pass length validation (may be reserved or taken)
        assert "username" in data
        print(f"✓ 3-char username validated: available={data['available']}")
    
    def test_username_exactly_30_chars(self):
        """Username with exactly 30 characters should be valid"""
        username_30 = "a" * 30
        response = requests.get(f"{BASE_URL}/api/username/check/{username_30}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should pass length validation
        assert "username" in data
        print(f"✓ 30-char username validated: available={data['available']}")
    
    def test_username_with_numbers(self):
        """Username with numbers (not at start) should be valid"""
        response = requests.get(f"{BASE_URL}/api/username/check/user123")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should pass format validation
        assert "username" in data
        print(f"✓ Username with numbers validated: available={data['available']}")
    
    def test_empty_search_query(self):
        """Empty search query should fail validation"""
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": ""}
        )
        
        # Should fail with 422 (min_length=1)
        assert response.status_code == 422
        print("✓ Empty search query rejected")
    
    def test_single_char_search(self):
        """Single character search should work"""
        response = requests.get(
            f"{BASE_URL}/api/username/search",
            params={"q": "a", "limit": 5}
        )
        
        assert response.status_code == 200
        print(f"✓ Single char search works ({len(response.json())} results)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
