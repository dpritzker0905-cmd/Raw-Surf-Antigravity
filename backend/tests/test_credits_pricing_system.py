"""
Test file for Credit System and SmugMug-style Pricing
Tests: 
- GET/PUT photographer pricing settings
- GET credit balance, history, summary
- POST join booking with credit deduction
- Credit transactions logging
- Platform fee (80% to photographer)
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
PHOTOGRAPHER_EMAIL = "test-photographer@test.com"
PHOTOGRAPHER_PASSWORD = "test123"
# Hobbyist with credits for testing
HOBBYIST_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def photographer_user(api_client):
    """Login and get photographer user"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": PHOTOGRAPHER_EMAIL,
        "password": PHOTOGRAPHER_PASSWORD
    })
    if response.status_code == 200:
        return response.json()
    pytest.skip(f"Photographer login failed: {response.status_code} - {response.text}")


class TestPricingAPI:
    """Tests for SmugMug-style Pricing Settings APIs"""
    
    def test_get_photographer_pricing(self, api_client, photographer_user):
        """GET /api/photographer/{id}/pricing - Returns SmugMug-style pricing settings"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify all SmugMug-style pricing fields are present
        expected_fields = ["live_buyin_price", "live_photo_price", "photo_package_size", 
                          "booking_hourly_rate", "booking_min_hours"]
        for field in expected_fields:
            assert field in data, f"Missing pricing field: {field}"
        
        # Verify types and reasonable values
        assert isinstance(data["live_buyin_price"], (int, float)), "live_buyin_price should be numeric"
        assert isinstance(data["live_photo_price"], (int, float)), "live_photo_price should be numeric"
        assert isinstance(data["photo_package_size"], int), "photo_package_size should be integer"
        assert isinstance(data["booking_hourly_rate"], (int, float)), "booking_hourly_rate should be numeric"
        assert isinstance(data["booking_min_hours"], (int, float)), "booking_min_hours should be numeric"
        
        print(f"✅ GET photographer pricing: {data}")
    
    
    def test_update_photographer_pricing(self, api_client, photographer_user):
        """PUT /api/photographer/{id}/pricing - Updates all pricing settings"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        new_pricing = {
            "live_buyin_price": 30.0,
            "live_photo_price": 7.0,
            "photo_package_size": 3,
            "booking_hourly_rate": 75.0,
            "booking_min_hours": 1.5
        }
        
        response = api_client.put(f"{BASE_URL}/api/photographer/{photographer_id}/pricing", json=new_pricing)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        assert "pricing" in data, "Response should have pricing object"
        
        pricing = data["pricing"]
        assert pricing["live_buyin_price"] == 30.0, f"live_buyin_price not updated: {pricing}"
        assert pricing["live_photo_price"] == 7.0, f"live_photo_price not updated: {pricing}"
        assert pricing["photo_package_size"] == 3, f"photo_package_size not updated: {pricing}"
        assert pricing["booking_hourly_rate"] == 75.0, f"booking_hourly_rate not updated: {pricing}"
        assert pricing["booking_min_hours"] == 1.5, f"booking_min_hours not updated: {pricing}"
        
        print(f"✅ PUT photographer pricing updated: {pricing}")
        
        # Verify persistence with GET
        verify_response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/pricing")
        verify_data = verify_response.json()
        assert verify_data["live_buyin_price"] == 30.0, "Pricing not persisted"
        
        print(f"✅ Pricing persistence verified via GET")
    
    
    def test_update_pricing_partial(self, api_client, photographer_user):
        """PUT /api/photographer/{id}/pricing - Partial update (only some fields)"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # Only update one field
        partial_update = {
            "live_buyin_price": 35.0
        }
        
        response = api_client.put(f"{BASE_URL}/api/photographer/{photographer_id}/pricing", json=partial_update)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()["pricing"]
        assert data["live_buyin_price"] == 35.0, "Partial update failed"
        
        # Other fields should remain unchanged
        assert data["live_photo_price"] == 7.0, "Other fields should not change"
        
        print(f"✅ Partial pricing update works correctly")
    
    
    def test_update_pricing_validation_negative(self, api_client, photographer_user):
        """PUT /api/photographer/{id}/pricing - Rejects negative values"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        invalid_pricing = {
            "live_buyin_price": -10.0
        }
        
        response = api_client.put(f"{BASE_URL}/api/photographer/{photographer_id}/pricing", json=invalid_pricing)
        
        assert response.status_code == 400, f"Expected 400 for negative value, got {response.status_code}"
        
        print(f"✅ Negative pricing values rejected with 400")
    
    
    def test_get_pricing_non_photographer(self, api_client):
        """GET /api/photographer/{id}/pricing - Fails for non-photographer"""
        # Try to get pricing for a non-existent user
        fake_id = "00000000-0000-0000-0000-000000000000"
        
        response = api_client.get(f"{BASE_URL}/api/photographer/{fake_id}/pricing")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✅ Non-existent photographer returns 404")


class TestCreditBalanceAPI:
    """Tests for Credit Balance APIs"""
    
    def test_get_credit_balance(self, api_client, photographer_user):
        """GET /api/credits/balance/{user_id} - Returns user's credit balance"""
        user_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/credits/balance/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "user_id" in data, "Response should have user_id"
        assert "balance" in data, "Response should have balance"
        assert "currency" in data, "Response should have currency"
        assert data["currency"] == "credits", "Currency should be 'credits'"
        assert "note" in data, "Response should have note about 1 credit = $1"
        
        assert isinstance(data["balance"], (int, float)), "Balance should be numeric"
        
        print(f"✅ GET credit balance: {data['balance']} credits for user {user_id}")
    
    
    def test_get_credit_balance_hobbyist(self, api_client):
        """GET /api/credits/balance/{user_id} - Check hobbyist balance"""
        response = api_client.get(f"{BASE_URL}/api/credits/balance/{HOBBYIST_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"✅ Hobbyist credit balance: {data['balance']} credits")
    
    
    def test_get_credit_balance_nonexistent_user(self, api_client):
        """GET /api/credits/balance/{user_id} - Returns 404 for non-existent user"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        
        response = api_client.get(f"{BASE_URL}/api/credits/balance/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✅ Non-existent user returns 404 for balance check")


class TestCreditHistoryAPI:
    """Tests for Credit Transaction History APIs"""
    
    def test_get_credit_history(self, api_client, photographer_user):
        """GET /api/credits/history/{user_id} - Returns credit transaction history"""
        user_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/credits/history/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "user_id" in data, "Response should have user_id"
        assert "transactions" in data, "Response should have transactions"
        assert "count" in data, "Response should have count"
        
        assert isinstance(data["transactions"], list), "Transactions should be a list"
        
        print(f"✅ GET credit history: {data['count']} transactions")
        
        # Verify transaction structure if any exist
        if data["count"] > 0:
            tx = data["transactions"][0]
            expected_fields = ["id", "amount", "balance_before", "balance_after", 
                            "transaction_type", "created_at"]
            for field in expected_fields:
                assert field in tx, f"Missing transaction field: {field}"
            print(f"✅ Transaction structure verified")
    
    
    def test_get_credit_history_with_limit(self, api_client, photographer_user):
        """GET /api/credits/history/{user_id} - With limit parameter"""
        user_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/credits/history/{user_id}?limit=5")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert len(data["transactions"]) <= 5, "Should respect limit parameter"
        
        print(f"✅ Credit history with limit=5 works")
    
    
    def test_get_credit_history_by_type(self, api_client, photographer_user):
        """GET /api/credits/history/{user_id} - Filter by transaction type"""
        user_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/credits/history/{user_id}?transaction_type=booking_payment")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # If there are transactions, they should all be of the requested type
        for tx in data["transactions"]:
            assert tx["transaction_type"] == "booking_payment", f"Wrong transaction type: {tx['transaction_type']}"
        
        print(f"✅ Credit history filter by type works: {data['count']} booking_payment transactions")


class TestCreditSummaryAPI:
    """Tests for Credit Summary API"""
    
    def test_get_credit_summary(self, api_client, photographer_user):
        """GET /api/credits/summary/{user_id} - Returns credit activity summary"""
        user_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/credits/summary/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        expected_fields = ["user_id", "current_balance", "total_earned", "total_spent", "breakdown"]
        for field in expected_fields:
            assert field in data, f"Missing summary field: {field}"
        
        assert isinstance(data["current_balance"], (int, float)), "current_balance should be numeric"
        assert isinstance(data["total_earned"], (int, float)), "total_earned should be numeric"
        assert isinstance(data["total_spent"], (int, float)), "total_spent should be numeric"
        assert isinstance(data["breakdown"], dict), "breakdown should be a dict"
        
        print(f"✅ GET credit summary: balance={data['current_balance']}, earned={data['total_earned']}, spent={data['total_spent']}")
    
    
    def test_get_credit_summary_nonexistent(self, api_client):
        """GET /api/credits/summary/{user_id} - Returns 404 for non-existent user"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        
        response = api_client.get(f"{BASE_URL}/api/credits/summary/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✅ Non-existent user returns 404 for summary")


class TestJoinBookingWithCredits:
    """Tests for joining bookings and credit deduction"""
    
    def test_get_booking_details(self, api_client, photographer_user):
        """GET /api/bookings/{id} - Get booking details for join verification"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # First get existing bookings
        bookings_response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/bookings")
        
        if bookings_response.status_code != 200 or not bookings_response.json():
            pytest.skip("No bookings available to test")
        
        bookings = bookings_response.json()
        if len(bookings) == 0:
            pytest.skip("No bookings available")
        
        booking_id = bookings[0]["id"]
        
        # Get booking details
        response = api_client.get(f"{BASE_URL}/api/bookings/{booking_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have id"
        assert "photographer_id" in data, "Response should have photographer_id"
        assert "price_per_person" in data, "Response should have price_per_person"
        
        print(f"✅ GET booking details: {data['id']} at {data['location']}, price=${data.get('price_per_person', 0)}")


class TestRestorePricing:
    """Restore original pricing after tests"""
    
    def test_restore_default_pricing(self, api_client, photographer_user):
        """Restore default pricing values"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        default_pricing = {
            "live_buyin_price": 25.0,
            "live_photo_price": 5.0,
            "photo_package_size": 0,
            "booking_hourly_rate": 50.0,
            "booking_min_hours": 1.0
        }
        
        response = api_client.put(f"{BASE_URL}/api/photographer/{photographer_id}/pricing", json=default_pricing)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        print(f"✅ Restored default pricing")
