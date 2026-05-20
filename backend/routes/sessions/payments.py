"""Sessions payments — complete payment flow."""
import json
import logging
import os
import stripe
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from models import LiveSession, Notification, Profile
from models import LiveSessionParticipant, PaymentTransaction
from .join import CompletePaymentRequest

STRIPE_API_KEY = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY
logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/sessions/complete-payment")
async def complete_session_payment(data: CompletePaymentRequest, db: AsyncSession = Depends(get_db)):
    """Complete a live session join after successful Stripe payment.
    
    IDEMPOTENCY: Uses SELECT FOR UPDATE on PaymentTransaction to prevent race conditions
    when multiple requests hit this endpoint simultaneously (e.g., React strict mode double-fire).
    """
    from sqlalchemy import text
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payment processing not configured")
    
    try:
        # Retrieve the Stripe checkout session
        checkout_session = stripe.checkout.Session.retrieve(data.checkout_session_id)
        
        if checkout_session.payment_status != 'paid':
            raise HTTPException(status_code=400, detail="Payment not completed")
        
        metadata = checkout_session.metadata
        if metadata.get('type') != 'live_session_join':
            raise HTTPException(status_code=400, detail="Invalid session type")
        
        surfer_id = metadata.get('surfer_id')
        photographer_id = metadata.get('photographer_id')
        amount = float(metadata.get('amount', 0))
        
        # ============ ATOMIC IDEMPOTENCY CHECK WITH ROW LOCK ============
        # Use FOR UPDATE to lock the row while we check and update status
        # This prevents concurrent requests from both passing the check
        tx_result = await db.execute(
            select(PaymentTransaction)
            .where(PaymentTransaction.session_id == data.checkout_session_id)
            .with_for_update()  # Row-level lock
        )
        tx = tx_result.scalar_one_or_none()
        
        # If already completed, return success (idempotent)
        if tx and tx.payment_status == 'Completed':
            return {"success": True, "message": "Session already activated"}
        
        # Also check if participant already exists (belt + suspenders)
        existing_participant_result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.surfer_id == surfer_id)
            .where(LiveSessionParticipant.photographer_id == photographer_id)
            .where(LiveSessionParticipant.payment_method == 'card')
            .where(LiveSessionParticipant.status == 'active')
        )
        if existing_participant_result.scalar_one_or_none():
            # Mark transaction as completed if not already
            if tx and tx.payment_status != 'Completed':
                tx.payment_status = 'Completed'
                tx.status = 'Completed'
                await db.commit()
            return {"success": True, "message": "Session already activated"}
        
        # ============ CLAIM THE TRANSACTION IMMEDIATELY ============
        # Mark as Completed BEFORE creating participant to win any race
        if tx:
            tx.payment_status = 'Completed'
            tx.status = 'Completed'
            await db.flush()  # Flush immediately - other concurrent requests will now see 'Completed'
        
        # Get surfer and photographer
        surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == photographer_id).options(selectinload(Profile.current_spot)).with_for_update()
        )
        photographer = photographer_result.scalar_one_or_none()
        
        if not surfer or not photographer:
            raise HTTPException(status_code=404, detail="User or photographer not found")
        
        # Get selfie_url from our stored transaction
        selfie_url = None
        if tx and tx.transaction_metadata:
            tx_data = json.loads(tx.transaction_metadata)
            selfie_url = tx_data.get('selfie_url')
        
        # Find the active live session for this photographer to link the participant
        active_ls_result = await db.execute(
            select(LiveSession)
            .where(LiveSession.photographer_id == photographer_id)
            .where(LiveSession.status == 'active')
            .order_by(LiveSession.created_at.desc())
            .limit(1)
        )
        active_live_session = active_ls_result.scalar_one_or_none()
        
        # CaptureSession: Calculate photos included in buy-in
        photos_included = 0
        if active_live_session and active_live_session.photos_included:
            photos_included = active_live_session.photos_included
        else:
            photos_included = photographer.live_session_photos_included or 3
        
        # Lock pricing at join time (same as credit path)
        if active_live_session:
            locked_web = active_live_session.session_price_web or photographer.photo_price_web or photographer.live_photo_price_web or 3.0
            locked_standard = active_live_session.session_price_standard or photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0
            locked_high = active_live_session.session_price_high or photographer.photo_price_high or photographer.live_photo_price_high or 10.0
        else:
            locked_web = photographer.photo_price_web or photographer.live_photo_price_web or 3.0
            locked_standard = photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0
            locked_high = photographer.photo_price_high or photographer.live_photo_price_high or 10.0
        
        # Create the session participant
        participant = LiveSessionParticipant(
            surfer_id=surfer_id,
            photographer_id=photographer_id,
            spot_id=photographer.current_spot_id,
            live_session_id=active_live_session.id if active_live_session else None,
            selfie_url=selfie_url,
            participant_role='participant',
            status='active',
            amount_paid=amount,
            payment_method='card',
            # CaptureSession fields (previously missing for card payments!)
            photos_credit_remaining=photos_included,
            resolution_preference='standard',
            locked_price_web=locked_web,
            locked_price_standard=locked_standard,
            locked_price_high=locked_high,
        )
        db.add(participant)
        
        # Credit the photographer (80% after platform fee)
        photographer_credit = amount * 0.80
        photographer.credit_balance = (photographer.credit_balance or 0) + photographer_credit
        
        # Notify photographer (card payment path was missing this)
        card_notification = Notification(
            user_id=photographer_id,
            type='session_join',
            title=f"{surfer.full_name} joined your session!",
            body=f"${amount:.2f} (card) \u2022 {photographer.current_spot.name if photographer.current_spot else 'Current location'}",
            data=json.dumps({
                "surfer_id": surfer_id,
                "surfer_name": surfer.full_name,
                "selfie_url": selfie_url,
                "amount_paid": amount
            })
        )
        db.add(card_notification)
        
        # Send real-time push notification
        try:
            from routes.notifications.push import notify_session_join


            await notify_session_join(
                photographer_id=photographer_id,
                surfer_name=surfer.full_name,
                amount=amount,
                spot_name=photographer.current_spot.name if photographer.current_spot else 'Current location',
                db=db
            )
        except Exception as push_err:
            logger.warning(f"Failed to send card session join push: {push_err}")
        
        await db.commit()
        
        return {
            "success": True,
            "message": "Successfully joined session",
            "session_id": str(participant.id),
            "photographer_name": photographer.full_name
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Payment verification failed: {str(e)}")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to complete session: {str(e)}")


