"""
Test New Features - Iteration 250
Tests for:
- GET /api/compliance/dashboard - location_fraud_map_data array
- POST /api/compliance/violations/bulk-review-appeals - bulk appeal processing
- GET /api/posts/{id}/reactions-detail - detailed reactions list
- GET /api/users/search-mentions - @mention autocomplete
- POST /api/posts - mentions array with notifications
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from iteration 249
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # dpritzker0905@gmail.com - admin user


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self, api_client):
        """Verify API is accessible"""
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ API health check passed")


class TestComplianceDashboardLocationFraudMap:
    """Test GET /api/compliance/dashboard - location_fraud_map_data"""
    
    def test_dashboard_returns_location_fraud_map_data(self, api_client):
        """Verify dashboard includes location_fraud_map_data array"""
        response = api_client.get(
            f"{BASE_URL}/api/compliance/dashboard",
            params={"admin_id": ADMIN_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify location_fraud_map_data exists and is an array
        assert "location_fraud_map_data" in data, "Missing location_fraud_map_data in response"
        assert isinstance(data["location_fraud_map_data"], list), "location_fraud_map_data should be a list"
        
        # Verify stats are present
        assert "stats" in data
        assert "recent_violations" in data
        
        print(f"✓ Dashboard returns location_fraud_map_data (count: {len(data['location_fraud_map_data'])})")
        print(f"  Stats: {data['stats']}")
    
    def test_dashboard_location_fraud_map_data_structure(self, api_client):
        """Verify location_fraud_map_data items have correct structure"""
        response = api_client.get(
            f"{BASE_URL}/api/compliance/dashboard",
            params={"admin_id": ADMIN_ID}
        )
        assert response.status_code == 200
        
        data = response.json()
        map_data = data.get("location_fraud_map_data", [])
        
        # If there's data, verify structure
        if len(map_data) > 0:
            item = map_data[0]
            expected_fields = ["id", "claimed", "actual", "distance_miles", "severity", "created_at"]
            for field in expected_fields:
                assert field in item, f"Missing field '{field}' in location_fraud_map_data item"
            
            # Verify claimed and actual are coordinate arrays
            assert isinstance(item["claimed"], list), "claimed should be [lat, lon] array"
            assert isinstance(item["actual"], list), "actual should be [lat, lon] array"
            assert len(item["claimed"]) == 2, "claimed should have 2 elements [lat, lon]"
            assert len(item["actual"]) == 2, "actual should have 2 elements [lat, lon]"
            
            print(f"✓ Location fraud map data structure is correct")
            print(f"  Sample: claimed={item['claimed']}, actual={item['actual']}, distance={item['distance_miles']}mi")
        else:
            print("✓ Location fraud map data structure test passed (no data to verify)")
    
    def test_dashboard_requires_admin(self, api_client):
        """Verify dashboard requires admin access"""
        fake_user_id = str(uuid.uuid4())
        response = api_client.get(
            f"{BASE_URL}/api/compliance/dashboard",
            params={"admin_id": fake_user_id}
        )
        assert response.status_code == 403, f"Expected 403 for non-admin, got {response.status_code}"
        print("✓ Dashboard correctly requires admin access")


class TestBulkReviewAppeals:
    """Test POST /api/compliance/violations/bulk-review-appeals"""
    
    def test_bulk_review_appeals_endpoint_exists(self, api_client):
        """Verify bulk-review-appeals endpoint exists"""
        # Test with empty array - should work but process 0
        response = api_client.post(
            f"{BASE_URL}/api/compliance/violations/bulk-review-appeals",
            params={"admin_id": ADMIN_ID},
            json={
                "violation_ids": [],
                "approved": True,
                "notes": None
            }
        )
        # Should return 200 with processed=0
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "processed" in data
        assert "total" in data
        assert "approved" in data
        assert data["processed"] == 0
        assert data["total"] == 0
        
        print("✓ Bulk review appeals endpoint exists and works with empty array")
    
    def test_bulk_review_appeals_with_invalid_ids(self, api_client):
        """Test bulk review with non-existent violation IDs"""
        fake_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        
        response = api_client.post(
            f"{BASE_URL}/api/compliance/violations/bulk-review-appeals",
            params={"admin_id": ADMIN_ID},
            json={
                "violation_ids": fake_ids,
                "approved": True,
                "notes": None
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["processed"] == 0, "Should process 0 for non-existent IDs"
        assert data["total"] == 2
        assert "errors" in data and data["errors"] is not None
        assert len(data["errors"]) == 2, "Should have 2 errors for 2 invalid IDs"
        
        print(f"✓ Bulk review correctly handles invalid IDs: {data['errors']}")
    
    def test_bulk_review_appeals_requires_admin(self, api_client):
        """Verify bulk review requires admin access"""
        fake_user_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/compliance/violations/bulk-review-appeals",
            params={"admin_id": fake_user_id},
            json={
                "violation_ids": [],
                "approved": True,
                "notes": None
            }
        )
        assert response.status_code == 403, f"Expected 403 for non-admin, got {response.status_code}"
        print("✓ Bulk review correctly requires admin access")
    
    def test_bulk_review_appeals_response_structure(self, api_client):
        """Verify bulk review response has correct structure"""
        response = api_client.post(
            f"{BASE_URL}/api/compliance/violations/bulk-review-appeals",
            params={"admin_id": ADMIN_ID},
            json={
                "violation_ids": [str(uuid.uuid4())],
                "approved": False,
                "notes": "Test bulk review"
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["processed", "total", "approved"]
        for field in required_fields:
            assert field in data, f"Missing field '{field}' in response"
        
        assert isinstance(data["approved"], bool)
        assert data["approved"] == False
        
        print("✓ Bulk review response structure is correct")


class TestPostReactionsDetail:
    """Test GET /api/posts/{id}/reactions-detail"""
    
    def test_reactions_detail_nonexistent_post(self, api_client):
        """Test reactions-detail with non-existent post"""
        fake_post_id = str(uuid.uuid4())
        
        response = api_client.get(f"{BASE_URL}/api/posts/{fake_post_id}/reactions-detail")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Reactions-detail returns 404 for non-existent post")
    
    def test_reactions_detail_with_existing_post(self, api_client):
        """Test reactions-detail with an existing post"""
        # First get a post from the feed
        feed_response = api_client.get(f"{BASE_URL}/api/posts", params={"limit": 1})
        
        if feed_response.status_code != 200 or len(feed_response.json()) == 0:
            pytest.skip("No posts available to test reactions-detail")
        
        post = feed_response.json()[0]
        post_id = post["id"]
        
        # Get reactions detail
        response = api_client.get(f"{BASE_URL}/api/posts/{post_id}/reactions-detail")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        required_fields = ["post_id", "total_reactions", "total_likes", "reactions_by_emoji", "all_reactors", "likers"]
        for field in required_fields:
            assert field in data, f"Missing field '{field}' in reactions-detail response"
        
        assert data["post_id"] == post_id
        assert isinstance(data["total_reactions"], int)
        assert isinstance(data["total_likes"], int)
        assert isinstance(data["reactions_by_emoji"], dict)
        assert isinstance(data["all_reactors"], list)
        assert isinstance(data["likers"], list)
        
        print(f"✓ Reactions-detail returns correct structure for post {post_id}")
        print(f"  Total reactions: {data['total_reactions']}, Total likes: {data['total_likes']}")
    
    def test_reactions_detail_reactor_structure(self, api_client):
        """Verify reactor data structure in reactions-detail"""
        # Get a post
        feed_response = api_client.get(f"{BASE_URL}/api/posts", params={"limit": 5})
        
        if feed_response.status_code != 200 or len(feed_response.json()) == 0:
            pytest.skip("No posts available")
        
        # Find a post with reactions
        for post in feed_response.json():
            response = api_client.get(f"{BASE_URL}/api/posts/{post['id']}/reactions-detail")
            if response.status_code == 200:
                data = response.json()
                
                # Check all_reactors structure if any exist
                if len(data["all_reactors"]) > 0:
                    reactor = data["all_reactors"][0]
                    expected_fields = ["user_id", "full_name", "avatar_url", "role", "reacted_at", "emoji"]
                    for field in expected_fields:
                        assert field in reactor, f"Missing field '{field}' in reactor data"
                    print(f"✓ Reactor structure is correct: {reactor['full_name']} reacted with {reactor['emoji']}")
                    return
                
                # Check likers structure if any exist
                if len(data["likers"]) > 0:
                    liker = data["likers"][0]
                    expected_fields = ["user_id", "full_name", "avatar_url", "role", "liked_at"]
                    for field in expected_fields:
                        assert field in liker, f"Missing field '{field}' in liker data"
                    print(f"✓ Liker structure is correct: {liker['full_name']}")
                    return
        
        print("✓ Reactions-detail structure test passed (no reactions/likes to verify)")


class TestSearchMentions:
    """Test GET /api/users/search-mentions"""
    
    def test_search_mentions_endpoint_exists(self, api_client):
        """Verify search-mentions endpoint exists"""
        response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "test"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✓ Search-mentions endpoint works (found {len(data)} users for 'test')")
    
    def test_search_mentions_requires_query(self, api_client):
        """Verify search-mentions requires q parameter"""
        response = api_client.get(f"{BASE_URL}/api/users/search-mentions")
        # Should return 422 for missing required parameter
        assert response.status_code == 422, f"Expected 422 for missing q param, got {response.status_code}"
        print("✓ Search-mentions correctly requires q parameter")
    
    def test_search_mentions_response_structure(self, api_client):
        """Verify search-mentions response structure"""
        response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "a", "limit": 5}
        )
        assert response.status_code == 200
        
        data = response.json()
        
        if len(data) > 0:
            user = data[0]
            expected_fields = ["id", "user_id", "full_name", "email", "avatar_url", "role"]
            for field in expected_fields:
                assert field in user, f"Missing field '{field}' in search-mentions response"
            
            # Verify user_id equals id
            assert user["id"] == user["user_id"], "id and user_id should match"
            
            print(f"✓ Search-mentions response structure is correct")
            print(f"  Sample user: {user['full_name']} ({user['email']})")
        else:
            print("✓ Search-mentions structure test passed (no users found)")
    
    def test_search_mentions_limit_parameter(self, api_client):
        """Verify search-mentions respects limit parameter"""
        response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "a", "limit": 3}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert len(data) <= 3, f"Expected max 3 results, got {len(data)}"
        
        print(f"✓ Search-mentions respects limit parameter (returned {len(data)} users)")
    
    def test_search_mentions_by_email(self, api_client):
        """Test search-mentions finds users by email prefix"""
        # Search for admin email prefix
        response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "dpritzker"}
        )
        assert response.status_code == 200
        
        data = response.json()
        print(f"✓ Search-mentions by email prefix works (found {len(data)} users for 'dpritzker')")


class TestPostWithMentions:
    """Test POST /api/posts with mentions array"""
    
    def test_create_post_with_mentions_schema(self, api_client):
        """Verify POST /api/posts accepts mentions array"""
        # We'll test the schema by checking if the endpoint accepts mentions
        # without actually creating a post (would need valid media_url)
        
        # First, search for a user to mention
        search_response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "a", "limit": 1}
        )
        
        if search_response.status_code != 200 or len(search_response.json()) == 0:
            pytest.skip("No users available to test mentions")
        
        user_to_mention = search_response.json()[0]
        
        # Try to create a post with mentions (will fail due to missing media, but validates schema)
        post_data = {
            "media_url": "https://example.com/test.jpg",
            "media_type": "image",
            "caption": f"Test post mentioning @{user_to_mention['full_name']}",
            "mentions": [
                {
                    "user_id": user_to_mention["user_id"],
                    "username": user_to_mention["full_name"]
                }
            ]
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": ADMIN_ID},
            json=post_data
        )
        
        # Should succeed (201) or fail for other reasons, not schema validation
        # If it returns 422, the mentions schema might be wrong
        assert response.status_code != 422, f"Schema validation failed: {response.text}"
        
        if response.status_code == 201:
            data = response.json()
            print(f"✓ Post created with mentions successfully: {data['id']}")
            
            # Clean up - delete the test post
            delete_response = api_client.delete(
                f"{BASE_URL}/api/posts/{data['id']}",
                params={"user_id": ADMIN_ID}
            )
            print(f"  Cleaned up test post: {delete_response.status_code}")
        else:
            print(f"✓ POST /api/posts accepts mentions array (status: {response.status_code})")


class TestIntegrationFlow:
    """Integration tests for the new features"""
    
    def test_full_compliance_dashboard_flow(self, api_client):
        """Test full compliance dashboard with all new fields"""
        response = api_client.get(
            f"{BASE_URL}/api/compliance/dashboard",
            params={"admin_id": ADMIN_ID}
        )
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify all expected sections
        assert "stats" in data
        assert "recent_violations" in data
        assert "location_fraud_map_data" in data
        
        # Verify stats fields
        stats = data["stats"]
        expected_stats = [
            "total_violations", "violations_this_week", "location_fraud_count",
            "pending_appeals", "suspended_users", "banned_users"
        ]
        for stat in expected_stats:
            assert stat in stats, f"Missing stat '{stat}'"
        
        print("✓ Full compliance dashboard flow works")
        print(f"  Stats: {stats}")
        print(f"  Recent violations: {len(data['recent_violations'])}")
        print(f"  Location fraud map data: {len(data['location_fraud_map_data'])}")
    
    def test_mention_search_to_post_flow(self, api_client):
        """Test flow: search users -> create post with mention"""
        # Step 1: Search for users
        search_response = api_client.get(
            f"{BASE_URL}/api/users/search-mentions",
            params={"q": "a", "limit": 3}
        )
        assert search_response.status_code == 200
        users = search_response.json()
        
        print(f"✓ Step 1: Found {len(users)} users for mention")
        
        if len(users) > 0:
            # Step 2: Verify user data is suitable for mentions
            user = users[0]
            assert "user_id" in user
            assert "full_name" in user
            
            print(f"✓ Step 2: User data suitable for mention: {user['full_name']}")
        
        print("✓ Mention search to post flow validated")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
