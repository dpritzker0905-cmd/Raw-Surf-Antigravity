"""
CaptureSession Unified Logic
Handles context-based pricing layers and permission checks for the unified session model.

Pricing Modes:
- Mode A (Live Join): Entry Fee + Resolution-based price (Web/Std/High)
- Mode B (On-Demand): Booking Fee + Resolution-based price
- Mode C (Gallery): Standard Resolution-based price

Permissions & Gates:
- Grom Parent: Buyer Only (Can Join/Buy; Cannot Activate/Sell)
- Hobbyist: Buyer + Limited Creator (Can Join/Buy; Can Activate 'Live' ONLY if no Pro in range)
- Photographer/Pro: Full Access (Can Join/Buy; Can Activate Live & On-Demand)
"""

from models import RoleEnum
from typing import Tuple, Optional
import math


# ============ ROLE-BASED PERMISSION DEFINITIONS ============

# Roles that can CREATE sessions (activate live, go on-demand)
CREATOR_ROLES = [
    RoleEnum.HOBBYIST,
    RoleEnum.PHOTOGRAPHER,
    RoleEnum.APPROVED_PRO,
]

# Roles that can ONLY buy/participate (no session creation)
BUYER_ONLY_ROLES = [
    RoleEnum.GROM,
    RoleEnum.SURFER,
    RoleEnum.COMP_SURFER,
    RoleEnum.PRO,  # Pro SURFER (not photographer)
    RoleEnum.GROM_PARENT,
]

# Roles that can use On-Demand (request a photographer)
ON_DEMAND_ELIGIBLE_ROLES = [
    RoleEnum.PHOTOGRAPHER,
    RoleEnum.APPROVED_PRO,
]

# Roles that CANNOT access Live/On-Demand at all (only Gallery and Bookings)
GALLERY_ONLY_ROLES = [
    RoleEnum.GROM_PARENT,  # Parents can buy from gallery, cannot participate in live
]


def can_create_session(role: RoleEnum, session_mode: str = 'live_join') -> Tuple[bool, Optional[str]]:
    """
    Check if a role can create a session.
    
    Args:
        role: The user's role
        session_mode: 'live_join', 'on_demand', or 'scheduled'
    
    Returns:
        Tuple of (allowed: bool, reason: str or None)
    """
    # Grom Parent: NO Live Sessions, NO On-Demand
    if role == RoleEnum.GROM_PARENT:
        return False, "Grom Parents cannot create sessions. Gallery and Bookings access only."
    
    # On-Demand: Only Photographer/Approved Pro
    if session_mode == 'on_demand':
        if role not in ON_DEMAND_ELIGIBLE_ROLES:
            return False, "On-Demand is only available for Photographer and Pro accounts."
    
    # Hobbyist: Limited creator (checked at go-live time for proximity)
    if role == RoleEnum.HOBBYIST:
        if session_mode == 'on_demand':
            return False, "Hobbyists cannot go On-Demand. Live Sessions only (when no Pro nearby)."
    
    # Photographer/Pro: Full access
    if role in [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]:
        return True, None
    
    # Hobbyist with live_join or scheduled is allowed
    # live_join: proximity check happens separately at go-live time
    # scheduled: booking guardrails (price cap, weekly limit) checked at booking creation
    if role == RoleEnum.HOBBYIST and session_mode in ['live_join', 'scheduled']:
        return True, None
    
    return False, f"Role {role.value if hasattr(role, 'value') else role} cannot create sessions."


def can_participate_in_session(role: RoleEnum, session_mode: str = 'live_join') -> Tuple[bool, Optional[str]]:
    """
    Check if a role can participate in (join/buy from) a session.
    
    Grom Parents CAN participate in Live Sessions and buy from Gallery.
    
    Args:
        role: The user's role
        session_mode: 'live_join', 'on_demand', or 'scheduled'
    
    Returns:
        Tuple of (allowed: bool, reason: str or None)
    """
    # All buyer roles can participate
    if role in BUYER_ONLY_ROLES:
        return True, None
    
    # Creator roles can also participate (photographers can buy from other photographers)
    if role in CREATOR_ROLES:
        return True, None
    
    return True, None  # Default allow


def check_hobbyist_proximity(
    latitude: float,
    longitude: float,
    nearby_photographers: list,
    threshold_miles: float = 0.1
) -> Tuple[bool, Optional[str]]:
    """
    Check if a Hobbyist can go live based on proximity to Pro photographers.
    
    Hobbyists can only go live when NO Pro/Photographer is within 0.1 miles.
    
    Args:
        latitude: Hobbyist's latitude
        longitude: Hobbyist's longitude  
        nearby_photographers: List of photographer profiles with on_demand_latitude/longitude
        threshold_miles: Distance threshold in miles (default 0.1 = ~528 feet)
    
    Returns:
        Tuple of (allowed: bool, reason: str or None)
    """
    for pro in nearby_photographers:
        if pro.on_demand_latitude and pro.on_demand_longitude:
            distance = calculate_distance(
                latitude, longitude,
                pro.on_demand_latitude, pro.on_demand_longitude
            )
            if distance <= threshold_miles:
                return False, f"A Pro photographer ({pro.full_name}) is active within {threshold_miles} miles. Hobbyists can only go live when no Pro photographers are nearby."
    
    return True, None


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two coordinates using Haversine formula.
    
    Returns distance in miles.
    """
    R = 3956  # Earth radius in miles
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c


# ============ PRICING ENGINE ============

class PricingMode:
    """Context-based pricing mode constants"""
    LIVE_JOIN = "live_join"      # Mode A: Entry Fee + Resolution price
    ON_DEMAND = "on_demand"      # Mode B: Booking Fee + Resolution price  
    GALLERY = "gallery"          # Mode C: Standard Resolution price


def get_session_pricing(
    photographer,
    session_mode: str,
    resolution: str = 'standard',
    live_session = None
) -> dict:
    """
    Get pricing based on session context and resolution.
    
    Args:
        photographer: Photographer profile with pricing fields
        session_mode: 'live_join', 'on_demand', or 'gallery'
        resolution: 'web', 'standard', or 'high'
        live_session: Optional LiveSession for session-specific pricing override
    
    Returns:
        Dict with pricing info:
        {
            'entry_fee': float,  # Buy-in price (Mode A/B only)
            'photo_price': float,  # Per-photo price
            'photos_included': int,  # Photos included in buy-in
            'resolution': str,
            'session_mode': str
        }
    """
    result = {
        'entry_fee': 0.0,
        'photo_price': 0.0,
        'photos_included': 0,
        'resolution': resolution,
        'session_mode': session_mode
    }
    
    # Resolution-based photo pricing (from photographer or session override)
    if live_session:
        # Use session-specific pricing if available
        price_map = {
            'web': live_session.session_price_web or photographer.photo_price_web or 3.0,
            'standard': live_session.session_price_standard or photographer.photo_price_standard or 5.0,
            'high': live_session.session_price_high or photographer.photo_price_high or 10.0,
        }
    else:
        # Use photographer's default pricing
        price_map = {
            'web': photographer.photo_price_web or 3.0,
            'standard': photographer.photo_price_standard or 5.0,
            'high': photographer.photo_price_high or 10.0,
        }
    
    result['photo_price'] = price_map.get(resolution, price_map['standard'])
    
    # Mode-specific pricing
    if session_mode == PricingMode.LIVE_JOIN:
        # Mode A: Entry Fee + Photos included
        result['entry_fee'] = photographer.live_buyin_price or photographer.session_price or 25.0
        result['photos_included'] = live_session.photos_included if live_session else (photographer.live_session_photos_included or 3)
        
    elif session_mode == PricingMode.ON_DEMAND:
        # Mode B: On-Demand Booking Fee (hourly) + Photos included
        result['entry_fee'] = photographer.on_demand_hourly_rate or 75.0
        result['photos_included'] = photographer.on_demand_photos_included or 3
        
    elif session_mode == PricingMode.GALLERY:
        # Mode C: No entry fee, just per-photo pricing
        result['entry_fee'] = 0.0
        result['photos_included'] = 0
    
    return result


def calculate_photo_cost(
    participant,
    photographer,
    resolution: str = 'standard',
    session_mode: str = 'gallery'
) -> float:
    """
    Calculate the cost for a participant to download a photo.
    
    Dynamic pricing based on session history:
    - If participant paid On-Demand fee with X photos included, first X are $0
    - If participant joined Live Session with Y photos included, first Y are $0
    - After included photos are exhausted, pay per-photo price
    
    Args:
        participant: LiveSessionParticipant record
        photographer: Photographer profile
        resolution: 'web', 'standard', or 'high'
        session_mode: The pricing context
    
    Returns:
        Price for the photo (0.0 if still has credits)
    """
    # Check if participant has remaining photo credits
    if participant and participant.photos_credit_remaining > 0:
        return 0.0  # Free photo from buy-in credits
    
    # Otherwise, charge resolution-based price
    pricing = get_session_pricing(photographer, session_mode, resolution)
    return pricing['photo_price']


def decrement_photo_credit(participant) -> bool:
    """
    Decrement a participant's photo credit after a free download.
    
    Returns True if credit was available and decremented.
    """
    if participant and participant.photos_credit_remaining > 0:
        participant.photos_credit_remaining -= 1
        return True
    return False
