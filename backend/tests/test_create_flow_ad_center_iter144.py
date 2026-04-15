"""
Test: Create Flow with Ad Option and Settings Ad Center
Iteration 144 - Tests for:
1. Desktop Sidebar Create button between Bookings and Wallet
2. CreatePost page with Photo, Video, Camera, Create Ad buttons
3. Feed CreatePostModal with Photo, Video, Camera, Create Ad options
4. Settings Ad Center with Overview, Activity, Analytics tabs
5. Backend GET /api/ads/my-analytics endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestAdAnalyticsEndpoint:
    """Tests for GET /api/ads/my-analytics endpoint"""
    
    def test_my_analytics_returns_200(self):
        """Test that my-analytics endpoint returns 200 for valid user"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-analytics",
            params={"user_id": ADMIN_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
    def test_my_analytics_response_structure(self):
        """Test that my-analytics returns correct data structure"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-analytics",
            params={"user_id": ADMIN_ID}
        )
        assert response.status_code == 200
        
        data = response.json()
        
        # Check required fields
        assert "total_impressions" in data, "Missing total_impressions field"
        assert "total_clicks" in data, "Missing total_clicks field"
        assert "ctr" in data, "Missing ctr field"
        assert "total_spent" in data, "Missing total_spent field"
        assert "active_ads" in data, "Missing active_ads field"
        assert "per_ad_stats" in data, "Missing per_ad_stats field"
        
        # Check data types
        assert isinstance(data["total_impressions"], int), "total_impressions should be int"
        assert isinstance(data["total_clicks"], int), "total_clicks should be int"
        assert isinstance(data["ctr"], (int, float)), "ctr should be numeric"
        assert isinstance(data["total_spent"], (int, float)), "total_spent should be numeric"
        assert isinstance(data["active_ads"], int), "active_ads should be int"
        assert isinstance(data["per_ad_stats"], list), "per_ad_stats should be list"
        
    def test_my_analytics_per_ad_stats_structure(self):
        """Test that per_ad_stats has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-analytics",
            params={"user_id": ADMIN_ID}
        )
        assert response.status_code == 200
        
        data = response.json()
        per_ad_stats = data.get("per_ad_stats", [])
        
        if len(per_ad_stats) > 0:
            ad_stat = per_ad_stats[0]
            assert "id" in ad_stat, "Missing id in per_ad_stats"
            assert "headline" in ad_stat, "Missing headline in per_ad_stats"
            assert "impressions" in ad_stat, "Missing impressions in per_ad_stats"
            assert "clicks" in ad_stat, "Missing clicks in per_ad_stats"
            assert "ctr" in ad_stat, "Missing ctr in per_ad_stats"


class TestAdSubmissionsEndpoint:
    """Tests for GET /api/ads/my-submissions endpoint"""
    
    def test_my_submissions_returns_200(self):
        """Test that my-submissions endpoint returns 200"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-submissions",
            params={"user_id": ADMIN_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
    def test_my_submissions_response_structure(self):
        """Test that my-submissions returns correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-submissions",
            params={"user_id": ADMIN_ID}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "ads" in data, "Missing ads field"
        assert "counts" in data, "Missing counts field"
        
        counts = data["counts"]
        assert "pending" in counts, "Missing pending count"
        assert "approved" in counts, "Missing approved count"
        assert "rejected" in counts, "Missing rejected count"


class TestPublicAdConfig:
    """Tests for GET /api/ads/config endpoint"""
    
    def test_public_ad_config_returns_200(self):
        """Test that public ad config endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/ads/config")
        assert response.status_code == 200
        
    def test_public_ad_config_structure(self):
        """Test that public ad config has correct structure"""
        response = requests.get(f"{BASE_URL}/api/ads/config")
        assert response.status_code == 200
        
        data = response.json()
        assert "frequency" in data, "Missing frequency"
        assert "min_posts_before_first_ad" in data, "Missing min_posts_before_first_ad"
        assert "variants" in data, "Missing variants"


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Test that health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("status") == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
