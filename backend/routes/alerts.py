from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json
import httpx
import logging
import math
from utils.geo import haversine_distance


from database import get_db
from models import (
    Profile, SurfSpot, SurfAlert, Notification, 
    PhotographerRequest, PhotographerRequestStatusEnum, RoleEnum
)

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

class SurfAlertCreate(BaseModel):
    spot_id: str
    min_wave_height: Optional[float] = None
    max_wave_height: Optional[float] = None
    preferred_conditions: Optional[List[str]] = None  # Array of condition IDs
    time_windows: Optional[List[str]] = None  # ["dawn", "morning", "afternoon", "evening"]
    tide_states: Optional[List[str]] = None   # ["low", "mid", "high", "rising", "falling"]
    notify_push: bool = True
    notify_email: bool = False

class SurfAlertUpdate(BaseModel):
    min_wave_height: Optional[float] = None
    max_wave_height: Optional[float] = None
    preferred_conditions: Optional[List[str]] = None  # Array of condition IDs
    time_windows: Optional[List[str]] = None
    tide_states: Optional[List[str]] = None
    is_active: Optional[bool] = None
    notify_push: Optional[bool] = None
    notify_email: Optional[bool] = None

class SurfAlertShare(BaseModel):
    alert_id: str
    sender_id: str
    recipient_identifier: str  # Username or email

@router.post("/alerts")
async def create_surf_alert(user_id: str, data: SurfAlertCreate, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    existing = await db.execute(
        select(SurfAlert).where(
            SurfAlert.user_id == user_id,
            SurfAlert.spot_id == data.spot_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Alert already exists for this spot")
    
    alert = SurfAlert(
        user_id=user_id,
        spot_id=data.spot_id,
        min_wave_height=data.min_wave_height,
        max_wave_height=data.max_wave_height,
        preferred_conditions=data.preferred_conditions,
        time_windows=data.time_windows,
        tide_states=data.tide_states,
        notify_push=data.notify_push,
        notify_email=data.notify_email
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    
    return {
        "id": alert.id,
        "spot_id": alert.spot_id,
        "spot_name": spot.name,
        "min_wave_height": alert.min_wave_height,
        "max_wave_height": alert.max_wave_height,
        "preferred_conditions": alert.preferred_conditions,
        "time_windows": alert.time_windows,
        "tide_states": alert.tide_states,
        "is_active": alert.is_active,
        "created_at": alert.created_at.isoformat()
    }

@router.get("/alerts/user/{user_id}")
async def get_user_alerts(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SurfAlert)
        .where(SurfAlert.user_id == user_id)
        .options(selectinload(SurfAlert.spot))
    )
    alerts = result.scalars().all()
    
    return [{
        "id": a.id,
        "spot_id": a.spot_id,
        "spot_name": a.spot.name if a.spot else None,
        "spot_image": a.spot.image_url if a.spot else None,
        "min_wave_height": a.min_wave_height,
        "max_wave_height": a.max_wave_height,
        "preferred_conditions": a.preferred_conditions,
        "time_windows": a.time_windows,
        "tide_states": a.tide_states,
        "is_active": a.is_active,
        "notify_push": a.notify_push,
        "trigger_count": a.trigger_count,
        "last_triggered": a.last_triggered.isoformat() if a.last_triggered else None
    } for a in alerts]

@router.patch("/alerts/{alert_id}")
async def update_surf_alert(alert_id: str, data: SurfAlertUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfAlert).where(SurfAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    if data.min_wave_height is not None:
        alert.min_wave_height = data.min_wave_height
    if data.max_wave_height is not None:
        alert.max_wave_height = data.max_wave_height
    if data.preferred_conditions is not None:
        alert.preferred_conditions = data.preferred_conditions
    if data.time_windows is not None:
        alert.time_windows = data.time_windows
    if data.tide_states is not None:
        alert.tide_states = data.tide_states
    if data.is_active is not None:
        alert.is_active = data.is_active
    if data.notify_push is not None:
        alert.notify_push = data.notify_push
    if data.notify_email is not None:
        alert.notify_email = data.notify_email
    
    await db.commit()
    return {"message": "Alert updated", "id": alert_id}


@router.put("/alerts/{alert_id}")
async def full_update_surf_alert(alert_id: str, data: SurfAlertCreate, db: AsyncSession = Depends(get_db)):
    """Full update of a surf alert - allows changing all fields including spot"""
    result = await db.execute(select(SurfAlert).where(SurfAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Update all fields
    alert.spot_id = data.spot_id
    alert.min_wave_height = data.min_wave_height
    alert.max_wave_height = data.max_wave_height
    alert.preferred_conditions = data.preferred_conditions
    alert.time_windows = data.time_windows
    alert.tide_states = data.tide_states
    alert.notify_push = data.notify_push
    alert.notify_email = data.notify_email
    
    await db.commit()
    return {"message": "Alert updated", "id": alert_id}

@router.delete("/alerts/{alert_id}")
async def delete_surf_alert(alert_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfAlert).where(SurfAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    await db.delete(alert)
    await db.commit()
    return {"message": "Alert deleted"}

@router.post("/alerts/share")
async def share_surf_alert(data: SurfAlertShare, db: AsyncSession = Depends(get_db)):
    """Share an alert configuration with another user"""
    # Get the original alert
    alert_result = await db.execute(
        select(SurfAlert)
        .where(SurfAlert.id == data.alert_id)
        .options(selectinload(SurfAlert.spot))
    )
    alert = alert_result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    # Get sender
    sender_result = await db.execute(select(Profile).where(Profile.id == data.sender_id))
    sender = sender_result.scalar_one_or_none()
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    # Find recipient by username or email
    recipient_result = await db.execute(
        select(Profile).where(
            or_(
                Profile.username == data.recipient_identifier,
                Profile.email == data.recipient_identifier
            )
        )
    )
    recipient = recipient_result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if recipient already has an alert for this spot
    existing = await db.execute(
        select(SurfAlert).where(
            SurfAlert.user_id == recipient.id,
            SurfAlert.spot_id == alert.spot_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already has an alert for this spot")
    
    # Create a copy of the alert for the recipient
    new_alert = SurfAlert(
        user_id=recipient.id,
        spot_id=alert.spot_id,
        min_wave_height=alert.min_wave_height,
        max_wave_height=alert.max_wave_height,
        preferred_conditions=alert.preferred_conditions,
        time_windows=alert.time_windows,
        tide_states=alert.tide_states,
        notify_push=True,
        notify_email=False
    )
    db.add(new_alert)
    
    # Notify the recipient
    notification = Notification(
        user_id=recipient.id,
        type="alert_shared",
        title=f"🔔 {sender.full_name} shared a surf alert with you!",
        body=f"Alert for {alert.spot.name if alert.spot else 'a spot'} has been added to your alerts.",
        data=json.dumps({
            "alert_id": new_alert.id,
            "spot_id": alert.spot_id,
            "spot_name": alert.spot.name if alert.spot else None,
            "sender_id": data.sender_id,
            "sender_name": sender.full_name,
            "type": "alert_shared"
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "message": f"Alert shared with {recipient.username or recipient.email}",
        "recipient_id": recipient.id,
        "new_alert_id": new_alert.id
    }

@router.post("/alerts/check")
async def check_and_trigger_alerts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SurfAlert)
        .where(SurfAlert.is_active.is_(True))
        .options(selectinload(SurfAlert.spot), selectinload(SurfAlert.user))
    )
    alerts = result.scalars().all()
    
    triggered = []
    
    for alert in alerts:
        if not alert.spot:
            continue
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(OPEN_METEO_MARINE_URL, params={
                    "latitude": alert.spot.latitude,
                    "longitude": alert.spot.longitude,
                    "current": "wave_height",
                    "timezone": "America/New_York"
                })
                
                if response.status_code == 200:
                    data = response.json()
                    wave_height_m = data.get("current", {}).get("wave_height", 0)
                    wave_height_ft = wave_height_m * 3.28084 if wave_height_m else 0
                    
                    matches = True
                    
                    if alert.min_wave_height and wave_height_ft < alert.min_wave_height:
                        matches = False
                    if alert.max_wave_height and wave_height_ft > alert.max_wave_height:
                        matches = False
                    
                    if matches:
                        alert.trigger_count += 1
                        alert.last_triggered = datetime.now(timezone.utc)
                        
                        notification = Notification(
                            user_id=alert.user_id,
                            type="surf_alert",
                            title=f"🌊 {alert.spot.name} is firing!",
                            body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!",
                            data=json.dumps({
                                "spot_id": alert.spot_id,
                                "wave_height_ft": wave_height_ft,
                                "alert_id": alert.id,
                                "type": "surf_alert"
                            })
                        )
                        db.add(notification)
                        
                        triggered.append({
                            "alert_id": alert.id,
                            "user_id": alert.user_id,
                            "spot_name": alert.spot.name,
                            "wave_height_ft": round(wave_height_ft, 1)
                        })
        except Exception as e:
            logger.error(f"Error checking alert {alert.id}: {str(e)}")
    
    await db.commit()
    return {"triggered_count": len(triggered), "triggered": triggered}


# ============ PHOTOGRAPHER REQUEST ALERT ENDPOINTS ============

class PhotographerRequestCreate(BaseModel):
    spot_id: str
    urgency: str = "flexible"  # 'now', 'today', 'flexible'
    preferred_time: Optional[str] = None
    duration_hours: float = 2.0
    notes: Optional[str] = None
    max_budget: Optional[float] = None


class PhotographerRequestResponse(BaseModel):
    accept: bool
    note: Optional[str] = None



@router.post("/photographer-request")
async def create_photographer_request(
    user_id: str, 
    data: PhotographerRequestCreate, 
    db: AsyncSession = Depends(get_db)
):
    """
    Create a request for photographer coverage at a spot.
    Notifies nearby photographers who are available.
    """
    # Verify requester
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify spot exists
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if user already has an active request for this spot
    existing = await db.execute(
        select(PhotographerRequest).where(
            PhotographerRequest.requester_id == user_id,
            PhotographerRequest.spot_id == data.spot_id,
            PhotographerRequest.status == PhotographerRequestStatusEnum.PENDING
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have an active request for this spot")
    
    # Calculate expiration based on urgency
    if data.urgency == "now":
        expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
    elif data.urgency == "today":
        expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    else:  # flexible
        expires_at = datetime.now(timezone.utc) + timedelta(days=3)
    
    # Create the request
    request = PhotographerRequest(
        requester_id=user_id,
        spot_id=data.spot_id,
        urgency=data.urgency,
        preferred_time=data.preferred_time,
        duration_hours=data.duration_hours,
        notes=data.notes,
        max_budget=data.max_budget,
        expires_at=expires_at
    )
    db.add(request)
    await db.flush()  # Get the ID
    
    # Find nearby photographers to notify (within 25 miles of spot)
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO, RoleEnum.HOBBYIST]
    photographers_result = await db.execute(
        select(Profile).where(
            Profile.role.in_(photographer_roles),
            Profile.home_latitude.isnot(None),
            Profile.home_longitude.isnot(None)
        )
    )
    all_photographers = photographers_result.scalars().all()
    
    # Filter by distance (25 mile radius)
    nearby_photographers = []
    for photographer in all_photographers:
        if photographer.home_latitude and photographer.home_longitude and spot.latitude and spot.longitude:
            distance = haversine_distance(
                spot.latitude, spot.longitude,
                photographer.home_latitude, photographer.home_longitude
            )
            if distance <= 25:  # 25 mile radius
                nearby_photographers.append(photographer)
    
    # Create notifications for nearby photographers
    notifications_created = 0
    urgency_emoji = "🚨" if data.urgency == "now" else "📸" if data.urgency == "today" else "📷"
    
    for photographer in nearby_photographers:
        notification = Notification(
            user_id=photographer.id,
            type="photographer_request",
            title=f"{urgency_emoji} Photographer Wanted at {spot.name}!",
            body=f"{user.full_name} is looking for coverage{' NOW' if data.urgency == 'now' else ' today' if data.urgency == 'today' else ''}. {data.duration_hours:.0f}h session.",
            data=json.dumps({
                "request_id": request.id,
                "spot_id": data.spot_id,
                "spot_name": spot.name,
                "requester_id": user_id,
                "requester_name": user.full_name,
                "urgency": data.urgency,
                "duration_hours": data.duration_hours,
                "max_budget": data.max_budget,
                "type": "photographer_request"
            })
        )
        db.add(notification)
        notifications_created += 1
    
    request.notified_count = notifications_created
    await db.commit()
    await db.refresh(request)
    
    return {
        "id": request.id,
        "spot_id": request.spot_id,
        "spot_name": spot.name,
        "urgency": request.urgency,
        "preferred_time": request.preferred_time,
        "duration_hours": request.duration_hours,
        "status": request.status.value,
        "notified_photographers": notifications_created,
        "expires_at": request.expires_at.isoformat() if request.expires_at else None,
        "created_at": request.created_at.isoformat()
    }


@router.get("/photographer-requests/active")
async def get_active_photographer_requests(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get active photographer requests for a photographer to view.
    Returns requests within 25 miles of the photographer's location.
    """
    # Get photographer profile
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get all pending requests that haven't expired
    requests_result = await db.execute(
        select(PhotographerRequest)
        .where(
            PhotographerRequest.status == PhotographerRequestStatusEnum.PENDING,
            or_(
                PhotographerRequest.expires_at.is_(None),
                PhotographerRequest.expires_at > datetime.now(timezone.utc)
            )
        )
        .options(
            selectinload(PhotographerRequest.spot),
            selectinload(PhotographerRequest.requester)
        )
        .order_by(PhotographerRequest.created_at.desc())
    )
    all_requests = requests_result.scalars().all()
    
    # Filter by distance if photographer has location
    result = []
    for req in all_requests:
        distance = None
        if photographer.home_latitude and photographer.home_longitude and req.spot and req.spot.latitude and req.spot.longitude:
            distance = haversine_distance(
                photographer.home_latitude, photographer.home_longitude,
                req.spot.latitude, req.spot.longitude
            )
            # Skip if more than 25 miles
            if distance > 25:
                continue
        
        result.append({
            "id": req.id,
            "spot_id": req.spot_id,
            "spot_name": req.spot.name if req.spot else None,
            "spot_image": req.spot.image_url if req.spot else None,
            "requester_id": req.requester_id,
            "requester_name": req.requester.full_name if req.requester else None,
            "requester_avatar": req.requester.avatar_url if req.requester else None,
            "urgency": req.urgency,
            "preferred_time": req.preferred_time,
            "duration_hours": req.duration_hours,
            "notes": req.notes,
            "max_budget": req.max_budget,
            "distance_miles": round(distance, 1) if distance else None,
            "created_at": req.created_at.isoformat(),
            "expires_at": req.expires_at.isoformat() if req.expires_at else None
        })
    
    return result


@router.get("/photographer-requests/my-requests")
async def get_my_photographer_requests(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get requests made by the current user"""
    result = await db.execute(
        select(PhotographerRequest)
        .where(PhotographerRequest.requester_id == user_id)
        .options(
            selectinload(PhotographerRequest.spot),
            selectinload(PhotographerRequest.accepted_by)
        )
        .order_by(PhotographerRequest.created_at.desc())
    )
    requests = result.scalars().all()
    
    return [{
        "id": req.id,
        "spot_id": req.spot_id,
        "spot_name": req.spot.name if req.spot else None,
        "urgency": req.urgency,
        "preferred_time": req.preferred_time,
        "duration_hours": req.duration_hours,
        "status": req.status.value,
        "accepted_by_name": req.accepted_by.full_name if req.accepted_by else None,
        "accepted_by_avatar": req.accepted_by.avatar_url if req.accepted_by else None,
        "response_note": req.response_note,
        "notified_count": req.notified_count,
        "view_count": req.view_count,
        "created_at": req.created_at.isoformat(),
        "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        "responded_at": req.responded_at.isoformat() if req.responded_at else None
    } for req in requests]


@router.post("/photographer-requests/{request_id}/respond")
async def respond_to_photographer_request(
    request_id: str,
    user_id: str,
    data: PhotographerRequestResponse,
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer responds to a coverage request.
    Can accept or decline.
    """
    # Verify photographer
    photographer_result = await db.execute(select(Profile).where(Profile.id == user_id))
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get the request
    request_result = await db.execute(
        select(PhotographerRequest)
        .where(PhotographerRequest.id == request_id)
        .options(selectinload(PhotographerRequest.spot), selectinload(PhotographerRequest.requester))
    )
    request = request_result.scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    
    # Check if already responded
    if request.status != PhotographerRequestStatusEnum.PENDING:
        raise HTTPException(status_code=400, detail="This request has already been responded to")
    
    # Check if expired
    if request.expires_at and request.expires_at < datetime.now(timezone.utc):
        request.status = PhotographerRequestStatusEnum.EXPIRED
        await db.commit()
        raise HTTPException(status_code=400, detail="This request has expired")
    
    if data.accept:
        request.status = PhotographerRequestStatusEnum.ACCEPTED
        request.accepted_by_id = user_id
        request.response_note = data.note
        request.responded_at = datetime.now(timezone.utc)
        
        # Notify the requester
        notification = Notification(
            user_id=request.requester_id,
            type="photographer_request_accepted",
            title=f"🎉 {photographer.full_name} accepted your request!",
            body=f"They'll cover you at {request.spot.name if request.spot else 'the spot'}. Message them to coordinate!",
            data=json.dumps({
                "request_id": request.id,
                "photographer_id": user_id,
                "photographer_name": photographer.full_name,
                "spot_id": request.spot_id,
                "type": "photographer_request_accepted"
            })
        )
        db.add(notification)
    else:
        # Just increment view count but don't change status (other photographers can still accept)
        request.view_count += 1
    
    await db.commit()
    
    return {
        "message": "Request accepted! You can now message the surfer to coordinate." if data.accept else "Noted. Other photographers may still respond.",
        "request_id": request_id,
        "status": request.status.value
    }


@router.post("/photographer-requests/{request_id}/cancel")
async def cancel_photographer_request(
    request_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Cancel a pending photographer request (only by requester)"""
    request_result = await db.execute(
        select(PhotographerRequest).where(
            PhotographerRequest.id == request_id,
            PhotographerRequest.requester_id == user_id
        )
    )
    request = request_result.scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found or you don't have permission")
    
    if request.status != PhotographerRequestStatusEnum.PENDING:
        raise HTTPException(status_code=400, detail="Can only cancel pending requests")
    
    request.status = PhotographerRequestStatusEnum.CANCELLED
    await db.commit()
    
    return {"message": "Request cancelled", "request_id": request_id}


@router.get("/photographer-requests/{request_id}")
async def get_photographer_request(
    request_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get details of a specific photographer request"""
    result = await db.execute(
        select(PhotographerRequest)
        .where(PhotographerRequest.id == request_id)
        .options(
            selectinload(PhotographerRequest.spot),
            selectinload(PhotographerRequest.requester),
            selectinload(PhotographerRequest.accepted_by)
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    
    # Increment view count if viewer is a photographer (not the requester)
    if req.requester_id != user_id:
        req.view_count += 1
        await db.commit()
    
    return {
        "id": req.id,
        "spot_id": req.spot_id,
        "spot_name": req.spot.name if req.spot else None,
        "spot_image": req.spot.image_url if req.spot else None,
        "spot_lat": req.spot.latitude if req.spot else None,
        "spot_lng": req.spot.longitude if req.spot else None,
        "requester_id": req.requester_id,
        "requester_name": req.requester.full_name if req.requester else None,
        "requester_avatar": req.requester.avatar_url if req.requester else None,
        "urgency": req.urgency,
        "preferred_time": req.preferred_time,
        "duration_hours": req.duration_hours,
        "notes": req.notes,
        "max_budget": req.max_budget,
        "status": req.status.value,
        "accepted_by_id": req.accepted_by_id,
        "accepted_by_name": req.accepted_by.full_name if req.accepted_by else None,
        "accepted_by_avatar": req.accepted_by.avatar_url if req.accepted_by else None,
        "response_note": req.response_note,
        "notified_count": req.notified_count,
        "view_count": req.view_count,
        "created_at": req.created_at.isoformat(),
        "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        "responded_at": req.responded_at.isoformat() if req.responded_at else None
    }
