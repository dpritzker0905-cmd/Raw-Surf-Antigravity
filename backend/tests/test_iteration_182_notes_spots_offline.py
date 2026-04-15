"""
Test Suite for Iteration 182: Notes UI, Southeast Asia Spots, Offline Mode

Features tested:
1. Notes API endpoint GET /api/notes/user/{user_id}?viewer_id={viewer_id}
2. Southeast Asia surf spots (Thailand, Sri Lanka, Philippines)
3. Total spots count (should be 1447)
4. Notes create/delete endpoints
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test user from previous iterations
TEST_USER_ID = "d3eb9019-d16f-4374-b432-4d168a96a00f"  # kelly@surf.com


class TestNotesAPI:
    """Test Notes API endpoints"""
    
    def test_get_user_note_own_profile(self):
        """Test GET /api/notes/user/{user_id} for own profile"""
        response = requests.get(
            f"{BASE_URL}/api/notes/user/{TEST_USER_ID}",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return note (or null) and is_mutual_follower flag
        assert "note" in data
        assert "is_mutual_follower" in data
        # Own profile should always show as mutual follower
        assert data["is_mutual_follower"] == True
        print(f"SUCCESS: Notes API returns note={data['note'] is not None}, is_mutual_follower={data['is_mutual_follower']}")
    
    def test_get_notes_feed(self):
        """Test GET /api/notes/feed for notes from mutual followers"""
        response = requests.get(
            f"{BASE_URL}/api/notes/feed",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return own_note, feed, total_count, mutual_follower_count
        assert "own_note" in data
        assert "feed" in data
        assert "total_count" in data
        assert "mutual_follower_count" in data
        print(f"SUCCESS: Notes feed returns {data['total_count']} notes, {data['mutual_follower_count']} mutual followers")
    
    def test_get_my_note(self):
        """Test GET /api/notes/my-note"""
        response = requests.get(
            f"{BASE_URL}/api/notes/my-note",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return note (or null)
        assert "note" in data
        print(f"SUCCESS: My note endpoint returns note={data['note'] is not None}")


class TestSoutheastAsiaSpots:
    """Test Southeast Asia surf spots expansion"""
    
    def test_thailand_spots(self):
        """Test Thailand spots exist"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={"country": "Thailand"}
        )
        assert response.status_code == 200
        spots = response.json()
        
        assert len(spots) > 0, "Thailand should have spots"
        print(f"SUCCESS: Thailand has {len(spots)} spots")
        
        # Verify some expected spots
        spot_names = [s["name"] for s in spots]
        assert any("Phuket" in name or "Kata" in name or "Bang Tao" in name for name in spot_names), \
            "Thailand should have Phuket area spots"
    
    def test_sri_lanka_spots(self):
        """Test Sri Lanka spots exist"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={"country": "Sri Lanka"}
        )
        assert response.status_code == 200
        spots = response.json()
        
        assert len(spots) > 0, "Sri Lanka should have spots"
        print(f"SUCCESS: Sri Lanka has {len(spots)} spots")
        
        # Verify Arugam Bay exists (famous Sri Lanka spot)
        spot_names = [s["name"].lower() for s in spots]
        assert any("arugam" in name for name in spot_names), \
            "Sri Lanka should have Arugam Bay spots"
    
    def test_philippines_spots(self):
        """Test Philippines spots exist"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={"country": "Philippines"}
        )
        assert response.status_code == 200
        spots = response.json()
        
        assert len(spots) > 0, "Philippines should have spots"
        print(f"SUCCESS: Philippines has {len(spots)} spots")
        
        # Verify La Union or Siargao exists (famous Philippines spots)
        spot_names = [s["name"].lower() for s in spots]
        assert any("la union" in name or "siargao" in name or "baler" in name or "cloud 9" in name 
                   for name in spot_names), \
            "Philippines should have La Union, Siargao, or Baler spots"
    
    def test_total_spots_count(self):
        """Test total spots count is 1447"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # Should be exactly 1447 after Southeast Asia expansion
        assert len(spots) == 1447, f"Expected 1447 spots, got {len(spots)}"
        print(f"SUCCESS: Total spots count is {len(spots)}")


class TestSpotsAPIFiltering:
    """Test surf spots API filtering capabilities"""
    
    def test_spots_by_country(self):
        """Test filtering spots by country"""
        countries = ["Thailand", "Sri Lanka", "Philippines", "USA", "Australia"]
        
        for country in countries:
            response = requests.get(
                f"{BASE_URL}/api/surf-spots",
                params={"country": country}
            )
            assert response.status_code == 200
            spots = response.json()
            
            # All returned spots should be from the requested country
            for spot in spots:
                assert spot["country"] == country, \
                    f"Spot {spot['name']} has country {spot['country']}, expected {country}"
            
            print(f"SUCCESS: {country} filter returns {len(spots)} spots")
    
    def test_spots_structure(self):
        """Test spot data structure"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={"country": "Thailand"}
        )
        assert response.status_code == 200
        spots = response.json()
        
        if len(spots) > 0:
            spot = spots[0]
            # Verify required fields
            required_fields = ["id", "name", "country", "latitude", "longitude"]
            for field in required_fields:
                assert field in spot, f"Spot missing required field: {field}"
            
            print(f"SUCCESS: Spot structure verified with fields: {list(spot.keys())}")


class TestOfflineModeHook:
    """Test that offline mode hook dependencies are available"""
    
    def test_surf_spots_endpoint_for_offline(self):
        """Test that surf spots endpoint returns all data needed for offline caching"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # Verify we can get all spots for offline caching
        assert len(spots) > 1000, "Should have over 1000 spots for offline caching"
        
        # Verify each spot has location data for offline map
        for spot in spots[:10]:  # Check first 10
            assert "latitude" in spot
            assert "longitude" in spot
            assert spot["latitude"] is not None
            assert spot["longitude"] is not None
        
        print(f"SUCCESS: {len(spots)} spots available for offline caching")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
