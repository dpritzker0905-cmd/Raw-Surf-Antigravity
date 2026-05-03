"""
Dispatch status queries -- get dispatch, active, photographer pending, crew-status, verify-payment.

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

@router.get("/{dispatch_id}")
async def get_dispatch_request(
    dispatch_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get dispatch request details"""
    result = await db.execute(
        select(DispatchRequest)

        .where(DispatchRequest.id == dispatch_id)
        .options(
            selectinload(DispatchRequest.requester),
            selectinload(DispatchRequest.photographer),
            selectinload(DispatchRequest.spot)
        )
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Get participants for shared sessions
    participants_data = []
    if dispatch.is_shared:
        participants_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id)
        )
        participants = participants_result.scalars().all()
        
        for p in participants:
            # Get participant profile
            profile_result = await db.execute(
                select(Profile).where(Profile.id == p.participant_id)
            )
            profile = profile_result.scalar_one_or_none()
            
            participants_data.append({
                "id": p.id,
                "user_id": p.participant_id,
                "name": profile.full_name if profile else "Unknown",
                "username": profile.username if profile else None,
                "avatar_url": profile.avatar_url if profile else None,
                "selfie_url": p.selfie_url,  # Session selfie for identification
                "share_amount": float(p.share_amount),
                "status": p.status,
                "paid": p.paid,  # Boolean payment flag
                "paid_at": p.paid_at.isoformat() if p.paid_at else None
            })
    
    return {
        "id": dispatch.id,
        "status": dispatch.status.value,
        "requester": {
            "id": dispatch.requester.id,
            "name": dispatch.requester.full_name,
            "avatar": dispatch.requester.avatar_url
        } if dispatch.requester else None,
        "photographer": {
            "id": dispatch.photographer.id,
            "name": dispatch.photographer.full_name,
            "avatar": dispatch.photographer.avatar_url
        } if dispatch.photographer else None,
        "location": {
            "lat": dispatch.latitude,
            "lng": dispatch.longitude,
            "name": dispatch.location_name
        },
        "spot": {
            "id": dispatch.spot.id,
            "name": dispatch.spot.name
        } if dispatch.spot else None,
        "pricing": {
            "hourly_rate": dispatch.hourly_rate,
            "estimated_duration": dispatch.estimated_duration_hours,
            "estimated_total": dispatch.estimated_total,
            "deposit_pct": dispatch.deposit_pct,
            "deposit_amount": dispatch.deposit_amount,
            "deposit_paid": dispatch.deposit_paid
        },
        "gps": {
            "photographer": {
                "lat": dispatch.photographer_lat,
                "lng": dispatch.photographer_lng,
                "updated": dispatch.photographer_last_update.isoformat() if dispatch.photographer_last_update else None
            },
            "requester": {
                "lat": dispatch.requester_lat,
                "lng": dispatch.requester_lng,
                "updated": dispatch.requester_last_update.isoformat() if dispatch.requester_last_update else None
            },
            "eta_minutes": dispatch.estimated_arrival_minutes
        },
        "timestamps": {
            "created": dispatch.created_at.isoformat(),
            "accepted": dispatch.accepted_at.isoformat() if dispatch.accepted_at else None,
            "arrived": dispatch.arrived_at.isoformat() if dispatch.arrived_at else None,
            "cancelled": dispatch.cancelled_at.isoformat() if dispatch.cancelled_at else None
        },
        "is_shared": dispatch.is_shared,
        "participants": participants_data,
        "booking_id": dispatch.booking_id,
        "selfie_url": dispatch.selfie_url,
        "cancelled_reason": dispatch.cancellation_reason,
        "refund_amount": dispatch.refund_amount if hasattr(dispatch, 'refund_amount') else None,
        "location_name": dispatch.location_name,
        "arrival_window_minutes": dispatch.arrival_window_minutes,
        "estimated_duration_hours": dispatch.estimated_duration_hours,
        "location_locked": dispatch.status.value not in ['pending_payment', 'searching_for_pro'],
    }


@router.get("/user/{user_id}/active")
async def get_active_dispatch(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's active dispatch request (if any) - includes requests where user is requester, photographer, or PAID crew member"""
    
    # First check as requester or photographer
    result = await db.execute(
        select(DispatchRequest)
        .where(
            or_(
                DispatchRequest.requester_id == user_id,
                DispatchRequest.photographer_id == user_id
            ),
            DispatchRequest.status.in_([
                DispatchRequestStatusEnum.PENDING_PAYMENT,
                DispatchRequestStatusEnum.SEARCHING_FOR_PRO,
                DispatchRequestStatusEnum.ACCEPTED,
                DispatchRequestStatusEnum.EN_ROUTE,
                DispatchRequestStatusEnum.ARRIVED
            ])
        )
        .options(
            selectinload(DispatchRequest.requester),
            selectinload(DispatchRequest.photographer)
        )
        .order_by(DispatchRequest.created_at.desc())
        .limit(1)
    )
    dispatch = result.scalar_one_or_none()
    
    # If not found, check if user is a PAID crew member
    if not dispatch:
        participant_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(
                DispatchRequestParticipant.participant_id == user_id,
                DispatchRequestParticipant.paid == True
            )
            .options(
                selectinload(DispatchRequestParticipant.dispatch_request)
                .selectinload(DispatchRequest.requester),
                selectinload(DispatchRequestParticipant.dispatch_request)
                .selectinload(DispatchRequest.photographer)
            )
            .order_by(DispatchRequestParticipant.paid_at.desc())
            .limit(1)
        )
        participant = participant_result.scalar_one_or_none()
        
        if participant and participant.dispatch_request:
            dispatch = participant.dispatch_request
            # Only return if dispatch is in active state
            if dispatch.status not in [
                DispatchRequestStatusEnum.PENDING_PAYMENT,
                DispatchRequestStatusEnum.SEARCHING_FOR_PRO,
                DispatchRequestStatusEnum.ACCEPTED,
                DispatchRequestStatusEnum.EN_ROUTE,
                DispatchRequestStatusEnum.ARRIVED
            ]:
                dispatch = None
    
    if not dispatch:
        return {"active_dispatch": None}
    
    # Determine role
    if dispatch.requester_id == user_id:
        role = "requester"
    elif dispatch.photographer_id == user_id:
        role = "photographer"
    else:
        role = "crew_member"
    
    # Get crew participant info including selfies
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
    )
    crew_participants = crew_result.scalars().all()
    
    # Build crew info with selfies - use cached metadata when available
    crew_info = []
    for cp in crew_participants:
        # Prefer cached metadata (written atomically with payment)
        if cp.payer_name or cp.payer_username:
            crew_info.append({
                "id": cp.participant_id,
                "name": cp.payer_name,
                "username": cp.payer_username,
                "avatar_url": cp.payer_avatar_url,
                "selfie_url": cp.selfie_url,
                "status": cp.status,
                "paid": cp.paid,
                "share_amount": cp.share_amount
            })
        else:
            # Fall back to profile lookup
            member_result = await db.execute(
                select(Profile).where(Profile.id == cp.participant_id)
            )
            member = member_result.scalar_one_or_none()
            if member:
                crew_info.append({
                    "id": member.id,
                    "name": member.full_name,
                    "username": member.username,
                    "avatar_url": member.avatar_url,
                    "selfie_url": cp.selfie_url,
                    "status": cp.status,
                    "paid": cp.paid,
                    "share_amount": cp.share_amount
                })
    
    # Fetch surfer profile data for photographer identification
    requester_stance = None
    requester_board_desc = None
    if dispatch.requester:
        requester_stance = dispatch.requester.stance
        requester_board_desc = await _get_surfer_board_description(db, dispatch.requester_id)

    return {
        "active_dispatch": {
            "id": dispatch.id,
            "status": dispatch.status.value,
            "role": role,
            "photographer_id": dispatch.photographer_id,  # Only set after acceptance
            "target_photographer_id": dispatch.target_photographer_id,  # Quick Book target (not yet accepted)
            "photographer_name": dispatch.photographer.full_name if dispatch.photographer else None,
            "requester_id": dispatch.requester_id,
            "requester_name": dispatch.requester.full_name if dispatch.requester else None,
            "requester_username": dispatch.requester.username if dispatch.requester else None,
            "requester_selfie": dispatch.selfie_url,
            "requester_avatar": dispatch.requester.avatar_url if dispatch.requester else None,
            "requester_stance": requester_stance,
            "requester_board_description": requester_board_desc,
            "eta_minutes": dispatch.estimated_arrival_minutes,
            "location_name": dispatch.location_name,
            "is_shared": dispatch.is_shared,
            "crew": crew_info,
            "created_at": dispatch.created_at.isoformat() if dispatch.created_at else None
        }
    }


@router.get("/photographer/{photographer_id}/pending")
async def get_pending_dispatch_notifications(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get pending dispatch notifications for a photographer"""
    result = await db.execute(
        select(DispatchNotification)
        .where(
            DispatchNotification.photographer_id == photographer_id,
            DispatchNotification.response == None
        )
        .options(
            selectinload(DispatchNotification.dispatch_request)
            .selectinload(DispatchRequest.requester)
        )
        .order_by(DispatchNotification.created_at.desc())
    )
    notifications = result.scalars().all()
    
    pending = []
    for notif in notifications:
        dispatch = notif.dispatch_request
        if dispatch.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
            # Get crew participants
            crew_result = await db.execute(
                select(DispatchRequestParticipant)
                .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
            )
            crew_participants = crew_result.scalars().all()
            
            # Get crew member details - use cached metadata if available for instant sync
            crew_info = []
            for cp in crew_participants:
                # Prefer cached metadata (written atomically with payment) for instant dashboard sync
                # Fall back to profile lookup if cached data not available
                if cp.payer_name or cp.payer_username:
                    # Use cached data - guaranteed to be present if payment succeeded
                    crew_info.append({
                        "id": cp.participant_id,
                        "name": cp.payer_name,
                        "username": cp.payer_username,
                        "avatar_url": cp.payer_avatar_url,
                        "selfie_url": cp.selfie_url,
                        "status": cp.status,
                        "paid": cp.paid,
                        "share_amount": cp.share_amount,
                        "paid_at": cp.paid_at.isoformat() if cp.paid_at else None
                    })
                else:
                    # Fall back to profile lookup for unpaid or legacy participants
                    member_result = await db.execute(
                        select(Profile).where(Profile.id == cp.participant_id)
                    )
                    member = member_result.scalar_one_or_none()
                    if member:
                        crew_info.append({
                            "id": member.id,
                            "name": member.full_name,
                            "username": member.username,
                            "avatar_url": member.avatar_url,
                            "selfie_url": cp.selfie_url,
                            "status": cp.status,
                            "paid": cp.paid,
                            "share_amount": cp.share_amount,
                            "paid_at": cp.paid_at.isoformat() if cp.paid_at else None
                        })
            
            # Fetch surfer profile data for identification
            requester_stance = None
            requester_board_desc = None
            if dispatch.requester:
                requester_stance = dispatch.requester.stance
                requester_board_desc = await _get_surfer_board_description(db, dispatch.requester_id)

            pending.append({
                "notification_id": notif.id,
                "dispatch_id": dispatch.id,
                "requester_id": dispatch.requester_id,
                # Use cached captain metadata if available (guaranteed present after atomic payment)
                "requester_name": dispatch.captain_name or (dispatch.requester.full_name if dispatch.requester else None),
                "requester_username": dispatch.captain_username or (dispatch.requester.username if dispatch.requester else None),
                "requester_avatar": dispatch.captain_avatar_url or (dispatch.requester.avatar_url if dispatch.requester else None),
                "requester_selfie": dispatch.selfie_url,
                "requester_stance": requester_stance,
                "requester_board_description": requester_board_desc,
                "captain_metadata_verified": bool(dispatch.captain_name),  # True if atomic payment stored metadata
                "location": {
                    "lat": dispatch.latitude,
                    "lng": dispatch.longitude,
                    "name": dispatch.location_name
                },
                "distance_miles": notif.distance_miles,
                "hourly_rate": dispatch.hourly_rate,
                "estimated_duration": dispatch.estimated_duration_hours,
                "deposit_amount": dispatch.deposit_amount,
                "is_shared": dispatch.is_shared,
                "crew_count": len(crew_info) + 1,  # +1 for requester
                "crew": crew_info,
                "crew_payment_status": {
                    "paid_count": sum(1 for c in crew_info if c.get('paid')),
                    "total_count": len(crew_info),
                    "captain_paid": dispatch.deposit_paid,
                    "all_paid": dispatch.all_participants_paid or False,
                    "fully_funded": dispatch.deposit_paid and (dispatch.all_participants_paid or len(crew_info) == 0)
                },
                "arrival_window_minutes": dispatch.arrival_window_minutes,  # 30, 60, or 90 min
                "requested_start_time": dispatch.requested_start_time.isoformat() if dispatch.requested_start_time else None,
                "created_at": notif.created_at.isoformat()
            })
    
    return {"pending_dispatches": pending}


@router.get("/{dispatch_id}/crew-status")
async def get_dispatch_crew_status(
    dispatch_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get real-time crew payment status for a dispatch.
    Used by photographer dashboard for reactive updates (polling).
    Returns all crew members with their payment status and selfies.
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    # Get all crew participants
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id)
    )
    crew_participants = crew_result.scalars().all()
    
    # Build crew info with cached metadata
    crew_info = []
    for cp in crew_participants:
        if cp.payer_name or cp.payer_username:
            crew_info.append({
                "id": cp.participant_id,
                "name": cp.payer_name,
                "username": cp.payer_username,
                "avatar_url": cp.payer_avatar_url,
                "selfie_url": cp.selfie_url,
                "status": cp.status,
                "paid": cp.paid,
                "paid_at": cp.paid_at.isoformat() if cp.paid_at else None,
                "share_amount": cp.share_amount
            })
        else:
            member_result = await db.execute(
                select(Profile).where(Profile.id == cp.participant_id)
            )
            member = member_result.scalar_one_or_none()
            if member:
                crew_info.append({
                    "id": member.id,
                    "name": member.full_name,
                    "username": member.username,
                    "avatar_url": member.avatar_url,
                    "selfie_url": cp.selfie_url,
                    "status": cp.status,
                    "paid": cp.paid,
                    "paid_at": cp.paid_at.isoformat() if cp.paid_at else None,
                    "share_amount": cp.share_amount
                })
    
    paid_crew = sum(1 for c in crew_info if c.get('paid'))
    total_crew = len(crew_info)
    
    # Fetch surfer profile data for photographer identification
    captain_stance = None
    captain_board_desc = None
    if dispatch.requester:
        captain_stance = dispatch.requester.stance
        captain_board_desc = await _get_surfer_board_description(db, dispatch.requester_id)

    return {
        "dispatch_id": dispatch_id,
        "status": dispatch.status.value,
        "captain": {
            "id": dispatch.requester_id,
            # Use cached metadata if available (guaranteed present after payment)
            "name": dispatch.captain_name or (dispatch.requester.full_name if dispatch.requester else None),
            "username": dispatch.captain_username or (dispatch.requester.username if dispatch.requester else None),
            "avatar_url": dispatch.captain_avatar_url or (dispatch.requester.avatar_url if dispatch.requester else None),
            "selfie_url": dispatch.selfie_url,
            "stance": captain_stance,
            "board_description": captain_board_desc,
            "paid": dispatch.deposit_paid,
            "metadata_verified": bool(dispatch.captain_name)  # True if atomic metadata was stored
        },
        "crew": crew_info,
        "payment_status": {
            "captain_paid": dispatch.deposit_paid,
            "crew_paid_count": paid_crew,
            "crew_total_count": total_crew,
            "all_crew_paid": paid_crew >= total_crew if total_crew > 0 else True,
            "fully_funded": dispatch.deposit_paid and (paid_crew >= total_crew if total_crew > 0 else True),
            "display": f"{paid_crew + (1 if dispatch.deposit_paid else 0)}/{total_crew + 1} paid"
        },
        "updated_at": dispatch.updated_at.isoformat() if dispatch.updated_at else None
    }


@router.get("/{dispatch_id}/verify-payment")
async def verify_dispatch_payment(
    dispatch_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Verify that payment was successful AND participant metadata was stored.
    Frontend must call this before showing "Success" screen.
    
    VALIDATION: Returns success=True only if:
    1. Dispatch exists and is in valid state
    2. User is either captain (with deposit_paid=True) or crew member (with paid=True)
    3. User metadata (name/username) is stored in the record
    
    This prevents "phantom" bookings where payment succeeded but metadata was lost.
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        return {
            "success": False,
            "verified": False,
            "error": "Dispatch not found",
            "action": "retry_payment"
        }
    
    # Check if user is the captain
    is_captain = dispatch.requester_id == user_id
    
    if is_captain:
        # Validate captain payment + metadata
        if not dispatch.deposit_paid:
            return {
                "success": False,
                "verified": False,
                "error": "Payment not confirmed",
                "action": "retry_payment"
            }
        
        # Check if captain metadata was stored (atomic transaction proof)
        has_metadata = bool(dispatch.captain_name or dispatch.captain_username)
        
        if not has_metadata:
            # Attempt to recover metadata from requester profile
            if dispatch.requester:
                dispatch.captain_name = dispatch.requester.full_name
                dispatch.captain_username = dispatch.requester.username
                dispatch.captain_avatar_url = dispatch.requester.avatar_url
                await db.commit()
                has_metadata = True
        
        return {
            "success": True,
            "verified": has_metadata,
            "role": "captain",
            "dispatch_id": dispatch_id,
            "status": dispatch.status.value,
            "metadata": {
                "name": dispatch.captain_name,
                "username": dispatch.captain_username,
                "selfie_url": dispatch.selfie_url
            },
            "needs_selfie": not bool(dispatch.selfie_url)
        }
    
    # Check if user is a crew member
    participant_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.dispatch_request_id == dispatch_id,
            DispatchRequestParticipant.participant_id == user_id
        )
    )
    participant = participant_result.scalar_one_or_none()
    
    if not participant:
        return {
            "success": False,
            "verified": False,
            "error": "User is not a participant in this session",
            "action": "check_invite"
        }
    
    if not participant.paid:
        return {
            "success": False,
            "verified": False,
            "error": "Payment not confirmed",
            "action": "complete_payment"
        }
    
    # Check if crew member metadata was stored
    has_metadata = bool(participant.payer_name or participant.payer_username)
    
    return {
        "success": True,
        "verified": has_metadata,
        "role": "crew_member",
        "dispatch_id": dispatch_id,
        "participant_id": participant.id,
        "status": dispatch.status.value,
        "metadata": {
            "name": participant.payer_name,
            "username": participant.payer_username,
            "selfie_url": participant.selfie_url
        },
        "needs_selfie": not bool(participant.selfie_url)
    }


@router.get("/{dispatch_id}/tracking")
async def get_dispatch_tracking(
    dispatch_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get real-time tracking data for a dispatch"""
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(
            selectinload(DispatchRequest.photographer),
            selectinload(DispatchRequest.requester)
        )
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    return {
        "id": dispatch.id,
        "status": dispatch.status.value,
        "photographer_location": {
            "lat": dispatch.photographer_lat,
            "lng": dispatch.photographer_lng,
            "updated": dispatch.photographer_last_update.isoformat() if dispatch.photographer_last_update else None,
            "name": dispatch.photographer.full_name if dispatch.photographer else None,
            "avatar": dispatch.photographer.avatar_url if dispatch.photographer else None
        } if dispatch.photographer_lat else None,
        "requester_location": {
            "lat": dispatch.requester_lat,
            "lng": dispatch.requester_lng,
            "updated": dispatch.requester_last_update.isoformat() if dispatch.requester_last_update else None,
            "name": dispatch.requester.full_name if dispatch.requester else None
        } if dispatch.requester_lat else None,
        "destination": {
            "lat": dispatch.latitude,
            "lng": dispatch.longitude,
            "name": dispatch.location_name
        },
        "estimated_arrival_minutes": dispatch.estimated_arrival_minutes
    }
