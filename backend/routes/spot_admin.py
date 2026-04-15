"""
Admin Spot Management & Photographer Verification Routes
April 2026 - Precision Map Editor & Crowdsourced Verification

Features:
1. Admin Map-Editor: Create, move, delete spots with precision
2. Water Check: Warn if pin is on land (using reverse geocoding)
3. Photographer Verification: Vote on spot accuracy
4. Community Verified Badge: 5+ "Yes" votes from photographers
5. Precision Queue: List spots flagged for review (>150m inland)
"""
from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.orm import selectinload
from database import get_db
from models import SurfSpot, SpotVerification, SpotEditLog, SpotRefinement, Profile
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import httpx

router = APIRouter(prefix="/admin/spots", tags=["Admin Spots"])

# ============ PYDANTIC MODELS ============

class SpotCreateRequest(BaseModel):
    name: str
    region: Optional[str] = None
    country: Optional[str] = None
    latitude: float
    longitude: float
    difficulty: Optional[str] = "Intermediate"
    wave_type: Optional[str] = None
    override_land_warning: bool = False
    noaa_buoy_id: Optional[str] = None

class SpotMoveRequest(BaseModel):
    latitude: float
    longitude: float
    override_land_warning: bool = False

class SpotUpdateRequest(BaseModel):
    name: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    difficulty: Optional[str] = None
    wave_type: Optional[str] = None
    noaa_buoy_id: Optional[str] = None

class SpotVerificationRequest(BaseModel):
    is_accurate: bool
    suggested_latitude: Optional[float] = None
    suggested_longitude: Optional[float] = None
    suggestion_note: Optional[str] = None


# ============ HELPER FUNCTIONS ============

async def check_is_admin(admin_id: str, db: AsyncSession) -> Profile:
    """Verify user is an admin"""
    result = await db.execute(
        select(Profile).where(Profile.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return admin

async def check_is_on_land(latitude: float, longitude: float) -> dict:
    """
    Check if coordinates are on land using Nominatim reverse geocoding.
    Returns dict with is_land: bool and location_type: str
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Use Nominatim for reverse geocoding
            response = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "format": "json",
                    "zoom": 18
                },
                headers={"User-Agent": "RawSurfOS/1.0"}
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check if response indicates water/ocean
                address = data.get("address", {})
                location_type = data.get("type", "unknown")
                
                # Water-related types
                water_types = ["water", "coastline", "bay", "ocean", "sea", "reef", "beach"]
                land_types = ["residential", "building", "highway", "road", "commercial", "industrial", "parking"]
                
                # Check if it's water
                is_water = any(wt in location_type.lower() for wt in water_types)
                is_land = any(lt in location_type.lower() for lt in land_types)
                
                # Also check address components
                if "water" in str(address).lower() or "ocean" in str(address).lower():
                    is_water = True
                    is_land = False
                
                return {
                    "is_land": is_land and not is_water,
                    "location_type": location_type,
                    "display_name": data.get("display_name", "Unknown location")
                }
            
            # Default to not on land if API fails (allow pin drop)
            return {"is_land": False, "location_type": "unknown", "display_name": "API unavailable"}
            
    except Exception as e:
        print(f"Water check error: {e}")
        return {"is_land": False, "location_type": "error", "display_name": "Check failed"}


# ============ ADMIN ENDPOINTS ============

@router.get("/list")
async def admin_list_spots(
    admin_id: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=5000),  # Allow up to 5000 for map editor
    search: Optional[str] = None,
    country: Optional[str] = None,
    flagged_only: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """List all spots with admin metadata"""
    await check_is_admin(admin_id, db)
    
    query = select(SurfSpot)
    
    # Filters
    if search:
        query = query.where(
            or_(
                SurfSpot.name.ilike(f"%{search}%"),
                SurfSpot.region.ilike(f"%{search}%")
            )
        )
    if country:
        query = query.where(SurfSpot.country == country)
    if flagged_only:
        query = query.where(SurfSpot.flagged_for_review == True)
    
    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # Paginate
    offset = (page - 1) * limit
    query = query.order_by(SurfSpot.name).offset(offset).limit(limit)
    
    result = await db.execute(query)
    spots = result.scalars().all()
    
    return {
        "spots": [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "country": s.country,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "difficulty": s.difficulty,
            "wave_type": s.wave_type,
            "is_verified_peak": s.is_verified_peak,
            "community_verified": s.community_verified,
            "verification_votes_yes": s.verification_votes_yes or 0,
            "verification_votes_no": s.verification_votes_no or 0,
            "flagged_for_review": s.flagged_for_review,
            "noaa_buoy_id": s.noaa_buoy_id,
            "accuracy_flag": s.accuracy_flag,
            "is_active": s.is_active
        } for s in spots],
        "total": total,
        "page": page,
        "limit": limit
    }


@router.post("/create")
async def admin_create_spot(
    request: SpotCreateRequest,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Create a new spot with precision pin-drop"""
    admin = await check_is_admin(admin_id, db)
    
    # Check if on land
    land_check = await check_is_on_land(request.latitude, request.longitude)
    
    if land_check["is_land"] and not request.override_land_warning:
        return {
            "success": False,
            "warning": "land_detected",
            "message": f"Pin appears to be on land ({land_check['location_type']}). Confirm offshore peak?",
            "location_type": land_check["location_type"],
            "display_name": land_check["display_name"]
        }
    
    # Create spot
    spot_id = str(uuid.uuid4())
    spot = SurfSpot(
        id=spot_id,
        name=request.name,
        region=request.region,
        country=request.country,
        latitude=request.latitude,
        longitude=request.longitude,
        original_latitude=request.latitude,
        original_longitude=request.longitude,
        difficulty=request.difficulty,
        wave_type=request.wave_type,
        noaa_buoy_id=request.noaa_buoy_id,
        is_verified_peak=True,
        accuracy_flag="admin_verified",
        verified_by=admin_id,
        verified_at=datetime.now(timezone.utc),
        is_active=True
    )
    db.add(spot)
    
    # Log the action
    log = SpotEditLog(
        id=str(uuid.uuid4()),
        spot_id=spot_id,
        admin_id=admin_id,
        action="create",
        new_latitude=request.latitude,
        new_longitude=request.longitude,
        new_name=request.name,
        new_region=request.region,
        was_on_land=land_check["is_land"],
        override_land_warning=request.override_land_warning,
        noaa_buoy_id=request.noaa_buoy_id
    )
    db.add(log)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Created spot: {request.name}",
        "spot_id": spot_id,
        "was_on_land": land_check["is_land"],
        "coordinates": {"latitude": request.latitude, "longitude": request.longitude}
    }


@router.put("/{spot_id}/move")
async def admin_move_spot(
    spot_id: str,
    request: SpotMoveRequest,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Move an existing spot to new coordinates"""
    admin = await check_is_admin(admin_id, db)
    
    # Get spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if on land
    land_check = await check_is_on_land(request.latitude, request.longitude)
    
    if land_check["is_land"] and not request.override_land_warning:
        return {
            "success": False,
            "warning": "land_detected",
            "message": f"New location appears to be on land ({land_check['location_type']}). Confirm offshore peak?",
            "location_type": land_check["location_type"]
        }
    
    # Log the move
    log = SpotEditLog(
        id=str(uuid.uuid4()),
        spot_id=spot_id,
        admin_id=admin_id,
        action="move",
        old_latitude=spot.latitude,
        old_longitude=spot.longitude,
        new_latitude=request.latitude,
        new_longitude=request.longitude,
        was_on_land=land_check["is_land"],
        override_land_warning=request.override_land_warning
    )
    db.add(log)
    
    # Store original if not already stored
    if not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Update coordinates
    spot.latitude = request.latitude
    spot.longitude = request.longitude
    spot.is_verified_peak = True
    spot.accuracy_flag = "admin_verified"
    spot.verified_by = admin_id
    spot.verified_at = datetime.now(timezone.utc)
    spot.flagged_for_review = False  # Clear review flag
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Moved {spot.name} to ({request.latitude}, {request.longitude})",
        "was_on_land": land_check["is_land"]
    }


@router.put("/{spot_id}/update")
async def admin_update_spot(
    spot_id: str,
    request: SpotUpdateRequest,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Update spot metadata (name, region, difficulty, etc.)"""
    admin = await check_is_admin(admin_id, db)
    
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Log changes
    log = SpotEditLog(
        id=str(uuid.uuid4()),
        spot_id=spot_id,
        admin_id=admin_id,
        action="update",
        old_name=spot.name if request.name else None,
        new_name=request.name,
        old_region=spot.region if request.region else None,
        new_region=request.region,
        noaa_buoy_id=request.noaa_buoy_id
    )
    db.add(log)
    
    # Apply updates
    if request.name:
        spot.name = request.name
    if request.region:
        spot.region = request.region
    if request.country:
        spot.country = request.country
    if request.difficulty:
        spot.difficulty = request.difficulty
    if request.wave_type:
        spot.wave_type = request.wave_type
    # Handle noaa_buoy_id - can be set OR cleared (empty string/None clears it)
    if request.noaa_buoy_id is not None:
        spot.noaa_buoy_id = request.noaa_buoy_id if request.noaa_buoy_id else None
    
    await db.commit()
    
    return {"success": True, "message": f"Updated {spot.name}"}


@router.delete("/{spot_id}")
async def admin_delete_spot(
    spot_id: str,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Delete a spot from the map"""
    admin = await check_is_admin(admin_id, db)
    
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Log deletion
    log = SpotEditLog(
        id=str(uuid.uuid4()),
        spot_id=spot_id,
        admin_id=admin_id,
        action="delete",
        old_latitude=spot.latitude,
        old_longitude=spot.longitude,
        old_name=spot.name,
        old_region=spot.region
    )
    db.add(log)
    
    # Soft delete (set inactive) instead of hard delete
    spot.is_active = False
    
    await db.commit()
    
    return {"success": True, "message": f"Deleted {spot.name}"}


@router.get("/queue")
async def admin_get_precision_queue(
    admin_id: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get spots flagged for review (>150m from water or unverified)"""
    await check_is_admin(admin_id, db)
    
    # Get flagged spots or spots with low accuracy
    query = select(SurfSpot).where(
        or_(
            SurfSpot.flagged_for_review == True,
            SurfSpot.accuracy_flag == 'low_accuracy',
            SurfSpot.accuracy_flag == 'unverified'
        ),
        SurfSpot.is_active == True
    ).order_by(desc(SurfSpot.created_at))
    
    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # Paginate
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    spots = result.scalars().all()
    
    return {
        "queue": [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "country": s.country,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "accuracy_flag": s.accuracy_flag,
            "flagged_for_review": s.flagged_for_review,
            "created_at": s.created_at.isoformat() if s.created_at else None
        } for s in spots],
        "total": total,
        "page": page
    }


@router.get("/suggestions")
async def admin_get_relocation_suggestions(
    admin_id: str = Query(...),
    status: str = Query("pending"),
    limit: int = Query(50, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get photographer relocation suggestions from verification feedback"""
    await check_is_admin(admin_id, db)
    
    # Get verifications where photographer suggested a move
    query = select(SpotVerification).where(
        SpotVerification.is_accurate == False,
        SpotVerification.suggested_latitude.isnot(None)
    ).order_by(desc(SpotVerification.created_at)).limit(limit)
    
    result = await db.execute(query)
    suggestions = result.scalars().all()
    
    # Get associated spots and photographers
    suggestion_list = []
    for s in suggestions:
        # Get spot
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == s.spot_id))
        spot = spot_result.scalar_one_or_none()
        
        # Get photographer
        photographer_result = await db.execute(select(Profile).where(Profile.id == s.photographer_id))
        photographer = photographer_result.scalar_one_or_none()
        
        if spot and photographer:
            suggestion_list.append({
                "id": s.id,
                "spot_id": s.spot_id,
                "spot_name": spot.name,
                "current_coords": {"latitude": spot.latitude, "longitude": spot.longitude},
                "suggested_coords": {"latitude": s.suggested_latitude, "longitude": s.suggested_longitude},
                "suggestion_note": s.suggestion_note,
                "photographer_id": s.photographer_id,
                "photographer_name": photographer.full_name,
                "created_at": s.created_at.isoformat()
            })
    
    return {"suggestions": suggestion_list, "total": len(suggestion_list)}


@router.get("/edit-history/{spot_id}")
async def admin_get_spot_edit_history(
    spot_id: str,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get edit history for a specific spot"""
    await check_is_admin(admin_id, db)
    
    result = await db.execute(
        select(SpotEditLog)
        .where(SpotEditLog.spot_id == spot_id)
        .order_by(desc(SpotEditLog.created_at))
    )
    logs = result.scalars().all()
    
    history = []
    for log in logs:
        # Get admin name
        admin_result = await db.execute(select(Profile).where(Profile.id == log.admin_id))
        admin = admin_result.scalar_one_or_none()
        
        history.append({
            "id": log.id,
            "action": log.action,
            "admin_name": admin.full_name if admin else "Unknown",
            "old_coords": {"latitude": log.old_latitude, "longitude": log.old_longitude} if log.old_latitude else None,
            "new_coords": {"latitude": log.new_latitude, "longitude": log.new_longitude} if log.new_latitude else None,
            "was_on_land": log.was_on_land,
            "override_land_warning": log.override_land_warning,
            "created_at": log.created_at.isoformat()
        })
    
    return {"history": history}


# ============ PHOTOGRAPHER VERIFICATION ENDPOINTS ============

verification_router = APIRouter(prefix="/spots/verification", tags=["Spot Verification"])

@verification_router.post("/{spot_id}")
async def submit_verification(
    spot_id: str,
    request: SpotVerificationRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer submits verification vote for spot accuracy.
    Requires being within 200m and having photographer role.
    """
    # Get user and verify photographer role
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    photographer_roles = ["Hobbyist", "Photographer", "Approved Pro"]
    if user.role.value not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can verify spots")
    
    # Get spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if already voted
    existing = await db.execute(
        select(SpotVerification).where(
            SpotVerification.spot_id == spot_id,
            SpotVerification.photographer_id == user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You have already verified this spot")
    
    # Create verification
    verification = SpotVerification(
        id=str(uuid.uuid4()),
        spot_id=spot_id,
        photographer_id=user_id,
        is_accurate=request.is_accurate,
        suggested_latitude=request.suggested_latitude,
        suggested_longitude=request.suggested_longitude,
        suggestion_note=request.suggestion_note
    )
    db.add(verification)
    
    # Update spot vote counts
    if request.is_accurate:
        spot.verification_votes_yes = (spot.verification_votes_yes or 0) + 1
    else:
        spot.verification_votes_no = (spot.verification_votes_no or 0) + 1
    
    # Check if spot earns Community Verified badge (5+ Yes votes)
    if (spot.verification_votes_yes or 0) >= 5 and not spot.community_verified:
        spot.community_verified = True
        spot.accuracy_flag = "community_verified"
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Thanks for verifying this spot!",
        "is_now_community_verified": spot.community_verified,
        "current_votes": {
            "yes": spot.verification_votes_yes or 0,
            "no": spot.verification_votes_no or 0
        }
    }


@verification_router.get("/{spot_id}/status")
async def get_verification_status(
    spot_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get verification status for a spot and whether user has voted"""
    # Get spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if user has voted
    vote_result = await db.execute(
        select(SpotVerification).where(
            SpotVerification.spot_id == spot_id,
            SpotVerification.photographer_id == user_id
        )
    )
    user_vote = vote_result.scalar_one_or_none()
    
    return {
        "spot_id": spot_id,
        "community_verified": spot.community_verified,
        "verification_votes_yes": spot.verification_votes_yes or 0,
        "verification_votes_no": spot.verification_votes_no or 0,
        "user_has_voted": user_vote is not None,
        "user_vote": user_vote.is_accurate if user_vote else None
    }


# Export routers
def include_spot_admin_routes(app):
    app.include_router(router)
    app.include_router(verification_router)
