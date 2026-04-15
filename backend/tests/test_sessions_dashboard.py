"""
Backend API tests for Sessions Dashboard sync features
Tests earnings-breakdown endpoint and photographer pricing APIs
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data
PHOTOGRAPHER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters


class TestEarningsBreakdownAPI:
    """Test /api/photographer/{id}/earnings-breakdown endpoint"""
    
    def test_earnings_breakdown_returns_200(self):
        """Test earnings breakdown endpoint returns 200 for valid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/earnings-breakdown")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Earnings breakdown endpoint returns 200")
    
    def test_earnings_breakdown_response_structure(self):
        """Test earnings breakdown response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/earnings-breakdown")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check all required fields are present
        assert "live_sessions" in data, "Missing 'live_sessions' field"
        assert "request_pro" in data, "Missing 'request_pro' field"
        assert "regular_bookings" in data, "Missing 'regular_bookings' field"
        assert "gallery_sales" in data, "Missing 'gallery_sales' field"
        assert "total" in data, "Missing 'total' field"
        assert "split_bookings" in data, "Missing 'split_bookings' field"
        
        # Check data types
        assert isinstance(data["live_sessions"], (int, float)), "live_sessions should be numeric"
        assert isinstance(data["request_pro"], (int, float)), "request_pro should be numeric"
        assert isinstance(data["regular_bookings"], (int, float)), "regular_bookings should be numeric"
        assert isinstance(data["gallery_sales"], (int, float)), "gallery_sales should be numeric"
        assert isinstance(data["total"], (int, float)), "total should be numeric"
        assert isinstance(data["split_bookings"], list), "split_bookings should be a list"
        
        print("✓ Earnings breakdown response has correct structure with 4 revenue streams")
    
    def test_earnings_breakdown_total_calculation(self):
        """Test that total equals sum of all revenue streams"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/earnings-breakdown")
        
        assert response.status_code == 200
        data = response.json()
        
        calculated_total = (
            data["live_sessions"] + 
            data["request_pro"] + 
            data["regular_bookings"] + 
            data["gallery_sales"]
        )
        
        assert abs(data["total"] - calculated_total) < 0.01, \
            f"Total ({data['total']}) doesn't match sum of streams ({calculated_total})"
        
        print(f"✓ Total ({data['total']}) correctly sums all 4 revenue streams")
    
    def test_earnings_breakdown_with_days_param(self):
        """Test earnings breakdown accepts days parameter"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/earnings-breakdown?days=7")
        
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        print("✓ Earnings breakdown accepts days parameter")
    
    def test_earnings_breakdown_invalid_photographer(self):
        """Test earnings breakdown returns 404 for non-existent photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/invalid-id-12345/earnings-breakdown")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Earnings breakdown returns 404 for invalid photographer")


class TestPhotographerPricingAPI:
    """Test /api/photographer/{id}/pricing endpoint"""
    
    def test_pricing_returns_200(self):
        """Test pricing endpoint returns 200 for valid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Pricing endpoint returns 200")
    
    def test_pricing_response_structure(self):
        """Test pricing response has live session pricing fields"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/pricing")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields for live session pricing
        assert "live_buyin_price" in data, "Missing 'live_buyin_price' field"
        assert "live_photo_price" in data, "Missing 'live_photo_price' field"
        assert "photo_package_size" in data, "Missing 'photo_package_size' field"
        assert "booking_hourly_rate" in data, "Missing 'booking_hourly_rate' field"
        assert "booking_min_hours" in data, "Missing 'booking_min_hours' field"
        
        # Check data types and values
        assert isinstance(data["live_buyin_price"], (int, float)), "live_buyin_price should be numeric"
        assert isinstance(data["live_photo_price"], (int, float)), "live_photo_price should be numeric"
        assert isinstance(data["photo_package_size"], int), "photo_package_size should be integer"
        assert data["live_buyin_price"] >= 0, "live_buyin_price should be non-negative"
        assert data["live_photo_price"] >= 0, "live_photo_price should be non-negative"
        
        print(f"✓ Pricing response has correct structure: buy-in=${data['live_buyin_price']}, photo=${data['live_photo_price']}, included={data['photo_package_size']}")
    
    def test_pricing_invalid_photographer(self):
        """Test pricing returns 404 for non-existent photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/invalid-id-12345/pricing")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Pricing returns 404 for invalid photographer")


class TestGalleryPricingAPI:
    """Test /api/photographer/{id}/gallery-pricing endpoint"""
    
    def test_gallery_pricing_returns_200(self):
        """Test gallery pricing endpoint returns 200 for valid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Gallery pricing endpoint returns 200")
    
    def test_gallery_pricing_response_structure(self):
        """Test gallery pricing has photo and video pricing tiers"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check photo pricing tiers
        assert "photo_pricing" in data, "Missing 'photo_pricing' field"
        assert "web" in data["photo_pricing"], "Missing photo_pricing.web"
        assert "standard" in data["photo_pricing"], "Missing photo_pricing.standard"
        assert "high" in data["photo_pricing"], "Missing photo_pricing.high"
        
        # Check video pricing tiers
        assert "video_pricing" in data, "Missing 'video_pricing' field"
        assert "720p" in data["video_pricing"], "Missing video_pricing.720p"
        assert "1080p" in data["video_pricing"], "Missing video_pricing.1080p"
        assert "4k" in data["video_pricing"], "Missing video_pricing.4k"
        
        print(f"✓ Gallery pricing has photo tiers (web=${data['photo_pricing']['web']}, standard=${data['photo_pricing']['standard']}, high=${data['photo_pricing']['high']})")
        print(f"  and video tiers (720p=${data['video_pricing']['720p']}, 1080p=${data['video_pricing']['1080p']}, 4k=${data['video_pricing']['4k']})")


class TestActiveSessionAPI:
    """Test /api/photographer/{id}/active-session endpoint"""
    
    def test_active_session_returns_response(self):
        """Test active session endpoint returns valid response"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        
        # Can be 200 (with data) or 200 (null when no active session)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("✓ Active session endpoint returns 200")
    
    def test_active_session_invalid_photographer(self):
        """Test active session returns 404 for invalid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/invalid-id-12345/active-session")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Active session returns 404 for invalid photographer")


class TestSessionHistoryAPI:
    """Test /api/photographer/{id}/session-history endpoint"""
    
    def test_session_history_returns_200(self):
        """Test session history endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/session-history")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Session history should return a list"
        print(f"✓ Session history returns 200 with {len(data)} records")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
