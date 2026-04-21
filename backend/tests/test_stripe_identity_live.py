"""
Stripe Identity Live Integration Test
Tests the full age verification flow for Grom Parents
"""
import pytest
import httpx
import os
import stripe
from datetime import datetime

# Configure Stripe
stripe.api_key = os.environ.get('STRIPE_API_KEY', '')

BASE_URL = os.environ.get('TEST_API_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestStripeIdentityIntegration:
    """Test Stripe Identity age verification flow"""
    
    @pytest.fixture
    def api_client(self):
        return httpx.Client(base_url=BASE_URL, timeout=30.0)
    
    def test_stripe_identity_api_connection(self):
        """Test that Stripe Identity API is accessible"""
        try:
            # List verification sessions to confirm API access
            sessions = stripe.identity.VerificationSession.list(limit=1)
            assert sessions is not None
            print(f"✅ Stripe Identity API connected. Found {len(sessions.data)} session(s)")
        except stripe.error.AuthenticationError as e:
            pytest.fail(f"Stripe API key invalid: {e}")
        except stripe.error.PermissionError as e:
            pytest.fail(f"Stripe Identity not enabled for this account: {e}")
    
    def test_create_verification_session_endpoint(self, api_client):
        """Test creating a verification session via our API"""
        # First login as Grom Parent
        login_response = api_client.post('/api/auth/login', json={
            'email': 'testgromparent@gmail.com',
            'password': 'test123'
        })
        
        if login_response.status_code != 200:
            pytest.skip("Grom Parent test account not available")
        
        user_data = login_response.json()
        parent_id = user_data.get('id')
        
        # Try to create verification session
        response = api_client.post(
            f'/api/grom-hq/create-age-verification/{parent_id}',
            json={'return_url': 'https://raw-surf-os.preview.emergentagent.com/grom-hq'}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Either already verified or got a new session
        if data.get('already_verified'):
            print(f"✅ Parent already verified")
            assert data['message'] == "You are already age verified"
        else:
            assert 'verification_session_id' in data
            assert data['verification_session_id'].startswith('vs_')
            print(f"✅ Created verification session: {data['verification_session_id']}")
    
    def test_verification_session_creation_direct(self):
        """Test creating a Stripe Identity session directly"""
        try:
            session = stripe.identity.VerificationSession.create(
                type="document",
                options={
                    "document": {
                        "allowed_types": ["driving_license", "passport", "id_card"]
                    }
                },
                metadata={
                    "test": "true",
                    "purpose": "integration_test"
                }
            )
            
            assert session.id.startswith('vs_')
            assert session.status in ['requires_input', 'processing', 'verified', 'canceled']
            print(f"✅ Direct session created: {session.id}, status: {session.status}")
            
            # Clean up - cancel the test session
            stripe.identity.VerificationSession.cancel(session.id)
            print(f"✅ Test session canceled")
            
        except stripe.error.StripeError as e:
            pytest.fail(f"Failed to create verification session: {e}")
    
    def test_age_verification_status_endpoint(self, api_client):
        """Test checking age verification status"""
        # Login as Grom Parent
        login_response = api_client.post('/api/auth/login', json={
            'email': 'testgromparent@gmail.com',
            'password': 'test123'
        })
        
        if login_response.status_code != 200:
            pytest.skip("Grom Parent test account not available")
        
        user_data = login_response.json()
        parent_id = user_data.get('id')
        
        # Check status
        response = api_client.get(f'/api/grom-hq/age-verification-status/{parent_id}')
        
        assert response.status_code == 200
        data = response.json()
        assert 'age_verified' in data
        print(f"✅ Age verification status: {data['age_verified']}")
    
    def test_non_grom_parent_rejection(self, api_client):
        """Test that non-Grom Parents are rejected from age verification"""
        # Login as admin (not a Grom Parent)
        login_response = api_client.post('/api/auth/login', json={
            'email': 'dpritzker0905@gmail.com',
            'password': 'admin123'
        })
        
        if login_response.status_code != 200:
            pytest.skip("Admin test account not available")
        
        user_data = login_response.json()
        user_id = user_data.get('id')
        
        # Try to create verification session
        response = api_client.post(
            f'/api/grom-hq/create-age-verification/{user_id}',
            json={'return_url': 'https://raw-surf-os.preview.emergentagent.com/grom-hq'}
        )
        
        # Should fail - only Grom Parents need verification
        assert response.status_code == 400
        data = response.json()
        assert 'Only Grom Parents' in data.get('detail', '')
        print(f"✅ Non-Grom Parent correctly rejected")


class TestStripeIdentityWebhooks:
    """Test webhook handling for identity verification events"""
    
    def test_webhook_endpoint_exists(self):
        """Verify webhook endpoint is configured (placeholder for future)"""
        # Note: Full webhook testing requires Stripe CLI or test webhooks
        print("ℹ️ Webhook testing requires Stripe CLI - manual verification recommended")
        print("   Run: stripe listen --forward-to localhost:8001/api/webhooks/stripe")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
