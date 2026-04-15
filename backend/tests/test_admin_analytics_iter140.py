"""
Admin Analytics API Tests - Iteration 140
Tests for Platform Mission Control analytics endpoints:
- GET /api/admin/analytics/financial - Financial Oversight
- GET /api/admin/analytics/ecosystem - Ecosystem Health
- GET /api/admin/analytics/price-impact - Price Impact Markers
- GET /api/admin/analytics/cached-metrics - Cached Metrics
- POST /api/admin/analytics/refresh-cache - Cache Refresh
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestFinancialAnalytics:
    """Tests for GET /api/admin/analytics/financial"""
    
    def test_financial_analytics_returns_200(self):
        """Financial analytics endpoint returns 200 for admin"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/financial?admin_id={ADMIN_ID}&days=30")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Financial analytics returns 200")
    
    def test_financial_analytics_has_credit_liability(self):
        """Financial analytics includes total_credit_liability"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/financial?admin_id={ADMIN_ID}&days=30")
        data = response.json()
        
        assert "total_credit_liability" in data, "Missing total_credit_liability"
        assert isinstance(data["total_credit_liability"], (int, float)), "total_credit_liability should be numeric"
        print(f"✓ Total credit liability: ${data['total_credit_liability']}")
    
    def test_financial_analytics_has_credit_distribution(self):
        """Financial analytics includes credit_distribution breakdown"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/financial?admin_id={ADMIN_ID}&days=30")
        data = response.json()
        
        assert "credit_distribution" in data, "Missing credit_distribution"
        dist = data["credit_distribution"]
        expected_ranges = ["0", "1-50", "51-100", "101-500", "500+"]
        for range_key in expected_ranges:
            assert range_key in dist, f"Missing credit range: {range_key}"
        print(f"✓ Credit distribution: {dist}")
    
    def test_financial_analytics_has_revenue_data(self):
        """Financial analytics includes revenue metrics"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/financial?admin_id={ADMIN_ID}&days=30")
        data = response.json()
        
        assert "total_revenue_period" in data, "Missing total_revenue_period"
        assert "revenue_by_type" in data, "Missing revenue_by_type"
        assert "ad_revenue" in data, "Missing ad_revenue"
        print(f"✓ Revenue data: total=${data['total_revenue_period']}, ad=${data['ad_revenue']}")
    
    def test_financial_analytics_requires_admin(self):
        """Financial analytics returns 403 for non-admin"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/admin/analytics/financial?admin_id={fake_id}&days=30")
        assert response.status_code == 403, f"Expected 403 for non-admin, got {response.status_code}"
        print("✓ Non-admin access correctly denied")


class TestEcosystemAnalytics:
    """Tests for GET /api/admin/analytics/ecosystem"""
    
    def test_ecosystem_analytics_returns_200(self):
        """Ecosystem analytics endpoint returns 200 for admin"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/ecosystem?admin_id={ADMIN_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Ecosystem analytics returns 200")
    
    def test_ecosystem_has_role_distribution(self):
        """Ecosystem analytics includes role_distribution"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/ecosystem?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert "role_distribution" in data, "Missing role_distribution"
        roles = data["role_distribution"]
        # Check for some expected roles
        expected_roles = ["Surfer", "Photographer", "Grom"]
        for role in expected_roles:
            assert role in roles, f"Missing role: {role}"
        print(f"✓ Role distribution has {len(roles)} roles")
    
    def test_ecosystem_has_role_categories(self):
        """Ecosystem analytics includes role_categories with percentages"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/ecosystem?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert "role_categories" in data, "Missing role_categories"
        categories = data["role_categories"]
        expected_categories = ["surfers", "working_pros", "hobbyists", "businesses"]
        
        for cat in expected_categories:
            assert cat in categories, f"Missing category: {cat}"
            assert "count" in categories[cat], f"Missing count in {cat}"
            assert "percentage" in categories[cat], f"Missing percentage in {cat}"
        
        print(f"✓ Role categories: surfers={categories['surfers']['percentage']}%, working_pros={categories['working_pros']['percentage']}%")
    
    def test_ecosystem_has_booking_efficiency(self):
        """Ecosystem analytics includes booking_efficiency"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/ecosystem?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert "booking_efficiency" in data, "Missing booking_efficiency"
        efficiency = data["booking_efficiency"]
        assert "on_demand" in efficiency, "Missing on_demand"
        assert "scheduled" in efficiency, "Missing scheduled"
        assert "total" in efficiency, "Missing total"
        print(f"✓ Booking efficiency: on_demand={efficiency['on_demand']['percentage']}%, scheduled={efficiency['scheduled']['percentage']}%")
    
    def test_ecosystem_has_spot_heatmap(self):
        """Ecosystem analytics includes spot_heatmap"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/ecosystem?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert "spot_heatmap" in data, "Missing spot_heatmap"
        heatmap = data["spot_heatmap"]
        assert isinstance(heatmap, list), "spot_heatmap should be a list"
        
        if len(heatmap) > 0:
            spot = heatmap[0]
            assert "location" in spot, "Missing location in heatmap entry"
            assert "bookings" in spot, "Missing bookings in heatmap entry"
            print(f"✓ Spot heatmap has {len(heatmap)} entries, top spot: {spot['location']} ({spot['bookings']} bookings)")
        else:
            print("✓ Spot heatmap is empty (no bookings)")


class TestPriceImpactAnalytics:
    """Tests for GET /api/admin/analytics/price-impact"""
    
    def test_price_impact_returns_200(self):
        """Price impact endpoint returns 200 for admin"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/price-impact?admin_id={ADMIN_ID}&days=90")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Price impact analytics returns 200")
    
    def test_price_impact_has_markers(self):
        """Price impact includes price_change_markers"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/price-impact?admin_id={ADMIN_ID}&days=90")
        data = response.json()
        
        assert "price_change_markers" in data, "Missing price_change_markers"
        assert isinstance(data["price_change_markers"], list), "price_change_markers should be a list"
        print(f"✓ Price change markers: {len(data['price_change_markers'])} events")
    
    def test_price_impact_has_signup_trend(self):
        """Price impact includes signup_trend"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/price-impact?admin_id={ADMIN_ID}&days=90")
        data = response.json()
        
        assert "signup_trend" in data, "Missing signup_trend"
        trend = data["signup_trend"]
        assert isinstance(trend, list), "signup_trend should be a list"
        
        if len(trend) > 0:
            entry = trend[0]
            assert "date" in entry, "Missing date in signup_trend entry"
            assert "signups" in entry, "Missing signups in signup_trend entry"
        print(f"✓ Signup trend has {len(trend)} data points")


class TestCachedMetrics:
    """Tests for cached metrics endpoints"""
    
    def test_cached_metrics_returns_200(self):
        """Cached metrics endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/cached-metrics?admin_id={ADMIN_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Cached metrics returns 200")
    
    def test_cached_metrics_has_source(self):
        """Cached metrics includes source (cache or live)"""
        response = requests.get(f"{BASE_URL}/api/admin/analytics/cached-metrics?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert "source" in data, "Missing source"
        assert data["source"] in ["cache", "live"], f"Invalid source: {data['source']}"
        print(f"✓ Metrics source: {data['source']}")
    
    def test_refresh_cache_returns_200(self):
        """Cache refresh endpoint returns 200"""
        response = requests.post(f"{BASE_URL}/api/admin/analytics/refresh-cache?admin_id={ADMIN_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Cache refresh should return success=True"
        print(f"✓ Cache refresh successful: {data.get('message')}")
    
    def test_cached_metrics_returns_from_cache_after_refresh(self):
        """After refresh, cached metrics should return from cache"""
        # First refresh
        requests.post(f"{BASE_URL}/api/admin/analytics/refresh-cache?admin_id={ADMIN_ID}")
        
        # Then get cached metrics
        response = requests.get(f"{BASE_URL}/api/admin/analytics/cached-metrics?admin_id={ADMIN_ID}")
        data = response.json()
        
        assert data.get("source") == "cache", f"Expected source=cache, got {data.get('source')}"
        assert "age_hours" in data, "Missing age_hours"
        assert data["age_hours"] < 1, f"Cache should be fresh, got age_hours={data['age_hours']}"
        print(f"✓ Metrics returned from cache (age: {data['age_hours']} hours)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
