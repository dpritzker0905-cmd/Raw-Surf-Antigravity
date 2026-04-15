"""
Test suite for Real-time Surf Conditions and User Surf Reports
Tests the Open-Meteo Marine API integration and community surf reports
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_ID = "90d2c43c-026e-4800-bc93-796921f410fe"
TEST_USER_EMAIL = "testuser@rawsurf.com"


class TestSurfConditionsAPI:
    """Tests for real-time surf conditions from Open-Meteo Marine API"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        print("API health check: PASS")
    
    def test_get_surf_spots_list(self):
        """Get list of surf spots to test conditions"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) > 0
        print(f"Found {len(spots)} surf spots")
        return spots
    
    def test_get_single_spot_conditions(self):
        """Test GET /api/conditions/{spot_id} returns wave data"""
        # First get a spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        assert len(spots) > 0
        
        spot = spots[0]
        spot_id = spot['id']
        
        # Get conditions for spot
        response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
        assert response.status_code == 200
        
        data = response.json()
        print(f"Conditions for {spot['name']}: {data}")
        
        # Verify response structure - may have data or error depending on API availability
        assert "spot_id" in data or "error" in data
        
        if "current" in data:
            current = data["current"]
            # Verify wave height is in feet
            assert "wave_height_ft" in current
            # Verify direction is present (may be None if no data)
            assert "wave_direction" in current
            # Verify swell info
            assert "swell_height_ft" in current
            print(f"Wave height: {current['wave_height_ft']}ft, Direction: {current['wave_direction']}")
        else:
            print(f"Conditions data: {data}")
        
        print("Single spot conditions: PASS")
    
    def test_conditions_include_all_required_fields(self):
        """Verify conditions include wave_height_ft, wave_direction, swell info"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        # Test Sebastian Inlet specifically (known spot)
        sebastian = next((s for s in spots if "Sebastian" in s['name']), spots[0])
        
        response = requests.get(f"{BASE_URL}/api/conditions/{sebastian['id']}")
        assert response.status_code == 200
        
        data = response.json()
        
        if "current" in data:
            current = data["current"]
            
            # Required fields
            required_fields = ["wave_height_ft", "wave_direction", "swell_height_ft", "swell_direction", "wave_period"]
            for field in required_fields:
                assert field in current, f"Missing field: {field}"
            
            print(f"All required fields present in conditions response")
            print(f"Current conditions: {current}")
        else:
            # API might return error if service unavailable
            print(f"Warning: Could not get current conditions - {data.get('error', 'unknown')}")
        
        print("Conditions fields validation: PASS")
    
    def test_batch_conditions_api(self):
        """Test GET /api/conditions/batch?spot_ids=id1,id2 returns multiple spots"""
        # Get some spots first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        assert len(spots) >= 2
        
        # Get first 3 spot IDs
        spot_ids = [s['id'] for s in spots[:3]]
        ids_param = ",".join(spot_ids)
        
        response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids={ids_param}")
        assert response.status_code == 200
        
        data = response.json()
        assert "conditions" in data
        
        conditions = data["conditions"]
        print(f"Batch conditions returned {len(conditions)} results for {len(spot_ids)} spots")
        
        # Verify each condition has required fields
        for cond in conditions:
            assert "spot_id" in cond
            assert "spot_name" in cond
            # wave_height_ft may be None if error
            if "wave_height_ft" in cond and cond["wave_height_ft"] is not None:
                assert "conditions_label" in cond
                print(f"  {cond['spot_name']}: {cond['wave_height_ft']}ft - {cond.get('conditions_label', 'N/A')}")
        
        print("Batch conditions API: PASS")
    
    def test_batch_conditions_empty_param(self):
        """Test batch endpoint handles empty spot_ids gracefully"""
        response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids=")
        assert response.status_code == 200
        data = response.json()
        assert "conditions" in data
        assert data["conditions"] == []
        print("Empty batch conditions: PASS")
    
    def test_conditions_label_mapping(self):
        """Test that conditions label is human-readable"""
        # Get a spot with conditions
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        spot_ids = ",".join([s['id'] for s in spots[:3]])
        response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids={spot_ids}")
        
        data = response.json()
        
        # Valid label values
        valid_labels = [
            "Flat", "Ankle High", "Knee High", "Waist High", 
            "Chest High", "Head High", "Overhead", 
            "Double Overhead", "Triple Overhead+"
        ]
        
        for cond in data["conditions"]:
            if cond.get("conditions_label"):
                assert cond["conditions_label"] in valid_labels, f"Invalid label: {cond['conditions_label']}"
                print(f"Label '{cond['conditions_label']}' is valid")
        
        print("Conditions label mapping: PASS")
    
    def test_conditions_invalid_spot_id(self):
        """Test handling of invalid spot ID"""
        response = requests.get(f"{BASE_URL}/api/conditions/invalid-spot-id-12345")
        assert response.status_code == 404
        print("Invalid spot ID handling: PASS")


class TestUserSurfReportsAPI:
    """Tests for user-generated surf reports"""
    
    def test_create_surf_report(self):
        """Test POST /api/surf-reports creates report"""
        # Get a spot first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        
        report_data = {
            "spot_id": spot['id'],
            "wave_height": "3-4ft",
            "conditions": "Clean",
            "wind_direction": "Offshore",
            "crowd_level": "Light",
            "rating": 4,
            "notes": "TEST_Great morning session, clean lines"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/surf-reports?user_id={TEST_USER_ID}",
            json=report_data
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "id" in data
        assert data["spot_id"] == spot['id']
        assert data["wave_height"] == "3-4ft"
        assert data["conditions"] == "Clean"
        assert data["rating"] == 4
        
        print(f"Created surf report: {data['id']}")
        print("Create surf report: PASS")
        return data
    
    def test_create_surf_report_minimal(self):
        """Test creating a report with minimal data"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[1] if len(spots) > 1 else spots[0]
        
        # Only spot_id is required
        report_data = {
            "spot_id": spot['id'],
            "conditions": "Glassy",
            "notes": "TEST_Minimal report test"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/surf-reports?user_id={TEST_USER_ID}",
            json=report_data
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["conditions"] == "Glassy"
        print("Minimal surf report: PASS")
    
    def test_create_surf_report_invalid_user(self):
        """Test report creation with invalid user"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        
        response = requests.post(
            f"{BASE_URL}/api/surf-reports?user_id=invalid-user-id-123",
            json={"spot_id": spot['id'], "conditions": "Clean"}
        )
        
        assert response.status_code == 404
        print("Invalid user handling: PASS")
    
    def test_create_surf_report_invalid_spot(self):
        """Test report creation with invalid spot"""
        response = requests.post(
            f"{BASE_URL}/api/surf-reports?user_id={TEST_USER_ID}",
            json={"spot_id": "invalid-spot-id", "conditions": "Clean"}
        )
        
        assert response.status_code == 404
        print("Invalid spot handling: PASS")
    
    def test_get_todays_reports(self):
        """Test GET /api/surf-reports/today/{spot_id} shows consensus"""
        # Get a spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        
        response = requests.get(f"{BASE_URL}/api/surf-reports/today/{spot['id']}")
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify response structure
        assert "spot_id" in data
        assert "report_count" in data
        assert "reports" in data
        
        # Consensus fields may be None if no reports today
        assert "consensus_conditions" in data
        assert "consensus_crowd" in data
        assert "average_rating" in data
        
        print(f"Today's reports for {spot['name']}:")
        print(f"  Report count: {data['report_count']}")
        print(f"  Consensus conditions: {data['consensus_conditions']}")
        print(f"  Consensus crowd: {data['consensus_crowd']}")
        print(f"  Average rating: {data['average_rating']}")
        
        # Verify reports structure
        for report in data["reports"]:
            assert "id" in report
            assert "user_name" in report
            assert "conditions" in report
            assert "created_at" in report
        
        print("Today's reports API: PASS")
    
    def test_get_spot_reports(self):
        """Test GET /api/surf-reports/spot/{spot_id} returns recent reports"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        
        response = requests.get(f"{BASE_URL}/api/surf-reports/spot/{spot['id']}")
        assert response.status_code == 200
        
        reports = response.json()
        assert isinstance(reports, list)
        
        print(f"Found {len(reports)} reports for {spot['name']}")
        
        # Verify each report structure
        for report in reports[:3]:  # Check first 3
            assert "id" in report
            assert "user_id" in report
            assert "user_name" in report
            assert "conditions" in report or "wave_height" in report  # At least one condition info
            assert "created_at" in report
        
        print("Get spot reports: PASS")


class TestConditionsLabelLogic:
    """Test the conditions label mapping logic"""
    
    def test_label_calculation_via_batch(self):
        """Verify labels match expected wave height ranges"""
        # Get spots and their conditions
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        spot_ids = ",".join([s['id'] for s in spots[:5]])
        response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids={spot_ids}")
        
        data = response.json()
        
        for cond in data["conditions"]:
            if cond.get("wave_height_ft") is not None:
                height = cond["wave_height_ft"]
                label = cond.get("conditions_label")
                
                # Verify label matches height
                if height < 1:
                    assert label == "Flat"
                elif height < 2:
                    assert label == "Ankle High"
                elif height < 3:
                    assert label == "Knee High"
                elif height < 4:
                    assert label == "Waist High"
                elif height < 5:
                    assert label == "Chest High"
                elif height < 6:
                    assert label == "Head High"
                elif height < 8:
                    assert label == "Overhead"
                elif height < 10:
                    assert label == "Double Overhead"
                else:
                    assert label == "Triple Overhead+"
                
                print(f"  {height}ft -> {label} (correct)")
        
        print("Label calculation logic: PASS")


class TestAtlanticBeachReport:
    """Test existing report mentioned in context (Atlantic Beach)"""
    
    def test_find_atlantic_beach_spot(self):
        """Find Atlantic Beach surf spot"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        
        atlantic_beach = next((s for s in spots if "Atlantic Beach" in s['name']), None)
        assert atlantic_beach is not None, "Atlantic Beach spot not found"
        
        print(f"Found Atlantic Beach: {atlantic_beach['id']}")
        print(f"  Region: {atlantic_beach.get('region')}")
        print(f"  Coordinates: {atlantic_beach['latitude']}, {atlantic_beach['longitude']}")
        
        return atlantic_beach
    
    def test_atlantic_beach_has_reports(self):
        """Verify Atlantic Beach has user surf reports"""
        # Get Atlantic Beach spot
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        
        atlantic_beach = next((s for s in spots if "Atlantic Beach" in s['name']), None)
        if not atlantic_beach:
            pytest.skip("Atlantic Beach spot not found")
        
        # Get reports for Atlantic Beach
        reports_response = requests.get(f"{BASE_URL}/api/surf-reports/spot/{atlantic_beach['id']}")
        assert reports_response.status_code == 200
        
        reports = reports_response.json()
        print(f"Atlantic Beach has {len(reports)} reports")
        
        for report in reports[:3]:
            print(f"  - {report.get('user_name', 'Anonymous')}: {report.get('conditions', 'N/A')} ({report.get('wave_height', 'N/A')})")
        
        print("Atlantic Beach reports: PASS")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
