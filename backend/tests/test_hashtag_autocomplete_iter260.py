"""
Test Hashtag Autocomplete Feature - Iteration 260
Tests:
- /api/hashtags/suggest endpoint for autocomplete suggestions
- /api/hashtags/trending endpoint for trending hashtags
- Query filtering and result ordering
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHashtagSuggestAPI:
    """Tests for /api/hashtags/suggest endpoint"""
    
    def test_suggest_hashtags_with_query_sur(self):
        """Test hashtag suggestions for query 'sur' returns matching hashtags"""
        response = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "sur"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "suggestions" in data, "Response should contain 'suggestions' key"
        assert "query" in data, "Response should contain 'query' key"
        assert data["query"] == "sur", f"Query should be 'sur', got {data['query']}"
        
        # Verify suggestions are returned
        suggestions = data["suggestions"]
        assert len(suggestions) > 0, "Should return at least one suggestion for 'sur'"
        
        # Verify all suggestions start with 'sur'
        for suggestion in suggestions:
            assert "tag" in suggestion, "Each suggestion should have 'tag' field"
            assert "post_count" in suggestion, "Each suggestion should have 'post_count' field"
            assert suggestion["tag"].lower().startswith("sur"), f"Tag '{suggestion['tag']}' should start with 'sur'"
        
        # Verify expected hashtags are present
        tags = [s["tag"] for s in suggestions]
        assert "surf" in tags, "Should include 'surf' hashtag"
        print(f"PASS: Found {len(suggestions)} suggestions for 'sur': {tags}")
    
    def test_suggest_hashtags_with_query_wave(self):
        """Test hashtag suggestions for query 'wave' returns matching hashtags"""
        response = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "wave"})
        assert response.status_code == 200
        
        data = response.json()
        suggestions = data["suggestions"]
        
        # Verify all suggestions start with 'wave'
        for suggestion in suggestions:
            assert suggestion["tag"].lower().startswith("wave"), f"Tag should start with 'wave'"
        
        tags = [s["tag"] for s in suggestions]
        if "waves" in tags:
            print(f"PASS: Found 'waves' in suggestions: {tags}")
        else:
            print(f"INFO: No 'waves' hashtag found, suggestions: {tags}")
    
    def test_suggest_hashtags_sorted_by_popularity(self):
        """Test that suggestions are sorted by post_count (descending)"""
        response = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "sur", "limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        suggestions = data["suggestions"]
        
        if len(suggestions) > 1:
            # Verify descending order by post_count
            for i in range(len(suggestions) - 1):
                assert suggestions[i]["post_count"] >= suggestions[i+1]["post_count"], \
                    f"Suggestions should be sorted by post_count descending"
            print(f"PASS: Suggestions are sorted by popularity")
    
    def test_suggest_hashtags_limit_parameter(self):
        """Test that limit parameter works correctly"""
        response = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "sur", "limit": 3})
        assert response.status_code == 200
        
        data = response.json()
        suggestions = data["suggestions"]
        assert len(suggestions) <= 3, f"Should return at most 3 suggestions, got {len(suggestions)}"
        print(f"PASS: Limit parameter works, returned {len(suggestions)} suggestions")
    
    def test_suggest_hashtags_no_results(self):
        """Test hashtag suggestions for non-existent query"""
        response = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "xyznonexistent123"})
        assert response.status_code == 200
        
        data = response.json()
        assert data["suggestions"] == [], "Should return empty list for non-existent query"
        print("PASS: Returns empty list for non-existent query")
    
    def test_suggest_hashtags_case_insensitive(self):
        """Test that hashtag search is case-insensitive"""
        response_lower = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "sur"})
        response_upper = requests.get(f"{BASE_URL}/api/hashtags/suggest", params={"q": "SUR"})
        
        assert response_lower.status_code == 200
        assert response_upper.status_code == 200
        
        data_lower = response_lower.json()
        data_upper = response_upper.json()
        
        # Both should return same results
        tags_lower = [s["tag"] for s in data_lower["suggestions"]]
        tags_upper = [s["tag"] for s in data_upper["suggestions"]]
        assert tags_lower == tags_upper, "Case-insensitive search should return same results"
        print("PASS: Search is case-insensitive")


class TestHashtagTrendingAPI:
    """Tests for /api/hashtags/trending endpoint"""
    
    def test_trending_hashtags_returns_list(self):
        """Test trending hashtags endpoint returns list of hashtags"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "hashtags" in data, "Response should contain 'hashtags' key"
        assert "period_days" in data, "Response should contain 'period_days' key"
        
        hashtags = data["hashtags"]
        assert isinstance(hashtags, list), "Hashtags should be a list"
        print(f"PASS: Trending endpoint returns {len(hashtags)} hashtags")
    
    def test_trending_hashtags_structure(self):
        """Test trending hashtags have correct structure"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 5})
        assert response.status_code == 200
        
        data = response.json()
        hashtags = data["hashtags"]
        
        for hashtag in hashtags:
            assert "tag" in hashtag, "Each hashtag should have 'tag' field"
            assert "post_count" in hashtag, "Each hashtag should have 'post_count' field"
            assert "last_used" in hashtag, "Each hashtag should have 'last_used' field"
        
        print(f"PASS: All hashtags have correct structure")
    
    def test_trending_hashtags_sorted_by_post_count(self):
        """Test trending hashtags are sorted by post_count descending"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        hashtags = data["hashtags"]
        
        if len(hashtags) > 1:
            for i in range(len(hashtags) - 1):
                assert hashtags[i]["post_count"] >= hashtags[i+1]["post_count"], \
                    "Trending hashtags should be sorted by post_count descending"
            print("PASS: Trending hashtags are sorted by popularity")
    
    def test_trending_hashtags_limit_parameter(self):
        """Test limit parameter for trending hashtags"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 5})
        assert response.status_code == 200
        
        data = response.json()
        hashtags = data["hashtags"]
        assert len(hashtags) <= 5, f"Should return at most 5 hashtags, got {len(hashtags)}"
        print(f"PASS: Limit parameter works, returned {len(hashtags)} trending hashtags")
    
    def test_trending_hashtags_days_parameter(self):
        """Test days parameter for trending hashtags"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"days": 30})
        assert response.status_code == 200
        
        data = response.json()
        assert data["period_days"] == 30, f"Period days should be 30, got {data['period_days']}"
        print("PASS: Days parameter works correctly")
    
    def test_trending_hashtags_seeded_data(self):
        """Test that seeded hashtags are present in trending"""
        response = requests.get(f"{BASE_URL}/api/hashtags/trending", params={"limit": 10})
        assert response.status_code == 200
        
        data = response.json()
        hashtags = data["hashtags"]
        tags = [h["tag"] for h in hashtags]
        
        # Check for expected seeded hashtags
        expected_tags = ["surf", "waves", "surfing", "pipeline", "surfphotography"]
        found_tags = [t for t in expected_tags if t in tags]
        
        assert len(found_tags) > 0, f"Should find at least one seeded hashtag. Found: {tags}"
        print(f"PASS: Found seeded hashtags: {found_tags}")


class TestHashtagPostsAPI:
    """Tests for /api/hashtags/{tag}/posts endpoint"""
    
    def test_get_posts_by_hashtag(self):
        """Test getting posts by hashtag"""
        response = requests.get(f"{BASE_URL}/api/hashtags/surf/posts")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "tag" in data, "Response should contain 'tag' key"
        assert "total_posts" in data, "Response should contain 'total_posts' key"
        assert "posts" in data, "Response should contain 'posts' key"
        assert data["tag"] == "surf", f"Tag should be 'surf', got {data['tag']}"
        print(f"PASS: Found {data['total_posts']} posts for #surf")
    
    def test_get_posts_by_hashtag_with_hash_prefix(self):
        """Test that hashtag with # prefix is handled correctly"""
        response = requests.get(f"{BASE_URL}/api/hashtags/%23surf/posts")  # URL encoded #
        assert response.status_code == 200
        
        data = response.json()
        assert data["tag"] == "surf", "Should strip # prefix from tag"
        print("PASS: Handles # prefix correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
