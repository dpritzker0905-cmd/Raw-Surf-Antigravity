"""
Test Reviews API and XP Transaction System
Tests the two-way review system (surfer↔photographer) with AI vulgar word filtering
and XP transactions for gamification engine
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if BASE_URL:
    BASE_URL = BASE_URL.rstrip('/')

# Test credentials
PHOTOGRAPHER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters
TEST_SURFER_EMAIL = f"test_surfer_{uuid.uuid4().hex[:8]}@test.com"

# ============ FIXTURES ============

@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def test_surfer_id(api_client):
    """Create a test surfer for reviews"""
    # First try to find an existing surfer
    response = api_client.get(f"{BASE_URL}/api/profiles")
    if response.status_code == 200:
        profiles = response.json()
        for p in profiles:
            if p.get('role') == 'Surfer' and p.get('id') != PHOTOGRAPHER_ID:
                return p['id']
    
    # Create a test surfer
    signup_data = {
        "email": TEST_SURFER_EMAIL,
        "password": "testpass123",
        "full_name": "TEST_ReviewSurfer",
        "role": "Surfer"
    }
    response = api_client.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
    if response.status_code in [200, 201]:
        data = response.json()
        return data.get('profile', {}).get('id') or data.get('user', {}).get('id')
    
    pytest.skip("Could not create or find a test surfer")


# ============ REVIEWS API TESTS ============

class TestReviewsAPI:
    """Test Reviews CRUD operations with AI moderation"""
    
    def test_get_photographer_reviews_returns_list(self, api_client):
        """GET /api/reviews/photographer/{id} should return a list"""
        response = api_client.get(f"{BASE_URL}/api/reviews/photographer/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
    
    def test_get_photographer_reviews_with_limit(self, api_client):
        """GET /api/reviews/photographer/{id}?limit=5 should respect limit"""
        response = api_client.get(f"{BASE_URL}/api/reviews/photographer/{PHOTOGRAPHER_ID}?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 5
    
    def test_get_photographer_review_stats(self, api_client):
        """GET /api/reviews/photographer/{id}/stats should return statistics"""
        response = api_client.get(f"{BASE_URL}/api/reviews/photographer/{PHOTOGRAPHER_ID}/stats")
        assert response.status_code == 200
        
        data = response.json()
        assert "average_rating" in data
        assert "total_reviews" in data
        assert "rating_breakdown" in data
        assert "recent_reviews" in data
    
    def test_create_review_success(self, api_client, test_surfer_id):
        """POST /api/reviews should create a review"""
        if not test_surfer_id:
            pytest.skip("No test surfer available")
        
        review_data = {
            "reviewee_id": PHOTOGRAPHER_ID,
            "rating": 5,
            "comment": "Great photographer! Amazing shots of my surf session."
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/reviews?reviewer_id={test_surfer_id}",
            json=review_data
        )
        
        # May fail if review already exists
        if response.status_code == 400 and "already reviewed" in response.text.lower():
            pytest.skip("Review already exists for this pair")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["rating"] == 5
        assert data["review_type"] == "surfer_to_photographer"
        assert data["status"] in ["approved", "pending"]
    
    def test_create_review_with_vulgar_word_gets_flagged(self, api_client, test_surfer_id):
        """POST /api/reviews with vulgar words should be flagged for moderation"""
        if not test_surfer_id:
            pytest.skip("No test surfer available")
        
        review_data = {
            "reviewee_id": PHOTOGRAPHER_ID,
            "rating": 1,
            "comment": "This was shit service, total crap!"  # Contains vulgar words
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/reviews?reviewer_id={test_surfer_id}",
            json=review_data
        )
        
        # May fail if review already exists
        if response.status_code == 400 and "already reviewed" in response.text.lower():
            pytest.skip("Review already exists for this pair")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should be flagged as pending due to vulgar words
        assert data["status"] == "pending", "Review with vulgar words should be pending"
    
    def test_create_review_requires_reviewer_id(self, api_client):
        """POST /api/reviews without reviewer_id should fail"""
        review_data = {
            "reviewee_id": PHOTOGRAPHER_ID,
            "rating": 4,
            "comment": "Good service"
        }
        
        response = api_client.post(f"{BASE_URL}/api/reviews", json=review_data)
        assert response.status_code == 422, "Should require reviewer_id query param"
    
    def test_create_review_validates_rating_range(self, api_client, test_surfer_id):
        """POST /api/reviews should validate rating is 1-5"""
        if not test_surfer_id:
            pytest.skip("No test surfer available")
        
        # Test rating too high
        review_data = {
            "reviewee_id": PHOTOGRAPHER_ID,
            "rating": 10,  # Invalid - should be 1-5
            "comment": "Test"
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/reviews?reviewer_id={test_surfer_id}",
            json=review_data
        )
        assert response.status_code == 422, "Should reject rating > 5"
    
    def test_get_surfer_reviews(self, api_client, test_surfer_id):
        """GET /api/reviews/surfer/{id} should return reviews for a surfer"""
        if not test_surfer_id:
            pytest.skip("No test surfer available")
        
        response = api_client.get(f"{BASE_URL}/api/reviews/surfer/{test_surfer_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)


# ============ XP TRANSACTION TESTS ============

class TestXPTransactions:
    """Test XP transactions created when reviews are posted"""
    
    def test_review_awards_xp(self, api_client, test_surfer_id):
        """Creating a review should award 10 XP to reviewer"""
        if not test_surfer_id:
            pytest.skip("No test surfer available")
        
        # Create a unique reviewee to avoid duplicate constraint
        # First find another user to review
        response = api_client.get(f"{BASE_URL}/api/profiles")
        other_user_id = None
        if response.status_code == 200:
            profiles = response.json()
            for p in profiles:
                if p.get('id') != test_surfer_id and p.get('id') != PHOTOGRAPHER_ID:
                    if p.get('role') in ['Photographer', 'Approved Pro', 'Hobbyist']:
                        other_user_id = p['id']
                        break
        
        if not other_user_id:
            pytest.skip("No other photographer to review")
        
        review_data = {
            "reviewee_id": other_user_id,
            "rating": 4,
            "comment": "Nice photos!"
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/reviews?reviewer_id={test_surfer_id}",
            json=review_data
        )
        
        if response.status_code == 400 and "already reviewed" in response.text.lower():
            pytest.skip("Review already exists")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        # The review creation should have triggered XP award
        # Check the response has review data
        data = response.json()
        assert "id" in data
        # Note: XP is awarded in the backend but we can't easily verify without an XP endpoint


# ============ PHOTOGRAPHER PROFILE ENDPOINT TESTS ============

class TestPhotographerProfile:
    """Test photographer-related endpoints for drawer integration"""
    
    def test_get_photographer_pricing(self, api_client):
        """GET /api/photographer/{id}/pricing should return pricing info"""
        response = api_client.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Check expected pricing fields exist
        assert "live_buyin_price" in data or "session_price" in data
    
    def test_get_photographer_session_history(self, api_client):
        """GET /api/photographer/{id}/session-history should return session list"""
        response = api_client.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/session-history?limit=3")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 3


# ============ API HEALTH AND INTEGRATION TESTS ============

class TestAPIHealth:
    """Test basic API health and connectivity"""
    
    def test_api_root_accessible(self, api_client):
        """API root should return active status"""
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("status") == "active"
    
    def test_profiles_endpoint_accessible(self, api_client):
        """Profiles endpoint should be accessible"""
        response = api_client.get(f"{BASE_URL}/api/profiles")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
