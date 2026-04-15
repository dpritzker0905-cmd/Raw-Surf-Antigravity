"""
Test: Dispatch Selfie & Mobile Selfie Visibility Features (Iteration 58)

Features tested:
1. DispatchRequest model has selfie_url field
2. Backend dispatch update-selfie endpoint works
3. Dispatch GET response includes selfie_url
4. UnifiedSpotDrawer mobile selfie sticky footer classes exist (pb-24, md:hidden)
5. Desktop selfie controls have hidden md:flex class
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')


class TestDispatchActiveEndpoint:
    """Test the dispatch active endpoint returns correct structure"""
    
    def test_dispatch_active_returns_active_dispatch_key(self):
        """Test /api/dispatch/user/{id}/active returns expected structure"""
        # Use a test user ID
        user_id = "d3eb9019-d16f-4374-b432-4d168a96a00f"
        response = requests.get(f"{BASE_URL}/api/dispatch/user/{user_id}/active")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "active_dispatch" in data, f"Response should have 'active_dispatch' key, got: {data}"
        print(f"PASS: dispatch/user/{user_id}/active returns correct structure")


class TestDispatchGetEndpoint:
    """Test the dispatch GET endpoint includes selfie_url field"""
    
    def test_dispatch_get_schema_includes_selfie_url(self):
        """Verify dispatch GET endpoint code includes selfie_url in response"""
        # Read the dispatch.py file to verify the selfie_url is in response
        import re
        
        with open('/app/backend/routes/dispatch.py', 'r') as f:
            content = f.read()
        
        # Check that selfie_url is in the GET response
        assert '"selfie_url": dispatch.selfie_url' in content or "'selfie_url': dispatch.selfie_url" in content, \
            "GET /api/dispatch/{id} should return selfie_url field"
        print("PASS: dispatch GET endpoint includes selfie_url in response")
    
    def test_update_selfie_endpoint_exists(self):
        """Verify update-selfie endpoint is properly defined"""
        import re
        
        with open('/app/backend/routes/dispatch.py', 'r') as f:
            content = f.read()
        
        # Check for the endpoint definition
        assert '/{dispatch_id}/update-selfie' in content, \
            "update-selfie endpoint should be defined"
        assert 'class UpdateSelfieRequest' in content, \
            "UpdateSelfieRequest schema should be defined"
        assert 'selfie_url: str' in content, \
            "UpdateSelfieRequest should have selfie_url field"
        print("PASS: update-selfie endpoint is properly defined")


class TestDispatchRequestModel:
    """Test the DispatchRequest model has selfie_url field"""
    
    def test_dispatch_request_model_has_selfie_url_field(self):
        """Verify DispatchRequest model has selfie_url column"""
        with open('/app/backend/models.py', 'r') as f:
            content = f.read()
        
        # Find the DispatchRequest class and check for selfie_url
        assert 'selfie_url = Column(String(500)' in content, \
            "DispatchRequest model should have selfie_url column"
        print("PASS: DispatchRequest model has selfie_url field")


class TestMobileSelfieVisibility:
    """Test mobile selfie sticky footer implementation in UnifiedSpotDrawer"""
    
    def test_unified_spot_drawer_has_mobile_sticky_footer(self):
        """Verify UnifiedSpotDrawer has mobile sticky footer for selfie controls"""
        with open('/app/frontend/src/components/UnifiedSpotDrawer.js', 'r') as f:
            content = f.read()
        
        # Check for pb-24 padding to make room for sticky footer
        assert 'pb-24' in content, \
            "Content should have pb-24 padding for mobile sticky footer"
        
        # Check for mobile sticky footer with md:hidden
        assert 'md:hidden' in content, \
            "Mobile sticky footer should have md:hidden class"
        
        # Check for desktop controls with hidden md:flex
        assert 'hidden md:flex' in content, \
            "Desktop controls should have hidden md:flex class"
        
        print("PASS: UnifiedSpotDrawer has mobile sticky footer implementation")
    
    def test_mobile_selfie_button_has_data_testid(self):
        """Verify mobile selfie capture button has data-testid"""
        with open('/app/frontend/src/components/UnifiedSpotDrawer.js', 'r') as f:
            content = f.read()
        
        # Check for data-testid on mobile capture button
        assert 'data-testid="capture-selfie-btn-mobile"' in content, \
            "Mobile selfie capture button should have data-testid"
        print("PASS: Mobile selfie button has data-testid attribute")


class TestRequestProSelfieModal:
    """Test RequestProSelfieModal component exists and has proper structure"""
    
    def test_request_pro_selfie_modal_exists(self):
        """Verify RequestProSelfieModal component file exists"""
        import os
        modal_path = '/app/frontend/src/components/RequestProSelfieModal.js'
        assert os.path.exists(modal_path), \
            f"RequestProSelfieModal.js should exist at {modal_path}"
        print("PASS: RequestProSelfieModal component exists")
    
    def test_request_pro_selfie_modal_has_surfboard_tip(self):
        """Verify modal has Pro Tip about surfboard"""
        with open('/app/frontend/src/components/RequestProSelfieModal.js', 'r') as f:
            content = f.read()
        
        assert 'surfboard' in content.lower(), \
            "RequestProSelfieModal should mention surfboard for identification"
        assert 'Pro Tip' in content or 'pro tip' in content.lower(), \
            "RequestProSelfieModal should have Pro Tip about holding surfboard"
        print("PASS: RequestProSelfieModal has surfboard Pro Tip")
    
    def test_request_pro_selfie_modal_uses_dispatch_update_selfie(self):
        """Verify modal calls dispatch update-selfie endpoint"""
        with open('/app/frontend/src/components/RequestProSelfieModal.js', 'r') as f:
            content = f.read()
        
        assert 'update-selfie' in content, \
            "RequestProSelfieModal should call dispatch update-selfie endpoint"
        print("PASS: RequestProSelfieModal calls dispatch update-selfie endpoint")


class TestMapPageIntegration:
    """Test MapPage integration with RequestProSelfieModal"""
    
    def test_map_page_imports_request_pro_selfie_modal(self):
        """Verify MapPage imports RequestProSelfieModal"""
        with open('/app/frontend/src/components/MapPage.js', 'r') as f:
            content = f.read()
        
        assert 'RequestProSelfieModal' in content, \
            "MapPage should import RequestProSelfieModal"
        print("PASS: MapPage imports RequestProSelfieModal")
    
    def test_map_page_has_selfie_modal_state(self):
        """Verify MapPage has state for selfie modal"""
        with open('/app/frontend/src/components/MapPage.js', 'r') as f:
            content = f.read()
        
        assert 'showRequestProSelfieModal' in content, \
            "MapPage should have showRequestProSelfieModal state"
        assert 'activeDispatchId' in content, \
            "MapPage should have activeDispatchId state"
        print("PASS: MapPage has selfie modal state variables")
    
    def test_map_page_renders_request_pro_selfie_modal(self):
        """Verify MapPage renders RequestProSelfieModal"""
        with open('/app/frontend/src/components/MapPage.js', 'r') as f:
            content = f.read()
        
        # Check that the modal is rendered with proper props
        assert '<RequestProSelfieModal' in content, \
            "MapPage should render RequestProSelfieModal component"
        assert 'dispatchId=' in content, \
            "RequestProSelfieModal should receive dispatchId prop"
        print("PASS: MapPage renders RequestProSelfieModal with proper props")


class TestSurfSpotsEndpoint:
    """Test surf spots API to verify basic backend functionality"""
    
    def test_surf_spots_returns_data(self):
        """Test /api/surf-spots returns spots with correct structure"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) > 0, "Should have at least one surf spot"
        
        # Check first spot has required fields
        spot = data[0]
        required_fields = ['id', 'name', 'latitude', 'longitude']
        for field in required_fields:
            assert field in spot, f"Spot should have '{field}' field"
        
        print(f"PASS: surf-spots endpoint returns {len(data)} spots with correct structure")


class TestLivePhotographersEndpoint:
    """Test live photographers API"""
    
    def test_live_photographers_endpoint_works(self):
        """Test /api/live-photographers returns list"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: live-photographers endpoint returns {len(data)} photographers")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
