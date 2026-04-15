"""
Test suite for Impact Dashboard features - Iteration 28
Testing:
- GET /api/impact/dashboard/{user_id} - Full impact dashboard with credits, sponsorships, settings
- GET /api/impact/public/{user_id} - Public impact score with level (Starter, Supporter, Patron, etc.)
- GET /api/impact/causes - List of verified causes with categories
- GET /api/impact/search-groms - Search for Groms to support
- GET /api/impact/search-surfers - Search for competitive surfers
- PUT /api/impact/settings/{user_id} - Update donation destination settings
- POST /api/impact/instant-shaka/{sponsorship_id} - Send 5-sec thank you video
- GET /api/impact/instant-shakas/{user_id} - Get instant shaka videos
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestImpactCauses:
    """Test verified causes endpoints"""
    
    def test_get_verified_causes(self):
        """GET /api/impact/causes - Returns list of verified causes"""
        response = requests.get(f"{BASE_URL}/api/impact/causes")
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list of causes
        assert isinstance(data, list)
        assert len(data) >= 8  # We seeded 8 causes
        
        # Check first cause structure
        cause = data[0]
        assert "id" in cause
        assert "name" in cause
        assert "description" in cause
        assert "category" in cause
        assert "is_featured" in cause
        print(f"PASSED: GET /api/impact/causes - Retrieved {len(data)} causes")
    
    def test_get_featured_causes_only(self):
        """GET /api/impact/causes?featured_only=true"""
        response = requests.get(f"{BASE_URL}/api/impact/causes?featured_only=true")
        assert response.status_code == 200
        data = response.json()
        
        # All returned causes should be featured
        for cause in data:
            assert cause["is_featured"] is True
        
        print(f"PASSED: GET /api/impact/causes?featured_only=true - {len(data)} featured causes")
    
    def test_filter_causes_by_category(self):
        """GET /api/impact/causes?category=ocean_conservation"""
        response = requests.get(f"{BASE_URL}/api/impact/causes?category=ocean_conservation")
        assert response.status_code == 200
        data = response.json()
        
        # All returned causes should be in ocean_conservation category
        for cause in data:
            assert cause["category"] == "ocean_conservation"
        
        print(f"PASSED: Category filter - {len(data)} ocean_conservation causes")
    
    def test_search_causes(self):
        """GET /api/impact/causes?search=Surfrider"""
        response = requests.get(f"{BASE_URL}/api/impact/causes?search=Surfrider")
        assert response.status_code == 200
        data = response.json()
        
        # Should find Surfrider Foundation
        assert len(data) >= 1
        assert any("Surfrider" in c["name"] for c in data)
        print(f"PASSED: Search causes - Found Surfrider Foundation")


class TestImpactSearchGroms:
    """Test Grom search endpoint"""
    
    def test_search_groms_no_query(self):
        """GET /api/impact/search-groms - Returns Groms without query"""
        response = requests.get(f"{BASE_URL}/api/impact/search-groms")
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list of groms
        assert isinstance(data, list)
        print(f"PASSED: GET /api/impact/search-groms - Retrieved {len(data)} Groms")
    
    def test_search_groms_with_query(self):
        """GET /api/impact/search-groms?search=Test"""
        response = requests.get(f"{BASE_URL}/api/impact/search-groms?search=Test")
        assert response.status_code == 200
        data = response.json()
        
        # Should return matching groms
        assert isinstance(data, list)
        
        # Check structure if results exist
        if len(data) > 0:
            grom = data[0]
            assert "id" in grom
            assert "full_name" in grom
        
        print(f"PASSED: Search Groms - Found {len(data)} matching")
    
    def test_search_groms_limit(self):
        """GET /api/impact/search-groms?limit=5"""
        response = requests.get(f"{BASE_URL}/api/impact/search-groms?limit=5")
        assert response.status_code == 200
        data = response.json()
        
        # Should respect limit
        assert len(data) <= 5
        print(f"PASSED: Groms limit=5 - Got {len(data)} results")


class TestImpactSearchSurfers:
    """Test competitive surfer search endpoint"""
    
    def test_search_surfers_no_query(self):
        """GET /api/impact/search-surfers - Returns competitive surfers"""
        response = requests.get(f"{BASE_URL}/api/impact/search-surfers")
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list
        assert isinstance(data, list)
        
        # Check that returned users are competitive surfers
        for surfer in data:
            assert surfer["role"] in ["Comp Surfer", "Pro"]
        
        print(f"PASSED: GET /api/impact/search-surfers - Retrieved {len(data)} surfers")
    
    def test_search_surfers_with_query(self):
        """GET /api/impact/search-surfers?search=Kelly"""
        response = requests.get(f"{BASE_URL}/api/impact/search-surfers?search=Kelly")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"PASSED: Search surfers - Found {len(data)} matching 'Kelly'")


class TestImpactDashboard:
    """Test impact dashboard endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get photographer ID for tests"""
        # Login to get photographer ID
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-photographer@test.com",
            "password": "test123"
        })
        if login_response.status_code == 200:
            self.user_id = login_response.json().get("id")
        else:
            pytest.skip("Cannot login as test photographer")
    
    def test_get_impact_dashboard(self):
        """GET /api/impact/dashboard/{user_id} - Full dashboard"""
        response = requests.get(f"{BASE_URL}/api/impact/dashboard/{self.user_id}")
        assert response.status_code == 200
        data = response.json()
        
        # Check all required fields
        assert data["user_id"] == self.user_id
        assert "role" in data
        assert "is_pro" in data
        assert "is_hobbyist" in data
        
        # Credits section
        assert "credits" in data
        credits = data["credits"]
        assert "withdrawable" in credits
        assert "gear_only" in credits
        assert "total" in credits
        
        # Impact score section
        assert "impact_score" in data
        score = data["impact_score"]
        assert "total_credits_given" in score
        assert "total_groms_supported" in score
        assert "total_causes_supported" in score
        assert "sponsorships_given" in score
        assert "sponsorships_received" in score
        
        # Donation settings
        assert "donation_settings" in data
        
        # Recent sponsorships
        assert "recent_sponsorships" in data
        
        print(f"PASSED: GET /api/impact/dashboard - Role: {data['role']}, Is Pro: {data['is_pro']}")
    
    def test_get_impact_dashboard_invalid_user(self):
        """GET /api/impact/dashboard/{invalid_id} - Returns 404"""
        response = requests.get(f"{BASE_URL}/api/impact/dashboard/non-existent-user-id")
        assert response.status_code == 404
        print("PASSED: Invalid user returns 404")


class TestPublicImpactScore:
    """Test public impact score endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get photographer ID for tests"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-photographer@test.com",
            "password": "test123"
        })
        if login_response.status_code == 200:
            self.user_id = login_response.json().get("id")
        else:
            pytest.skip("Cannot login as test photographer")
    
    def test_get_public_impact_score(self):
        """GET /api/impact/public/{user_id} - Public impact score"""
        response = requests.get(f"{BASE_URL}/api/impact/public/{self.user_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert data["user_id"] == self.user_id
        assert data["is_photographer"] is True
        
        # Impact score should have level info
        score = data["impact_score"]
        assert "total_credits_given" in score
        assert "total_groms_supported" in score
        assert "total_causes_supported" in score
        assert "level" in score
        
        # Level should have name, emoji, min_credits
        level = score["level"]
        assert "name" in level
        assert "emoji" in level
        assert "min_credits" in level
        
        # Starter is level 0
        assert level["name"] in ["Starter", "Contributor", "Supporter", "Patron", "Hero", "Champion", "Legend"]
        
        print(f"PASSED: Public impact score - Level: {level['name']} {level['emoji']}")
    
    def test_public_impact_non_photographer(self):
        """Test impact score for non-photographer user"""
        # Create or find a surfer user
        response = requests.get(f"{BASE_URL}/api/impact/search-surfers?limit=1")
        if response.status_code == 200 and len(response.json()) > 0:
            surfer_id = response.json()[0]["id"]
            
            impact_response = requests.get(f"{BASE_URL}/api/impact/public/{surfer_id}")
            assert impact_response.status_code == 200
            data = impact_response.json()
            
            # Non-photographers should not show impact score
            assert data["is_photographer"] is False
            print("PASSED: Non-photographer impact score returns is_photographer=False")
        else:
            pytest.skip("No surfer users available for test")


class TestImpactSettings:
    """Test impact settings update endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get photographer ID for tests"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-photographer@test.com",
            "password": "test123"
        })
        if login_response.status_code == 200:
            self.user_id = login_response.json().get("id")
        else:
            pytest.skip("Cannot login as test photographer")
    
    def test_update_settings_cause(self):
        """PUT /api/impact/settings/{user_id} - Set cause destination"""
        response = requests.put(f"{BASE_URL}/api/impact/settings/{self.user_id}", json={
            "donation_destination_type": "cause",
            "donation_cause_name": "Surfrider Foundation",
            "donation_split_percentage": 50
        })
        assert response.status_code == 200
        data = response.json()
        
        assert data["message"] == "Impact settings updated"
        assert data["user_id"] == self.user_id
        
        # Verify the settings were saved
        dashboard = requests.get(f"{BASE_URL}/api/impact/dashboard/{self.user_id}").json()
        assert dashboard["donation_settings"]["destination_type"] == "cause"
        assert dashboard["donation_settings"]["cause_name"] == "Surfrider Foundation"
        assert dashboard["donation_settings"]["split_percentage"] == 50
        
        print("PASSED: Updated donation settings to cause")
    
    def test_update_settings_grom(self):
        """PUT /api/impact/settings/{user_id} - Set grom destination"""
        # Find a grom to donate to
        groms = requests.get(f"{BASE_URL}/api/impact/search-groms?limit=1").json()
        if len(groms) == 0:
            pytest.skip("No groms available for test")
        
        grom_id = groms[0]["id"]
        
        response = requests.put(f"{BASE_URL}/api/impact/settings/{self.user_id}", json={
            "donation_destination_type": "grom",
            "donation_destination_id": grom_id,
            "donation_split_percentage": 30
        })
        assert response.status_code == 200
        print(f"PASSED: Updated donation settings to grom {groms[0]['full_name']}")
    
    def test_update_settings_invalid_cause(self):
        """PUT /api/impact/settings - Invalid cause returns 400"""
        response = requests.put(f"{BASE_URL}/api/impact/settings/{self.user_id}", json={
            "donation_destination_type": "cause",
            "donation_cause_name": "Non-existent Cause XYZ"
        })
        assert response.status_code == 400
        assert "Invalid cause" in response.json()["detail"]
        print("PASSED: Invalid cause returns 400")
    
    def test_update_settings_invalid_grom(self):
        """PUT /api/impact/settings - Invalid grom ID returns 400"""
        response = requests.put(f"{BASE_URL}/api/impact/settings/{self.user_id}", json={
            "donation_destination_type": "grom",
            "donation_destination_id": "invalid-grom-id-xyz"
        })
        assert response.status_code == 400
        assert "Invalid Grom ID" in response.json()["detail"]
        print("PASSED: Invalid Grom ID returns 400")


class TestInstantShaka:
    """Test Instant Shaka video endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get photographer ID for tests"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-photographer@test.com",
            "password": "test123"
        })
        if login_response.status_code == 200:
            self.user_id = login_response.json().get("id")
        else:
            pytest.skip("Cannot login as test photographer")
    
    def test_get_instant_shakas_received(self):
        """GET /api/impact/instant-shakas/{user_id}?direction=received"""
        response = requests.get(f"{BASE_URL}/api/impact/instant-shakas/{self.user_id}?direction=received")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"PASSED: Get received instant shakas - {len(data)} shakas")
    
    def test_get_instant_shakas_sent(self):
        """GET /api/impact/instant-shakas/{user_id}?direction=sent"""
        response = requests.get(f"{BASE_URL}/api/impact/instant-shakas/{self.user_id}?direction=sent")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"PASSED: Get sent instant shakas - {len(data)} shakas")
    
    def test_send_instant_shaka_invalid_sponsorship(self):
        """POST /api/impact/instant-shaka/{invalid_id} - Returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/impact/instant-shaka/non-existent-sponsorship-id",
            params={
                "sender_id": self.user_id,
                "video_url": "https://example.com/video.mp4"
            }
        )
        assert response.status_code == 404
        assert "Sponsorship not found" in response.json()["detail"]
        print("PASSED: Invalid sponsorship returns 404")


class TestImpactLevelCalculation:
    """Test impact level calculation based on credits given"""
    
    def test_impact_level_thresholds(self):
        """Verify impact level thresholds via public endpoint"""
        # Create a test to verify level names are returned correctly
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test-photographer@test.com",
            "password": "test123"
        })
        if login_response.status_code != 200:
            pytest.skip("Cannot login as test photographer")
        
        user_id = login_response.json().get("id")
        
        response = requests.get(f"{BASE_URL}/api/impact/public/{user_id}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify level structure
        level = data["impact_score"]["level"]
        assert level["name"] in ["Starter", "Contributor", "Supporter", "Patron", "Hero", "Champion", "Legend"]
        
        # Verify level thresholds
        level_thresholds = {
            "Starter": 0,
            "Contributor": 100,
            "Supporter": 500,
            "Patron": 1000,
            "Hero": 2500,
            "Champion": 5000,
            "Legend": 10000
        }
        
        assert level["min_credits"] == level_thresholds[level["name"]]
        print(f"PASSED: Impact level calculation - {level['name']} starts at {level['min_credits']} credits")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
