"""
Test Credit Wallet APIs and SmugMug-style Gallery Pricing Tiers
Tests: Credit balance/history/purchase, Gallery pricing tiers, Live participants
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test photographer ID provided in review request
PHOTOGRAPHER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"


class TestCreditWalletAPIs:
    """Tests for Credit Wallet endpoints"""
    
    def test_get_credit_balance(self):
        """GET /api/credits/balance/{user_id} - returns credit balance"""
        response = requests.get(f"{BASE_URL}/api/credits/balance/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate response structure
        assert "user_id" in data, "Missing user_id in response"
        assert "balance" in data, "Missing balance in response"
        assert "currency" in data, "Missing currency in response"
        assert "note" in data, "Missing note in response"
        
        # Validate values
        assert data["user_id"] == PHOTOGRAPHER_ID
        assert data["currency"] == "credits"
        assert "1 credit = $1" in data["note"]
        assert isinstance(data["balance"], (int, float))
        print(f"✅ Credit balance: ${data['balance']} credits")
    
    def test_get_credit_balance_invalid_user(self):
        """GET /api/credits/balance/{user_id} - 404 for invalid user"""
        response = requests.get(f"{BASE_URL}/api/credits/balance/invalid-user-id-123")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for invalid user")
    
    def test_get_credit_history(self):
        """GET /api/credits/history/{user_id} - returns transaction history"""
        response = requests.get(f"{BASE_URL}/api/credits/history/{PHOTOGRAPHER_ID}?limit=10")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate response structure
        assert "user_id" in data, "Missing user_id in response"
        assert "transactions" in data, "Missing transactions in response"
        assert "count" in data, "Missing count in response"
        
        # Validate values
        assert data["user_id"] == PHOTOGRAPHER_ID
        assert isinstance(data["transactions"], list)
        assert isinstance(data["count"], int)
        
        # If transactions exist, validate structure
        if len(data["transactions"]) > 0:
            tx = data["transactions"][0]
            assert "id" in tx, "Missing id in transaction"
            assert "amount" in tx, "Missing amount in transaction"
            assert "transaction_type" in tx, "Missing transaction_type"
        
        print(f"✅ Credit history: {data['count']} transactions returned")
    
    def test_get_credit_history_with_filter(self):
        """GET /api/credits/history/{user_id} with transaction_type filter"""
        response = requests.get(
            f"{BASE_URL}/api/credits/history/{PHOTOGRAPHER_ID}",
            params={"limit": 10, "transaction_type": "gallery_sale"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✅ Credit history filter by transaction_type works")
    
    def test_get_credit_history_invalid_user(self):
        """GET /api/credits/history/{user_id} - 404 for invalid user"""
        response = requests.get(f"{BASE_URL}/api/credits/history/invalid-user-id-123")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for invalid user")
    
    def test_credit_summary(self):
        """GET /api/credits/summary/{user_id} - returns credit summary"""
        response = requests.get(f"{BASE_URL}/api/credits/summary/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate response structure
        assert "user_id" in data, "Missing user_id"
        assert "current_balance" in data, "Missing current_balance"
        assert "total_earned" in data, "Missing total_earned"
        assert "total_spent" in data, "Missing total_spent"
        
        print(f"✅ Credit summary: balance=${data['current_balance']}, earned=${data['total_earned']}, spent=${data['total_spent']}")


class TestGalleryPricingTiers:
    """Tests for SmugMug-style Gallery Pricing Tiers"""
    
    def test_get_gallery_pricing(self):
        """GET /api/photographer/{id}/gallery-pricing - returns photo/video quality tier pricing"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate photo pricing tiers
        assert "photo_pricing" in data, "Missing photo_pricing"
        photo_pricing = data["photo_pricing"]
        assert "web" in photo_pricing, "Missing web tier price"
        assert "standard" in photo_pricing, "Missing standard tier price"
        assert "high" in photo_pricing, "Missing high tier price"
        
        # Validate video pricing tiers
        assert "video_pricing" in data, "Missing video_pricing"
        video_pricing = data["video_pricing"]
        assert "720p" in video_pricing, "Missing 720p tier price"
        assert "1080p" in video_pricing, "Missing 1080p tier price"
        assert "4k" in video_pricing, "Missing 4k tier price"
        
        print(f"✅ Gallery pricing: Photo web=${photo_pricing['web']}, standard=${photo_pricing['standard']}, high=${photo_pricing['high']}")
        print(f"✅ Gallery pricing: Video 720p=${video_pricing['720p']}, 1080p=${video_pricing['1080p']}, 4k=${video_pricing['4k']}")
    
    def test_update_gallery_pricing(self):
        """PUT /api/photographer/{id}/gallery-pricing - updates gallery pricing tiers"""
        # First get current pricing to restore later
        get_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        original_data = get_response.json()
        
        # Update pricing
        update_data = {
            "photo_price_web": 4.0,
            "photo_price_standard": 6.0,
            "photo_price_high": 12.0,
            "video_price_720p": 10.0,
            "video_price_1080p": 18.0,
            "video_price_4k": 35.0
        }
        response = requests.put(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing",
            json=update_data
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Missing message in response"
        assert "photo_pricing" in data, "Missing photo_pricing in response"
        assert "video_pricing" in data, "Missing video_pricing in response"
        
        # Verify values were updated
        assert data["photo_pricing"]["web"] == 4.0
        assert data["photo_pricing"]["standard"] == 6.0
        assert data["photo_pricing"]["high"] == 12.0
        assert data["video_pricing"]["720p"] == 10.0
        assert data["video_pricing"]["1080p"] == 18.0
        assert data["video_pricing"]["4k"] == 35.0
        
        # Restore original pricing
        restore_data = {
            "photo_price_web": original_data["photo_pricing"]["web"],
            "photo_price_standard": original_data["photo_pricing"]["standard"],
            "photo_price_high": original_data["photo_pricing"]["high"],
            "video_price_720p": original_data["video_pricing"]["720p"],
            "video_price_1080p": original_data["video_pricing"]["1080p"],
            "video_price_4k": original_data["video_pricing"]["4k"]
        }
        requests.put(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing", json=restore_data)
        
        print("✅ Gallery pricing update successful and verified")
    
    def test_gallery_pricing_invalid_photographer(self):
        """GET /api/photographer/{id}/gallery-pricing - 404 for invalid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/invalid-id-123/gallery-pricing")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for invalid photographer")


class TestLiveSessionParticipants:
    """Tests for Live Session Participants endpoint"""
    
    def test_get_live_participants(self):
        """GET /api/photographer/{id}/live-participants - returns list of users in live session"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/live-participants")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Response should have these fields
        assert "is_live" in data, "Missing is_live"
        assert "participants" in data, "Missing participants"
        assert "total_participants" in data, "Missing total_participants"
        assert "total_earnings" in data, "Missing total_earnings"
        
        # Validate data types
        assert isinstance(data["is_live"], bool)
        assert isinstance(data["participants"], list)
        assert isinstance(data["total_participants"], int)
        assert isinstance(data["total_earnings"], (int, float))
        
        # If live, should have location and started_at
        if data["is_live"]:
            assert "location" in data, "Missing location when live"
            assert "started_at" in data, "Missing started_at when live"
            
            # If there are participants, validate structure
            if len(data["participants"]) > 0:
                p = data["participants"][0]
                assert "id" in p, "Missing id in participant"
                assert "surfer_id" in p, "Missing surfer_id"
                assert "name" in p, "Missing name"
                assert "amount_paid" in p, "Missing amount_paid"
                assert "joined_at" in p, "Missing joined_at"
        
        print(f"✅ Live participants: is_live={data['is_live']}, total={data['total_participants']}, earnings=${data['total_earnings']}")
    
    def test_live_participants_invalid_photographer(self):
        """GET /api/photographer/{id}/live-participants - 404 for invalid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/invalid-id-123/live-participants")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for invalid photographer")


class TestGalleryItemPricing:
    """Tests for Gallery Item Pricing endpoint"""
    
    def test_gallery_item_pricing_not_found(self):
        """GET /api/gallery/item/{id}/pricing - 404 for non-existent item"""
        response = requests.get(f"{BASE_URL}/api/gallery/item/nonexistent-item-id-123/pricing")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for non-existent gallery item")
    
    def test_gallery_purchase_not_found(self):
        """POST /api/gallery/item/{id}/purchase - 404 for non-existent item"""
        response = requests.post(
            f"{BASE_URL}/api/gallery/item/nonexistent-item-id/purchase",
            params={"buyer_id": PHOTOGRAPHER_ID},
            json={"payment_method": "credits", "quality_tier": "standard"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for purchase of non-existent item")


class TestCreditPurchaseInitiation:
    """Tests for Credit Purchase API (Stripe integration)"""
    
    def test_purchase_credits_initiation(self):
        """POST /api/credits/purchase - initiates Stripe checkout for credit purchase"""
        response = requests.post(
            f"{BASE_URL}/api/credits/purchase",
            params={"user_id": PHOTOGRAPHER_ID},
            json={
                "amount": 25.0,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Validate response structure
        assert "checkout_url" in data, "Missing checkout_url in response"
        assert "session_id" in data, "Missing session_id in response"
        
        # Validate checkout URL is a Stripe URL
        assert data["checkout_url"].startswith("https://checkout.stripe.com"), \
            f"Invalid checkout URL: {data['checkout_url']}"
        
        print(f"✅ Credit purchase initiation successful, checkout_url generated")
    
    def test_purchase_credits_invalid_user(self):
        """POST /api/credits/purchase - 404 for invalid user"""
        response = requests.post(
            f"{BASE_URL}/api/credits/purchase",
            params={"user_id": "invalid-user-id-123"},
            json={
                "amount": 25.0,
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Correctly returns 404 for invalid user")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
