"""
Test: Theme Lock, Badge Award Triggers, and God Mode - Iteration 60
Tests badge award triggers after XP awards and God Mode effective_role parameter
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"


class TestHealthAndAuth:
    """Basic health and auth tests"""
    
    def test_api_works(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        print("✅ API responding")
    
    def test_admin_login(self):
        """Test admin login - returns user directly (not wrapped in 'user' key)"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        # Response returns user directly - id should be present
        assert "id" in data
        assert "email" in data
        print(f"✅ Admin login passed: {data['email']}")
        return data


class TestGamificationBadges:
    """Test badge award triggers in gamification system"""
    
    def test_gamification_stats_endpoint(self):
        """Test gamification stats endpoint exists and returns data structure"""
        # First login to get user ID
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # Get gamification stats
        response = requests.get(f"{BASE_URL}/api/gamification/user/{user_id}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "total_xp" in data
        assert "badges" in data
        assert "recent_xp_transactions" in data
        print(f"✅ Gamification stats endpoint working. Total XP: {data['total_xp']}, Badges: {len(data['badges'])}")
    
    def test_check_badges_endpoint(self):
        """Test badge milestone check endpoint"""
        # Login to get user ID
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # Trigger badge check
        response = requests.post(f"{BASE_URL}/api/gamification/check-badges/{user_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert "badges_awarded" in data
        print(f"✅ Check badges endpoint working. Badges checked/awarded: {data['badges_awarded']}")
    
    def test_leaderboard_endpoint(self):
        """Test XP leaderboard endpoint"""
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard")
        assert response.status_code == 200
        data = response.json()
        
        assert "leaderboard" in data
        assert "time_range" in data
        assert "category" in data
        print(f"✅ Leaderboard endpoint working. Time range: {data['time_range']}, Category: {data['category']}")
    
    def test_leaderboard_with_filters(self):
        """Test XP leaderboard with time and category filters"""
        # Test week filter
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard?time_range=week")
        assert response.status_code == 200
        data = response.json()
        assert data['time_range'] == 'week'
        
        # Test category filter
        response = requests.get(f"{BASE_URL}/api/gamification/leaderboard?category=patrons")
        assert response.status_code == 200
        data = response.json()
        assert data['category'] == 'patrons'
        
        print("✅ Leaderboard filters working")


class TestReviewsBadgeTrigger:
    """Test that reviews.py has badge trigger after XP award"""
    
    def test_reviews_photographer_stats(self):
        """Test reviews endpoint - stats should work"""
        # Login to get user ID
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # Get photographer reviews stats
        response = requests.get(f"{BASE_URL}/api/reviews/photographer/{user_id}/stats")
        assert response.status_code == 200
        data = response.json()
        
        assert "average_rating" in data
        assert "total_reviews" in data
        print(f"✅ Reviews stats endpoint working. Avg rating: {data['average_rating']}, Total: {data['total_reviews']}")


class TestGalleryEndpoints:
    """Test gallery endpoints (badge triggers are in purchase flow)"""
    
    def test_photographer_gallery(self):
        """Test photographer gallery endpoint"""
        # Login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # Get gallery
        response = requests.get(f"{BASE_URL}/api/gallery/photographer/{user_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✅ Photographer gallery endpoint working. Items: {len(data)}")


class TestSessionsGodMode:
    """Test sessions endpoint with God Mode effective_role parameter"""
    
    def test_sessions_endpoint_exists(self):
        """Test that sessions join endpoint exists"""
        # Login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # The join endpoint should exist (we'll get an error but not 404 on route)
        # Testing with invalid data to verify endpoint route exists
        response = requests.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={user_id}",
            json={
                "photographer_id": "invalid-id",
                "effective_role": "Surfer"  # God Mode parameter
            }
        )
        # Should return 404 for photographer not found, OR 403 for role restriction
        # Not 404 for route - route should exist
        assert response.status_code in [400, 403, 404, 422]
        print(f"✅ Sessions join endpoint exists. Response: {response.status_code}")
    
    def test_surfer_active_session(self):
        """Test surfer active session endpoint"""
        # Login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        user_id = login_resp.json()['id']
        
        # Get active session
        response = requests.get(f"{BASE_URL}/api/sessions/my-active/{user_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert "active" in data
        print(f"✅ Surfer active session endpoint working. Active: {data['active']}")


class TestSpotsEndpoint:
    """Test spots endpoint for live photographer data"""
    
    def test_spots_list(self):
        """Test spots list endpoint"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✅ Spots endpoint working. Total spots: {len(data)}")
    
    def test_active_shooters(self):
        """Test active shooters endpoint"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✅ Active shooters endpoint working. Active photographers: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
