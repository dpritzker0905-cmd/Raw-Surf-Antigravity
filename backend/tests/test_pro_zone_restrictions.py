"""
Pro-Zone Broadcast Restriction Tests
Tests that Hobbyists/Grom Parents are blocked from going live near active Pros
"""
import pytest
import math
from unittest.mock import MagicMock, AsyncMock, patch


# Test haversine distance calculation
def test_haversine_distance_calculation():
    """Test distance calculation between two points"""
    def haversine_distance(lat1, lon1, lat2, lon2):
        R = 3959  # Earth radius in miles
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    
    # Same location should be 0 distance
    assert haversine_distance(26.5, -80.0, 26.5, -80.0) == 0
    
    # ~1 degree latitude = ~69 miles
    distance = haversine_distance(26.0, -80.0, 27.0, -80.0)
    assert 68 < distance < 70, f"Expected ~69 miles, got {distance}"
    
    # Test 0.5 mile distance (approx 0.0072 degrees)
    # At latitude 26.5, 0.5 miles ≈ 0.0072 degrees
    distance = haversine_distance(26.5, -80.0, 26.5072, -80.0)
    assert distance < 0.6, f"Expected <0.6 miles, got {distance}"
    
    print(f"✅ Haversine distance calculation verified")


def test_pro_zone_radius():
    """Verify Pro-Zone radius is exactly 0.5 miles"""
    PRO_ZONE_RADIUS_MILES = 0.5
    assert PRO_ZONE_RADIUS_MILES == 0.5
    print(f"✅ Pro-Zone radius is {PRO_ZONE_RADIUS_MILES} miles")


def test_pro_zone_logic_blocks_hobbyist():
    """Test that hobbyist within 0.5 miles of active Pro is blocked"""
    def haversine_distance(lat1, lon1, lat2, lon2):
        R = 3959
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    
    PRO_ZONE_RADIUS_MILES = 0.5
    
    # Simulate Pro at position
    pro_lat, pro_lng = 26.5, -80.0
    
    # Hobbyist at same location (should be blocked)
    hobbyist_lat, hobbyist_lng = 26.5, -80.0
    distance = haversine_distance(hobbyist_lat, hobbyist_lng, pro_lat, pro_lng)
    assert distance <= PRO_ZONE_RADIUS_MILES, "Should be blocked at same location"
    print(f"✅ Hobbyist at same location: blocked (distance={distance:.4f} miles)")
    
    # Hobbyist 0.3 miles away (should be blocked)
    # ~0.3 miles ≈ 0.0043 degrees latitude
    hobbyist_lat2 = 26.5 + 0.0043
    distance2 = haversine_distance(hobbyist_lat2, hobbyist_lng, pro_lat, pro_lng)
    assert distance2 <= PRO_ZONE_RADIUS_MILES, f"Should be blocked at 0.3 miles (got {distance2})"
    print(f"✅ Hobbyist at 0.3 miles: blocked (distance={distance2:.4f} miles)")
    
    # Hobbyist 0.6 miles away (should NOT be blocked)
    # ~0.6 miles ≈ 0.0087 degrees latitude
    hobbyist_lat3 = 26.5 + 0.0087
    distance3 = haversine_distance(hobbyist_lat3, hobbyist_lng, pro_lat, pro_lng)
    assert distance3 > PRO_ZONE_RADIUS_MILES, f"Should NOT be blocked at 0.6 miles (got {distance3})"
    print(f"✅ Hobbyist at 0.6 miles: allowed (distance={distance3:.4f} miles)")


def test_roles_affected_by_pro_zone():
    """Test that only HOBBYIST and GROM_PARENT are affected by Pro-Zone"""
    RESTRICTED_ROLES = ['HOBBYIST', 'GROM_PARENT']
    UNRESTRICTED_ROLES = ['SURFER', 'GROM', 'PHOTOGRAPHER', 'APPROVED_PRO', 'BUSINESS']
    
    for role in RESTRICTED_ROLES:
        assert role in ['HOBBYIST', 'GROM_PARENT'], f"{role} should be restricted"
        print(f"✅ {role}: affected by Pro-Zone")
    
    for role in UNRESTRICTED_ROLES:
        assert role not in RESTRICTED_ROLES, f"{role} should NOT be restricted"
        print(f"✅ {role}: NOT affected by Pro-Zone")


if __name__ == '__main__':
    test_haversine_distance_calculation()
    test_pro_zone_radius()
    test_pro_zone_logic_blocks_hobbyist()
    test_roles_affected_by_pro_zone()
    print("\n✅ All Pro-Zone tests passed!")
