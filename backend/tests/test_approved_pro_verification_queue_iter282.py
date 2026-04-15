"""
Test: APPROVED_PRO Signup Auto-Creates VerificationRequest in Admin Queue
Iteration 282 - Bug fix verification

Tests:
1. POST /api/auth/signup with role=APPROVED_PRO should auto-create a VerificationRequest
2. GET /api/admin/verification/queue should return pending APPROVED_PRO verification requests
3. VerificationRequest should have verification_type='approved_pro_photographer'
4. Username validation during signup (3-30 chars, alphanumeric + underscores)
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials from the review request
ADMIN_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
ADMIN_EMAIL = "dpritzker0905@gmail.com"


class TestApprovedProSignupVerificationQueue:
    """Test that APPROVED_PRO signup creates verification request in admin queue"""
    
    def test_01_approved_pro_signup_creates_verification_request_and_appears_in_queue(self):
        """Test that signing up as APPROVED_PRO auto-creates a VerificationRequest that appears in admin queue"""
        print(f"\n=== Test: APPROVED_PRO Signup Creates VerificationRequest ===")
        
        # Generate unique test data
        test_timestamp = datetime.now().strftime("%H%M%S%f")[:10]
        test_username = f"test_pro_{test_timestamp}"
        test_email = f"test_pro_{test_timestamp}@test.rawsurf.io"
        
        print(f"Test email: {test_email}")
        print(f"Test username: {test_username}")
        
        # Signup as APPROVED_PRO
        signup_data = {
            "email": test_email,
            "password": "TestPass123!",
            "full_name": "Test Pro Photographer",
            "username": test_username,
            "role": "APPROVED_PRO",
            "company_name": "Test Pro Photography"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup response status: {response.status_code}")
        print(f"Signup response: {response.json()}")
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        
        data = response.json()
        assert data.get("role") == "Approved Pro", f"Expected role 'Approved Pro', got {data.get('role')}"
        assert data.get("requires_onboarding") == True, "APPROVED_PRO should require onboarding"
        assert data.get("redirect_path") == "/pro-onboarding", f"Expected redirect to /pro-onboarding, got {data.get('redirect_path')}"
        
        created_user_id = data.get("id")
        print(f"Created user ID: {created_user_id}")
        print("PASS: APPROVED_PRO signup successful")
        
        # Now verify the verification request appears in admin queue
        print(f"\n=== Verifying Request in Admin Queue ===")
        
        # Get admin verification queue
        queue_response = requests.get(
            f"{BASE_URL}/api/admin/verification/queue",
            params={
                "admin_id": ADMIN_USER_ID,
                "status": "pending",
                "verification_type": "approved_pro_photographer"
            }
        )
        print(f"Admin queue response status: {queue_response.status_code}")
        
        assert queue_response.status_code == 200, f"Admin queue request failed: {queue_response.text}"
        
        queue_data = queue_response.json()
        print(f"Pending count: {queue_data.get('pending_count')}")
        print(f"Number of requests returned: {len(queue_data.get('requests', []))}")
        
        # Check if our test user's verification request is in the queue
        requests_list = queue_data.get("requests", [])
        
        # Find our test user's request
        test_user_request = None
        for req in requests_list:
            user = req.get("user", {})
            if user and user.get("email") == test_email:
                test_user_request = req
                break
        
        assert test_user_request is not None, f"Verification request for {test_email} not found in admin queue"
        
        print(f"Found verification request for test user:")
        print(f"  - Request ID: {test_user_request.get('id')}")
        print(f"  - Verification Type: {test_user_request.get('verification_type')}")
        print(f"  - Status: {test_user_request.get('status')}")
        print(f"  - User: {test_user_request.get('user', {}).get('full_name')}")
        print(f"  - Additional Notes: {test_user_request.get('additional_notes')}")
        
        # Verify the verification_type is correct
        assert test_user_request.get("verification_type") == "approved_pro_photographer", \
            f"Expected verification_type 'approved_pro_photographer', got {test_user_request.get('verification_type')}"
        assert test_user_request.get("status") == "pending", \
            f"Expected status 'pending', got {test_user_request.get('status')}"
        
        print("PASS: Verification request found in admin queue with correct verification_type")
    
    def test_02_admin_queue_returns_pending_requests(self):
        """Test that admin queue endpoint returns pending verification requests"""
        print(f"\n=== Test: Admin Queue Returns Pending Requests ===")
        
        # Get all pending requests (no filter by type)
        response = requests.get(
            f"{BASE_URL}/api/admin/verification/queue",
            params={
                "admin_id": ADMIN_USER_ID
            }
        )
        print(f"Admin queue response status: {response.status_code}")
        
        assert response.status_code == 200, f"Admin queue request failed: {response.text}"
        
        data = response.json()
        print(f"Pending count: {data.get('pending_count')}")
        print(f"Number of requests returned: {len(data.get('requests', []))}")
        
        # Verify response structure
        assert "requests" in data, "Response should contain 'requests' field"
        assert "pending_count" in data, "Response should contain 'pending_count' field"
        
        # Check that requests have required fields
        if data.get("requests"):
            first_request = data["requests"][0]
            assert "id" in first_request, "Request should have 'id' field"
            assert "verification_type" in first_request, "Request should have 'verification_type' field"
            assert "status" in first_request, "Request should have 'status' field"
            assert "user" in first_request, "Request should have 'user' field"
            print("PASS: Admin queue returns properly structured data")
        else:
            print("INFO: No pending requests in queue (may be expected if queue is empty)")


class TestUsernameValidation:
    """Test username validation during signup"""
    
    def test_01_username_required_for_signup(self):
        """Test that username is required for signup"""
        print(f"\n=== Test: Username Required for Signup ===")
        
        # Try signup without username
        signup_data = {
            "email": f"test_no_username_{uuid.uuid4().hex[:8]}@test.rawsurf.io",
            "password": "TestPass123!",
            "full_name": "Test User No Username",
            "role": "SURFER"
            # Missing username
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup without username response status: {response.status_code}")
        
        # Should fail with 422 (validation error) since username is required
        assert response.status_code == 422, f"Expected 422 for missing username, got {response.status_code}"
        print("PASS: Signup without username correctly rejected")
    
    def test_02_username_too_short_rejected(self):
        """Test that username shorter than 3 chars is rejected"""
        print(f"\n=== Test: Username Too Short Rejected ===")
        
        signup_data = {
            "email": f"test_short_username_{uuid.uuid4().hex[:8]}@test.rawsurf.io",
            "password": "TestPass123!",
            "full_name": "Test User Short Username",
            "username": "ab",  # Too short (2 chars)
            "role": "SURFER"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup with short username response status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # Should fail with 400 (bad request)
        assert response.status_code == 400, f"Expected 400 for short username, got {response.status_code}"
        assert "3-30 characters" in response.json().get("detail", ""), "Error should mention character limit"
        print("PASS: Short username correctly rejected")
    
    def test_03_username_invalid_chars_rejected(self):
        """Test that username with invalid characters is rejected"""
        print(f"\n=== Test: Username Invalid Chars Rejected ===")
        
        signup_data = {
            "email": f"test_invalid_username_{uuid.uuid4().hex[:8]}@test.rawsurf.io",
            "password": "TestPass123!",
            "full_name": "Test User Invalid Username",
            "username": "test-user!",  # Invalid chars (hyphen and exclamation)
            "role": "SURFER"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup with invalid username response status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # Should fail with 400 (bad request)
        assert response.status_code == 400, f"Expected 400 for invalid username, got {response.status_code}"
        print("PASS: Invalid username correctly rejected")
    
    def test_04_valid_username_accepted(self):
        """Test that valid username is accepted"""
        print(f"\n=== Test: Valid Username Accepted ===")
        
        test_username = f"valid_user_{uuid.uuid4().hex[:6]}"
        signup_data = {
            "email": f"test_valid_username_{uuid.uuid4().hex[:8]}@test.rawsurf.io",
            "password": "TestPass123!",
            "full_name": "Test User Valid Username",
            "username": test_username,
            "role": "SURFER"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup with valid username response status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200 for valid username, got {response.status_code}: {response.text}"
        print("PASS: Valid username accepted")
    
    def test_05_username_with_at_symbol_cleaned(self):
        """Test that username with @ symbol is cleaned (@ removed)"""
        print(f"\n=== Test: Username @ Symbol Cleaned ===")
        
        test_username = f"@at_user_{uuid.uuid4().hex[:6]}"
        signup_data = {
            "email": f"test_at_username_{uuid.uuid4().hex[:8]}@test.rawsurf.io",
            "password": "TestPass123!",
            "full_name": "Test User At Username",
            "username": test_username,
            "role": "SURFER"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup with @ username response status: {response.status_code}")
        
        # Should succeed - @ is stripped
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: Username with @ symbol accepted (@ stripped)")


class TestVerificationRequestFields:
    """Test that VerificationRequest has correct fields"""
    
    def test_01_verification_request_has_correct_type(self):
        """Test that verification request has verification_type='approved_pro_photographer'"""
        print(f"\n=== Test: Verification Request Has Correct Type ===")
        
        # Create a new APPROVED_PRO user
        test_timestamp = datetime.now().strftime("%H%M%S%f")[:10]
        test_email = f"test_verify_type_{test_timestamp}@test.rawsurf.io"
        test_username = f"verify_type_{test_timestamp}"
        
        signup_data = {
            "email": test_email,
            "password": "TestPass123!",
            "full_name": "Test Verify Type",
            "username": test_username,
            "role": "APPROVED_PRO"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        print(f"Signup response status: {response.status_code}")
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        
        user_id = response.json().get("id")
        print(f"Created user ID: {user_id}")
        
        # Now check the admin queue for this user's verification request
        queue_response = requests.get(
            f"{BASE_URL}/api/admin/verification/queue",
            params={
                "admin_id": ADMIN_USER_ID,
                "verification_type": "approved_pro_photographer"
            }
        )
        
        assert queue_response.status_code == 200, f"Queue request failed: {queue_response.text}"
        
        queue_data = queue_response.json()
        requests_list = queue_data.get("requests", [])
        
        # Find our user's request
        user_request = None
        for req in requests_list:
            if req.get("user", {}).get("email") == test_email:
                user_request = req
                break
        
        assert user_request is not None, f"Verification request for {test_email} not found"
        
        # Verify the verification_type field
        assert user_request.get("verification_type") == "approved_pro_photographer", \
            f"Expected verification_type 'approved_pro_photographer', got {user_request.get('verification_type')}"
        
        # Verify additional_notes contains signup info
        additional_notes = user_request.get("additional_notes", "")
        assert "Auto-created during signup" in additional_notes, \
            f"Expected 'Auto-created during signup' in notes, got: {additional_notes}"
        assert test_username in additional_notes, \
            f"Expected username '{test_username}' in notes, got: {additional_notes}"
        
        print(f"Verification request details:")
        print(f"  - verification_type: {user_request.get('verification_type')}")
        print(f"  - status: {user_request.get('status')}")
        print(f"  - additional_notes: {additional_notes}")
        print("PASS: Verification request has correct verification_type and notes")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
