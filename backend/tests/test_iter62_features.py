"""
Test cases for Iteration 62 Features:
- Stoke Sponsor Leaderboard API
- Mobile layer collision fix (frontend-only)
- Camera permission persistence (frontend-only)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestStokeSponsorLeaderboard:
    """Tests for GET /api/career/stoke-sponsor/leaderboard endpoint"""
    
    def test_leaderboard_all_time(self):
        """Test leaderboard with all time range"""
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/leaderboard?time_range=all")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "time_range" in data
        assert data["time_range"] == "all"
        assert "stats" in data
        assert "leaderboard" in data
        
        # Verify stats structure
        stats = data["stats"]
        assert "total_contributed" in stats
        assert "total_to_groms" in stats
        assert "total_sponsors" in stats
        
        # Values should be numeric
        assert isinstance(stats["total_contributed"], (int, float))
        assert isinstance(stats["total_to_groms"], (int, float))
        assert isinstance(stats["total_sponsors"], int)
        
        print(f"✓ All time leaderboard: {len(data['leaderboard'])} sponsors, ${stats['total_contributed']} total")
    
    def test_leaderboard_week_range(self):
        """Test leaderboard with week time range"""
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/leaderboard?time_range=week")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["time_range"] == "week"
        assert "stats" in data
        assert "leaderboard" in data
        
        print(f"✓ Week leaderboard: {len(data['leaderboard'])} sponsors")
    
    def test_leaderboard_month_range(self):
        """Test leaderboard with month time range"""
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/leaderboard?time_range=month")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["time_range"] == "month"
        assert "stats" in data
        assert "leaderboard" in data
        
        print(f"✓ Month leaderboard: {len(data['leaderboard'])} sponsors")
    
    def test_leaderboard_entry_structure(self):
        """Test leaderboard entry structure when data exists"""
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/leaderboard?time_range=all")
        
        assert response.status_code == 200
        data = response.json()
        
        # If there are entries, verify structure
        if data["leaderboard"]:
            entry = data["leaderboard"][0]
            
            # Required fields for each entry
            assert "rank" in entry
            assert "photographer_id" in entry
            assert "full_name" in entry
            assert "total_contributed" in entry
            assert "contribution_count" in entry
            assert "grom_percentage" in entry
            
            # Rank should be 1 for first entry
            assert entry["rank"] == 1
            
            print(f"✓ First sponsor: {entry['full_name']} - ${entry['total_contributed']}")
        else:
            print("✓ Leaderboard empty but structure valid")


class TestExistingCareerAPIs:
    """Verify existing Career Hub APIs still work"""
    
    def test_stoke_sponsor_eligible_surfers(self):
        """Test eligible surfers endpoint"""
        # Using a placeholder photographer_id
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/eligible-surfers?photographer_id=test")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "eligible_surfers" in data
        assert isinstance(data["eligible_surfers"], list)
        
        print(f"✓ Eligible surfers endpoint: {len(data['eligible_surfers'])} surfers")


class TestSurfSpotsAndPhotographers:
    """Test map-related APIs that support the Jump In flow"""
    
    def test_surf_spots_api(self):
        """Test surf spots endpoint returns Florida spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) > 0
        
        # Verify spot structure
        spot = data[0]
        assert "id" in spot
        assert "name" in spot
        assert "latitude" in spot
        assert "longitude" in spot
        assert "active_photographers_count" in spot
        
        print(f"✓ Surf spots: {len(data)} spots loaded")
    
    def test_live_photographers_api(self):
        """Test live photographers endpoint"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        
        if data:
            photographer = data[0]
            assert "id" in photographer
            assert "full_name" in photographer
            assert "is_shooting" in photographer
            assert "current_spot_name" in photographer
            
            print(f"✓ Live photographers: {len(data)} shooting ({data[0]['full_name']})")
        else:
            print("✓ Live photographers endpoint working (none currently live)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
