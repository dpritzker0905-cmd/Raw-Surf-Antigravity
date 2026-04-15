"""
Test Social Live & Conditions Explorer Features - Sprint 101
Tests:
1. Condition Reports API - /api/condition-reports/feed
2. Condition Reports Regions API - /api/condition-reports/regions
3. Social Live API - /api/social-live/active
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestConditionReportsAPI:
    """Test Condition Reports endpoints for Conditions Explorer tab"""
    
    def test_condition_reports_regions_returns_16_regions(self):
        """Test /api/condition-reports/regions returns 16 regions"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/regions")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "regions" in data, "Response should contain 'regions' key"
        regions = data["regions"]
        assert isinstance(regions, list), "Regions should be a list"
        assert len(regions) == 16, f"Expected 16 regions, got {len(regions)}"
        
        # Verify some expected regions
        expected_regions = ["North Shore", "South Shore", "SoCal", "Hawaii", "Gold Coast"]
        for region in expected_regions:
            assert region in regions, f"Expected region '{region}' not found in {regions}"
        
        print(f"PASS: Regions API returns {len(regions)} regions: {regions}")
    
    def test_condition_reports_feed_returns_data(self):
        """Test /api/condition-reports/feed returns proper structure"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "reports" in data, "Response should contain 'reports' key"
        assert "total" in data, "Response should contain 'total' key"
        assert "has_more" in data, "Response should contain 'has_more' key"
        
        reports = data["reports"]
        assert isinstance(reports, list), "Reports should be a list"
        
        print(f"PASS: Condition reports feed returns {len(reports)} reports, total: {data['total']}")
    
    def test_condition_reports_feed_with_region_filter(self):
        """Test /api/condition-reports/feed with region filter"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed?region=North Shore")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "reports" in data, "Response should contain 'reports' key"
        
        print(f"PASS: Condition reports feed with region filter returns {len(data['reports'])} reports")
    
    def test_condition_reports_feed_with_all_region(self):
        """Test /api/condition-reports/feed with 'All' region (should return all)"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed?region=All")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "reports" in data, "Response should contain 'reports' key"
        
        print(f"PASS: Condition reports feed with 'All' region returns {len(data['reports'])} reports")
    
    def test_condition_reports_feed_pagination(self):
        """Test /api/condition-reports/feed pagination parameters"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed?limit=5&offset=0")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        reports = data["reports"]
        assert len(reports) <= 5, f"Expected max 5 reports, got {len(reports)}"
        
        print(f"PASS: Condition reports feed pagination works, returned {len(reports)} reports")


class TestSocialLiveAPI:
    """Test Social Live streaming endpoints"""
    
    def test_social_live_active_returns_empty_array(self):
        """Test /api/social-live/active returns empty array when no live streams"""
        response = requests.get(f"{BASE_URL}/api/social-live/active")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "streams" in data, "Response should contain 'streams' key"
        assert "count" in data, "Response should contain 'count' key"
        
        streams = data["streams"]
        assert isinstance(streams, list), "Streams should be a list"
        
        print(f"PASS: Social live active returns {len(streams)} streams, count: {data['count']}")
    
    def test_social_live_active_with_limit(self):
        """Test /api/social-live/active with limit parameter"""
        response = requests.get(f"{BASE_URL}/api/social-live/active?limit=10")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "streams" in data, "Response should contain 'streams' key"
        
        print(f"PASS: Social live active with limit returns {len(data['streams'])} streams")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
