"""Sessions join — surfer join flow with payment."""
from pydantic import BaseModel
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from datetime import datetime, timedelta, timezone
import json
from models import AnalyticsEvent, CreditTransaction, LiveSession, LiveSessionParticipant, Notification, PaymentTransaction, Post, Profile, RoleEnum, XPTransaction

from .schemas import JoinSessionRequest
from utils.credits import deduct_credits
import os, stripe, logging
STRIPE_API_KEY = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
if STRIPE_API_KEY: stripe.api_key = STRIPE_API_KEY
logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/sessions/join")
async def join_session(data: JoinSessionRequest, surfer_id: str, db: AsyncSession = Depends(get_db)):
    """
    Join a live session - SmugMug-style pricing:
    - Buy-in price to join the session
    - Additional per-photo price after buy-in
    - Subscription tier discounts apply
    - Creates a Check-In Post on the feed (Map â†’ Feed cross-pollination)
    - Updates user's surf streak (Payment â†’ Profile cross-pollination)
    - Supports God Mode persona masking for admin testing
    
    CaptureSession Unified Model:
    - Grom Parents CAN join sessions and buy photos (they are Participants/Buyers)
    - Grom Parents CANNOT create sessions (enforced in go-live endpoint)
    
    CRITICAL: Automated Credit Refund Logic
    - If payment succeeds but session join fails, credits are automatically refunded
    - User receives notification about the refund
    """
    from models import AnalyticsEvent
    
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Define roles that can join sessions (including Grom Parent as BUYER)
    # CaptureSession Core v2: Grom Parents are valid PARTICIPANTS (buyers) even though they can't CREATE sessions
    surfer_role_names = ['Grom', 'Surfer', 'Comp Surfer', 'Pro', 'Competition Surfer', 'Grom Parent', 'Hobbyist']
    surfer_roles = [RoleEnum.GROM, RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO, RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST]
    
    # Check role - support God Mode persona masking for admins
    actual_role = surfer.role
    effective_role = data.effective_role
    
    # If user is admin and has effective_role set (God Mode), use that for validation
    is_admin_testing = surfer.is_admin and effective_role is not None
    
    if is_admin_testing:
        # Admin testing with God Mode - check if effective_role is a surfer role
        if effective_role not in surfer_role_names:
            raise HTTPException(status_code=403, detail=f"Only surfers can join sessions. Current persona: {effective_role}")
    else:
        # Normal user - check actual role from database
        if actual_role not in surfer_roles:
            raise HTTPException(status_code=403, detail="Only surfers can join sessions")
    
    photographer_result = await db.execute(
        select(Profile)
        .where(Profile.id == data.photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        raise HTTPException(status_code=400, detail="Photographer is not currently shooting")
    
    existing = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == data.photographer_id)
        .where(LiveSessionParticipant.surfer_id == surfer_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already in this session")
    
    # SmugMug-style pricing: buy-in price for the session
    buyin_price = photographer.live_buyin_price or photographer.session_price or 25.0
    
    # Apply platform subscription tier discounts
    platform_discount = 0.0
    if surfer.subscription_tier == 'basic':
        platform_discount = 0.10  # 10% off
    elif surfer.subscription_tier == 'premium':
        platform_discount = 0.20  # 20% off
    
    # Apply photographer-specific subscription discount (stacks with platform discount)
    from routes.photo_subscriptions import get_subscription_discount, try_use_subscription_quota
    photo_sub_discount_pct = await get_subscription_discount(
        db, surfer_id, data.photographer_id, service_type='on_demand'
    )
    photo_sub_discount = photo_sub_discount_pct / 100.0  # Convert percentage to decimal
    
    # Combined discount: platform + photographer subscription (capped at 50%)
    discount = min(platform_discount + photo_sub_discount, 0.50)
    
    final_price = buyin_price * (1 - discount)
    
    # Try to use subscription live_buyin quota (free session if quota available)
    sub_quota_result = await try_use_subscription_quota(
        db, surfer_id, data.photographer_id, 'live_buyin'
    )
    subscription_covered = sub_quota_result.get("used", False)
    if subscription_covered:
        final_price = 0.0  # Subscription covers this buy-in
    
    # ============ CARD PAYMENT: Create Stripe Checkout Session ============
    if data.payment_method == 'card':
        if not STRIPE_API_KEY:
            raise HTTPException(status_code=500, detail="Payment processing not configured")
        
        origin_url = data.origin_url or "https://raw-surf-os.preview.emergentagent.com"
        
        # Store session data for completion after payment
        session_data = {
            "surfer_id": surfer_id,
            "photographer_id": data.photographer_id,
            "selfie_url": data.selfie_url,
            "amount": final_price,
            "photographer_name": photographer.full_name,
            "spot_name": photographer.current_spot.name if photographer.current_spot else "Live Session"
        }
        
        try:
            checkout_session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{
                    'price_data': {
                        'currency': 'usd',
                        'unit_amount': int(final_price * 100),
                        'product_data': {
                            'name': f"Live Session with {photographer.full_name}",
                            'description': f"Jump into live surf photography session",
                        },
                    },
                    'quantity': 1,
                }],
                mode='payment',
                success_url=f"{origin_url}/bookings?session_payment=success&checkout_session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{origin_url}/bookings?session_payment=cancelled",
                metadata={
                    "type": "live_session_join",
                    "surfer_id": surfer_id,
                    "photographer_id": data.photographer_id,
                    "amount": str(final_price)
                    # NOTE: selfie_url stored in PaymentTransaction, not Stripe (too large)
                }
            )
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")
        
        # Store pending transaction
        transaction = PaymentTransaction(
            user_id=surfer_id,
            session_id=checkout_session.id,
            amount=final_price,
            currency="usd",
            payment_status="Pending",
            status="Pending",
            transaction_metadata=json.dumps(session_data)
        )
        db.add(transaction)
        await db.commit()
        
        return {
            "requires_payment": True,
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id
        }
    
    # ============ CREDIT PAYMENT PROCESSING ============
    payment_processed = False
    new_balance = surfer.credit_balance
    photographer_credited = False
    photographer_credit_amount = 0.0
    
    if data.payment_method == 'credits':
        success, new_balance, error = await deduct_credits(
            user_id=surfer_id,
            amount=final_price,
            transaction_type='live_session_buyin',
            db=db,
            description=f"Live session buy-in with {photographer.full_name}",
            reference_type='live_session',
            reference_id=photographer.id,
            counterparty_id=photographer.id
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=error)
        
        payment_processed = True
        
        # Credit photographer - use proper balance based on role
        from utils.revenue_routing import is_pro_creator, is_hobbyist_creator
        
        photographer_credit_amount = final_price * 0.80  # 80% after platform fee
        
        if is_pro_creator(photographer.role):
            # Pro: goes to withdrawable credits
            photographer.withdrawable_credits += photographer_credit_amount
            photographer.credit_balance = photographer.withdrawable_credits
        elif is_hobbyist_creator(photographer.role):
            # Hobbyist: goes to gear credits
            photographer.gear_only_credits += photographer_credit_amount
            photographer.credit_balance = photographer.gear_only_credits
        else:
            # Other roles: regular credit balance
            photographer.credit_balance = (photographer.credit_balance or 0) + photographer_credit_amount
        
        photographer_credited = True
        
        # Log the credit transaction
        credit_tx = CreditTransaction(
            user_id=photographer.id,
            amount=photographer_credit_amount,
            balance_before=photographer.credit_balance - photographer_credit_amount,
            balance_after=photographer.credit_balance,
            transaction_type='live_session_earning',
            description=f"Live session buy-in from {surfer.full_name}",
            reference_type='live_session',
            reference_id=surfer_id,
            counterparty_id=surfer_id
        )
        db.add(credit_tx)
    
    # ============ TRY SESSION JOIN - REFUND ON FAILURE ============
    try:
        # Determine participant role (grom_buyer if parent is buying for child)
        participant_role = 'grom_buyer' if actual_role == RoleEnum.GROM_PARENT else 'participant'
        
        # Get photos included from session or photographer settings
        # Get the most recent active session (there might be multiple due to data issues)
        live_session_result = await db.execute(
            select(LiveSession)
            .where(LiveSession.photographer_id == data.photographer_id)
            .where(LiveSession.status == 'active')
            .order_by(LiveSession.created_at.desc())
            .limit(1)
        )
        active_session = live_session_result.scalar_one_or_none()
        
        # CaptureSession Core: Photos included in buy-in
        photos_included = 0
        if active_session and active_session.photos_included:
            photos_included = active_session.photos_included
        else:
            photos_included = photographer.live_session_photos_included or 3
        
        # ============ LOCK PRICING AT JOIN TIME ============
        # Capture the resolution-based prices the surfer agreed to when joining
        # These are used for gallery checkout to ensure rates persist even if photographer changes settings
        session_mode = active_session.session_mode if active_session else 'live_join'
        
        if active_session:
            locked_web = active_session.session_price_web or photographer.photo_price_web or photographer.live_photo_price_web or 3.0
            locked_standard = active_session.session_price_standard or photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0
            locked_high = active_session.session_price_high or photographer.photo_price_high or photographer.live_photo_price_high or 10.0
        else:
            locked_web = photographer.photo_price_web or photographer.live_photo_price_web or 3.0
            locked_standard = photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0
            locked_high = photographer.photo_price_high or photographer.live_photo_price_high or 10.0
        
        participant = LiveSessionParticipant(
            photographer_id=data.photographer_id,
            surfer_id=surfer_id,
            spot_id=photographer.current_spot_id,
            live_session_id=active_session.id if active_session else None,
            selfie_url=data.selfie_url,
            amount_paid=final_price,
            payment_method=data.payment_method,
            status='active',
            # CaptureSession Unified Fields
            participant_role=participant_role,
            photos_credit_remaining=photos_included,  # Photos included in buy-in
            resolution_preference=data.resolution or 'standard',
            # Locked Pricing - Captures rates at join time
            locked_price_web=locked_web,
            locked_price_standard=locked_standard,
            locked_price_high=locked_high,
        )
        
        db.add(participant)
        
        # Notify photographer
        notification = Notification(
            user_id=data.photographer_id,
            type='session_join',
            title=f"{surfer.full_name} joined your session!",
            body=f"${final_price:.2f} â€¢ {photographer.current_spot.name if photographer.current_spot else 'Current location'}",
            data=json.dumps({
                "surfer_id": surfer_id,
                "surfer_name": surfer.full_name,
                "selfie_url": data.selfie_url,
                "amount_paid": final_price
            })
        )
        db.add(notification)
        
        # ============ PUSH NOTIFICATION: Alert photographer ============
        # Send real-time push notification so photographer sees it immediately
        try:
            from routes.notifications.push import notify_session_join
            await notify_session_join(
                photographer_id=data.photographer_id,
                surfer_name=surfer.full_name,
                amount=final_price,
                spot_name=photographer.current_spot.name if photographer.current_spot else 'Current location',
                db=db
            )
        except Exception as push_err:
            logger.warning(f"Failed to send session join push notification: {push_err}")
        
        # ============ CROSS-POLLINATION: Map â†’ Feed ============
        # Create a Check-In Post when user joins a live session
        spot_name = photographer.current_spot.name if photographer.current_spot else photographer.location
        check_in_post = Post(
            author_id=surfer_id,
            caption=f"ðŸ“ Checked in at {spot_name} with {photographer.full_name}! ðŸ„â€â™‚ï¸",
            media_type='check_in',
            media_url=data.selfie_url,  # Use selfie if provided
            spot_id=photographer.current_spot_id,
            latitude=photographer.current_spot.latitude if photographer.current_spot else None,
            longitude=photographer.current_spot.longitude if photographer.current_spot else None,
            is_check_in=True,
            check_in_photographer_id=data.photographer_id,
            check_in_session_price=final_price
        )
        db.add(check_in_post)
        
        # ============ CROSS-POLLINATION: Payment â†’ Profile ============
        # Update user's surf streak
        today = datetime.now(timezone.utc).date()
        last_surf = surfer.last_surf_date
        
        if last_surf is None:
            # First surf ever
            surfer.surf_streak = 1
        elif last_surf == today:
            # Already surfed today, no change
            pass
        elif last_surf == today - timedelta(days=1):
            # Consecutive day - increase streak
            surfer.surf_streak = (surfer.surf_streak or 0) + 1
        else:
            # Streak broken - reset to 1
            surfer.surf_streak = 1
        
        surfer.last_surf_date = today
        surfer.total_sessions = (surfer.total_sessions or 0) + 1
        
        # Check for achievement badges
        badges_earned = []
        if surfer.surf_streak == 7:
            badges_earned.append('week_warrior')
        elif surfer.surf_streak == 30:
            badges_earned.append('monthly_shredder')
        elif surfer.total_sessions == 10:
            badges_earned.append('session_regular')
        elif surfer.total_sessions == 50:
            badges_earned.append('session_veteran')
        
        # Store badges if earned
        if badges_earned:
            current_badges = json.loads(surfer.badges or '[]')
            for badge in badges_earned:
                if badge not in current_badges:
                    current_badges.append(badge)
                    # Notify user of new badge
                    badge_notification = Notification(
                        user_id=surfer_id,
                        type='badge_earned',
                        title='New Badge Earned! ðŸ†',
                        body=f'You earned the {badge.replace("_", " ").title()} badge!',
                        data=json.dumps({"badge": badge})
                    )
                    db.add(badge_notification)
            surfer.badges = json.dumps(current_badges)
        
        # Track analytics
        analytics = AnalyticsEvent(
            event_type='session_joined',
            user_id=surfer_id,
            entity_type='live_session',
            entity_id=data.photographer_id,
            event_data=json.dumps({
                "photographer_id": data.photographer_id,
                "spot_id": photographer.current_spot_id,
                "amount_paid": final_price,
                "streak": surfer.surf_streak,
                "total_sessions": surfer.total_sessions
            })
        )
        db.add(analytics)
        
        # ============ GAMIFICATION: Award XP ============
        # Flush to get participant.id before creating XP transactions
        await db.flush()
        
        # Surfer gets XP for joining a session (25 XP)
        surfer_xp = XPTransaction(
            user_id=surfer_id,
            amount=25,
            reason='Joined a live session',
            reference_type='live_session',
            reference_id=str(participant.id) if participant.id else None
        )
        db.add(surfer_xp)
        
        # Photographer gets XP for hosting (15 XP per participant)
        photographer_xp = XPTransaction(
            user_id=data.photographer_id,
            amount=15,
            reason='Participant joined live session',
            reference_type='live_session',
            reference_id=str(participant.id) if participant.id else None
        )
        db.add(photographer_xp)
        
        # Commit all changes
        await db.commit()
        await db.refresh(participant)
        
        # NOTE: Badge milestone checks temporarily disabled due to async issues
        # TODO: Fix check_badge_milestones async handling
        
        return {
            "message": "Successfully joined session",
            "session_id": participant.id,
            "photographer_name": photographer.full_name,
            "spot_name": spot_name,
            "amount_paid": final_price,
            "discount_applied": discount * 100 if discount > 0 else 0,
            "platform_discount_pct": platform_discount * 100,
            "photographer_sub_discount_pct": photo_sub_discount_pct,
            "subscription_covered": subscription_covered,
            "remaining_credits": new_balance if data.payment_method == 'credits' else surfer.credit_balance,
            "photos_included": photographer.photo_package_size or 0,
            "price_per_photo": photographer.live_photo_price or 5.0,
            "check_in_created": True,
            "surf_streak": surfer.surf_streak,
            "badges_earned": badges_earned
        }
    
    except Exception as join_error:
        # ============ AUTOMATIC CREDIT REFUND ON FAILURE ============
        # Payment was processed but session join failed - refund the user
        logger.error(f"SESSION JOIN ERROR: {type(join_error).__name__}: {str(join_error)}")
        import traceback


        traceback.print_exc()
        
        await db.rollback()
        
        if payment_processed and data.payment_method == 'credits':
            try:
                # Re-fetch surfer after rollback
                surfer_refetch = await db.execute(select(Profile).where(Profile.id == surfer_id))
                surfer_for_refund = surfer_refetch.scalar_one_or_none()
                
                if surfer_for_refund:
                    # Refund credits to surfer
                    surfer_for_refund.credit_balance = (surfer_for_refund.credit_balance or 0) + final_price
                    surfer_for_refund.withdrawable_credits = (surfer_for_refund.withdrawable_credits or 0) + final_price
                    
                    # Log refund transaction
                    refund_tx = CreditTransaction(
                        user_id=surfer_id,
                        amount=final_price,
                        balance_before=surfer_for_refund.credit_balance - final_price,
                        balance_after=surfer_for_refund.credit_balance,
                        transaction_type='session_join_refund',
                        description=f"Auto-refund: Session join failed with {photographer.full_name}",
                        reference_type='refund',
                        reference_id=data.photographer_id,
                        counterparty_id=data.photographer_id
                    )
                    db.add(refund_tx)
                    
                    # Create notification for the surfer about the refund
                    refund_notification = Notification(
                        user_id=surfer_id,
                        type='credit_refund',
                        title='Session Join Failed - Credit Refunded',
                        body=f'A credit of ${final_price:.2f} has been added to your account for immediate use.',
                        data=json.dumps({
                            "refund_amount": final_price,
                            "photographer_id": data.photographer_id,
                            "photographer_name": photographer.full_name,
                            "reason": "session_join_failed"
                        })
                    )
                    db.add(refund_notification)
                    
                    await db.commit()
                    
                    # Return error with refund info
                    raise HTTPException(
                        status_code=500, 
                        detail={
                            "error": "Session join failed but your payment has been refunded",
                            "refunded": True,
                            "refund_amount": final_price,
                            "new_balance": surfer_for_refund.credit_balance,
                            "message": f"A credit of ${final_price:.2f} has been added to your account for immediate use."
                        }
                    )
            except HTTPException:
                raise
            except Exception as refund_error:
                # Refund also failed - log this critical error
                logger.error(f"CRITICAL: Payment refund failed for user {surfer_id}: {str(refund_error)}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "Session join failed. Please contact support for refund.",
                        "refunded": False,
                        "original_error": str(join_error),
                        "refund_error": str(refund_error)
                    }
                )
        
        # Non-credit payment or no payment processed - just raise the error
        raise HTTPException(status_code=500, detail=f"Failed to join session: {str(join_error)}")


class CompletePaymentRequest(BaseModel):
    checkout_session_id: str

