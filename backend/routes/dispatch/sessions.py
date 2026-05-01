"""
Core dispatch session lifecycle -- create, pay, checkout, payment-success.

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

# ===================== ROUTES =====================

@router.get("/available-pros")
async def get_available_photographers(
    latitude: float,
    longitude: float,
    radius_miles: float = 10.0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get available Pro photographers for surfer to see
    Returns list with city/county (not exact location for privacy)
    Priority ordered: Top-Level Pros > Streak Holders > Nearest
    """
    # Get from both stages
    available_pros = await get_available_pros(
        db, latitude, longitude, radius_miles, stage=1
    )
    
    if len(available_pros) < 5:  # If less than 5 Approved Pros, include regular Pros
        stage2_pros = await get_available_pros(
            db, latitude, longitude, radius_miles, stage=2
        )
        # Filter out duplicates (already have Approved Pros)
        existing_ids = {p.id for p in available_pros}
        for p in stage2_pros:
            if p.id not in existing_ids:
                available_pros.append(p)
    
    # Return sanitized list (no exact GPS for privacy)
    result = []
    for p in available_pros:
        result.append({
            "id": str(p.id),
            "name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": str(p.role.value) if hasattr(p.role, 'value') else str(p.role),
            "is_top_level": p.role == RoleEnum.APPROVED_PRO,
            "city": p.on_demand_city or "Your Area",
            "county": p.on_demand_county or "Nearby",
            "hourly_rate": p.on_demand_hourly_rate or 75.0,
            "streak": getattr(p, '_streak', 0),
            "is_hot_streak": getattr(p, '_is_hot_streak', False),
            "distance_miles": round(getattr(p, '_distance', 0), 1),
            "priority_score": getattr(p, '_priority_score', 0),
            "xp_total": p.xp_total or 0
        })
    
    return {
        "available_count": len(result),
        "photographers": result
    }


@router.get("/requests/pending")
async def get_pending_requests(db: AsyncSession = Depends(get_db)):
    """
    Get all active dispatch requests searching for a photographer.
    Used by photographers to see 'breathing green markers' on the map.
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO)
        .options(selectinload(DispatchRequest.requester))
    )
    requests = result.scalars().all()
    
    output = []
    for req in requests:
        # Determine priority badge based on requester role
        badge = {"level": "regular", "label": "Surfer", "color": "cyan"}
        if req.requester:
            if req.requester.role == RoleEnum.PRO:
                badge = {"level": "pro", "label": "Pro", "color": "amber"}
            elif req.requester.role == RoleEnum.COMP_SURFER:
                badge = {"level": "comp", "label": "Competitor", "color": "purple"}
                
        output.append({
            "id": req.id,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "location_name": req.location_name,
            "estimated_duration_hours": req.estimated_duration_hours,
            "is_boosted": getattr(req, 'is_boosted', False),
            "priority_badge": badge,
            "hourly_rate": req.hourly_rate,
            "estimated_total": req.estimated_total
        })
        
    return output


@router.post("/request")
async def create_dispatch_request(
    request_data: CreateDispatchRequest,
    requester_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new on-demand dispatch request
    Returns payment intent for deposit
    
    Time Guardrails:
    - On-Demand (is_immediate=True): Current-day only, no scheduling allowed
    - Scheduled (is_immediate=False): Requires 24-hour lead time
    """
    # Verify requester exists
    result = await db.execute(select(Profile).where(Profile.id == requester_id))
    requester = result.scalar_one_or_none()
    
    if not requester:
        raise HTTPException(status_code=404, detail="Requester not found")
    
    # ============ TIME GUARDRAILS ============
    now = datetime.now(timezone.utc)
    
    if request_data.is_immediate:
        # On-Demand requests must be within a reasonable timeframe (next 3 hours)
        # This avoids timezone issues while still preventing abuse
        if request_data.requested_start_time:
            time_until_start = request_data.requested_start_time - now
            hours_until_start = time_until_start.total_seconds() / 3600
            # Allow requests up to 3 hours out (covers 90-min arrival + buffer)
            # Also allow slightly in the past (user's clock might be off)
            if hours_until_start > 3 or hours_until_start < -0.5:
                raise HTTPException(
                    status_code=400, 
                    detail="On-Demand requests must be within the next 3 hours. Use Scheduled Booking for later times."
                )
    else:
        # Scheduled requests require 24-hour lead time
        if request_data.requested_start_time:
            lead_time = request_data.requested_start_time - now
            if lead_time.total_seconds() < 86400:  # 24 hours in seconds
                raise HTTPException(
                    status_code=400,
                    detail="Scheduled bookings require at least 24 hours advance notice."
                )
    
    # If target photographer specified (Quick Book), verify they exist and are available
    target_pro = None
    if request_data.target_photographer_id:
        result = await db.execute(
            select(Profile).where(Profile.id == request_data.target_photographer_id)
        )
        target_pro = result.scalar_one_or_none()
        if not target_pro:
            raise HTTPException(status_code=404, detail="Target photographer not found")
        if not target_pro.on_demand_available:
            raise HTTPException(status_code=400, detail="Photographer is not currently available for on-demand")
        available_pros = [target_pro]
    else:
        # Find nearest available Pro to estimate pricing
        available_pros = await get_available_pros(
            db, 
            request_data.latitude, 
            request_data.longitude,
            radius_miles=10.0,
            stage=1
        )
        
        if not available_pros:
            # Check stage 2
            available_pros = await get_available_pros(
                db,
                request_data.latitude,
                request_data.longitude,
                radius_miles=10.0,
                stage=2
            )
    
    if not available_pros:
        raise HTTPException(
            status_code=404, 
            detail="No photographers available in your area. Try again later."
        )
    
    # Use average rate of available pros
    avg_rate = sum(p.on_demand_hourly_rate or 75.0 for p in available_pros) / len(available_pros)
    
    # Calculate base pricing
    hourly_rate = avg_rate
    estimated_total = hourly_rate * request_data.estimated_duration_hours
    
    # Apply photographer-specific subscription discount (Quick Book only)
    subscription_discount_pct = 0.0
    subscription_covered = False
    if request_data.target_photographer_id:
        from routes.photo_subscriptions import get_subscription_discount, try_use_subscription_quota
        subscription_discount_pct = await get_subscription_discount(
            db, requester_id, request_data.target_photographer_id, service_type='on_demand'
        )
        if subscription_discount_pct > 0:
            # Cap discount at 50% to ensure photographer still earns
            effective_discount = min(subscription_discount_pct / 100.0, 0.50)
            estimated_total = estimated_total * (1 - effective_discount)
        
        # Try to use subscription session quota (free session if quota available)
        sub_quota_result = await try_use_subscription_quota(
            db, requester_id, request_data.target_photographer_id, 'session'
        )
        subscription_covered = sub_quota_result.get("used", False)
        if subscription_covered:
            estimated_total = 0.0  # Subscription covers this session
    
    # Full payment (no deposit - we act as escrow)
    deposit_pct = 100
    deposit_amount = estimated_total  # Full amount
    
    # For shared requests, calculate individual shares
    num_participants = 1
    if request_data.is_shared and request_data.friend_ids:
        num_participants = 1 + len(request_data.friend_ids)  # Requester + friends
    
    individual_share = estimated_total / num_participants
    
    # Captain's share - use provided value or default to individual share
    captain_share = request_data.captain_share_amount if request_data.captain_share_amount is not None else individual_share
    
    # Set payment expiry for client-side countdown (30 minutes from now)
    payment_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    
    # Create dispatch request (pending payment)
    dispatch_request = DispatchRequest(
        requester_id=requester_id,
        latitude=request_data.latitude,
        longitude=request_data.longitude,
        location_name=request_data.location_name,
        spot_id=request_data.spot_id,
        estimated_duration_hours=request_data.estimated_duration_hours,
        is_immediate=request_data.is_immediate,
        requested_start_time=request_data.requested_start_time,
        arrival_window_minutes=request_data.arrival_window_minutes,  # 30, 60, or 90 min
        status=DispatchRequestStatusEnum.PENDING_PAYMENT,
        hourly_rate=hourly_rate,
        estimated_total=estimated_total,
        deposit_pct=deposit_pct,
        deposit_amount=deposit_amount,
        captain_share_amount=captain_share,  # Store captain's actual portion
        pending_payment_expires_at=payment_expires_at,  # For client-side countdown & auto-cleanup
        is_shared=request_data.is_shared,
        max_participants=num_participants,
        search_radius_miles=5.0,
        target_photographer_id=request_data.target_photographer_id  # Quick Book target
    )
    
    db.add(dispatch_request)
    await db.flush()  # Get the ID
    
    # Create Stripe Payment Intent for deposit
    try:
        payment_intent = stripe.PaymentIntent.create(
            amount=int(individual_share * 100),  # Stripe uses cents
            currency='usd',
            metadata={
                'dispatch_request_id': dispatch_request.id,
                'requester_id': requester_id,
                'type': 'dispatch_deposit'
            }
        )
        
        dispatch_request.stripe_payment_intent_id = payment_intent.id
    except Exception as e:
        # If Stripe fails, still create the request for wallet payment
        logger.error(f"Stripe error: {e}")
    
    # If shared request, create participant records with custom shares
    if request_data.is_shared and request_data.friend_ids:
        # Use crew_shares if provided, otherwise equal split
        crew_shares_map = {}
        if request_data.crew_shares:
            for cs in request_data.crew_shares:
                crew_shares_map[cs.get('user_id') or cs.get('id')] = cs
        
        for friend_id in request_data.friend_ids:
            # Get custom share if provided
            share_info = crew_shares_map.get(friend_id, {})
            share_amount = share_info.get('share_amount', individual_share)
            covered = share_info.get('covered_by_captain', False)
            
            # If covered by captain, their share is 0
            if covered:
                share_amount = 0
            
            participant = DispatchRequestParticipant(
                dispatch_request_id=dispatch_request.id,
                participant_id=friend_id,
                share_amount=share_amount,
                status='invited' if share_amount > 0 else 'covered'  # Mark as covered if captain pays
            )
            db.add(participant)
    
    await db.commit()
    
    return {
        "id": dispatch_request.id,
        "status": "pending_payment",
        "estimated_total": estimated_total,
        "deposit_amount": deposit_amount,
        "captain_share_amount": captain_share,
        "individual_share": individual_share if request_data.is_shared else deposit_amount,
        "num_participants": num_participants,
        "hourly_rate": hourly_rate,
        "stripe_client_secret": payment_intent.client_secret if 'payment_intent' in dir() else None,
        "available_pros_count": len(available_pros),
        "pending_payment_expires_at": payment_expires_at.isoformat(),  # For client-side countdown
        "subscription_discount_pct": subscription_discount_pct,
        "subscription_covered": subscription_covered,
    }


@router.post("/{dispatch_id}/pay")
async def confirm_payment(
    dispatch_id: str,
    payer_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Confirm payment and start the dispatch process (CAPTAIN payment).
    Called after Stripe payment succeeds or wallet/credit payment.
    
    ATOMIC TRANSACTION: This endpoint ensures that:
    1. Credit deduction only happens if dispatch record is properly updated
    2. Captain metadata (name, avatar) is stored for photographer dashboard
    3. If any step fails, entire transaction rolls back
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.status != DispatchRequestStatusEnum.PENDING_PAYMENT:
        raise HTTPException(status_code=400, detail=f"Request is not pending payment. Status: {dispatch.status}")
    
    # Get payer profile - REQUIRED for metadata injection
    payer_result = await db.execute(select(Profile).where(Profile.id == payer_id))
    payer = payer_result.scalar_one_or_none()
    
    if not payer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Use captain_share_amount if set (for split bookings), otherwise full deposit
    # This allows captain to pay $0 if crew pays 100%
    captain_amount = dispatch.captain_share_amount if dispatch.captain_share_amount is not None else dispatch.deposit_amount
    
    # Only verify credits if captain actually needs to pay
    if captain_amount > 0 and payer.credit_balance < captain_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient credits. Need ${captain_amount:.2f}, have ${payer.credit_balance:.2f}"
        )
    
    # ============ ATOMIC TRANSACTION START ============
    # All updates happen together or none at all
    
    try:
        # 1. Record credit balance BEFORE deduction
        old_balance = payer.credit_balance
        
        # 2. Deduct credits (only if captain_amount > 0)
        if captain_amount > 0:
            payer.credit_balance -= captain_amount
            
            # 3. Create credit transaction record
            tx = CreditTransaction(
                user_id=payer_id,
                amount=-captain_amount,
                balance_before=old_balance,
                balance_after=payer.credit_balance,
                transaction_type='dispatch_deposit',
                reference_type='dispatch_request',
                reference_id=dispatch_id,
                description=f'Session deposit (captain share: ${captain_amount:.2f})'
            )
            db.add(tx)
        
        # 4. Update dispatch with payment status AND captain metadata
        dispatch.deposit_paid = True
        dispatch.deposit_paid_at = datetime.now(timezone.utc)
        
        # 5. METADATA INJECTION: Store captain info for photographer dashboard
        # This ensures photographer sees captain's card immediately
        dispatch.captain_name = payer.full_name
        dispatch.captain_username = payer.username
        dispatch.captain_avatar_url = payer.avatar_url
        
        # 6. Move to searching stage
        dispatch.status = DispatchRequestStatusEnum.SEARCHING_FOR_PRO
        dispatch.status_changed_at = datetime.now(timezone.utc)
        dispatch.dispatch_stage = 1
        dispatch.stage_1_started_at = datetime.now(timezone.utc)
        
        # 7. Commit all changes atomically
        await db.commit()
        
        # Send parental spending alert if this is a Grom above approval threshold
        await check_and_send_spending_alert(
            db=db,
            grom_id=payer_id,
            amount=dispatch.deposit_amount,
            description='Request a Pro booking deposit',
            transaction_type='dispatch_deposit'
        )
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Payment failed - transaction rolled back. Please try again. Error: {str(e)}"
        )
    
    # ============ ATOMIC TRANSACTION END ============
    
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
        "id": dispatch_id,
        "status": "searching_for_pro",
        "message": "Payment confirmed. Searching for available photographers...",
        "remaining_credits": payer.credit_balance,
        "captain_metadata_stored": True
    }


@router.post("/checkout")
async def create_dispatch_checkout(
    data: DispatchCheckoutRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a Stripe Checkout session for on-demand dispatch card payments.
    Called when user selects card payment instead of credits.
    """
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    # Verify dispatch request exists and is pending payment
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == data.dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    if dispatch.status != DispatchRequestStatusEnum.PENDING_PAYMENT:
        raise HTTPException(status_code=400, detail=f"Request is not pending payment. Status: {dispatch.status}")
    
    # Get photographer name for checkout description
    photographer_name = "Photographer"
    if dispatch.target_photographer_id:
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == dispatch.target_photographer_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        if photographer:
            photographer_name = photographer.full_name
    
    # Build URLs
    success_url = f"{data.origin_url}/dispatch/success?session_id={{CHECKOUT_SESSION_ID}}&dispatch_id={data.dispatch_id}"
    cancel_url = f"{data.origin_url}/map"
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(data.amount * 100),  # Stripe uses cents
                    'product_data': {
                        'name': f'On-Demand Session with {photographer_name}',
                        'description': f'{int(dispatch.estimated_duration_hours * 60)} min on-demand photography session',
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'user_id': data.payer_id,
                'dispatch_id': data.dispatch_id,
                'photographer_id': dispatch.target_photographer_id,
                'type': 'on_demand_dispatch'
            }
        )
        
        # Store the checkout session ID on the dispatch
        dispatch.stripe_checkout_session_id = checkout_session.id
        
        # Store payment transaction record
        transaction = PaymentTransaction(
            user_id=data.payer_id,
            session_id=checkout_session.id,
            amount=data.amount,
            currency="usd",
            payment_status="Pending",
            status="Pending",
            transaction_metadata=json.dumps({
                'dispatch_id': data.dispatch_id,
                'type': 'on_demand_dispatch'
            })
        )
        db.add(transaction)
        await db.commit()
        
        return {
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id,
            "dispatch_id": data.dispatch_id,
            "amount": data.amount
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")


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
    from routes.push import notify_dispatch_alert
    
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
    from routes.push import send_push_notification
    
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


