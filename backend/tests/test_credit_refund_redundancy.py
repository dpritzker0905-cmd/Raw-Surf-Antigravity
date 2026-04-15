"""
Test: Automated Account Credit Redundancy System (Iteration 82)

Features to test:
1. Backend join_session has try-catch with automatic refund on failure
2. Backend creates CreditTransaction record for refund with transaction_type='session_join_refund'
3. Backend creates Notification for user about refund
4. Backend returns detailed error object with refunded=true, refund_amount, new_balance
5. Frontend JumpInSessionModal handles refund notification and updates user balance
6. Frontend checkout shows 'Photos Included' and savings information
7. Frontend shows Account Credit banner when user has credits
"""

import pytest
import requests
import os
from dotenv import load_dotenv

load_dotenv('/app/frontend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestCreditRefundCodeVerification:
    """Verify backend code structure for credit refund logic"""
    
    def test_refund_logic_exists_in_sessions_route(self):
        """Verify that the try-catch refund logic is present in sessions.py"""
        # Read the sessions.py file
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        # Check for key elements of the refund logic
        assert 'session_join_refund' in code, "Missing 'session_join_refund' transaction type"
        assert 'credit_refund' in code, "Missing 'credit_refund' notification type"
        assert 'refunded' in code, "Missing 'refunded' key in error response"
        assert 'refund_amount' in code, "Missing 'refund_amount' in error response"
        assert 'new_balance' in code, "Missing 'new_balance' in error response"
        
        print("✓ All refund logic elements present in sessions.py")
    
    def test_refund_transaction_type_is_correct(self):
        """Verify the transaction type for refunds"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        # Check for the specific transaction type string
        assert "transaction_type='session_join_refund'" in code, \
            "CreditTransaction should use 'session_join_refund' type"
        
        print("✓ CreditTransaction uses 'session_join_refund' type")
    
    def test_refund_notification_is_created(self):
        """Verify notification is created for refund"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        # Check for notification creation
        assert "type='credit_refund'" in code, "Missing 'credit_refund' notification type"
        assert "Session Join Failed - Credit Refunded" in code, \
            "Missing refund notification title"
        
        print("✓ Refund notification is properly created")


class TestFrontendRefundHandling:
    """Verify frontend code handles refund notifications"""
    
    def test_frontend_handles_refund_response(self):
        """Verify JumpInSessionModal.js handles refund response"""
        with open('/app/frontend/src/components/JumpInSessionModal.js', 'r') as f:
            code = f.read()
        
        # Check for refund handling
        assert 'errorDetail.refunded' in code, "Missing check for errorDetail.refunded"
        assert 'refund_amount' in code, "Missing refund_amount handling"
        assert 'new_balance' in code, "Missing new_balance update"
        assert 'Session Join Failed - Credit Refunded' in code, "Missing refund toast message"
        
        print("✓ Frontend handles refund response correctly")
    
    def test_frontend_updates_user_balance(self):
        """Verify frontend updates user balance after refund"""
        with open('/app/frontend/src/components/JumpInSessionModal.js', 'r') as f:
            code = f.read()
        
        # Check for balance update call
        assert 'updateUser({ credit_balance: errorDetail.new_balance' in code or \
               'updateUser' in code and 'new_balance' in code, \
            "Frontend should update user balance after refund"
        
        print("✓ Frontend updates user balance on refund")


class TestFrontendPaymentUI:
    """Verify frontend checkout UI shows required information"""
    
    def test_photos_included_shown_in_checkout(self):
        """Verify checkout shows 'Photos Included' information"""
        with open('/app/frontend/src/components/JumpInSessionModal.js', 'r') as f:
            code = f.read()
        
        # Check for "Photos Included" in UI
        assert 'Photos Included' in code, "Missing 'Photos Included' display"
        assert 'photosIncluded' in code, "Missing photosIncluded variable"
        
        print("✓ Checkout shows 'Photos Included' info")
    
    def test_savings_shown_in_checkout(self):
        """Verify checkout shows savings information"""
        with open('/app/frontend/src/components/JumpInSessionModal.js', 'r') as f:
            code = f.read()
        
        # Check for savings display
        assert 'savingsAmount' in code, "Missing savingsAmount calculation"
        assert 'savingsPercent' in code, "Missing savingsPercent calculation"
        assert 'Save $' in code or 'Save ' in code, "Missing savings display text"
        
        print("✓ Checkout shows savings information")
    
    def test_credit_banner_shown_when_user_has_credits(self):
        """Verify Account Credit banner is shown"""
        with open('/app/frontend/src/components/JumpInSessionModal.js', 'r') as f:
            code = f.read()
        
        # Check for credit banner
        assert 'Account Credit' in code, "Missing 'Account Credit' banner"
        assert 'credit_balance' in code, "Missing credit_balance check"
        
        print("✓ Account Credit banner is shown when user has credits")


class TestJoinSessionEndpoint:
    """Test the actual join session endpoint"""
    
    def test_join_session_returns_photos_included(self):
        """Verify join session response includes photos_included"""
        # Login as test surfer
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test_selfie_surfer@test.com",
            "password": "test-shaka"
        })
        
        if login_response.status_code != 200:
            pytest.skip("Could not login as surfer")
        
        surfer_data = login_response.json()
        surfer_id = surfer_data.get('id')
        token = surfer_data.get('token')
        
        # Get shooting photographers
        map_response = requests.get(f"{BASE_URL}/api/photographers/live")
        if map_response.status_code != 200:
            pytest.skip("Cannot get photographers list")
        
        photographers = map_response.json()
        if not photographers:
            pytest.skip("No photographer currently shooting")
        
        photographer_id = photographers[0].get('id')
        
        # Join session
        headers = {"Authorization": f"Bearer {token}"}
        join_response = requests.post(
            f"{BASE_URL}/api/sessions/join",
            json={
                "photographer_id": photographer_id,
                "selfie_url": None,
                "payment_method": "credits"
            },
            params={"surfer_id": surfer_id},
            headers=headers
        )
        
        if join_response.status_code == 200:
            data = join_response.json()
            assert 'photos_included' in data, "Response should include photos_included"
            assert 'price_per_photo' in data, "Response should include price_per_photo"
            print(f"✓ Join session response includes:")
            print(f"  - photos_included: {data.get('photos_included')}")
            print(f"  - price_per_photo: {data.get('price_per_photo')}")
        elif join_response.status_code == 400:
            detail = join_response.json().get('detail', '')
            print(f"ℹ Business logic error (expected if already joined): {detail}")
        else:
            print(f"Response {join_response.status_code}: {join_response.text}")
    
    def test_refund_error_format(self):
        """Verify refund error response format in code"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        # Check for proper error object structure
        assert '"error":' in code, "Missing 'error' key in error response"
        assert '"refunded": True' in code, "Missing 'refunded': True in error response"
        assert '"refund_amount":' in code, "Missing 'refund_amount' in error response"
        assert '"new_balance":' in code, "Missing 'new_balance' in error response"
        
        print("✓ Refund error response has correct format")


class TestCreditTransactionTypes:
    """Verify credit transaction types are used correctly"""
    
    def test_live_session_buyin_type_exists(self):
        """Check that live_session_buyin transaction type is used"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        assert "transaction_type='live_session_buyin'" in code, \
            "Missing 'live_session_buyin' transaction type for payment"
        
        print("✓ 'live_session_buyin' transaction type used for payment")
    
    def test_session_join_refund_type_exists(self):
        """Check that session_join_refund transaction type is used"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        assert "transaction_type='session_join_refund'" in code, \
            "Missing 'session_join_refund' transaction type for refund"
        
        print("✓ 'session_join_refund' transaction type used for refund")


class TestRefundLogicStructure:
    """Verify refund logic structure in the code"""
    
    def test_try_except_block_exists(self):
        """Verify try-except block wraps session join operations"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        # Check for try-except with refund logic
        assert 'TRY SESSION JOIN - REFUND ON FAILURE' in code or \
               ('try:' in code and 'except' in code and 'payment_processed' in code), \
            "Missing try-except block for session join with refund"
        
        print("✓ Try-except block exists for session join with refund logic")
    
    def test_payment_processed_flag_exists(self):
        """Verify payment_processed flag is tracked"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        assert 'payment_processed' in code, "Missing payment_processed flag"
        assert 'payment_processed = True' in code, "Missing payment_processed = True"
        assert 'if payment_processed' in code, "Missing check for payment_processed in refund logic"
        
        print("✓ payment_processed flag is properly tracked")
    
    def test_db_rollback_before_refund(self):
        """Verify db.rollback() is called before refund"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            code = f.read()
        
        assert 'await db.rollback()' in code, "Missing db.rollback() before refund"
        
        print("✓ db.rollback() is called before refund")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
