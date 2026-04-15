"""
Test Gear Hub, Shaka System, and Revenue Routing Features

Tests:
- GET /api/gear-hub - Returns catalog of gear items
- GET /api/gear-hub?category=camera - Category filtering
- GET /api/gear-hub?featured_only=true - Featured items only
- GET /api/gear-hub/user/{user_id}/progress - User gear credits and progress
- POST /api/gear-hub/{item_id}/purchase - Purchase gear with credits
- GET /api/shaka/animations - Returns list of Shaka animations
- GET /api/shaka/pending/{user_id} - Get pending Shaka prompts
- POST /api/shaka/send - Send Shaka thank you
- POST /api/photographer/{id}/go-live - Start session with earnings_destination fields
- POST /api/photographer/{id}/end-session - End session with revenue routing
"""

import pytest
import requests
import os
import json
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data
TEST_HOBBYIST = {
    "email": "testhobbyist_flow@example.com",
    "password": "testpass123"
}

TEST_PHOTOGRAPHER = {
    "email": "test-photographer@test.com",
    "password": "test123"
}


class TestGearHubCatalog:
    """Tests for Gear Hub catalog endpoints"""

    def test_get_gear_catalog_returns_items(self):
        """GET /api/gear-hub should return list of gear items"""
        response = requests.get(f"{BASE_URL}/api/gear-hub")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Gear catalog should have items"
        
        # Verify item structure
        item = data[0]
        assert "id" in item
        assert "name" in item
        assert "category" in item
        assert "price_credits" in item
        assert "affiliate_partner" in item
        print(f"✓ Gear catalog returned {len(data)} items")

    def test_gear_catalog_category_filter(self):
        """GET /api/gear-hub?category=camera should filter by category"""
        response = requests.get(f"{BASE_URL}/api/gear-hub?category=camera")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # All items should be cameras
        for item in data:
            assert item["category"] == "camera", f"Expected camera, got {item['category']}"
        
        print(f"✓ Category filter returned {len(data)} camera items")

    def test_gear_catalog_featured_filter(self):
        """GET /api/gear-hub?featured_only=true should return only featured items"""
        response = requests.get(f"{BASE_URL}/api/gear-hub?featured_only=true")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # All items should be featured
        for item in data:
            assert item["is_featured"] == True, "Expected featured item only"
        
        print(f"✓ Featured filter returned {len(data)} featured items")

    def test_gear_item_has_required_fields(self):
        """Verify gear items have all required fields"""
        response = requests.get(f"{BASE_URL}/api/gear-hub")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data) > 0
        
        required_fields = ["id", "name", "category", "price_credits", "affiliate_partner", 
                          "is_featured", "stock_status", "purchase_count"]
        
        item = data[0]
        for field in required_fields:
            assert field in item, f"Missing required field: {field}"
        
        print(f"✓ Gear items have all required fields")


class TestGearHubUserProgress:
    """Tests for user progress and purchase endpoints"""

    @pytest.fixture
    def hobbyist_user(self):
        """Get hobbyist user by logging in"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_HOBBYIST)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as hobbyist")

    def test_user_gear_progress(self, hobbyist_user):
        """GET /api/gear-hub/user/{user_id}/progress should return user credits and progress"""
        user_id = hobbyist_user["id"]
        response = requests.get(f"{BASE_URL}/api/gear-hub/user/{user_id}/progress")
        
        assert response.status_code == 200
        
        data = response.json()
        assert "available_credits" in data
        assert "can_purchase" in data
        assert "is_hobbyist" in data
        assert "progress_items" in data
        
        # Hobbyist should be able to purchase
        assert data["is_hobbyist"] == True, "User should be identified as hobbyist"
        assert data["can_purchase"] == True, "Hobbyist should be able to purchase"
        
        # Progress items should show featured gear
        assert isinstance(data["progress_items"], list)
        
        print(f"✓ User progress: {data['available_credits']} credits, {len(data['progress_items'])} progress items")

    def test_user_progress_shows_correct_calculations(self, hobbyist_user):
        """Verify progress percentage calculations are correct"""
        user_id = hobbyist_user["id"]
        response = requests.get(f"{BASE_URL}/api/gear-hub/user/{user_id}/progress")
        assert response.status_code == 200
        
        data = response.json()
        available = data["available_credits"]
        
        for item in data["progress_items"]:
            expected_pct = min(100, (available / item["price_credits"]) * 100) if item["price_credits"] > 0 else 0
            actual_pct = item["progress_percentage"]
            assert abs(actual_pct - expected_pct) < 0.2, f"Progress calculation mismatch"
            
            # can_afford should match credits comparison
            if available >= item["price_credits"]:
                assert item["can_afford"] == True
            else:
                assert item["can_afford"] == False
        
        print(f"✓ Progress calculations verified")

    def test_purchase_insufficient_credits(self, hobbyist_user):
        """POST /api/gear-hub/{item_id}/purchase should fail with insufficient credits"""
        user_id = hobbyist_user["id"]
        
        # Get a gear item
        gear_response = requests.get(f"{BASE_URL}/api/gear-hub")
        gear_items = gear_response.json()
        assert len(gear_items) > 0
        
        # Pick an expensive item the user likely can't afford
        expensive_item = max(gear_items, key=lambda x: x["price_credits"])
        
        # Try to purchase
        response = requests.post(f"{BASE_URL}/api/gear-hub/{expensive_item['id']}/purchase?user_id={user_id}")
        
        # Should fail with 400 (insufficient credits)
        assert response.status_code == 400
        assert "Insufficient" in response.json()["detail"] or "credits" in response.json()["detail"].lower()
        
        print(f"✓ Purchase correctly rejected for insufficient credits")

    def test_purchase_nonexistent_item(self, hobbyist_user):
        """POST /api/gear-hub/{item_id}/purchase should return 404 for nonexistent item"""
        user_id = hobbyist_user["id"]
        response = requests.post(f"{BASE_URL}/api/gear-hub/nonexistent-item-id/purchase?user_id={user_id}")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
        
        print(f"✓ Purchase correctly returns 404 for nonexistent item")


class TestShakaAnimations:
    """Tests for Shaka feedback system"""

    def test_get_shaka_animations(self):
        """GET /api/shaka/animations should return list of animations"""
        response = requests.get(f"{BASE_URL}/api/shaka/animations")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 6, f"Expected 6 animations, got {len(data)}"
        
        # Verify animation structure
        expected_ids = ["shaka_wave", "surfer_thanks", "stoked", "mahalo", "hang_loose", "barrel_thanks"]
        actual_ids = [a["id"] for a in data]
        
        for expected_id in expected_ids:
            assert expected_id in actual_ids, f"Missing animation: {expected_id}"
        
        # Each animation should have name and preview_url
        for anim in data:
            assert "id" in anim
            assert "name" in anim
            assert "preview_url" in anim
        
        print(f"✓ Shaka animations: {len(data)} animations returned")

    def test_shaka_animation_preview_urls(self):
        """Verify shaka animations have valid preview URLs"""
        response = requests.get(f"{BASE_URL}/api/shaka/animations")
        assert response.status_code == 200
        
        data = response.json()
        for anim in data:
            assert anim["preview_url"].startswith("/animations/")
            assert anim["preview_url"].endswith(".gif")
        
        print(f"✓ All animation preview URLs are valid format")


class TestShakaPending:
    """Tests for pending Shaka prompts"""

    @pytest.fixture
    def hobbyist_user(self):
        """Get hobbyist user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_HOBBYIST)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as hobbyist")

    def test_get_pending_shakas(self, hobbyist_user):
        """GET /api/shaka/pending/{user_id} should return pending prompts"""
        user_id = hobbyist_user["id"]
        response = requests.get(f"{BASE_URL}/api/shaka/pending/{user_id}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # Each pending shaka should have expected fields
        for pending in data:
            assert "sponsorship_id" in pending
            assert "donor_id" in pending
            assert "donor_name" in pending
            assert "amount" in pending
            assert "prompt_message" in pending
        
        print(f"✓ Pending shakas: {len(data)} pending prompts")

    def test_pending_shakas_nonexistent_user(self):
        """GET /api/shaka/pending/{user_id} should handle nonexistent user"""
        response = requests.get(f"{BASE_URL}/api/shaka/pending/nonexistent-user-id")
        
        # Should return empty list or 404
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            assert response.json() == []
        
        print(f"✓ Pending shakas handles nonexistent user correctly")


class TestShakaSend:
    """Tests for sending Shaka messages"""

    @pytest.fixture
    def hobbyist_user(self):
        """Get hobbyist user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_HOBBYIST)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as hobbyist")

    def test_send_shaka_invalid_sponsorship(self, hobbyist_user):
        """POST /api/shaka/send should return 404 for nonexistent sponsorship"""
        sender_id = hobbyist_user["id"]
        response = requests.post(
            f"{BASE_URL}/api/shaka/send?sender_id={sender_id}",
            json={
                "sponsorship_id": "nonexistent-sponsorship",
                "message_type": "animation",
                "animation_id": "shaka_wave"
            }
        )
        
        assert response.status_code == 404
        assert "Sponsorship not found" in response.json()["detail"]
        
        print(f"✓ Send shaka correctly returns 404 for nonexistent sponsorship")


class TestPhotographerGoLive:
    """Tests for photographer go-live with earnings destination"""

    @pytest.fixture
    def photographer_user(self):
        """Get photographer user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_PHOTOGRAPHER)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as photographer")

    @pytest.fixture
    def hobbyist_user(self):
        """Get hobbyist user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_HOBBYIST)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as hobbyist")

    def test_go_live_basic(self, photographer_user):
        """POST /api/photographer/{id}/go-live should start a live session"""
        photographer_id = photographer_user["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={
                "location": "Test Beach",
                "price_per_join": 25.0,
                "max_surfers": 10,
                "auto_accept": True
            }
        )
        
        assert response.status_code == 200
        
        data = response.json()
        assert data["message"] == "You are now live!"
        assert data["photographer_id"] == photographer_id
        assert data["location"] == "Test Beach"
        assert data["session_price"] == 25.0
        assert "live_session_id" in data
        assert "started_at" in data
        
        print(f"✓ Go-live successful, session ID: {data['live_session_id']}")
        
        # Clean up - end session
        requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")

    def test_go_live_with_earnings_destination(self, hobbyist_user):
        """POST /api/photographer/{id}/go-live should accept earnings_destination fields"""
        hobbyist_id = hobbyist_user["id"]
        
        # Get a gear item ID for the destination
        gear_response = requests.get(f"{BASE_URL}/api/gear-hub")
        gear_items = gear_response.json()
        assert len(gear_items) > 0
        gear_item_id = gear_items[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{hobbyist_id}/go-live",
            json={
                "location": "Hobbyist Test Spot",
                "price_per_join": 20.0,
                "earnings_destination_type": "gear",
                "earnings_destination_id": gear_item_id
            }
        )
        
        assert response.status_code == 200
        
        data = response.json()
        assert "earnings_destination" in data
        assert data["earnings_destination"]["type"] == "gear"
        assert data["earnings_destination"]["id"] == gear_item_id
        
        print(f"✓ Go-live with earnings destination successful")
        
        # Clean up - end session
        requests.post(f"{BASE_URL}/api/photographer/{hobbyist_id}/end-session")

    def test_go_live_already_live(self, photographer_user):
        """POST /api/photographer/{id}/go-live should fail if already live"""
        photographer_id = photographer_user["id"]
        
        # First go live
        requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={"location": "First Session", "price_per_join": 25.0}
        )
        
        # Try to go live again
        response = requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={"location": "Second Session", "price_per_join": 25.0}
        )
        
        assert response.status_code == 400
        assert "Already in a live session" in response.json()["detail"]
        
        print(f"✓ Go-live correctly rejects when already live")
        
        # Clean up
        requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")


class TestPhotographerEndSession:
    """Tests for ending sessions with revenue routing"""

    @pytest.fixture
    def photographer_user(self):
        """Get photographer user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_PHOTOGRAPHER)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as photographer")

    def test_end_session_creates_gallery(self, photographer_user):
        """POST /api/photographer/{id}/end-session should create gallery"""
        photographer_id = photographer_user["id"]
        
        # Start session
        requests.post(
            f"{BASE_URL}/api/photographer/{photographer_id}/go-live",
            json={"location": "Gallery Test Beach", "price_per_join": 25.0}
        )
        
        # End session
        response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        
        assert response.status_code == 200
        
        data = response.json()
        assert "Gallery created" in data["message"]
        assert "gallery_id" in data
        assert "gallery_title" in data
        assert data["gallery_title"] == "Session at Gallery Test Beach"
        assert "live_session_id" in data
        assert "duration_mins" in data
        assert "total_surfers" in data
        assert "total_earnings" in data
        
        print(f"✓ End session created gallery: {data['gallery_id']}")

    def test_end_session_not_live(self, photographer_user):
        """POST /api/photographer/{id}/end-session should fail if not live"""
        photographer_id = photographer_user["id"]
        
        # Make sure not live (end any existing session)
        requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        
        # Try to end again
        response = requests.post(f"{BASE_URL}/api/photographer/{photographer_id}/end-session")
        
        assert response.status_code == 400
        assert "No active session" in response.json()["detail"]
        
        print(f"✓ End session correctly fails when not live")


class TestRevenueRouting:
    """Tests for revenue routing logic"""

    @pytest.fixture
    def hobbyist_user(self):
        """Get hobbyist user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEST_HOBBYIST)
        if response.status_code == 200:
            return response.json()
        pytest.skip("Could not login as hobbyist")

    def test_hobbyist_has_gear_credits_field(self, hobbyist_user):
        """Verify hobbyist user has gear_only_credits tracked"""
        user_id = hobbyist_user["id"]
        
        # Check gear progress which shows available credits
        response = requests.get(f"{BASE_URL}/api/gear-hub/user/{user_id}/progress")
        assert response.status_code == 200
        
        data = response.json()
        assert "available_credits" in data
        assert isinstance(data["available_credits"], (int, float))
        
        print(f"✓ Hobbyist gear credits: {data['available_credits']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
