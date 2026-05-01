"""
Dispatch schemas and shared helpers.

Part of the dispatch package -- extracted from dispatch.py monolith.
Contains Pydantic request/response models and shared helper functions.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from utils.geo import haversine_distance

from models import Profile, RoleEnum, Surfboard


logger = logging.getLogger("routes.dispatch")


# ===================== PYDANTIC SCHEMAS =====================

class CreateDispatchRequest(BaseModel):
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    spot_id: Optional[str] = None
    estimated_duration_hours: float = 1.0
    is_immediate: bool = True
    requested_start_time: Optional[datetime] = None
    arrival_window_minutes: int = 30  # 30, 60, or 90 minutes from request
    is_shared: bool = False
    friend_ids: Optional[List[str]] = None  # For split requests
    target_photographer_id: Optional[str] = None  # For Quick Book - request specific photographer
    captain_share_amount: Optional[float] = None  # Captain's portion (can be 0 if crew pays 100%)
    crew_shares: Optional[List[dict]] = None  # [{user_id, share_amount, covered_by_captain}]


class AcceptDispatchRequest(BaseModel):
    photographer_id: str


class UpdateGPSLocation(BaseModel):
    latitude: float
    longitude: float


class CancelDispatchRequest(BaseModel):
    reason: Optional[str] = None


class UpdateSessionLocationRequest(BaseModel):
    """Update the session meeting point (before location is locked)"""
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    spot_id: Optional[str] = None


class UpdateSelfieRequest(BaseModel):
    selfie_url: str


class BoostRequestCreate(BaseModel):
    """Boost a dispatch request for priority in the queue"""
    boost_hours: int = 1  # 1, 2, or 4 hours
    
    @property
    def cost(self) -> int:
        """Tiered pricing: 5/10/20 credits for 1/2/4 hours"""
        pricing = {1: 5, 2: 10, 4: 20}
        return pricing.get(self.boost_hours, 5)


class DispatchCheckoutRequest(BaseModel):
    """Request for creating a Stripe checkout session for on-demand dispatch"""
    dispatch_id: str
    payer_id: str
    amount: float  # Amount to charge (captain's share)
    origin_url: str


class ExceptionRequestBody(BaseModel):
    reason: str
    requested_by_id: str


class ExceptionResolveBody(BaseModel):
    resolved_by_id: str
    action: str  # 'approve', 'deny'
    note: Optional[str] = None


class CrewPaymentRequest(BaseModel):
    payer_id: str
    selfie_url: Optional[str] = None


class CrewCheckoutRequest(BaseModel):
    selfie_url: Optional[str] = None
    origin_url: str = "https://dev--rawsurf.netlify.app"


class CoverRemainingRequest(BaseModel):
    captain_id: str


class RemindCrewRequest(BaseModel):
    captain_id: str
    member_id: str


# ===================== HELPER FUNCTIONS =====================


async def _get_surfer_board_description(db: AsyncSession, user_id: str) -> Optional[str]:
    """Build a human-readable board description from the surfer's primary surfboard."""
    try:
        board_result = await db.execute(
            select(Surfboard)
            .where(Surfboard.user_id == user_id)
            .order_by(Surfboard.created_at.desc())
            .limit(1)
        )
        board = board_result.scalar_one_or_none()
        if not board:
            return None
        parts = []
        if board.length_feet:
            inches = f'"{board.length_inches}' if board.length_inches else ''
            parts.append(f"{board.length_feet}'{inches}")
        if board.brand:
            parts.append(board.brand)
        if board.model:
            parts.append(board.model)
        elif board.board_type:
            parts.append(board.board_type)
        if board.description and not parts:
            return board.description[:80]
        return ' '.join(parts) if parts else (board.name or None)
    except Exception:
        return None


async def get_available_pros(
    db: AsyncSession, 
    latitude: float, 
    longitude: float, 
    radius_miles: float,
    stage: int = 1
) -> List[Profile]:
    """
    Get available Pro photographers within radius
    Priority ordering: Top-Level Pros > Streak Holders > Nearest
    """
    # Stage 1: Only Approved Pros
    # Stage 2: All Pros (Pro + Approved Pro)
    
    if stage == 1:
        role_filter = Profile.role == RoleEnum.APPROVED_PRO
    else:
        role_filter = or_(Profile.role == RoleEnum.PRO, Profile.role == RoleEnum.APPROVED_PRO)
    
    result = await db.execute(
        select(Profile)
        .where(
            role_filter,
            or_(
                Profile.is_available_on_demand == True,
                Profile.on_demand_available == True  # New On-Demand GPS toggle
            ),
            Profile.is_shooting == False,  # Not currently shooting
            Profile.is_suspended == False
        )
    )
    
    photographers = result.scalars().all()
    
    # Filter by distance and calculate priority scores
    in_range = []
    for p in photographers:
        # Use On-Demand GPS location if available, else home location
        p_lat = p.on_demand_latitude or getattr(p, 'latitude', None)
        p_lng = p.on_demand_longitude or getattr(p, 'longitude', None)
        
        # If no location data, skip
        if p_lat is None or p_lng is None:
            continue
            
        distance = haversine_distance(latitude, longitude, p_lat, p_lng)
        if distance <= radius_miles:
            # Calculate priority score for sorting
            # Higher score = higher priority
            priority_score = 0
            
            # Priority 1: Top-Level Pros (Approved Pro) get +1000 points
            if p.role == RoleEnum.APPROVED_PRO:
                priority_score += 1000
            
            # Priority 2: Streak Holders get +100 * streak
            streak = p.on_demand_streak or 0
            if streak >= 3:  # Hot streak
                priority_score += 500 + (streak * 10)  # Hot streak bonus
            elif streak > 0:
                priority_score += streak * 20
            
            # Priority 3: Nearest (invert distance so closer = higher score)
            # Max distance points = 100 (for 0 distance), min = 0 (for radius)
            distance_score = max(0, 100 - (distance / radius_miles * 100))
            priority_score += distance_score
            
            # Store for sorting
            p._distance = distance
            p._priority_score = priority_score
            p._streak = streak
            p._is_hot_streak = streak >= 3
            in_range.append(p)
    
    # Sort by priority score (highest first), then by distance (nearest first) as tiebreaker
    in_range.sort(key=lambda x: (-x._priority_score, x._distance))
    
    return in_range
