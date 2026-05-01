"""
Session lifecycle -- accept, decline, update-location, arrived, complete, cancel.

Part of the dispatch package -- extracted from dispatch.py monolith.
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
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer accepts a dispatch request
    Starts GPS tracking session and sends push notification to surfer
    """
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
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer declines a dispatch request.
    This marks the notification as declined but doesn't cancel the request.
    If this is a Quick Book (target_photographer), notify the surfer.
    """
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
    db: AsyncSession = Depends(get_db)
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
    db: AsyncSession = Depends(get_db)
):
    """Update GPS location for either party during en_route phase"""
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
    db: AsyncSession = Depends(get_db)
):
    """
    Surfer uploads their identification selfie (with surfboard) so the Pro can find them.
    This should be done after the Pro accepts the request.
    """
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
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer marks arrival - ends GPS tracking, creates booking
    """
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
    # NOTE: Booking model requires 'location' (String, non-nullable) and 'session_date' (DateTime, non-nullable)
    booking = Booking(
        photographer_id=photographer_id,
        creator_id=dispatch.requester_id,
        surf_spot_id=dispatch.spot_id,
        latitude=dispatch.latitude,
        longitude=dispatch.longitude,
        location=dispatch.location_name or "On-Demand Meeting Point",  # Required non-nullable field
        session_date=now,  # Required non-nullable DateTime
        booking_type='on_demand',
        duration=int((dispatch.estimated_duration_hours or 1) * 60),  # Convert hours to minutes
        status='in_progress',
        total_price=dispatch.estimated_total or 0,
        escrow_amount=dispatch.deposit_amount or 0,
        escrow_status='held'
    )
    
    db.add(booking)
    await db.flush()
    
    # Add requester as participant
    # NOTE: BookingParticipant model fields: is_captain, payment_status, paid_amount, status
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
    # This prevents mid-session mutations from affecting the active session
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
    # Photographer gets "Rapid Response" XP boost
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if photographer:
        # Award XP with hot streak multiplier
        base_xp = 50  # "Rapid Response" XP boost
        hot_streak_multiplier = 2.0 if (photographer.on_demand_streak or 0) >= 3 else 1.0
        final_xp = int(base_xp * hot_streak_multiplier)
        photographer.xp_total = (photographer.xp_total or 0) + final_xp
        
        # Increment streak (tracks monthly requests)
        # Reset if last request was in a different month
        today = now.date()
        if photographer.on_demand_updated_at:
            last_date = photographer.on_demand_updated_at.date()
            # Same month = increment streak
            if last_date.year == today.year and last_date.month == today.month:
                photographer.on_demand_streak = (photographer.on_demand_streak or 0) + 1
            # Different month = reset streak to 1
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
        # Award "First Responder" badge if this is their first On-Demand
        badges = []
        if surfer.badges:
            try:
                badges = json.loads(surfer.badges) if isinstance(surfer.badges, str) else (surfer.badges or [])
            except (ValueError, TypeError):
                badges = []
        
        if 'first_responder' not in badges:
            badges.append('first_responder')
            surfer.badges = json.dumps(badges)
        
        # Award XP to surfer too
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



@router.post("/{dispatch_id}/complete")
async def complete_dispatch_session(
    dispatch_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Complete an On-Demand dispatch session.
    Auto-creates gallery with on-demand pricing via the gallery sync service.
    """
    from services.gallery_sync import create_session_gallery, check_gallery_exists_for_session
    
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Only the assigned photographer can complete this session")
    
    if dispatch.status != DispatchRequestStatusEnum.ARRIVED:
        raise HTTPException(status_code=400, detail=f"Cannot complete session. Status: {dispatch.status.value}")
    
    now = datetime.now(timezone.utc)
    
    # Update dispatch status to COMPLETED
    dispatch.status = DispatchRequestStatusEnum.COMPLETED
    dispatch.status_changed_at = now
    dispatch.completed_at = now
    
    # Calculate session duration
    duration_mins = 0
    if dispatch.arrived_at:
        duration = now - dispatch.arrived_at
        duration_mins = int(duration.total_seconds() / 60)
    
    # If booking was created, update it too
    if dispatch.booking_id:
        booking_result = await db.execute(
            select(Booking).where(Booking.id == dispatch.booking_id)
        )
        booking = booking_result.scalar_one_or_none()
        if booking:
            booking.status = 'Completed'
            booking.actual_duration_mins = duration_mins
    
    await db.flush()
    
    # Check if gallery already exists (idempotency)
    gallery_exists = await check_gallery_exists_for_session(db, dispatch_id=dispatch_id)
    
    # Collect participant IDs (requester + any friends who paid)
    participant_ids = [dispatch.requester_id]
    
    # Check for additional participants (crew members who paid)
    participants_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id)
        .where(DispatchRequestParticipant.status == 'paid')
    )
    additional_participants = participants_result.scalars().all()
    for p in additional_participants:
        if p.participant_id not in participant_ids:
            participant_ids.append(p.participant_id)
    
    # Auto-create Gallery with on-demand pricing
    gallery_result = None
    if not gallery_exists:
        gallery_result = await create_session_gallery(
            db=db,
            photographer_id=photographer_id,
            session_type='on_demand',
            spot_id=dispatch.spot_id,
            spot_name=dispatch.location_name,
            dispatch_id=dispatch_id,
            session_start=dispatch.arrived_at or dispatch.created_at,
            participant_ids=participant_ids
        )
        
        # Notify all participants that their gallery is ready
        if gallery_result and gallery_result.get("gallery_id"):
            gallery_id = gallery_result.get("gallery_id")
            
            # Get photographer name for notification
            photographer_result = await db.execute(
                select(Profile).where(Profile.id == photographer_id)
            )
            photographer = photographer_result.scalar_one_or_none()
            photographer_name = photographer.full_name if photographer else "Your photographer"
            
            for surfer_id in participant_ids:
                notification = Notification(
                    user_id=surfer_id,
                    type='gallery_ready',
                    title='Your Photos Are Ready! 📸',
                    body=f'{photographer_name} has completed your on-demand session. Your gallery is ready for selection!',
                    data=json.dumps({
                        'action_url': f'/gallery/{gallery_id}',
                        'gallery_id': gallery_id,
                        'dispatch_id': dispatch_id,
                        'photographer_id': photographer_id,
                        'photographer_name': photographer_name
                    })
                )
                db.add(notification)
    
    await db.commit()
    
    return {
        "message": "On-Demand session completed! Gallery created for your photos.",
        "dispatch_id": dispatch_id,
        "status": "completed",
        "duration_mins": duration_mins,
        "gallery_id": gallery_result.get("gallery_id") if gallery_result else None,
        "gallery_title": gallery_result.get("title") if gallery_result else "Gallery already exists",
        "participants_count": len(participant_ids),
        "selection_quotas_created": gallery_result.get("participants_added", 0) if gallery_result else 0
    }



@router.post("/{dispatch_id}/cancel")
async def cancel_dispatch(
    dispatch_id: str,
    user_id: str,
    cancel_data: CancelDispatchRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Cancel a dispatch request
    Refund logic: 
    - On-demand: Non-refundable after Pro accepts
    - Scheduled: Full refund 24h+, half refund within 24h
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Only requester or photographer can cancel
    if user_id not in [dispatch.requester_id, dispatch.photographer_id]:
        raise HTTPException(status_code=403, detail="Only requester or photographer can cancel")
    
    now = datetime.now(timezone.utc)
    
    # Determine refund amount
    refund_amount = 0.0
    refund_type = 'none'
    photographer_fee_pct = 0  # Default for non-immediate dispatches
    
    if dispatch.status == DispatchRequestStatusEnum.PENDING_PAYMENT:
        # Not paid yet - no refund needed
        refund_type = 'none'
    elif dispatch.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
        # Still searching - full refund
        refund_amount = dispatch.deposit_amount
        refund_type = 'full'
    elif dispatch.is_immediate:
        # On-demand after acceptance — fee logic depends on WHO cancelled
        if user_id == dispatch.photographer_id:
            # PHOTOGRAPHER cancelled → surfer always gets full refund, no fee
            refund_amount = dispatch.deposit_amount or 0
            refund_type = 'full'
            photographer_fee_pct = 0
        else:
            # SURFER cancelled → apply photographer's cancellation fee setting
            photographer_fee_pct = 100  # Default: non-refundable (legacy behavior)
            if dispatch.photographer_id:
                photographer_result = await db.execute(
                    select(Profile).where(Profile.id == dispatch.photographer_id)
                )
                photographer_profile = photographer_result.scalar_one_or_none()
                if photographer_profile and photographer_profile.on_demand_cancellation_fee_pct is not None:
                    photographer_fee_pct = photographer_profile.on_demand_cancellation_fee_pct
            
            # Calculate refund: deposit minus fee
            fee_fraction = photographer_fee_pct / 100.0
            fee_amount = (dispatch.deposit_amount or 0) * fee_fraction
            refund_amount = (dispatch.deposit_amount or 0) - fee_amount
            
            if refund_amount >= (dispatch.deposit_amount or 0):
                refund_type = 'full'
            elif refund_amount > 0:
                refund_type = 'partial'
            else:
                refund_type = 'none'
    else:
        # Scheduled request - check timing
        if dispatch.requested_start_time:
            hours_until = (dispatch.requested_start_time - now).total_seconds() / 3600
            if hours_until >= 24:
                refund_amount = dispatch.deposit_amount
                refund_type = 'full'
            else:
                refund_amount = dispatch.deposit_amount / 2
                refund_type = 'half'
    
    dispatch.status = DispatchRequestStatusEnum.CANCELLED
    dispatch.status_changed_at = now
    dispatch.cancelled_at = now
    dispatch.cancelled_by = user_id
    dispatch.cancellation_reason = cancel_data.reason
    dispatch.refund_amount = refund_amount
    dispatch.refund_type = refund_type
    
    # Process refund to wallet
    if refund_amount > 0:
        requester_result = await db.execute(
            select(Profile).where(Profile.id == dispatch.requester_id)
        )
        requester = requester_result.scalar_one_or_none()
        
        if requester:
            tx = CreditTransaction(
                user_id=dispatch.requester_id,
                amount=refund_amount,
                balance_before=requester.credit_balance,
                balance_after=requester.credit_balance + refund_amount,
                transaction_type='dispatch_refund',
                reference_type='dispatch_request',
                reference_id=dispatch_id
            )
            db.add(tx)
            requester.credit_balance += refund_amount
    
    # ============ NOTIFICATION: Alert the other party about cancellation ============
    # Determine who to notify (the party that didn't cancel)
    if user_id == dispatch.photographer_id:
        # Photographer cancelled → notify surfer/requester
        notify_user_id = dispatch.requester_id
        # Get photographer name for the notification
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == dispatch.photographer_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        cancel_actor_name = photographer.full_name if photographer else "The photographer"
        
        refund_msg = f" ${refund_amount:.2f} has been refunded to your wallet." if refund_amount > 0 else ""
        cancel_notification = Notification(
            user_id=notify_user_id,
            type='dispatch_cancelled',
            title='Session Cancelled',
            body=f'{cancel_actor_name} has cancelled your on-demand session.{refund_msg}',
            data=json.dumps({
                'dispatch_id': dispatch_id,
                'action': 'cancelled',
                'cancelled_by': 'photographer',
                'refund_amount': refund_amount,
                'refund_type': refund_type
            })
        )
        db.add(cancel_notification)
    elif user_id == dispatch.requester_id and dispatch.photographer_id:
        # Surfer cancelled → notify photographer (if one was assigned)
        cancel_notification = Notification(
            user_id=dispatch.photographer_id,
            type='dispatch_cancelled',
            title='Session Cancelled',
            body=f'The surfer has cancelled the on-demand session.',
            data=json.dumps({
                'dispatch_id': dispatch_id,
                'action': 'cancelled',
                'cancelled_by': 'requester'
            })
        )
        db.add(cancel_notification)
    
    await db.commit()
    
    return {
        "id": dispatch_id,
        "status": "cancelled",
        "refund_amount": refund_amount,
        "refund_type": refund_type,
        "fee_amount": (dispatch.deposit_amount or 0) - refund_amount,
        "fee_pct": photographer_fee_pct if dispatch.is_immediate else 0,
        "message": f"Request cancelled. {f'${refund_amount:.2f} refunded to wallet.' if refund_amount > 0 else 'No refund due to cancellation policy.'}"
    }


# ============ CANCELLATION EXCEPTION REQUESTS ============

