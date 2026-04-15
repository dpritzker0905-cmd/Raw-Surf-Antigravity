"""
Test Session Pricing and Live Savings Feature (Iteration 49)

Tests:
1. POST /api/photographers/{id}/go-live accepts new pricing fields:
   - live_photo_price
   - photos_included
   - general_photo_price
   - max_surfers
   - estimated_duration
   
2. LiveSession record stores session-specific pricing fields
3. Pricing data returned in go-live response for savings display
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_PHOTOGRAPHER = {
    "email": "hobbyist_photo@surf.com",
    "password": "test-shaka"
}


class TestSessionPricingSavings:
    """Test session pricing and live savings feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.photographer_id = None
        yield
        # Cleanup: End session if active
        if self.photographer_id:
            try:
                self.session.post(f"{BASE_URL}/api/photographers/{self.photographer_id}/end-session")
            except:
                pass
    
    def test_photographer_login(self):
        """Test login for photographer user"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_PHOTOGRAPHER["email"],
            "password": TEST_PHOTOGRAPHER["password"]
        })
        
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Login response returns user data directly (not wrapped in "user" key)
        assert "role" in data, f"Expected role in response: {data}"
        assert data["role"] == "Hobbyist", f"Expected Hobbyist role, got {data['role']}"
        self.photographer_id = data["id"]
        print(f"✓ Photographer logged in: {data['full_name']} (ID: {self.photographer_id})")
        return data["id"]
    
    def test_get_photographer_pricing(self):
        """Test fetching photographer's default pricing"""
        photographer_id = self.test_photographer_login()
        
        response = self.session.get(f"{BASE_URL}/api/photographer/{photographer_id}/pricing")
        
        assert response.status_code == 200, f"Failed to get pricing: {response.text}"
        data = response.json()
        
        # Verify pricing fields exist
        assert "live_buyin_price" in data
        assert "live_photo_price" in data
        assert "photo_package_size" in data
        assert "booking_hourly_rate" in data
        assert "booking_min_hours" in data
        
        print(f"✓ Photographer pricing retrieved:")
        print(f"  - Buy-in Price: ${data['live_buyin_price']}")
        print(f"  - Photo Price: ${data['live_photo_price']}")
        print(f"  - Package Size: {data['photo_package_size']} photos")
    
    def test_go_live_with_session_pricing(self):
        """Test go-live API with new session pricing fields"""
        photographer_id = self.test_photographer_login()
        
        # First end any existing session - use singular 'photographer' in path
        try:
            self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        except:
            pass
        
        # Go live with session-specific pricing (using a real surf spot)
        go_live_data = {
            "spot_id": "dda01b15-4385-4687-af62-9b249f0781c0",  # Atlantic Beach
            "location": "Test Beach",
            "price_per_join": 30.0,  # Custom buy-in
            "max_surfers": 15,
            "auto_accept": True,
            "estimated_duration": 3,  # 3 hours
            # New Live Session Rates fields
            "live_photo_price": 4.0,  # Discounted from general price
            "photos_included": 5,     # 5 photos included in buy-in
            "general_photo_price": 10.0  # General gallery price for comparison
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/photographers/{photographer_id}/go-live",
            json=go_live_data
        )
        
        assert response.status_code == 200, f"Go-live failed: {response.text}"
        data = response.json()
        
        # Verify response contains session data
        assert "message" in data
        assert "live_session_id" in data
        assert "live_session_rates" in data, "Response should include live_session_rates"
        
        rates = data["live_session_rates"]
        
        # Verify session rates match what we sent
        assert rates["buyin_price"] == 30.0, f"Expected buyin 30, got {rates['buyin_price']}"
        assert rates["live_photo_price"] == 4.0, f"Expected photo price 4, got {rates['live_photo_price']}"
        assert rates["photos_included"] == 5, f"Expected 5 photos included, got {rates['photos_included']}"
        assert rates["general_photo_price"] == 10.0, f"Expected general price 10, got {rates['general_photo_price']}"
        assert rates["max_surfers"] == 15, f"Expected max_surfers 15, got {rates['max_surfers']}"
        
        # Verify savings calculation
        expected_savings = 10.0 - 4.0  # general - live = $6 savings
        assert rates["savings_per_photo"] == expected_savings, f"Expected savings {expected_savings}, got {rates['savings_per_photo']}"
        
        print(f"✓ Go-live with session pricing successful:")
        print(f"  - Live Session ID: {data['live_session_id']}")
        print(f"  - Buy-in: ${rates['buyin_price']}")
        print(f"  - Live Photo Price: ${rates['live_photo_price']}")
        print(f"  - Photos Included: {rates['photos_included']}")
        print(f"  - General Price (reference): ${rates['general_photo_price']}")
        print(f"  - Savings per photo: ${rates['savings_per_photo']}")
        print(f"  - Max Surfers: {rates['max_surfers']}")
        
        # End session - use singular 'photographer' in path
        end_response = self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        assert end_response.status_code == 200, f"End session failed: {end_response.text}"
        print(f"✓ Session ended successfully")
    
    def test_go_live_default_values(self):
        """Test go-live uses default values when pricing fields not provided"""
        photographer_id = self.test_photographer_login()
        
        # End any existing session - use singular 'photographer' in path
        try:
            self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        except:
            pass
        
        # Go live with minimal data (no session pricing fields, but with valid spot)
        go_live_data = {
            "spot_id": "dda01b15-4385-4687-af62-9b249f0781c0",  # Atlantic Beach
            "location": "Minimal Test Beach",
            "price_per_join": 25.0
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/photographers/{photographer_id}/go-live",
            json=go_live_data
        )
        
        assert response.status_code == 200, f"Go-live failed: {response.text}"
        data = response.json()
        
        # Should still have live_session_rates with defaults
        assert "live_session_rates" in data
        rates = data["live_session_rates"]
        
        # Default values should be applied
        assert rates["photos_included"] == 3, f"Expected default photos_included 3, got {rates['photos_included']}"
        assert rates["max_surfers"] == 10, f"Expected default max_surfers 10, got {rates['max_surfers']}"
        
        print(f"✓ Go-live with defaults successful:")
        print(f"  - Photos Included (default): {rates['photos_included']}")
        print(f"  - Max Surfers (default): {rates['max_surfers']}")
        print(f"  - Live Photo Price: ${rates['live_photo_price']}")
        print(f"  - General Photo Price: ${rates['general_photo_price']}")
        
        # End session - use singular 'photographer' in path
        self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
    
    def test_savings_calculation_no_savings(self):
        """Test when live price equals or exceeds general price (no savings)"""
        photographer_id = self.test_photographer_login()
        
        # End any existing session - use singular 'photographer' in path
        try:
            self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        except:
            pass
        
        # Go live with live price >= general price
        go_live_data = {
            "spot_id": "dda01b15-4385-4687-af62-9b249f0781c0",  # Atlantic Beach
            "location": "No Savings Beach",
            "price_per_join": 25.0,
            "live_photo_price": 12.0,  # More than general price
            "general_photo_price": 10.0
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/photographers/{photographer_id}/go-live",
            json=go_live_data
        )
        
        assert response.status_code == 200, f"Go-live failed: {response.text}"
        data = response.json()
        rates = data["live_session_rates"]
        
        # Savings should be negative (no actual savings for surfers)
        expected_savings = 10.0 - 12.0  # -$2
        assert rates["savings_per_photo"] == expected_savings
        
        print(f"✓ No savings scenario handled correctly:")
        print(f"  - Live Photo Price: ${rates['live_photo_price']}")
        print(f"  - General Photo Price: ${rates['general_photo_price']}")
        print(f"  - Savings (negative = no savings): ${rates['savings_per_photo']}")
        
        # End session - use singular 'photographer' in path
        self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
    
    def test_active_session_retrieval(self):
        """Test retrieving active session shows pricing data"""
        photographer_id = self.test_photographer_login()
        
        # End any existing session - use singular 'photographer' in path
        try:
            self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        except:
            pass
        
        # Go live with valid spot
        go_live_data = {
            "spot_id": "dda01b15-4385-4687-af62-9b249f0781c0",  # Atlantic Beach
            "location": "Active Session Beach",
            "price_per_join": 35.0,
            "live_photo_price": 6.0,
            "photos_included": 4,
            "general_photo_price": 12.0,
            "max_surfers": 8,
            "estimated_duration": 2
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/photographers/{photographer_id}/go-live",
            json=go_live_data
        )
        assert response.status_code == 200, f"Go-live failed: {response.text}"
        
        # Get active session
        response = self.session.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
        
        assert response.status_code == 200, f"Get active session failed: {response.text}"
        data = response.json()
        
        # Active session should exist and return spot name from DB
        assert data is not None, "Expected active session data"
        # The endpoint returns spot_name from DB, not custom location param
        assert "location" in data
        assert data["price_per_join"] == 35.0
        
        print(f"✓ Active session retrieved:")
        print(f"  - Location: {data['location']}")
        print(f"  - Buy-in: ${data['price_per_join']}")
        
        # End session - use singular 'photographer' in path
        self.session.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")


class TestSurfSpotMapIntegration:
    """Test surf spot and map endpoints"""
    
    def test_get_surf_spots(self):
        """Test getting surf spots for map display"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        
        assert response.status_code == 200, f"Get surf spots failed: {response.text}"
        spots = response.json()
        
        assert isinstance(spots, list), "Expected list of surf spots"
        assert len(spots) > 0, "Expected at least one surf spot"
        
        # Check first spot has required fields
        spot = spots[0]
        assert "id" in spot
        assert "name" in spot
        assert "latitude" in spot
        assert "longitude" in spot
        
        print(f"✓ Retrieved {len(spots)} surf spots")
        print(f"  - First spot: {spot['name']}")
    
    def test_get_live_photographers(self):
        """Test getting live photographers for map"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        
        assert response.status_code == 200, f"Get live photographers failed: {response.text}"
        photographers = response.json()
        
        assert isinstance(photographers, list), "Expected list of photographers"
        
        print(f"✓ Retrieved {len(photographers)} live photographers")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
