"""
dispatch/dispatch_matching.py — Payment success, photographer matching, crew notifications.

Extracted from sessions.py (v90) to comply with <800 LOC governance.
Contains: dispatch_payment_success, process_dispatch_notifications, notify_crew_members
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
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
    DispatchNotification, DispatchRequestStatusEnum,
    CreditTransaction, Notification, PaymentTransaction,
)
from services.onesignal_service import onesignal_service

from .schemas import get_available_pros

logger = logging.getLogger("routes.dispatch")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


@router.get("/payment-success")
async def dispatch_payment_success(
    session_id: str,
    dispatch_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Handle successful Stripe payment for on-demand dispatch.
    Confirms payment and moves dispatch to searching stage.
    """
    try:
        # Verify payment with Stripe
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        payment_status = checkout_session.payment_status
        
        if payment_status != 'paid':
            return {
                "success": False,
                "message": "Payment not confirmed yet",
                "payment_status": payment_status
            }
        
        # Get dispatch request
        result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.id == dispatch_id)
            .options(selectinload(DispatchRequest.requester))
        )
        dispatch = result.scalar_one_or_none()
        
        if not dispatch:
            raise HTTPException(status_code=404, detail="Dispatch request not found")
        
        # Already processed
        if dispatch.status != DispatchRequestStatusEnum.PENDING_PAYMENT:
            return {
                "success": True,
                "message": "Payment already confirmed",
                "dispatch_id": dispatch_id,
                "status": dispatch.status.value
            }
        
        # Mark as paid
        dispatch.deposit_paid = True
        dispatch.deposit_paid_at = datetime.now(timezone.utc)
        dispatch.stripe_checkout_session_id = session_id
        
        # Move to searching stage
        dispatch.status = DispatchRequestStatusEnum.SEARCHING_FOR_PRO
        dispatch.status_changed_at = datetime.now(timezone.utc)
        dispatch.dispatch_stage = 1
        dispatch.stage_1_started_at = datetime.now(timezone.utc)
        
        # Update payment transaction
        tx_result = await db.execute(
            select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
        )
        transaction = tx_result.scalar_one_or_none()
        if transaction:
            transaction.payment_status = "Completed"
            transaction.status = "Completed"
        
        # Record credit transaction for tracking (even though paid via Stripe)
        payer_id = checkout_session.metadata.get('user_id')
        payer_result = await db.execute(select(Profile).where(Profile.id == payer_id))
        payer = payer_result.scalar_one_or_none()
        
        if payer:
            amount = checkout_session.amount_total / 100  # Convert from cents
            tx = CreditTransaction(
                user_id=payer_id,
                amount=0,  # No credit deduction - paid via card
                balance_before=payer.credit_balance,
                balance_after=payer.credit_balance,
                transaction_type='dispatch_deposit_card',
                reference_type='dispatch_request',
                reference_id=dispatch_id,
                description=f'On-demand session deposit (card payment ${amount:.2f})'
            )
            db.add(tx)
            
            # METADATA INJECTION: Store captain info for photographer dashboard
            dispatch.captain_name = payer.full_name
            dispatch.captain_username = payer.username
            dispatch.captain_avatar_url = payer.avatar_url
        
        await db.commit()
        
        # Notify crew members about the shared session (if any)
        if dispatch.is_shared:
            background_tasks.add_task(
                notify_crew_members,
                dispatch_id=dispatch_id,
                captain_id=payer_id
            )
        
        # Start dispatch process in background
        background_tasks.add_task(
            process_dispatch_notifications,
            dispatch_id=dispatch_id
        )
        
        return {
            "success": True,
            "message": "Payment confirmed! Now add your selfie.",
            "dispatch_id": dispatch_id,
            "status": "searching_for_pro"
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Stripe verification error: {str(e)}")


async def process_dispatch_notifications(dispatch_id: str):
    """Background task to notify photographers in stages"""
    from database import async_session_maker
    from routes.notifications.push import notify_dispatch_alert
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.id == dispatch_id)
            .options(selectinload(DispatchRequest.requester))
        )
        dispatch = result.scalar_one_or_none()
        
        if not dispatch or dispatch.status != DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
            return
        
        requester_name = dispatch.requester.full_name if dispatch.requester else "A surfer"
        spot_name = dispatch.location_name or "Nearby"
        
        # If Quick Book - notify ONLY the target photographer
        if dispatch.target_photographer_id:
            # Fetch target photographer
            target_result = await db.execute(
                select(Profile).where(Profile.id == dispatch.target_photographer_id)
            )
            target_pro = target_result.scalar_one_or_none()
            
            if target_pro:
                # Calculate distance
                from utils.geo import haversine_distance
                distance = haversine_distance(
                    dispatch.latitude, dispatch.longitude,
                    target_pro.on_demand_latitude or target_pro.latitude or dispatch.latitude,
                    target_pro.on_demand_longitude or target_pro.longitude or dispatch.longitude
                )
                
                notification = DispatchNotification(
                    dispatch_request_id=dispatch_id,
                    photographer_id=target_pro.id,
                    dispatch_stage=1,
                    distance_miles=distance
                )
                db.add(notification)
                await db.commit()
                
                # Send push notification to target photographer
                try:
                    await notify_dispatch_alert(
                        photographer_id=target_pro.id,
                        spot_name=spot_name,
                        surfer_name=requester_name,
                        db=db
                    )
                except Exception as push_err:
                    logger.warning(f"Failed to send Quick Book push to {target_pro.full_name}: {push_err}")
                
                logger.info(f"[Dispatch] Sent Quick Book notification to {target_pro.full_name} for request {dispatch_id}")
            return
        
        # Regular dispatch - notify Approved Pros in radius (Stage 1)
        available_pros = await get_available_pros(
            db,
            dispatch.latitude,
            dispatch.longitude,
            dispatch.search_radius_miles,
            stage=1
        )
        
        for pro in available_pros:
            notification = DispatchNotification(
                dispatch_request_id=dispatch_id,
                photographer_id=pro.id,
                dispatch_stage=1,
                distance_miles=getattr(pro, '_distance', None)
            )
            db.add(notification)
            
            # Send push notification to each available pro
            try:
                await notify_dispatch_alert(
                    photographer_id=pro.id,
                    spot_name=spot_name,
                    surfer_name=requester_name,
                    db=db
                )
            except Exception as push_err:
                logger.warning(f"Failed to send dispatch push to {pro.full_name}: {push_err}")
        
        await db.commit()
        
        # Note: Stage 2 escalation would be handled by a scheduled job
        # after 60 seconds if no acceptance


async def notify_crew_members(dispatch_id: str, captain_id: str):
    """Background task to notify crew members about shared session via in-app + push"""
    from database import async_session_maker
    from routes.notifications.push import send_push_notification
    
    async with async_session_maker() as db:
        # Get dispatch request with requester info
        dispatch_result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.id == dispatch_id)
            .options(selectinload(DispatchRequest.requester))
        )
        dispatch = dispatch_result.scalar_one_or_none()
        
        if not dispatch or not dispatch.is_shared:
            return
        
        # Get crew participants
        participants_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id)
        )
        participants = participants_result.scalars().all()
        
        captain_name = dispatch.requester.full_name if dispatch.requester else "A surfer"
        captain_avatar = dispatch.requester.avatar_url if dispatch.requester else None
        location_name = dispatch.location_name or "Nearby"
        
        for participant in participants:
            # Skip participants who are already covered (captain pays their share)
            if participant.status == 'covered':
                logger.info(f"[Dispatch] Skipping notification for covered participant {participant.participant_id}")
                continue
            
            # 1. Create in-app notification
            notification = Notification(
                user_id=participant.participant_id,
                type='crew_session_invite',
                title='You\'ve been invited to a surf session!',
                body=f'{captain_name} invited you to join an on-demand photography session. Your share: ${participant.share_amount:.2f}',
                data=json.dumps({
                    'dispatch_id': dispatch_id,
                    'captain_id': captain_id,
                    'share_amount': float(participant.share_amount),
                    'action_url': f'/bookings?tab=on_demand&highlight={dispatch_id}'
                })
            )
            db.add(notification)
            
            # 2. Send OneSignal push notification so crew actually sees the invite
            try:
                await send_push_notification(
                    user_id=participant.participant_id,
                    title=f"🏄 {captain_name} invited you to surf!",
                    message=f"Your share: ${participant.share_amount:.2f} at {location_name}. Tap to join the session.",
                    data={
                        "type": "crew_session_invite",
                        "dispatch_id": dispatch_id,
                        "captain_name": captain_name,
                        "captain_avatar": captain_avatar,
                        "share_amount": float(participant.share_amount),
                        "location": location_name,
                        "deep_link": f"/bookings?tab=on_demand&highlight={dispatch_id}"
                    },
                    action_url=f"/bookings?tab=on_demand&highlight={dispatch_id}"
                )
                logger.info(f"[Dispatch] Sent push + in-app crew invite to participant {participant.participant_id}")
            except Exception as push_err:
                logger.warning(f"[Dispatch] Push failed for participant {participant.participant_id}: {push_err}")
        
        await db.commit()
