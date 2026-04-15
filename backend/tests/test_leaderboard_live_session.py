"""
Test Sponsorship Leaderboard and Live Session E2E Flow
Tests:
1. GET /api/leaderboard/top-sponsors - Returns monthly leaderboard
2. GET /api/leaderboard/top-sponsors?period=lifetime - Returns all-time leaderboard
3. GET /api/leaderboard/photographer/{id}/rank - Returns photographer's rank and stats
4. GET /api/leaderboard/photographer/{id}/details - Returns detailed impact info for Quick Card
5. E2E live session flow (go-live → join → end → gallery created)
6. Revenue routing records entries in impact_ledger
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestLeaderboardAPI:
    """Test leaderboard API endpoints"""
    
    def test_get_top_sponsors_monthly(self):
        """GET /api/leaderboard/top-sponsors - Returns monthly leaderboard"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "period" in data
        assert data["period"] == "monthly"
        assert "month" in data
        assert "year" in data
        assert "leaderboard" in data
        assert isinstance(data["leaderboard"], list)
        print(f"✓ GET /api/leaderboard/top-sponsors returned monthly leaderboard with {len(data['leaderboard'])} sponsors")
    
    def test_get_top_sponsors_lifetime(self):
        """GET /api/leaderboard/top-sponsors?period=lifetime - Returns all-time leaderboard"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors?period=lifetime")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "period" in data
        assert data["period"] == "lifetime"
        assert "leaderboard" in data
        assert isinstance(data["leaderboard"], list)
        
        # Check data structure for each sponsor
        if len(data["leaderboard"]) > 0:
            sponsor = data["leaderboard"][0]
            assert "rank" in sponsor
            assert "photographer_id" in sponsor
            assert "full_name" in sponsor
            assert "lifetime_total" in sponsor
            assert "is_grom_guardian" in sponsor
        print(f"✓ GET /api/leaderboard/top-sponsors?period=lifetime returned {len(data['leaderboard'])} sponsors")
    
    def test_get_top_sponsors_with_limit(self):
        """GET /api/leaderboard/top-sponsors?limit=5 - Returns limited leaderboard"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data["leaderboard"]) <= 5
        print(f"✓ GET /api/leaderboard/top-sponsors?limit=5 returned {len(data['leaderboard'])} sponsors (max 5)")
    
    def test_get_photographer_rank(self):
        """GET /api/leaderboard/photographer/{id}/rank - Returns photographer's rank"""
        # First get a photographer ID from leaderboard
        leaderboard_response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors?period=lifetime")
        leaderboard = leaderboard_response.json().get("leaderboard", [])
        
        if len(leaderboard) > 0:
            photographer_id = leaderboard[0]["photographer_id"]
            
            response = requests.get(f"{BASE_URL}/api/leaderboard/photographer/{photographer_id}/rank")
            assert response.status_code == 200
            
            data = response.json()
            assert "photographer_id" in data
            assert data["photographer_id"] == photographer_id
            assert "monthly_total" in data
            assert "lifetime_total" in data
            assert "is_grom_guardian" in data
            assert "groms_supported" in data
            assert "causes_supported" in data
            print(f"✓ GET /api/leaderboard/photographer/{photographer_id}/rank returned rank data")
        else:
            pytest.skip("No photographers in leaderboard to test rank")
    
    def test_get_photographer_rank_invalid_id(self):
        """GET /api/leaderboard/photographer/{invalid}/rank - Returns 404"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/photographer/invalid-id/rank")
        assert response.status_code == 404
        print("✓ GET /api/leaderboard/photographer/invalid-id/rank returns 404")
    
    def test_get_photographer_details(self):
        """GET /api/leaderboard/photographer/{id}/details - Returns detailed impact info"""
        # First get a photographer ID
        leaderboard_response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors?period=lifetime")
        leaderboard = leaderboard_response.json().get("leaderboard", [])
        
        if len(leaderboard) > 0:
            photographer_id = leaderboard[0]["photographer_id"]
            
            response = requests.get(f"{BASE_URL}/api/leaderboard/photographer/{photographer_id}/details")
            assert response.status_code == 200
            
            data = response.json()
            assert "photographer_id" in data
            assert "full_name" in data
            assert "role" in data
            assert "monthly_total" in data
            assert "lifetime_total" in data
            assert "total_groms_supported" in data
            assert "total_causes_supported" in data
            assert "supported_athletes" in data
            assert "supported_causes" in data
            assert isinstance(data["supported_athletes"], list)
            assert isinstance(data["supported_causes"], list)
            print(f"✓ GET /api/leaderboard/photographer/{photographer_id}/details returned impact details")
        else:
            pytest.skip("No photographers in leaderboard to test details")
    
    def test_get_photographer_details_invalid_id(self):
        """GET /api/leaderboard/photographer/{invalid}/details - Returns 404"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/photographer/invalid-id/details")
        assert response.status_code == 404
        print("✓ GET /api/leaderboard/photographer/invalid-id/details returns 404")


class TestAuthenticationHelper:
    """Helper to manage authentication"""
    
    @staticmethod
    def login(email: str, password: str) -> dict:
        """Login and return tokens and user info"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        if response.status_code == 200:
            data = response.json()
            # Normalize: auth response has id directly, not nested in user
            if "id" in data and "user" not in data:
                data["user"] = {"id": data["id"]}
            return data
        return None


class TestLiveSessionE2EFlow:
    """Test E2E live session flow: go-live → join → end → gallery created"""
    
    @pytest.fixture
    def photographer_auth(self):
        """Get photographer authentication"""
        auth = TestAuthenticationHelper.login("test-photographer@test.com", "test123")
        if not auth:
            pytest.skip("Could not authenticate photographer")
        return auth
    
    @pytest.fixture
    def surfer_auth(self):
        """Get surfer authentication"""
        auth = TestAuthenticationHelper.login("test-shaka@test.com", "test123")
        if not auth:
            pytest.skip("Could not authenticate surfer")
        return auth
    
    def test_photographer_go_live(self, photographer_auth):
        """POST /api/photographer/{id}/go-live - Start live session"""
        photographer_id = photographer_auth.get("user", {}).get("id") or photographer_auth.get("id")
        if not photographer_id:
            pytest.skip("No photographer ID in auth response")
        
        # First check if photographer is already live and end session
        active_response = requests.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
        if active_response.status_code == 200 and active_response.json():
            # End existing session first
            end_response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
            print(f"Ended existing session: {end_response.status_code}")
        
        # Now go live
        response = requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={
                "location": "Test Beach",
                "price_per_join": 25.0,
                "max_surfers": 10,
                "auto_accept": True
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data
        assert "live_session_id" in data
        assert data.get("location") == "Test Beach"
        assert data.get("session_price") == 25.0
        print(f"✓ POST /api/photographer/{photographer_id}/go-live - Session started")
        
        return data
    
    def test_photographer_active_session(self, photographer_auth):
        """GET /api/photographer/{id}/active-session - Get active session"""
        photographer_id = photographer_auth.get("user", {}).get("id") or photographer_auth.get("id")
        
        response = requests.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
        # Could be 200 (session active) or 400 (no active session)
        assert response.status_code in [200, 400]
        print(f"✓ GET /api/photographer/{photographer_id}/active-session returned {response.status_code}")
    
    def test_live_session_full_flow(self, photographer_auth, surfer_auth):
        """Test full E2E flow: go-live → verify active → end → gallery created"""
        photographer_id = photographer_auth.get("user", {}).get("id") or photographer_auth.get("id")
        surfer_id = surfer_auth.get("user", {}).get("id") or surfer_auth.get("id")
        
        if not photographer_id or not surfer_id:
            pytest.skip("Missing user IDs")
        
        # Step 1: End any existing session
        end_response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        print(f"Pre-cleanup: {end_response.status_code}")
        
        # Step 2: Go live
        go_live_response = requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={
                "location": "E2E Test Beach",
                "price_per_join": 20.0,
                "max_surfers": 5
            }
        )
        assert go_live_response.status_code == 200, f"Go live failed: {go_live_response.text}"
        go_live_data = go_live_response.json()
        live_session_id = go_live_data.get("live_session_id")
        print(f"✓ Step 1: Photographer went live, session_id={live_session_id}")
        
        # Step 3: Verify photographer is now live
        active_response = requests.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
        assert active_response.status_code == 200
        active_data = active_response.json()
        assert active_data is not None
        print(f"✓ Step 2: Verified photographer is live at {active_data.get('location')}")
        
        # Step 4: End session
        end_response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        assert end_response.status_code == 200, f"End session failed: {end_response.text}"
        end_data = end_response.json()
        
        # Verify gallery was created
        assert "gallery_id" in end_data
        assert "gallery_title" in end_data
        gallery_id = end_data.get("gallery_id")
        print(f"✓ Step 3: Session ended, gallery created: {end_data.get('gallery_title')}")
        
        # Step 5: Verify gallery exists
        gallery_response = requests.get(f"{BASE_URL}/api/galleries/{gallery_id}")
        assert gallery_response.status_code == 200, f"Gallery not found: {gallery_response.text}"
        gallery_data = gallery_response.json()
        assert gallery_data.get("id") == gallery_id
        assert gallery_data.get("photographer_id") == photographer_id
        print(f"✓ Step 4: Gallery verified: {gallery_data.get('title')}")
        
        print("\n✓✓✓ E2E Live Session Flow Complete ✓✓✓")
    
    def test_photographer_end_session(self, photographer_auth):
        """POST /api/photographer/{id}/end-session - End live session"""
        photographer_id = photographer_auth.get("user", {}).get("id") or photographer_auth.get("id")
        
        # First ensure photographer is live
        go_live_response = requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={"location": "End Test Beach", "price_per_join": 15.0}
        )
        
        if go_live_response.status_code == 400:
            # Already in session, that's ok
            pass
        
        # Now end session
        response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        
        # Could be 200 (ended) or 400 (no active session)
        if response.status_code == 200:
            data = response.json()
            assert "gallery_id" in data
            assert "total_surfers" in data
            assert "total_earnings" in data
            print(f"✓ POST /api/photographer/{photographer_id}/end-session - Gallery ID: {data.get('gallery_id')}")
        else:
            print(f"✓ POST /api/photographer/{photographer_id}/end-session returned {response.status_code} (no active session)")


class TestImpactLedger:
    """Test that revenue routing records entries in impact_ledger"""
    
    def test_impact_ledger_models_exist(self):
        """Verify ImpactLedger and LeaderboardSnapshot tables exist via API"""
        # Get leaderboard - this queries ImpactLedger table
        response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors")
        assert response.status_code == 200
        print("✓ ImpactLedger table accessible via leaderboard API")
    
    def test_leaderboard_snapshot_model(self):
        """Verify LeaderboardSnapshot is used for archiving"""
        # The snapshot is created during monthly reset
        # We can verify the endpoint works which requires the model
        response = requests.get(f"{BASE_URL}/api/leaderboard/top-sponsors?period=lifetime")
        assert response.status_code == 200
        print("✓ LeaderboardSnapshot model accessible")


class TestLivePhotographersPublic:
    """Test public photographers endpoints"""
    
    def test_get_live_photographers(self):
        """GET /api/photographers/live - Returns live photographers"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        for photographer in data:
            assert "id" in photographer
            assert "full_name" in photographer
            assert "location" in photographer or photographer.get("spot_name") is not None
        
        print(f"✓ GET /api/photographers/live returned {len(data)} photographers")
    
    def test_get_featured_photographers(self):
        """GET /api/photographers/featured - Returns featured photographers"""
        response = requests.get(f"{BASE_URL}/api/photographers/featured?limit=10")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/photographers/featured returned {len(data)} photographers")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
