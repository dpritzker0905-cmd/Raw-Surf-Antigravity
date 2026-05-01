"""
Spot location refinement — crowdsourced photographer refinement queue and admin tools.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot, RoleEnum, SpotRefinement
from utils.geo import haversine_distance
from .schemas import calculate_seaward_offset

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/spots/{spot_id}/refine-location")
async def refine_spot_location(
    spot_id: str,
    photographer_id: str,
    new_latitude: float,
    new_longitude: float,
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer submits a location refinement for a spot.
    If 3+ verified photographers agree, queues for admin approval.
    """
    # Verify photographer exists and is a valid role
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if photographer.role not in [RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO, RoleEnum.ADMIN]:
        raise HTTPException(status_code=403, detail="Only photographers can refine spot locations")
    
    # Verify spot exists
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if this photographer already refined this spot
    existing = await db.execute(
        select(SpotRefinement).where(
            SpotRefinement.spot_id == spot_id,
            SpotRefinement.photographer_id == photographer_id,
            SpotRefinement.status == 'pending'
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a pending refinement for this spot")
    
    # Create refinement
    refinement = SpotRefinement(
        spot_id=spot_id,
        photographer_id=photographer_id,
        proposed_latitude=new_latitude,
        proposed_longitude=new_longitude,
        status='pending'
    )
    db.add(refinement)
    
    # Update spot refinement count
    spot.refinement_count = (spot.refinement_count or 0) + 1
    spot.last_refined_at = datetime.now(timezone.utc)
    
    # Check if 3+ photographers have proposed similar coordinates (within 50m)
    similar_refinements = await db.execute(
        select(SpotRefinement).where(
            SpotRefinement.spot_id == spot_id,
            SpotRefinement.status == 'pending'
        )
    )
    pending = similar_refinements.scalars().all()
    
    # Group refinements that are within 50m of each other
    THRESHOLD_METERS = 50
    for ref in pending:
        distance = haversine_distance(
            new_latitude, new_longitude,
            ref.proposed_latitude, ref.proposed_longitude
        ) * 1609.34  # Convert miles to meters
        
        if distance <= THRESHOLD_METERS:
            # Found similar refinement
            similar_count = 1
            for other_ref in pending:
                if other_ref.id != ref.id:
                    other_dist = haversine_distance(
                        ref.proposed_latitude, ref.proposed_longitude,
                        other_ref.proposed_latitude, other_ref.proposed_longitude
                    ) * 1609.34
                    if other_dist <= THRESHOLD_METERS:
                        similar_count += 1
            
            if similar_count >= 3:
                # Mark spot for crowdsourced update
                spot.accuracy_flag = 'crowdsourced_pending'
                logger.info(f"Spot {spot_id} has 3+ similar refinements, queued for admin review")
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Location refinement submitted",
        "refinement_count": spot.refinement_count
    }


@router.get("/admin/spots/refinement-queue")
async def get_refinement_queue(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get spots with pending refinements for admin review."""
    # Get spots with crowdsourced_pending flag or pending refinements
    result = await db.execute(
        select(SurfSpot).where(
            or_(
                SurfSpot.accuracy_flag == 'crowdsourced_pending',
                SurfSpot.refinement_count >= 3
            )
        )
    )
    spots = result.scalars().all()
    
    queue = []
    for spot in spots:
        # Get pending refinements for this spot
        ref_result = await db.execute(
            select(SpotRefinement).where(
                SpotRefinement.spot_id == spot.id,
                SpotRefinement.status == 'pending'
            )
        )
        refinements = ref_result.scalars().all()
        
        queue.append({
            "spot_id": spot.id,
            "spot_name": spot.name,
            "current_lat": spot.latitude,
            "current_lon": spot.longitude,
            "accuracy_flag": spot.accuracy_flag,
            "refinement_count": spot.refinement_count,
            "pending_refinements": [
                {
                    "id": r.id,
                    "proposed_lat": r.proposed_latitude,
                    "proposed_lon": r.proposed_longitude,
                    "photographer_id": r.photographer_id,
                    "created_at": r.created_at.isoformat()
                }
                for r in refinements
            ]
        })
    
    return {"queue": queue, "count": len(queue)}


@router.post("/admin/spots/{spot_id}/apply-refinement")
async def apply_spot_refinement(
    spot_id: str,
    admin: Profile = Depends(get_current_admin),
    new_latitude: float = Query(..., description="New latitude for the spot"),
    new_longitude: float = Query(..., description="New longitude for the spot"),
    db: AsyncSession = Depends(get_db)
):
    """Admin applies a refinement to update spot location."""
    # Get spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates
    if not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Apply new coordinates
    spot.latitude = new_latitude
    spot.longitude = new_longitude
    spot.is_verified_peak = True
    spot.accuracy_flag = 'verified'
    spot.verified_by = admin.id
    spot.verified_at = datetime.now(timezone.utc)
    
    # Clear pending refinements
    await db.execute(
        SpotRefinement.__table__.update()
        .where(SpotRefinement.spot_id == spot_id)
        .values(status='approved', reviewed_at=datetime.now(timezone.utc), reviewed_by=admin.id)
    )
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Spot {spot.name} updated and verified",
        "new_coordinates": {"lat": new_latitude, "lon": new_longitude}
    }


@router.post("/admin/spots/{spot_id}/offset-seaward")
async def offset_spot_seaward(
    spot_id: str,
    admin: Profile = Depends(get_current_admin),
    offset_meters: float = 100,
    db: AsyncSession = Depends(get_db)
):
    """Automatically offset a spot seaward using the coastline algorithm."""
    # Get spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates
    if not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Calculate seaward offset
    new_lat, new_lon = calculate_seaward_offset(spot.latitude, spot.longitude, offset_meters)
    
    # Apply offset
    spot.latitude = new_lat
    spot.longitude = new_lon
    spot.accuracy_flag = 'offset_adjusted'
    spot.verified_by = admin.id
    spot.verified_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Spot offset {offset_meters}m seaward",
        "original": {"lat": spot.original_latitude, "lon": spot.original_longitude},
        "new": {"lat": new_lat, "lon": new_lon}
    }

