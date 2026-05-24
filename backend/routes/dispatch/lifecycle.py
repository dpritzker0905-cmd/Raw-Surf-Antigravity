"""
Session lifecycle -- accept, decline, update-location, arrived.

Part of the dispatch package -- extracted from dispatch.py monolith.
Complete and cancel transitions extracted to dispatch_transitions.py (v90).
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import math
import os
import json
import stripe
from utils.geo import haversine_distance

from database import get_db
from models import (
    Profile, DispatchRequest, DispatchRequestParticipant,
    DispatchNotification, DispatchRequestStatusEnum, SurfSpot,
    Booking, BookingParticipant, CreditTransaction, RoleEnum, Notification,
    PaymentTransaction, SessionSnapshot, CancellationExceptionRequest,
    Surfboard
)
from utils.parental_alerts import check_and_send_spending_alert
from core.security import get_current_user_id

from services.onesignal_service import onesignal_service

from .schemas import (
    CreateDispatchRequest, AcceptDispatchRequest, UpdateGPSLocation,
    CancelDispatchRequest, UpdateSessionLocationRequest, UpdateSelfieRequest,
    BoostRequestCreate, DispatchCheckoutRequest, ExceptionRequestBody,
    ExceptionResolveBody, CrewPaymentRequest, CrewCheckoutRequest,
    CoverRemainingRequest, RemindCrewRequest,
    get_available_pros, _get_surfer_board_description
)

logger = logging.getLogger("routes.dispatch")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

@router.post("/{dispatch_id}/accept")
async def accept_dispatch(
    dispatch_id: str,
    accept_data: AcceptDispatchRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Photographer accepts a dispatch request
    Starts GPS tracking session and sends push notification to surfer
    """
    if accept_data.photographer_id != current_user_id:
        raise HTTPException(
            status_code=403, 
            detail="Unauthorized action: photographer_id does not match authenticated user."
        )

    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.status != DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
        raise HTTPException(status_code=400, detail=f"Request cannot be accepted. Status: {dispatch.status}")
    
    # Verify photographer is eligible
    result = await db.execute(
        select(Profile).where(Profile.id == accept_data.photographer_id)
    )
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if photographer.role not in [RoleEnum.PRO, RoleEnum.APPROVED_PRO, RoleEnum.PHOTOGRAPHER]:
        raise HTTPException(status_code=403, detail="Only Pro photographers can accept dispatch requests")
    
    if not photographer.is_available_on_demand:
        raise HTTPException(status_code=403, detail="Photographer is not available for on-demand requests")
    
    # Check for existing notification
    notif_result = await db.execute(
        select(DispatchNotification)
        .where(
            DispatchNotification.dispatch_request_id == dispatch_id,
            DispatchNotification.photographer_id == accept_data.photographer_id
        )
    )
    notification = notif_result.scalar_one_or_none()
    
    if notification:
        notification.response = 'accepted'
        notification.responded_at = datetime.now(timezone.utc)
    
    # Update dispatch status
    dispatch.status = DispatchRequestStatusEnum.ACCEPTED
    dispatch.status_changed_at = datetime.now(timezone.utc)
    dispatch.photographer_id = accept_data.photographer_id
    dispatch.accepted_at = datetime.now(timezone.utc)
    
    # Calculate ETA based on distance (if available)
    eta_minutes = 5  # Default
    photographer_lat = photographer.on_demand_latitude or photographer.home_latitude
    photographer_lng = photographer.on_demand_longitude or photographer.home_longitude
    if dispatch.latitude and dispatch.longitude and photographer_lat and photographer_lng:
        distance = haversine_distance(
            photographer_lat, photographer_lng,
            dispatch.latitude, dispatch.longitude
        )
        eta_minutes = max(2, int(distance * 3))  # ~3 min per mile, min 2 min
    
    dispatch.estimated_arrival_minutes = eta_minutes
    
    # Move to en_route immediately
    dispatch.status = DispatchRequestStatusEnum.EN_ROUTE
    
    await db.commit()
    
    # Send push notification to surfer (background task for non-blocking)
    async def send_acceptance_notification():
        try:
            await onesignal_service.send_notification(
                external_user_ids=[str(dispatch.requester_id)],
                title=f"{photographer.full_name} is on the way!",
                message=f"Your photographer accepted! ETA: ~{eta_minutes} min. Get ready to shred!",
                data={
                    "type": "on_demand_accepted",
                    "dispatch_id": dispatch_id,
                    "photographer_id": str(photographer.id),
                    "photographer_name": photographer.full_name,
                    "photographer_avatar": photographer.avatar_url,
                    "eta_minutes": eta_minutes
                },
                url=f"/bookings?tab=on-demand&dispatch={dispatch_id}"
            )
        except Exception as e:
            logger.error(f"Failed to send acceptance notification: {e}")
    
    background_tasks.add_task(send_acceptance_notification)
    
    return {
        "id": dispatch_id,
        "status": "en_route",
        "photographer_id": accept_data.photographer_id,
        "photographer_name": photographer.full_name,
        "photographer_avatar": photographer.avatar_url,
        "eta_minutes": eta_minutes,
        "message": "Photographer is on their way!"
    }


@router.post("/{dispatch_id}/decline")
async def decline_dispatch(
    dispatch_id: str,
    photographer_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Photographer declines a dispatch request.
    This marks the notification as declined but doesn't cancel the request.
    If this is a Quick Book (target_photographer), notify the surfer.
    """
    if photographer_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized action: photographer_id does not match authenticated user."
        )

    # Find the notification for this photographer
    notif_result = await db.execute(
        select(DispatchNotification).where(
            DispatchNotification.dispatch_request_id == dispatch_id,
            DispatchNotification.photographer_id == photographer_id
        )
    )
    notification = notif_result.scalar_one_or_none()
    
    if notification:
        notification.response = 'declined'
        notification.responded_at = datetime.now(timezone.utc)
    
    # Get the dispatch request
    dispatch_result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = dispatch_result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # If this was a Quick Book (targeted), mark the entire request as declined
    if dispatch.target_photographer_id == photographer_id:
        dispatch.status = DispatchRequestStatusEnum.CANCELLED
        dispatch.cancellation_reason = "Photographer declined the request"
        dispatch.cancelled_at = datetime.now(timezone.utc)
        
        # Notify the surfer
        requester_notification = Notification(
            user_id=dispatch.requester_id,
            type='dispatch_declined',
            title='Request Declined',
            body='The photographer is unavailable right now. Your credits have been refunded.',
            data=json.dumps({
                'dispatch_id': dispatch_id,
                'action': 'declined'
            })
        )
        db.add(requester_notification)
        
        # Refund the deposit
        if dispatch.deposit_amount and dispatch.deposit_amount > 0:
            payer_result = await db.execute(
                select(Profile).where(Profile.id == dispatch.requester_id)
            )
            payer = payer_result.scalar_one_or_none()
            if payer:
                old_balance = payer.credit_balance or 0
                payer.credit_balance = old_balance + dispatch.deposit_amount
                
                refund_tx = CreditTransaction(
                    user_id=dispatch.requester_id,
                    amount=dispatch.deposit_amount,
                    balance_before=old_balance,
                    balance_after=payer.credit_balance,
                    transaction_type='dispatch_refund',
                    reference_type='dispatch_request',
                    reference_id=dispatch_id
                )
                db.add(refund_tx)
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Request declined",
        "dispatch_id": dispatch_id,
        "was_quick_book": dispatch.target_photographer_id == photographer_id
    }


@router.put("/{dispatch_id}/update-session-location")
async def update_session_location(
    dispatch_id: str,
    requester_id: str,
    data: UpdateSessionLocationRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Update the session meeting point (coordinates + name).
    
    ONLY allowed when:
    - Caller is the requester (captain)
    - Status is PENDING_PAYMENT or SEARCHING_FOR_PRO
    - No photographer has accepted yet
    - No crew member has paid yet (for split sessions)
    
    Once any confirmation happens, the location is LOCKED.
    """
    if requester_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized action: requester_id does not match authenticated user."
        )

    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Only the requester can change the meeting point
    if str(dispatch.requester_id) != str(requester_id):
        raise HTTPException(status_code=403, detail="Only the session requester can update the location")
    
    # Check if location is locked (photographer accepted or session advanced)
    locked_statuses = [
        DispatchRequestStatusEnum.EN_ROUTE,
        DispatchRequestStatusEnum.ARRIVED,
        DispatchRequestStatusEnum.COMPLETED,
        DispatchRequestStatusEnum.CANCELLED
    ]
    # Also check for 'accepted' if it exists as a status
    if hasattr(DispatchRequestStatusEnum, 'ACCEPTED'):
        locked_statuses.append(DispatchRequestStatusEnum.ACCEPTED)
    
    if dispatch.status in locked_statuses:
        raise HTTPException(
            status_code=400,
            detail="Location is locked — a photographer has already accepted this session."
        )
    
    # For split sessions: check if any crew member has paid (locks location)
    if dispatch.is_shared:
        crew_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(
                DispatchRequestParticipant.dispatch_request_id == dispatch_id,
                DispatchRequestParticipant.paid == True
            )
        )
        paid_crew = crew_result.scalars().all()
        if paid_crew:
            raise HTTPException(
                status_code=400,
                detail="Location is locked — a crew member has already confirmed and paid."
            )
    
    # Update the session meeting point
    dispatch.latitude = data.latitude
    dispatch.longitude = data.longitude
    if data.location_name:
        dispatch.location_name = data.location_name
    if data.spot_id:
        dispatch.spot_id = data.spot_id
    
    dispatch.status_changed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    logger.info(f"Session location updated for dispatch {dispatch_id}: {data.location_name} ({data.latitude}, {data.longitude})")
    
    return {
        "success": True,
        "dispatch_id": dispatch_id,
        "location": {
            "lat": dispatch.latitude,
            "lng": dispatch.longitude,
            "name": dispatch.location_name
        },
        "location_locked": False,
        "message": "Meeting point updated successfully"
    }


@router.post("/{dispatch_id}/update-location")
async def update_location(
    dispatch_id: str,
    user_id: str,
    location: UpdateGPSLocation,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """Update GPS location for either party during en_route phase"""
    if user_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized action: user_id does not match authenticated user."
        )

    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.status != DispatchRequestStatusEnum.EN_ROUTE:
        raise HTTPException(status_code=400, detail="GPS tracking is only active during en_route phase")
    
    now = datetime.now(timezone.utc)
    
    if user_id == dispatch.photographer_id:
        dispatch.photographer_lat = location.latitude
        dispatch.photographer_lng = location.longitude
        dispatch.photographer_last_update = now
        
        # Calculate ETA if both locations known
        if dispatch.latitude and dispatch.longitude:
            distance = haversine_distance(
                location.latitude, location.longitude,
                dispatch.latitude, dispatch.longitude
            )
            # Estimate 2 minutes per mile (30mph average)
            dispatch.estimated_arrival_minutes = int(distance * 2)
            
    elif user_id == dispatch.requester_id:
        dispatch.requester_lat = location.latitude
        dispatch.requester_lng = location.longitude
        dispatch.requester_last_update = now
    else:
        raise HTTPException(status_code=403, detail="Only requester or photographer can update location")
    
    await db.commit()
    
    return {
        "id": dispatch_id,
        "photographer_location": {
            "lat": dispatch.photographer_lat,
            "lng": dispatch.photographer_lng,
            "updated": dispatch.photographer_last_update.isoformat() if dispatch.photographer_last_update else None
        },
        "requester_location": {
            "lat": dispatch.requester_lat,
            "lng": dispatch.requester_lng,
            "updated": dispatch.requester_last_update.isoformat() if dispatch.requester_last_update else None
        },
        "estimated_arrival_minutes": dispatch.estimated_arrival_minutes
    }


@router.post("/{dispatch_id}/update-selfie")
async def update_selfie(
    dispatch_id: str,
    requester_id: str,
    data: UpdateSelfieRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Surfer uploads their identification selfie (with surfboard) so the Pro can find them.
    This should be done after the Pro accepts the request.
    """
    if requester_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized action: requester_id does not match authenticated user."
        )

    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.requester_id != requester_id:
        raise HTTPException(status_code=403, detail="Only the requester can update the selfie")
    
    # Allow selfie upload during any active phase (before completion/cancellation)
    allowed_statuses = [
        DispatchRequestStatusEnum.PENDING_PAYMENT,
        DispatchRequestStatusEnum.SEARCHING_FOR_PRO,
        DispatchRequestStatusEnum.ACCEPTED, 
        DispatchRequestStatusEnum.EN_ROUTE
    ]
    if dispatch.status not in allowed_statuses:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot upload selfie in current status: {dispatch.status.value}"
        )
    
    dispatch.selfie_url = data.selfie_url
    await db.commit()
    
    return {
        "message": "Selfie uploaded successfully",
        "dispatch_id": dispatch_id,
        "selfie_url": data.selfie_url
    }


@router.post("/{dispatch_id}/arrived")
async def mark_arrived(
    dispatch_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Photographer marks arrival - ends GPS tracking, creates booking
    """
    if photographer_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized action: photographer_id does not match authenticated user."
        )

    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Only the assigned photographer can mark arrival")
    
    if dispatch.status != DispatchRequestStatusEnum.EN_ROUTE:
        raise HTTPException(status_code=400, detail=f"Cannot mark arrived. Status: {dispatch.status}")
    
    now = datetime.now(timezone.utc)
    
    # Update status
    dispatch.status = DispatchRequestStatusEnum.ARRIVED
    dispatch.status_changed_at = now
    dispatch.arrived_at = now
    
    # Auto-create a Private Booking
    booking = Booking(
        photographer_id=photographer_id,
        creator_id=dispatch.requester_id,
        surf_spot_id=dispatch.spot_id,
        latitude=dispatch.latitude,
        longitude=dispatch.longitude,
        location=dispatch.location_name or "On-Demand Meeting Point",
        session_date=now,
        booking_type='on_demand',
        duration=int((dispatch.estimated_duration_hours or 1) * 60),
        status='in_progress',
        total_price=dispatch.estimated_total or 0,
        escrow_amount=dispatch.deposit_amount or 0,
        escrow_status='held'
    )
    
    db.add(booking)
    await db.flush()
    
    # Add requester as participant
    participant = BookingParticipant(
        booking_id=booking.id,
        participant_id=dispatch.requester_id,
        is_captain=True,
        payment_status='Paid',
        paid_amount=dispatch.deposit_amount or 0,
        share_amount=dispatch.deposit_amount or 0,
        status='confirmed'
    )
    db.add(participant)
    
    dispatch.booking_id = booking.id
    
    # === DATA INTEGRITY: Create frozen snapshot of participant data ===
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id)
    )
    crew_participants = crew_result.scalars().all()
    
    snapshot_data = {
        "captain": {
            "id": dispatch.requester_id,
            "name": dispatch.captain_name,
            "username": dispatch.captain_username,
            "avatar_url": dispatch.captain_avatar_url,
            "selfie_url": dispatch.selfie_url
        },
        "crew": [
            {
                "id": cp.participant_id,
                "name": cp.payer_name,
                "username": cp.payer_username,
                "avatar_url": cp.payer_avatar_url,
                "selfie_url": cp.selfie_url,
                "share_amount": cp.share_amount,
                "paid": cp.paid
            }
            for cp in crew_participants
        ],
        "photographer_id": photographer_id,
        "location_name": dispatch.location_name,
        "estimated_duration_hours": dispatch.estimated_duration_hours,
        "estimated_total": dispatch.estimated_total
    }
    
    session_snapshot = SessionSnapshot(
        dispatch_request_id=dispatch_id,
        booking_id=booking.id,
        snapshot_data=snapshot_data,
        snapshot_type='arrived'
    )
    db.add(session_snapshot)
    
    # === GAMIFICATION: Award XP for successful On-Demand connection ===
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if photographer:
        base_xp = 50
        hot_streak_multiplier = 2.0 if (photographer.on_demand_streak or 0) >= 3 else 1.0
        final_xp = int(base_xp * hot_streak_multiplier)
        photographer.xp_total = (photographer.xp_total or 0) + final_xp
        
        today = now.date()
        if photographer.on_demand_updated_at:
            last_date = photographer.on_demand_updated_at.date()
            if last_date.year == today.year and last_date.month == today.month:
                photographer.on_demand_streak = (photographer.on_demand_streak or 0) + 1
            else:
                photographer.on_demand_streak = 1
        else:
            photographer.on_demand_streak = 1
        photographer.on_demand_updated_at = now
    
    # Surfer gets "First Responder" badge (if first On-Demand)
    surfer_result = await db.execute(
        select(Profile).where(Profile.id == dispatch.requester_id)
    )
    surfer = surfer_result.scalar_one_or_none()
    
    if surfer:
        badges = []
        if surfer.badges:
            try:
                badges = json.loads(surfer.badges) if isinstance(surfer.badges, str) else (surfer.badges or [])
            except (ValueError, TypeError):
                badges = []
        
        if 'first_responder' not in badges:
            badges.append('first_responder')
            surfer.badges = json.dumps(badges)
        
        surfer.xp_total = (surfer.xp_total or 0) + 25
    
    await db.commit()
    
    return {
        "id": dispatch_id,
        "status": "arrived",
        "booking_id": booking.id,
        "message": "Arrived! Session started. Enjoy your surf!",
        "gamification": {
            "photographer_xp_awarded": final_xp if photographer else 0,
            "photographer_streak": photographer.on_demand_streak if photographer else 0,
            "surfer_xp_awarded": 25 if surfer else 0,
            "surfer_badge": "first_responder" if surfer and 'first_responder' not in (badges[:-1] if badges else []) else None
        }
    }


# ═══ COMPLETE/CANCEL (extracted to dispatch_transitions.py in v90) ═══════
# Re-exported for backward compatibility
from .dispatch_transitions import (
    complete_dispatch_session,
    cancel_dispatch,
)
