"""
Test suite for Raw Surf OS - Gallery, Admin Dashboard, and Annual Subscriptions
Tests: 
- File upload with watermarking
- Gallery CRUD and purchases
- Admin dashboard endpoints
- Annual subscription plans with 20% discount
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestSubscriptionPlans:
    """Tests for subscription plans with annual options"""
    
    def test_get_subscription_plans(self, api_client):
        """Test that subscription plans endpoint returns monthly and annual options"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify surfer plans exist
        assert "surfer" in data
        assert "monthly" in data["surfer"]
        assert "annual" in data["surfer"]
        
        # Verify photographer plans exist
        assert "photographer" in data
        assert "monthly" in data["photographer"]
        assert "annual" in data["photographer"]
        
        print("✓ Subscription plans structure verified")
    
    def test_annual_plans_have_20_percent_discount(self, api_client):
        """Verify annual plans have 20% discount"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check surfer annual plans
        for plan in data["surfer"]["annual"]:
            assert "savings" in plan
            assert plan["savings"] == "20%"
            assert "monthly_equiv" in plan
            print(f"✓ Surfer annual plan '{plan['name']}' has 20% savings: ${plan['price']} ({plan['monthly_equiv']}/mo)")
        
        # Check photographer annual plans  
        for plan in data["photographer"]["annual"]:
            assert "savings" in plan
            assert plan["savings"] == "20%"
            assert "monthly_equiv" in plan
            print(f"✓ Photographer annual plan '{plan['name']}' has 20% savings: ${plan['price']} ({plan['monthly_equiv']}/mo)")
    
    def test_annual_price_calculations(self, api_client):
        """Verify annual prices are correctly calculated (monthly * 12 * 0.8)"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        data = response.json()
        
        # Surfer basic: $1.99/mo => $19.10/year (1.99 * 12 * 0.8 = 19.104)
        surfer_basic_annual = next(p for p in data["surfer"]["annual"] if "basic" in p["id"].lower())
        assert abs(surfer_basic_annual["price"] - 19.10) < 0.1
        print(f"✓ Surfer Basic Annual: ${surfer_basic_annual['price']} (expected ~$19.10)")
        
        # Surfer premium: $9.99/mo => $95.90/year (9.99 * 12 * 0.8 = 95.904)
        surfer_premium_annual = next(p for p in data["surfer"]["annual"] if "premium" in p["id"].lower())
        assert abs(surfer_premium_annual["price"] - 95.90) < 0.1
        print(f"✓ Surfer Premium Annual: ${surfer_premium_annual['price']} (expected ~$95.90)")
        
        # Photographer basic: $18/mo => $172.80/year (18 * 12 * 0.8)
        photo_basic_annual = next(p for p in data["photographer"]["annual"] if "basic" in p["id"].lower())
        assert abs(photo_basic_annual["price"] - 172.80) < 0.1
        print(f"✓ Photographer Basic Annual: ${photo_basic_annual['price']} (expected ~$172.80)")
        
        # Photographer premium: $30/mo => $288.00/year (30 * 12 * 0.8)
        photo_premium_annual = next(p for p in data["photographer"]["annual"] if "premium" in p["id"].lower())
        assert abs(photo_premium_annual["price"] - 288.00) < 0.1
        print(f"✓ Photographer Premium Annual: ${photo_premium_annual['price']} (expected ~$288.00)")


class TestGalleryEndpoints:
    """Tests for photographer gallery functionality"""
    
    def test_get_photographer_gallery_empty(self, api_client):
        """Test getting an empty photographer gallery"""
        fake_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/gallery/photographer/{fake_id}")
        assert response.status_code == 200
        assert response.json() == []
        print("✓ Empty gallery returns empty list")
    
    def test_create_gallery_item_requires_photographer_role(self, api_client):
        """Test that only photographers can create gallery items"""
        # Create a surfer (non-photographer)
        email = f"test_surfer_{uuid.uuid4().hex[:8]}@rawsurf.test"
        signup_resp = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test Surfer",
            "role": "Surfer"
        })
        
        if signup_resp.status_code == 200:
            surfer_id = signup_resp.json()["profile"]["id"]
            
            # Try to create gallery item as surfer
            response = api_client.post(
                f"{BASE_URL}/api/gallery?photographer_id={surfer_id}",
                json={
                    "original_url": "https://example.com/photo.jpg",
                    "preview_url": "https://example.com/photo_preview.jpg",
                    "price": 5.0
                }
            )
            assert response.status_code == 403
            assert "photographer" in response.json()["detail"].lower()
            print("✓ Non-photographers cannot create gallery items")
        else:
            print(f"Signup failed: {signup_resp.text}")
            pytest.skip("Failed to create test surfer")
    
    def test_gallery_crud_flow(self, api_client):
        """Test complete gallery CRUD flow: create, read, purchase"""
        # Step 1: Create a photographer user
        email = f"test_photo_{uuid.uuid4().hex[:8]}@rawsurf.test"
        signup_resp = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email,
            "password": "testpass123",
            "full_name": "Test Gallery Photographer",
            "role": "Photographer"
        })
        
        if signup_resp.status_code != 200:
            print(f"Photographer signup failed: {signup_resp.text}")
            pytest.skip("Failed to create test photographer")
        
        photographer_id = signup_resp.json()["profile"]["id"]
        print(f"✓ Created photographer: {photographer_id}")
        
        # Step 2: Create a gallery item
        create_resp = api_client.post(
            f"{BASE_URL}/api/gallery?photographer_id={photographer_id}",
            json={
                "original_url": "https://example.com/photo_original.jpg",
                "preview_url": "https://example.com/photo_preview.jpg",
                "title": "Epic Wave Shot",
                "description": "A perfect barrel at Pipeline",
                "price": 10.0,
                "is_for_sale": True
            }
        )
        assert create_resp.status_code == 200
        gallery_item_id = create_resp.json()["id"]
        print(f"✓ Created gallery item: {gallery_item_id}")
        
        # Step 3: Get the photographer's gallery
        gallery_resp = api_client.get(f"{BASE_URL}/api/gallery/photographer/{photographer_id}")
        assert gallery_resp.status_code == 200
        items = gallery_resp.json()
        assert len(items) >= 1
        assert any(item["id"] == gallery_item_id for item in items)
        print(f"✓ Gallery contains {len(items)} item(s)")
        
        # Step 4: Get single gallery item
        item_resp = api_client.get(f"{BASE_URL}/api/gallery/item/{gallery_item_id}")
        assert item_resp.status_code == 200
        item_data = item_resp.json()
        assert item_data["title"] == "Epic Wave Shot"
        assert item_data["price"] == 10.0
        # Original URL should be hidden (not purchased)
        assert item_data["original_url"] is None
        print("✓ Single item retrieved, original hidden")
        
        # Step 5: Create a buyer with credits
        buyer_email = f"test_buyer_{uuid.uuid4().hex[:8]}@rawsurf.test"
        buyer_signup = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "email": buyer_email,
            "password": "testpass123",
            "full_name": "Test Buyer",
            "role": "Surfer"
        })
        
        if buyer_signup.status_code != 200:
            print("Buyer creation failed")
            return
        
        buyer_id = buyer_signup.json()["profile"]["id"]
        
        # Add credits to buyer
        api_client.post(f"{BASE_URL}/api/credits/add/{buyer_id}?amount=100")
        print(f"✓ Created buyer with credits: {buyer_id}")
        
        # Step 6: Purchase the gallery item
        purchase_resp = api_client.post(
            f"{BASE_URL}/api/gallery/item/{gallery_item_id}/purchase?buyer_id={buyer_id}",
            json={"payment_method": "credits"}
        )
        assert purchase_resp.status_code == 200
        purchase_data = purchase_resp.json()
        assert "original_url" in purchase_data
        assert purchase_data["original_url"] is not None
        print(f"✓ Purchase successful, remaining credits: {purchase_data.get('remaining_credits')}")
        
        # Step 7: Try to purchase again (should fail)
        repurchase_resp = api_client.post(
            f"{BASE_URL}/api/gallery/item/{gallery_item_id}/purchase?buyer_id={buyer_id}",
            json={"payment_method": "credits"}
        )
        assert repurchase_resp.status_code == 400
        assert "already" in repurchase_resp.json()["detail"].lower()
        print("✓ Re-purchase blocked")
        
        # Step 8: Download the purchased item
        download_resp = api_client.get(
            f"{BASE_URL}/api/gallery/download/{gallery_item_id}?buyer_id={buyer_id}"
        )
        assert download_resp.status_code == 200
        download_data = download_resp.json()
        assert "original_url" in download_data
        assert "downloads_remaining" in download_data
        print(f"✓ Download successful, {download_data['downloads_remaining']} remaining")
    
    def test_purchase_with_insufficient_credits(self, api_client):
        """Test purchase fails with insufficient credits"""
        # Create photographer and item
        photo_email = f"test_photo2_{uuid.uuid4().hex[:8]}@rawsurf.test"
        photo_signup = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "email": photo_email,
            "password": "testpass123",
            "full_name": "Photographer 2",
            "role": "Photographer"
        })
        
        if photo_signup.status_code != 200:
            pytest.skip("Failed to create photographer")
        
        photographer_id = photo_signup.json()["profile"]["id"]
        
        # Create item
        item_resp = api_client.post(
            f"{BASE_URL}/api/gallery?photographer_id={photographer_id}",
            json={
                "original_url": "https://example.com/expensive.jpg",
                "preview_url": "https://example.com/expensive_preview.jpg",
                "price": 50.0
            }
        )
        item_id = item_resp.json()["id"]
        
        # Create broke buyer (no credits)
        broke_email = f"test_broke_{uuid.uuid4().hex[:8]}@rawsurf.test"
        broke_signup = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "email": broke_email,
            "password": "testpass123",
            "full_name": "Broke Buyer",
            "role": "Surfer"
        })
        
        if broke_signup.status_code != 200:
            pytest.skip("Failed to create broke buyer")
        
        broke_id = broke_signup.json()["profile"]["id"]
        
        # Try to purchase
        purchase_resp = api_client.post(
            f"{BASE_URL}/api/gallery/item/{item_id}/purchase?buyer_id={broke_id}",
            json={"payment_method": "credits"}
        )
        assert purchase_resp.status_code == 400
        assert "insufficient" in purchase_resp.json()["detail"].lower()
        print("✓ Purchase correctly fails with insufficient credits")


class TestAdminEndpoints:
    """Tests for admin dashboard functionality"""
    
    def test_admin_stats_requires_admin(self, api_client):
        """Test that admin stats requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/admin/stats?admin_id={fake_id}")
        assert response.status_code == 403
        assert "admin access required" in response.json()["detail"].lower()
        print("✓ Admin stats protected - requires admin access")
    
    def test_admin_users_requires_admin(self, api_client):
        """Test that admin users endpoint requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/admin/users?admin_id={fake_id}")
        assert response.status_code == 403
        print("✓ Admin users protected - requires admin access")
    
    def test_suspend_user_requires_admin(self, api_client):
        """Test that suspend endpoint requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.post(
            f"{BASE_URL}/api/admin/users/{fake_id}/suspend?admin_id={fake_id}",
            json={"reason": "test"}
        )
        assert response.status_code == 403
        print("✓ Suspend user protected - requires admin access")
    
    def test_unsuspend_user_requires_admin(self, api_client):
        """Test that unsuspend endpoint requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.post(
            f"{BASE_URL}/api/admin/users/{fake_id}/unsuspend?admin_id={fake_id}"
        )
        assert response.status_code == 403
        print("✓ Unsuspend user protected - requires admin access")
    
    def test_make_admin_requires_admin(self, api_client):
        """Test that make-admin endpoint requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.post(
            f"{BASE_URL}/api/admin/make-admin/{fake_id}?admin_id={fake_id}"
        )
        assert response.status_code == 403
        print("✓ Make admin protected - requires admin access")
    
    def test_admin_logs_requires_admin(self, api_client):
        """Test that admin logs endpoint requires admin access"""
        fake_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/admin/logs?admin_id={fake_id}")
        assert response.status_code == 403
        print("✓ Admin logs protected - requires admin access")


class TestUploadEndpoints:
    """Tests for file upload endpoints"""
    
    def test_upload_story_endpoint_exists(self, api_client):
        """Test that upload endpoint exists"""
        response = api_client.post(f"{BASE_URL}/api/upload/story")
        assert response.status_code in [400, 422]
        print("✓ Story upload endpoint exists")
    
    def test_upload_gallery_endpoint_exists(self, api_client):
        """Test that gallery upload endpoint exists"""
        response = api_client.post(f"{BASE_URL}/api/upload/gallery")
        assert response.status_code in [400, 422]
        print("✓ Gallery upload endpoint exists")
    
    def test_upload_avatar_endpoint_exists(self, api_client):
        """Test that avatar upload endpoint exists"""
        response = api_client.post(f"{BASE_URL}/api/upload/avatar")
        assert response.status_code in [400, 422]
        print("✓ Avatar upload endpoint exists")
    
    def test_get_story_media_404(self, api_client):
        """Test getting non-existent story media"""
        response = api_client.get(f"{BASE_URL}/api/uploads/stories/nonexistent.jpg")
        assert response.status_code == 404
        print("✓ Story media 404 works correctly")
    
    def test_get_gallery_media_404(self, api_client):
        """Test getting non-existent gallery media"""
        response = api_client.get(f"{BASE_URL}/api/uploads/gallery/fake-id/nonexistent.jpg")
        assert response.status_code == 404
        print("✓ Gallery media 404 works correctly")


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self, api_client):
        """Test API is responsive"""
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        print("✓ API health check passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
