"""
dispatch/dispatch_transitions.py — Complete and cancel dispatch session transitions.

Extracted from lifecycle.py (v90) to comply with <800 LOC governance.
Contains: complete_dispatch_session, cancel_dispatch
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
import json
import os
import stripe

from database import get_db
from models import (
    Profile, DispatchRequest, DispatchRequestParticipant,
    DispatchRequestStatusEnum, Booking, CreditTransaction, Notification,
)

from .schemas import CancelDispatchRequest

logger = logging.getLogger("routes.dispatch")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


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

    # Reject if already cancelled or completed
    if dispatch.status in [DispatchRequestStatusEnum.CANCELLED, DispatchRequestStatusEnum.COMPLETED]:
        raise HTTPException(status_code=400, detail=f"Dispatch is already {dispatch.status.value}")

    # Only requester or photographer can cancel (normalize to str for safe comparison)
    allowed_ids = [str(dispatch.requester_id)]
    if dispatch.photographer_id:
        allowed_ids.append(str(dispatch.photographer_id))
    if str(user_id) not in allowed_ids:
        raise HTTPException(status_code=403, detail="Only the requester or assigned photographer can cancel")

    now = datetime.now(timezone.utc)

    # Calculate refund based on cancellation policy
    refund_amount = 0
    refund_type = 'none'
    photographer_fee_pct = 0

    if dispatch.is_immediate:
        # On-Demand: Check status for refund eligibility
        if dispatch.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
            # Not accepted yet — full refund
            refund_amount = dispatch.deposit_amount
            refund_type = 'full'
        elif dispatch.status == DispatchRequestStatusEnum.PRO_ACCEPTED:
            # Pro accepted — apply photographer's cancellation fee
            photographer_fee_pct = 50  # Default 50% fee
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
