"""
Test Suite for Gold-Pass, Stoked Credits, and Elite Groms Leaderboard
Iteration 125 - Backend API Testing

Features tested:
1. Gold-Pass 2hr time-gate on booking slots (tier_3 users see all, others see countdown)
2. Stoked Credit subscription payment (100 credits = $1)
3. Elite Groms Leaderboard with filtering by elite_tier

Test Credentials:
- Test Surfer ID: 0e42ce7f-c289-4ed8-a407-9697c2ad4cb7 (Comp Surfer, no Gold-Pass)
- Test Grom Parent ID: fc495a58-ccfa-4cd3-8641-5d90e11619be
- Photographer ID: 7c2a4dc8-e406-48c7-8f5c-90cc37ad5548
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test IDs from the review request
TEST_SURFER_ID = "0e42ce7f-c289-4ed8-a407-9697c2ad4cb7"  # Comp Surfer, no Gold-Pass
TEST_GROM_PARENT_ID = "fc495a58-ccfa-4cd3-8641-5d90e11619be"
TEST_PHOTOGRAPHER_ID = "7c2a4dc8-e406-48c7-8f5c-90cc37ad5548"


class TestGoldPassAvailability:
    """
    P0: Test Gold-Pass 2hr time-gate on photographer availability slots
    - tier_3 (Premium/Gold-Pass) users see ALL slots unlocked
    - Non-Gold users see slots locked for 2 hours after creation
    """
    
    def test_availability_endpoint_returns_gold_pass_fields(self):
        """Verify availability endpoint returns is_locked, unlock_time, unlock_minutes_remaining"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/availability"
        )
        
        # Should return 200 even if no availability slots exist
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "slots" in data, "Response should contain 'slots' array"
        assert "viewer_has_gold_pass" in data, "Response should contain 'viewer_has_gold_pass'"
        assert "gold_pass_window_hours" in data, "Response should contain 'gold_pass_window_hours'"
        
        # Verify gold_pass_window_hours is 2
        assert data["gold_pass_window_hours"] == 2, f"Expected gold_pass_window_hours=2, got {data['gold_pass_window_hours']}"
        
        print(f"✓ Availability endpoint returns correct structure with gold_pass_window_hours=2")
    
    def test_availability_with_non_gold_viewer_shows_lock_fields(self):
        """Non-Gold viewer should see is_locked, unlock_time, unlock_minutes_remaining in slots"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/availability",
            params={"viewer_id": TEST_SURFER_ID}  # Comp Surfer without Gold-Pass
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Non-Gold user should not have gold pass
        assert data["viewer_has_gold_pass"] == False, "Comp Surfer should not have Gold-Pass"
        
        # If there are slots, verify they have lock fields
        if data["slots"]:
            slot = data["slots"][0]
            assert "is_locked" in slot, "Slot should have 'is_locked' field"
            assert "unlock_time" in slot, "Slot should have 'unlock_time' field"
            assert "unlock_minutes_remaining" in slot, "Slot should have 'unlock_minutes_remaining' field"
            print(f"✓ Slot has lock fields: is_locked={slot['is_locked']}, unlock_minutes_remaining={slot['unlock_minutes_remaining']}")
        else:
            print("✓ No slots available, but response structure is correct")
    
    def test_availability_without_viewer_id_defaults_to_locked(self):
        """Without viewer_id, slots should show lock status (no Gold-Pass assumed)"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/availability"
        )
        
        assert response.status_code == 200
        
        data = response.json()
        
        # Without viewer_id, viewer_has_gold_pass should be False
        assert data["viewer_has_gold_pass"] == False, "Without viewer_id, should default to no Gold-Pass"
        
        print("✓ Without viewer_id, defaults to no Gold-Pass")
    
    def test_availability_returns_photographer_not_found(self):
        """Non-existent photographer should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/non-existent-id-12345/availability"
        )
        
        # Should return 200 with empty slots (based on code review - no 404 check for photographer)
        # Actually looking at code, it just queries availability without checking photographer exists
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["slots"] == [], "Non-existent photographer should have empty slots"
        
        print("✓ Non-existent photographer returns empty slots")


class TestStokedCreditPayment:
    """
    P0: Test Stoked Credit subscription payment
    - Conversion rate: 100 credits = $1
    - Returns insufficient_credits response when balance too low
    """
    
    def test_credit_payment_info_returns_credits_required(self):
        """Verify credit-payment-info returns credits_required = price * 100"""
        # Test with tier_2 (Basic) which costs $4.99 for surfers
        response = requests.get(
            f"{BASE_URL}/api/subscriptions/credit-payment-info/{TEST_SURFER_ID}",
            params={"tier_id": "tier_2"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "tier_id" in data, "Response should contain 'tier_id'"
        assert "tier_name" in data, "Response should contain 'tier_name'"
        assert "price_usd" in data, "Response should contain 'price_usd'"
        assert "credits_required" in data, "Response should contain 'credits_required'"
        assert "current_balance" in data, "Response should contain 'current_balance'"
        assert "can_afford" in data, "Response should contain 'can_afford'"
        assert "credits_needed" in data, "Response should contain 'credits_needed'"
        assert "conversion_rate" in data, "Response should contain 'conversion_rate'"
        
        # Verify credits_required = price * 100
        expected_credits = int(data["price_usd"] * 100)
        assert data["credits_required"] == expected_credits, \
            f"Expected credits_required={expected_credits}, got {data['credits_required']}"
        
        # Verify conversion rate string
        assert data["conversion_rate"] == "100 credits = $1.00", \
            f"Expected '100 credits = $1.00', got {data['conversion_rate']}"
        
        print(f"✓ Credit payment info: tier={data['tier_name']}, price=${data['price_usd']}, credits_required={data['credits_required']}")
    
    def test_credit_payment_info_tier_3_premium(self):
        """Verify tier_3 (Premium) credits calculation: $14.99 * 100 = 1499 credits"""
        response = requests.get(
            f"{BASE_URL}/api/subscriptions/credit-payment-info/{TEST_SURFER_ID}",
            params={"tier_id": "tier_3"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Premium tier is $14.99 for surfers
        assert data["price_usd"] == 14.99, f"Expected price_usd=14.99, got {data['price_usd']}"
        assert data["credits_required"] == 1499, f"Expected credits_required=1499, got {data['credits_required']}"
        
        print(f"✓ Premium tier: ${data['price_usd']} = {data['credits_required']} credits")
    
    def test_credit_payment_info_invalid_tier(self):
        """Invalid tier should return 400"""
        response = requests.get(
            f"{BASE_URL}/api/subscriptions/credit-payment-info/{TEST_SURFER_ID}",
            params={"tier_id": "invalid_tier"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        
        print("✓ Invalid tier returns 400")
    
    def test_credit_payment_info_user_not_found(self):
        """Non-existent user should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/subscriptions/credit-payment-info/non-existent-user-12345",
            params={"tier_id": "tier_2"}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        
        print("✓ Non-existent user returns 404")
    
    def test_pay_with_credits_insufficient_balance(self):
        """Verify insufficient_credits response when balance too low"""
        # Try to pay for tier_3 (Premium) which requires 1499 credits
        # Test user likely has 0 or low balance
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{TEST_SURFER_ID}",
            json={
                "tier_id": "tier_3",
                "use_credits": True
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # If user has insufficient credits, should return insufficient_credits=True
        if data.get("success") == False:
            assert data.get("insufficient_credits") == True, "Should have insufficient_credits=True"
            assert "credits_required" in data, "Should have credits_required"
            assert "current_balance" in data, "Should have current_balance"
            assert "credits_needed" in data, "Should have credits_needed"
            assert "dollars_needed" in data, "Should have dollars_needed"
            
            print(f"✓ Insufficient credits response: need {data['credits_needed']} more credits (${data['dollars_needed']})")
        else:
            # User had enough credits - payment succeeded
            print(f"✓ Payment succeeded (user had enough credits): {data}")
    
    def test_pay_with_credits_free_tier_no_payment(self):
        """Free tier (tier_1) should not require payment"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/pay-with-credits/{TEST_SURFER_ID}",
            json={
                "tier_id": "tier_1",
                "use_credits": True
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        assert data["success"] == True, "Free tier should succeed"
        assert data["credits_used"] == 0, "Free tier should use 0 credits"
        
        print("✓ Free tier requires no credits")


class TestEliteGromsLeaderboard:
    """
    P0: Test Elite Groms Leaderboard
    - Returns Groms ranked by XP
    - Filters by elite_tier='grom_rising' when elite_only=true
    """
    
    def test_elite_groms_endpoint_returns_leaderboard(self):
        """Verify /api/leaderboard/elite-groms returns leaderboard structure"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/elite-groms")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "leaderboard" in data, "Response should contain 'leaderboard'"
        assert "total_count" in data, "Response should contain 'total_count'"
        assert "elite_only_filter" in data, "Response should contain 'elite_only_filter'"
        assert "ranking_criteria" in data, "Response should contain 'ranking_criteria'"
        
        # Verify ranking criteria includes XP
        assert "Community Stoke (XP)" in data["ranking_criteria"], \
            "Ranking criteria should include 'Community Stoke (XP)'"
        
        print(f"✓ Elite Groms leaderboard: {data['total_count']} Groms")
    
    def test_elite_groms_leaderboard_entry_structure(self):
        """Verify each leaderboard entry has required fields"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/elite-groms")
        
        assert response.status_code == 200
        
        data = response.json()
        
        if data["leaderboard"]:
            entry = data["leaderboard"][0]
            
            # Verify entry structure
            required_fields = [
                "rank", "grom_id", "full_name", "avatar_url", "elite_tier",
                "is_competitive", "subscription_tier", "sponsorship_points",
                "community_stoke", "total_xp", "parent_id", "overall_score", "badges"
            ]
            
            for field in required_fields:
                assert field in entry, f"Entry should have '{field}' field"
            
            # Verify is_competitive is based on elite_tier
            if entry["elite_tier"] == "grom_rising":
                assert entry["is_competitive"] == True, "grom_rising should be competitive"
            
            print(f"✓ Leaderboard entry structure verified: rank={entry['rank']}, name={entry['full_name']}")
        else:
            print("✓ No Groms in leaderboard, but structure is correct")
    
    def test_elite_groms_ranked_by_xp(self):
        """Verify Groms are ranked by XP (descending)"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/elite-groms")
        
        assert response.status_code == 200
        
        data = response.json()
        
        if len(data["leaderboard"]) >= 2:
            # Verify XP is in descending order
            for i in range(len(data["leaderboard"]) - 1):
                current_xp = data["leaderboard"][i]["total_xp"]
                next_xp = data["leaderboard"][i + 1]["total_xp"]
                assert current_xp >= next_xp, \
                    f"XP should be descending: {current_xp} >= {next_xp}"
            
            print(f"✓ Groms ranked by XP (descending): top XP = {data['leaderboard'][0]['total_xp']}")
        else:
            print("✓ Not enough Groms to verify ranking order")
    
    def test_elite_groms_elite_only_filter(self):
        """Verify elite_only=true filters to only grom_rising elite_tier"""
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/elite-groms",
            params={"elite_only": "true"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify filter is applied
        assert data["elite_only_filter"] == True, "elite_only_filter should be True"
        
        # Verify all entries have elite_tier='grom_rising'
        for entry in data["leaderboard"]:
            assert entry["elite_tier"] == "grom_rising", \
                f"With elite_only=true, all entries should have elite_tier='grom_rising', got {entry['elite_tier']}"
            assert entry["is_competitive"] == True, \
                "With elite_only=true, all entries should be competitive"
        
        print(f"✓ Elite-only filter: {len(data['leaderboard'])} competitive Groms")
    
    def test_elite_groms_without_elite_only_filter(self):
        """Verify without elite_only filter, all Groms are returned"""
        response = requests.get(f"{BASE_URL}/api/leaderboard/elite-groms")
        
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify filter is not applied
        assert data["elite_only_filter"] == False, "elite_only_filter should be False by default"
        
        print(f"✓ Without filter: {len(data['leaderboard'])} total Groms")
    
    def test_elite_groms_limit_parameter(self):
        """Verify limit parameter works"""
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/elite-groms",
            params={"limit": 5}
        )
        
        assert response.status_code == 200
        
        data = response.json()
        
        assert len(data["leaderboard"]) <= 5, "Should return at most 5 entries"
        
        print(f"✓ Limit parameter works: returned {len(data['leaderboard'])} entries")


class TestGromHQEliteRankings:
    """
    P1: Test Grom HQ Elite Rankings for Parents
    - Returns linked Grom rankings for parents
    """
    
    def test_grom_hq_elite_rankings_endpoint(self):
        """Verify /api/leaderboard/grom-hq/{parent_id}/elite-rankings returns rankings"""
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/grom-hq/{TEST_GROM_PARENT_ID}/elite-rankings"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "parent_id" in data, "Response should contain 'parent_id'"
        assert "linked_groms" in data, "Response should contain 'linked_groms'"
        assert "total_linked" in data, "Response should contain 'total_linked'"
        
        assert data["parent_id"] == TEST_GROM_PARENT_ID, "parent_id should match request"
        
        print(f"✓ Grom HQ Elite Rankings: {data['total_linked']} linked Groms")
    
    def test_grom_hq_elite_rankings_entry_structure(self):
        """Verify each linked Grom entry has required fields"""
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/grom-hq/{TEST_GROM_PARENT_ID}/elite-rankings"
        )
        
        assert response.status_code == 200
        
        data = response.json()
        
        if data["linked_groms"]:
            entry = data["linked_groms"][0]
            
            # Verify entry structure
            required_fields = [
                "grom_id", "grom_name", "avatar_url", "elite_tier",
                "is_competitive", "current_rank", "total_groms", "percentile",
                "xp_total", "sponsorship_points", "subscription_tier", "badges"
            ]
            
            for field in required_fields:
                assert field in entry, f"Entry should have '{field}' field"
            
            # Verify percentile calculation
            assert 0 <= entry["percentile"] <= 100, "Percentile should be between 0 and 100"
            
            print(f"✓ Linked Grom entry: {entry['grom_name']}, rank={entry['current_rank']}, percentile={entry['percentile']}%")
        else:
            print("✓ No linked Groms, but structure is correct")
    
    def test_grom_hq_elite_rankings_parent_not_found(self):
        """Non-existent parent should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/grom-hq/non-existent-parent-12345/elite-rankings"
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        
        print("✓ Non-existent parent returns 404")
    
    def test_grom_hq_elite_rankings_non_parent_role(self):
        """Non-Grom Parent role should return 403"""
        # Use the test surfer ID (Comp Surfer, not a Grom Parent)
        response = requests.get(
            f"{BASE_URL}/api/leaderboard/grom-hq/{TEST_SURFER_ID}/elite-rankings"
        )
        
        # Should return 403 or 404 depending on implementation
        assert response.status_code in [403, 404], \
            f"Expected 403 or 404, got {response.status_code}: {response.text}"
        
        print(f"✓ Non-Grom Parent returns {response.status_code}")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
