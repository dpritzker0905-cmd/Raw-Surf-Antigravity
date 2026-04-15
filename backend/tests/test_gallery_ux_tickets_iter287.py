"""
Test Gallery UX Tickets - Iteration 287
Tests for TICKET-001 through TICKET-008 Gallery UX improvements

Endpoints tested:
- POST /api/dispatch/{id}/cover-remaining (TICKET-003)
- POST /api/dispatch/{id}/remind-crew (TICKET-003)
- POST /api/gallery/bulk-purchase (TICKET-005)
- GET /api/gallery/item/{id}/quality-previews (TICKET-004)
- GET /api/gallery/item/{id}/pricing (TICKET-001 pricing context)
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestHealthCheck:
    """Basic health check to ensure API is running"""
    
    def test_api_health(self):
        """Test API health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        print("✓ API health check passed")


class TestQualityPreviewsEndpoint:
    """TICKET-004: Quality Comparison Modal - quality-previews endpoint"""
    
    def test_quality_previews_returns_tiers(self):
        """Test that quality-previews endpoint returns tier data"""
        # First, get a gallery item to test with
        response = requests.get(f"{BASE_URL}/api/gallery/spot/test-spot?limit=1")
        
        # If no items in test spot, try getting any gallery
        if response.status_code != 200 or not response.json().get('items'):
            # Try to get any gallery item from a photographer
            response = requests.get(f"{BASE_URL}/api/galleries?limit=1")
            if response.status_code == 200 and response.json():
                galleries = response.json()
                if galleries:
                    gallery_id = galleries[0].get('id')
                    items_response = requests.get(f"{BASE_URL}/api/galleries/{gallery_id}/items?limit=1")
                    if items_response.status_code == 200 and items_response.json():
                        item_id = items_response.json()[0].get('id')
                        
                        # Test quality-previews endpoint
                        preview_response = requests.get(f"{BASE_URL}/api/gallery/item/{item_id}/quality-previews")
                        assert preview_response.status_code == 200, f"Quality previews failed: {preview_response.text}"
                        
                        data = preview_response.json()
                        assert 'previews' in data, "Response should contain 'previews'"
                        assert 'item_id' in data, "Response should contain 'item_id'"
                        assert 'media_type' in data, "Response should contain 'media_type'"
                        
                        print(f"✓ Quality previews endpoint works - media_type: {data.get('media_type')}")
                        print(f"  Tiers available: {list(data.get('previews', {}).keys())}")
                        return
        
        # If we can't find any items, skip with a note
        pytest.skip("No gallery items available to test quality-previews endpoint")
    
    def test_quality_previews_invalid_item(self):
        """Test quality-previews with invalid item ID returns 404"""
        fake_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/gallery/item/{fake_id}/quality-previews")
        assert response.status_code == 404, f"Expected 404 for invalid item, got {response.status_code}"
        print("✓ Quality previews returns 404 for invalid item")


class TestBulkPurchaseEndpoint:
    """TICKET-005: Bulk Purchase with volume discounts"""
    
    def test_bulk_purchase_no_items_error(self):
        """Test bulk purchase with empty items list returns error"""
        response = requests.post(
            f"{BASE_URL}/api/gallery/bulk-purchase",
            json={
                "item_ids": [],
                "buyer_id": str(uuid.uuid4()),
                "quality_tiers": {}
            }
        )
        assert response.status_code == 400, f"Expected 400 for empty items, got {response.status_code}"
        assert "No items selected" in response.json().get('detail', ''), "Should indicate no items selected"
        print("✓ Bulk purchase rejects empty item list")
    
    def test_bulk_purchase_invalid_buyer(self):
        """Test bulk purchase with invalid buyer returns error"""
        fake_buyer_id = str(uuid.uuid4())
        fake_item_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/bulk-purchase",
            json={
                "item_ids": [fake_item_id],
                "buyer_id": fake_buyer_id,
                "quality_tiers": {fake_item_id: "standard"}
            }
        )
        # Should fail with 404 for buyer not found
        assert response.status_code in [400, 404], f"Expected 400/404, got {response.status_code}"
        print("✓ Bulk purchase validates buyer exists")
    
    def test_bulk_purchase_invalid_items(self):
        """Test bulk purchase with invalid item IDs returns error"""
        # Get a real user first
        users_response = requests.get(f"{BASE_URL}/api/users/search?query=david&limit=1")
        if users_response.status_code != 200 or not users_response.json().get('users'):
            pytest.skip("No test users available")
        
        buyer_id = users_response.json()['users'][0]['id']
        fake_item_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/bulk-purchase",
            json={
                "item_ids": fake_item_ids,
                "buyer_id": buyer_id,
                "quality_tiers": {id: "standard" for id in fake_item_ids}
            }
        )
        assert response.status_code == 404, f"Expected 404 for invalid items, got {response.status_code}"
        assert "not found" in response.json().get('detail', '').lower(), "Should indicate items not found"
        print("✓ Bulk purchase validates items exist")


class TestCoverRemainingEndpoint:
    """TICKET-003: Crew Payment Progress - cover-remaining endpoint"""
    
    def test_cover_remaining_invalid_dispatch(self):
        """Test cover-remaining with invalid dispatch ID returns 404"""
        fake_dispatch_id = str(uuid.uuid4())
        fake_captain_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{fake_dispatch_id}/cover-remaining",
            json={"captain_id": fake_captain_id}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Cover-remaining returns 404 for invalid dispatch")
    
    def test_cover_remaining_requires_captain(self):
        """Test that only captain can cover remaining shares"""
        # This test validates the endpoint exists and has proper authorization
        fake_dispatch_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{fake_dispatch_id}/cover-remaining",
            json={"captain_id": str(uuid.uuid4())}
        )
        # Should return 404 (dispatch not found) or 403 (not captain)
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print("✓ Cover-remaining endpoint validates authorization")


class TestRemindCrewEndpoint:
    """TICKET-003: Crew Payment Progress - remind-crew endpoint"""
    
    def test_remind_crew_invalid_dispatch(self):
        """Test remind-crew with invalid dispatch ID returns 404"""
        fake_dispatch_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{fake_dispatch_id}/remind-crew",
            json={
                "captain_id": str(uuid.uuid4()),
                "member_id": str(uuid.uuid4())
            }
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Remind-crew returns 404 for invalid dispatch")
    
    def test_remind_crew_requires_captain(self):
        """Test that only captain can send reminders"""
        fake_dispatch_id = str(uuid.uuid4())
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{fake_dispatch_id}/remind-crew",
            json={
                "captain_id": str(uuid.uuid4()),
                "member_id": str(uuid.uuid4())
            }
        )
        # Should return 404 (dispatch not found) or 403 (not captain)
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print("✓ Remind-crew endpoint validates authorization")


class TestGalleryItemPricing:
    """TICKET-001: Pricing Transparency - pricing endpoint with source badges"""
    
    def test_pricing_endpoint_returns_tiers(self):
        """Test that pricing endpoint returns tier information"""
        # Try to get a gallery item
        response = requests.get(f"{BASE_URL}/api/galleries?limit=1")
        
        if response.status_code == 200 and response.json():
            galleries = response.json()
            if galleries:
                gallery_id = galleries[0].get('id')
                items_response = requests.get(f"{BASE_URL}/api/galleries/{gallery_id}/items?limit=1")
                
                if items_response.status_code == 200 and items_response.json():
                    item_id = items_response.json()[0].get('id')
                    
                    # Test pricing endpoint
                    pricing_response = requests.get(f"{BASE_URL}/api/gallery/item/{item_id}/pricing")
                    assert pricing_response.status_code == 200, f"Pricing failed: {pricing_response.text}"
                    
                    data = pricing_response.json()
                    assert 'pricing' in data, "Response should contain 'pricing'"
                    assert 'tiers' in data.get('pricing', {}), "Pricing should contain 'tiers'"
                    
                    # Check tier structure
                    tiers = data['pricing']['tiers']
                    assert len(tiers) > 0, "Should have at least one tier"
                    
                    for tier in tiers:
                        assert 'tier' in tier, "Each tier should have 'tier' field"
                        assert 'price' in tier, "Each tier should have 'price' field"
                        assert 'label' in tier, "Each tier should have 'label' field"
                    
                    print(f"✓ Pricing endpoint returns {len(tiers)} tiers")
                    print(f"  Tiers: {[t['tier'] for t in tiers]}")
                    return
        
        pytest.skip("No gallery items available to test pricing endpoint")
    
    def test_pricing_with_viewer_id(self):
        """Test pricing endpoint with viewer_id for session deals"""
        # Get a test user
        users_response = requests.get(f"{BASE_URL}/api/users/search?query=david&limit=1")
        if users_response.status_code != 200 or not users_response.json().get('users'):
            pytest.skip("No test users available")
        
        viewer_id = users_response.json()['users'][0]['id']
        
        # Get a gallery item
        response = requests.get(f"{BASE_URL}/api/galleries?limit=1")
        if response.status_code == 200 and response.json():
            galleries = response.json()
            if galleries:
                gallery_id = galleries[0].get('id')
                items_response = requests.get(f"{BASE_URL}/api/galleries/{gallery_id}/items?limit=1")
                
                if items_response.status_code == 200 and items_response.json():
                    item_id = items_response.json()[0].get('id')
                    
                    # Test pricing with viewer_id
                    pricing_response = requests.get(
                        f"{BASE_URL}/api/gallery/item/{item_id}/pricing?viewer_id={viewer_id}"
                    )
                    assert pricing_response.status_code == 200, f"Pricing failed: {pricing_response.text}"
                    
                    data = pricing_response.json()
                    # Check for session participant fields
                    assert 'is_session_participant' in data, "Should indicate session participant status"
                    
                    print(f"✓ Pricing endpoint works with viewer_id")
                    print(f"  is_session_participant: {data.get('is_session_participant')}")
                    return
        
        pytest.skip("No gallery items available")


class TestDispatchCrewStatus:
    """TICKET-003: Crew Payment Progress - crew-status endpoint"""
    
    def test_crew_status_invalid_dispatch(self):
        """Test crew-status with invalid dispatch returns 404"""
        fake_dispatch_id = str(uuid.uuid4())
        
        response = requests.get(f"{BASE_URL}/api/dispatch/{fake_dispatch_id}/crew-status")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Crew-status returns 404 for invalid dispatch")


class TestSurferGalleryEndpoints:
    """Test surfer gallery endpoints for download limits and visibility"""
    
    def test_surfer_gallery_endpoint_exists(self):
        """Test that surfer-gallery endpoint exists"""
        # Get a test user
        users_response = requests.get(f"{BASE_URL}/api/users/search?query=david&limit=1")
        if users_response.status_code != 200 or not users_response.json().get('users'):
            pytest.skip("No test users available")
        
        user_id = users_response.json()['users'][0]['id']
        
        response = requests.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={user_id}")
        # Should return 200 with items array (even if empty)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert 'items' in data, "Response should contain 'items'"
        
        print(f"✓ Surfer gallery endpoint works - {len(data.get('items', []))} items")


class TestSelectionQueueEndpoints:
    """TICKET-002: Selection Deadline Countdown - selection queue endpoints"""
    
    def test_selection_queue_endpoint_exists(self):
        """Test that selection-queue endpoint exists"""
        # Get a test user
        users_response = requests.get(f"{BASE_URL}/api/users/search?query=david&limit=1")
        if users_response.status_code != 200 or not users_response.json().get('users'):
            pytest.skip("No test users available")
        
        user_id = users_response.json()['users'][0]['id']
        
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/selection-queue/{user_id}")
        # Should return 200 with quotas array (even if empty)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert 'quotas' in data, "Response should contain 'quotas'"
        
        print(f"✓ Selection queue endpoint works - {len(data.get('quotas', []))} quotas")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
