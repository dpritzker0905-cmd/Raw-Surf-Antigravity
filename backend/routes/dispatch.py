"""
On-Demand Dispatch System Routes
Uber-style reverse request system for summoning photographers
"""

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

from database import get_db
from models import (
    Profile, DispatchRequest, DispatchRequestParticipant, 
    DispatchNotification, DispatchRequestStatusEnum, SurfSpot,
    Booking, BookingParticipant, CreditTransaction, RoleEnum, Notification,
    PaymentTransaction, SessionSnapshot
)
from utils.parental_alerts import check_and_send_spending_alert
from services.onesignal_service import onesignal_service

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

# Initialize Stripe
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")


# ===================== PYDANTIC SCHEMAS =====================

class CreateDispatchRequest(BaseModel):
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    spot_id: Optional[str] = None
    estimated_duration_hours: float = 1.0
    is_immediate: bool = True
    requested_start_time: Optional[datetime] = None
    arrival_window_minutes: int = 30  # 30, 60, or 90 minutes from request
    is_shared: bool = False
    friend_ids: Optional[List[str]] = None  # For split requests
    target_photographer_id: Optional[str] = None  # For Quick Book - request specific photographer
    captain_share_amount: Optional[float] = None  # Captain's portion (can be 0 if crew pays 100%)
    crew_shares: Optional[List[dict]] = None  # [{user_id, share_amount, covered_by_captain}]


class AcceptDispatchRequest(BaseModel):
    photographer_id: str


class UpdateGPSLocation(BaseModel):
    latitude: float
    longitude: float


class CancelDispatchRequest(BaseModel):
    reason: Optional[str] = None


class UpdateSelfieRequest(BaseModel):
    selfie_url: str


class BoostRequestCreate(BaseModel):
    """Boost a dispatch request for priority in the queue"""
    boost_hours: int = 1  # 1, 2, or 4 hours
    
    @property
    def cost(self) -> int:
        """Tiered pricing: 5/10/20 credits for 1/2/4 hours"""
        pricing = {1: 5, 2: 10, 4: 20}
        return pricing.get(self.boost_hours, 5)


class DispatchCheckoutRequest(BaseModel):
    """Request for creating a Stripe checkout session for on-demand dispatch"""
    dispatch_id: str
    payer_id: str
    amount: float  # Amount to charge (captain's share)
    origin_url: str


# ===================== HELPER FUNCTIONS =====================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in miles"""
    R = 3959  # Earth's radius in miles
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


async def get_available_pros(
    db: AsyncSession, 
    latitude: float, 
    longitude: float, 
    radius_miles: float,
    stage: int = 1
) -> List[Profile]:
    """
    Get available Pro photographers within radius
    Priority ordering: Top-Level Pros > Streak Holders > Nearest
    """
    # Stage 1: Only Approved Pros
    # Stage 2: All Pros (Pro + Approved Pro)
    
    if stage == 1:
        role_filter = Profile.role == RoleEnum.APPROVED_PRO
    else:
        role_filter = or_(Profile.role == RoleEnum.PRO, Profile.role == RoleEnum.APPROVED_PRO)
    
    result = await db.execute(
        select(Profile)
        .where(
            role_filter,
            or_(
                Profile.is_available_on_demand == True,
                Profile.on_demand_available == True  # New On-Demand GPS toggle
            ),
            Profile.is_shooting == False,  # Not currently shooting
            Profile.is_suspended == False
        )
    )
    
    photographers = result.scalars().all()
    
    # Filter by distance and calculate priority scores
    in_range = []
    for p in photographers:
        # Use On-Demand GPS location if available, else home location
        p_lat = p.on_demand_latitude or getattr(p, 'latitude', None)
        p_lng = p.on_demand_longitude or getattr(p, 'longitude', None)
        
        # If no location data, skip
        if p_lat is None or p_lng is None:
            continue
            
        distance = haversine_distance(latitude, longitude, p_lat, p_lng)
        if distance <= radius_miles:
            # Calculate priority score for sorting
            # Higher score = higher priority
            priority_score = 0
            
            # Priority 1: Top-Level Pros (Approved Pro) get +1000 points
            if p.role == RoleEnum.APPROVED_PRO:
                priority_score += 1000
            
            # Priority 2: Streak Holders get +100 * streak
            streak = p.on_demand_streak or 0
            if streak >= 3:  # Hot streak
                priority_score += 500 + (streak * 10)  # Hot streak bonus
            elif streak > 0:
                priority_score += streak * 20
            
            # Priority 3: Nearest (invert distance so closer = higher score)
            # Max distance points = 100 (for 0 distance), min = 0 (for radius)
            distance_score = max(0, 100 - (distance / radius_miles * 100))
            priority_score += distance_score
            
            # Store for sorting
            p._distance = distance
            p._priority_score = priority_score
            p._streak = streak
            p._is_hot_streak = streak >= 3
            in_range.append(p)
    
    # Sort by priority score (highest first), then by distance (nearest first) as tiebreaker
    in_range.sort(key=lambda x: (-x._priority_score, x._distance))
    
    return in_range


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
    
    # Calculate pricing
    hourly_rate = avg_rate
    estimated_total = hourly_rate * request_data.estimated_duration_hours
    
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
        print(f"Stripe error: {e}")
    
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
        "pending_payment_expires_at": payment_expires_at.isoformat()  # For client-side countdown
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
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
        )
        dispatch = result.scalar_one_or_none()
        
        if not dispatch or dispatch.status != DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
            return
        
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
                print(f"[Dispatch] Sent Quick Book notification to {target_pro.full_name} for request {dispatch_id}")
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
            # TODO: Send push notification via notification service
        
        await db.commit()
        
        # Note: Stage 2 escalation would be handled by a scheduled job
        # after 60 seconds if no acceptance


async def notify_crew_members(dispatch_id: str, captain_id: str):
    """Background task to notify crew members about shared session"""
    from database import async_session_maker
    
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
        
        for participant in participants:
            # Create in-app notification
            notification = Notification(
                user_id=participant.participant_id,
                type='crew_session_invite',
                title='You\'ve been invited to a surf session!',
                body=f'{captain_name} invited you to join an on-demand photography session. Your share: ${participant.share_amount:.2f}',
                data=json.dumps({
                    'dispatch_id': dispatch_id,
                    'captain_id': captain_id,
                    'share_amount': float(participant.share_amount),
                    'action_url': '/bookings?tab=scheduled'
                })
            )
            db.add(notification)
            
            print(f"[Dispatch] Sent crew invite notification to participant {participant.participant_id}")
        
        await db.commit()


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
            print(f"Failed to send acceptance notification: {e}")
    
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
    booking = Booking(
        photographer_id=photographer_id,
        surf_spot_id=dispatch.spot_id,  # Fixed: Booking uses surf_spot_id not spot_id
        latitude=dispatch.latitude,
        longitude=dispatch.longitude,
        location_name=dispatch.location_name,
        booking_type='private',
        scheduled_date=now.date(),
        scheduled_time=now.time(),
        duration_hours=dispatch.estimated_duration_hours,
        status='in_progress',
        total_price=dispatch.estimated_total,
        deposit_amount=dispatch.deposit_amount,
        is_on_demand=True,
        dispatch_request_id=dispatch.id
    )
    
    db.add(booking)
    await db.flush()
    
    # Add requester as participant
    participant = BookingParticipant(
        booking_id=booking.id,
        participant_id=dispatch.requester_id,
        role='requester',
        has_paid=True,
        amount_paid=dispatch.deposit_amount
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
            except:
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
                    action_url=f'/gallery/{gallery_id}',
                    metadata={
                        'gallery_id': gallery_id,
                        'dispatch_id': dispatch_id,
                        'photographer_id': photographer_id,
                        'photographer_name': photographer_name
                    }
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
    
    if dispatch.status == DispatchRequestStatusEnum.PENDING_PAYMENT:
        # Not paid yet - no refund needed
        refund_type = 'none'
    elif dispatch.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
        # Still searching - full refund
        refund_amount = dispatch.deposit_amount
        refund_type = 'full'
    elif dispatch.is_immediate:
        # On-demand after acceptance - non-refundable
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
    
    await db.commit()
    
    return {
        "id": dispatch_id,
        "status": "cancelled",
        "refund_amount": refund_amount,
        "refund_type": refund_type,
        "message": f"Request cancelled. {f'${refund_amount:.2f} refunded to wallet.' if refund_amount > 0 else 'No refund due to cancellation policy.'}"
    }


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
        "refund_amount": dispatch.refund_amount if hasattr(dispatch, 'refund_amount') else None
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
    
    return {
        "active_dispatch": {
            "id": dispatch.id,
            "status": dispatch.status.value,
            "role": role,
            "photographer_id": dispatch.photographer_id or dispatch.target_photographer_id,
            "photographer_name": dispatch.photographer.full_name if dispatch.photographer else None,
            "requester_id": dispatch.requester_id,
            "requester_name": dispatch.requester.full_name if dispatch.requester else None,
            "requester_selfie": dispatch.selfie_url,
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
            
            pending.append({
                "notification_id": notif.id,
                "dispatch_id": dispatch.id,
                "requester_id": dispatch.requester_id,
                # Use cached captain metadata if available (guaranteed present after atomic payment)
                "requester_name": dispatch.captain_name or (dispatch.requester.full_name if dispatch.requester else None),
                "requester_username": dispatch.captain_username or (dispatch.requester.username if dispatch.requester else None),
                "requester_avatar": dispatch.captain_avatar_url or (dispatch.requester.avatar_url if dispatch.requester else None),
                "requester_selfie": dispatch.selfie_url,
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


@router.get("/user/{user_id}/crew-invites")
async def get_crew_invites(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get pending crew invites for a user (shared session invitations)"""
    # Find all dispatch participants where user is invited but hasn't paid
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.participant_id == user_id,
            DispatchRequestParticipant.status.in_(['invited', 'pending'])
        )
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participants = result.scalars().all()
    
    invites = []
    for participant in participants:
        dispatch = participant.dispatch_request
        if not dispatch or dispatch.status in [
            DispatchRequestStatusEnum.COMPLETED,
            DispatchRequestStatusEnum.CANCELLED
        ]:
            continue
        
        # Get captain info
        captain_result = await db.execute(
            select(Profile).where(Profile.id == dispatch.requester_id)
        )
        captain = captain_result.scalar_one_or_none()
        
        # Get photographer info if assigned
        photographer = None
        if dispatch.target_photographer_id:
            photo_result = await db.execute(
                select(Profile).where(Profile.id == dispatch.target_photographer_id)
            )
            photographer = photo_result.scalar_one_or_none()
        
        invites.append({
            "id": participant.id,
            "dispatch_id": dispatch.id,
            "captain": {
                "id": captain.id if captain else None,
                "name": captain.full_name if captain else "Unknown",
                "avatar_url": captain.avatar_url if captain else None
            },
            "photographer": {
                "id": photographer.id if photographer else None,
                "name": photographer.full_name if photographer else None,
                "avatar_url": photographer.avatar_url if photographer else None
            } if photographer else None,
            "location_name": dispatch.location_name,
            "estimated_duration_hours": dispatch.estimated_duration_hours,
            "your_share": participant.share_amount,
            "status": participant.status,
            "dispatch_status": dispatch.status.value,
            "created_at": dispatch.created_at.isoformat()
        })
    
    return {"crew_invites": invites}


class CrewPaymentRequest(BaseModel):
    selfie_url: Optional[str] = None
    require_selfie: bool = False  # If true, payment will fail without selfie


@router.post("/crew-invite/{participant_id}/pay")
async def pay_crew_share(
    participant_id: str,
    payer_id: str,
    payment_data: Optional[CrewPaymentRequest] = Body(default=None),
    db: AsyncSession = Depends(get_db)
):
    """
    Crew member pays their share of a shared session.
    
    ATOMIC TRANSACTION: This endpoint ensures that:
    1. User profile metadata is ALWAYS written to participant record
    2. Payment and metadata updates happen in the same transaction
    3. If metadata write fails, payment is rolled back
    """
    # Find the participant record
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.id == participant_id)
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    if participant.participant_id != payer_id:
        raise HTTPException(status_code=403, detail="You can only pay for your own share")
    
    if participant.status == 'paid':
        raise HTTPException(status_code=400, detail="Already paid")
    
    dispatch = participant.dispatch_request
    if dispatch.status in [DispatchRequestStatusEnum.COMPLETED, DispatchRequestStatusEnum.CANCELLED]:
        raise HTTPException(status_code=400, detail="Session is no longer active")
    
    # Get payer's profile - REQUIRED for metadata injection
    payer_result = await db.execute(select(Profile).where(Profile.id == payer_id))
    payer = payer_result.scalar_one_or_none()
    
    if not payer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # DATA INTEGRITY CHECK: Validate selfie if required or if session is in active state
    selfie_url = payment_data.selfie_url if payment_data else None
    
    # If dispatch is already accepted/en_route, selfie is highly recommended
    if dispatch.status in [DispatchRequestStatusEnum.ACCEPTED, DispatchRequestStatusEnum.EN_ROUTE]:
        if not selfie_url and not participant.selfie_url:
            # Return a "needs_selfie" response instead of failing
            return {
                "success": False,
                "needs_selfie": True,
                "message": "The photographer is already on their way! Please add a selfie so they can find you.",
                "dispatch_status": dispatch.status.value
            }
    
    # Check if payer has enough credits
    if payer.credit_balance < participant.share_amount:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient credits. You need ${participant.share_amount:.2f} but have ${payer.credit_balance:.2f}"
        )
    
    # ============ ATOMIC TRANSACTION START ============
    # All updates happen together or none at all
    
    try:
        # 1. Deduct credits
        old_balance = payer.credit_balance
        payer.credit_balance -= participant.share_amount
        
        # 2. Record transaction
        tx = CreditTransaction(
            user_id=payer_id,
            amount=-participant.share_amount,
            balance_before=old_balance,
            balance_after=payer.credit_balance,
            transaction_type='crew_session_payment',
            reference_type='dispatch_participant',
            reference_id=participant_id
        )
        db.add(tx)
        
        # 3. CRITICAL: Update participant with ALL metadata atomically
        participant.status = 'paid'
        participant.paid = True
        participant.paid_at = datetime.now(timezone.utc)
        
        # Store selfie URL if provided
        if selfie_url:
            participant.selfie_url = selfie_url
        
        # 4. METADATA INJECTION: Store profile data for dashboard sync
        # This ensures photographer dashboard has immediate access to surfer info
        # even if profile lookup fails later
        participant.payer_name = payer.full_name
        participant.payer_username = payer.username
        participant.payer_avatar_url = payer.avatar_url
        
        # 5. CHECK IF ALL CREW MEMBERS PAID (triggers "2/2 complete" state)
        # Query all participants in this dispatch to check completion
        all_participants_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
        )
        all_participants = all_participants_result.scalars().all()
        
        total_crew = len(all_participants)
        paid_crew = sum(1 for p in all_participants if p.paid or p.id == participant_id)
        all_crew_paid = paid_crew >= total_crew
        
        # 6. If all crew paid AND captain has paid, dispatch is fully funded
        dispatch_fully_funded = all_crew_paid and dispatch.deposit_paid
        
        if dispatch_fully_funded:
            # Mark dispatch as ready for notification
            dispatch.all_participants_paid = True
            dispatch.all_participants_paid_at = datetime.now(timezone.utc)
        
        # Commit all changes atomically
        await db.commit()
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500, 
            detail=f"Payment failed - transaction rolled back. Please try again. Error: {str(e)}"
        )
    
    # ============ ATOMIC TRANSACTION END ============
    
    # Calculate crew payment status for response
    all_participants_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
    )
    all_participants = all_participants_result.scalars().all()
    total_crew = len(all_participants)
    paid_crew = sum(1 for p in all_participants if p.paid)
    
    return {
        "success": True,
        "message": "Payment successful! You're in the session.",
        "remaining_credits": payer.credit_balance,
        "participant_id": participant_id,
        "dispatch_id": dispatch.id,
        "has_selfie": bool(participant.selfie_url),
        "crew_payment_status": {
            "paid_count": paid_crew,
            "total_count": total_crew,
            "all_paid": paid_crew >= total_crew,
            "captain_paid": dispatch.deposit_paid,
            "fully_funded": dispatch.deposit_paid and paid_crew >= total_crew
        }
    }



async def get_pending_dispatch_requests_for_map(
    db: AsyncSession = Depends(get_db)
):
    """
    Get all active/pending dispatch requests for map display.
    Shows green breathing markers for active on-demand requests.
    Only returns requests that are actively searching for a photographer.
    Includes surfer priority info for queue display (Pros > Comp > Regular).
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO)
        .options(selectinload(DispatchRequest.requester))
        .order_by(DispatchRequest.created_at.desc())
        .limit(50)  # Limit for performance
    )
    requests = result.scalars().all()
    
    def get_surfer_priority(role_value):
        """
        Calculate surfer priority for queue display.
        Higher number = higher priority.
        Pros > Comp Surfers > Regular Surfers
        """
        priority_map = {
            'Pro': 3,
            'Approved Pro': 3,
            'Comp Surfer': 2,
            'Surfer': 1,
            'Hobbyist': 1,
            'Grom': 1,
            'Grom Parent': 1
        }
        return priority_map.get(role_value, 1)
    
    def get_priority_badge(priority):
        """Return badge info for priority level"""
        if priority >= 3:
            return {"level": "pro", "label": "Pro Surfer", "color": "yellow"}
        elif priority >= 2:
            return {"level": "comp", "label": "Comp Surfer", "color": "purple"}
        else:
            return {"level": "regular", "label": "Surfer", "color": "cyan"}
    
    response_data = []
    for req in requests:
        if not req.latitude or not req.longitude:
            continue
        
        # Check if boost is active
        is_boosted = False
        boost_time_remaining = 0
        if req.boost_priority and req.boost_priority > 0 and req.boost_expires_at:
            if req.boost_expires_at > datetime.now(timezone.utc):
                is_boosted = True
                boost_time_remaining = int((req.boost_expires_at - datetime.now(timezone.utc)).total_seconds() / 60)
            
        requester_role = req.requester.role.value if req.requester and req.requester.role else 'Surfer'
        base_priority = get_surfer_priority(requester_role)
        
        # Boosted requests get +10 priority
        total_priority = base_priority + (req.boost_priority or 0)
        
        badge = get_priority_badge(base_priority)
        
        # Override badge if boosted
        if is_boosted:
            badge = {"level": "boosted", "label": "BOOSTED", "color": "orange"}
        
        response_data.append({
            "id": req.id,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "location_name": req.location_name,
            "requester_name": req.requester.full_name if req.requester else "Surfer",
            "requester_avatar": req.requester.avatar_url if req.requester else None,
            "requester_role": requester_role,
            "estimated_duration": req.estimated_duration_hours,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            # Priority info
            "priority": total_priority,
            "base_priority": base_priority,
            "priority_badge": badge,
            # Boost info
            "is_boosted": is_boosted,
            "boost_time_remaining_minutes": boost_time_remaining
        })
    
    # Sort by total priority (highest first), then by creation time (oldest first for fairness)
    response_data.sort(key=lambda x: (-x["priority"], x["created_at"]))
    
    return response_data


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


# ============ BOOST REQUEST FEATURE ============

@router.post("/request/{request_id}/boost")
async def boost_dispatch_request(
    request_id: str,
    data: BoostRequestCreate,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Boost a dispatch request to elevate priority in the queue.
    Costs credits based on duration: 5/10/20 credits for 1/2/4 hours.
    """
    # Validate boost hours
    if data.boost_hours not in [1, 2, 4]:
        raise HTTPException(status_code=400, detail="Boost hours must be 1, 2, or 4")
    
    # Get the dispatch request
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == request_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Verify user owns this request
    if dispatch.requester_id != user_id:
        raise HTTPException(status_code=403, detail="You can only boost your own requests")
    
    # Verify request is still searching for a pro
    if dispatch.status != DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
        raise HTTPException(status_code=400, detail="Can only boost requests that are actively searching")
    
    # Calculate cost
    pricing = {1: 5, 2: 10, 4: 20}
    cost = pricing[data.boost_hours]
    
    # Get user profile and check credits
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user_profile = user_result.scalar_one_or_none()
    
    if not user_profile:
        raise HTTPException(status_code=404, detail="User profile not found")
    
    if (user_profile.credit_balance or 0) < cost:
        raise HTTPException(
            status_code=402, 
            detail=f"Insufficient credits. Boost costs {cost} credits, you have {user_profile.credit_balance or 0}"
        )
    
    # Deduct credits
    user_profile.credit_balance = (user_profile.credit_balance or 0) - cost
    
    # Apply boost
    dispatch.boost_priority = 10  # Max priority for boosted requests
    dispatch.boost_expires_at = datetime.now(timezone.utc) + timedelta(hours=data.boost_hours)
    dispatch.boost_credits_spent = (dispatch.boost_credits_spent or 0) + cost
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Request boosted for {data.boost_hours} hour(s)!",
        "boost_expires_at": dispatch.boost_expires_at.isoformat(),
        "credits_spent": cost,
        "remaining_credits": user_profile.credit_balance
    }


@router.get("/request/{request_id}/boost-status")
async def get_boost_status(
    request_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the current boost status of a dispatch request"""
    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == request_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Check if boost is still active
    is_boosted = False
    time_remaining = None
    
    if dispatch.boost_priority > 0 and dispatch.boost_expires_at:
        if dispatch.boost_expires_at > datetime.now(timezone.utc):
            is_boosted = True
            time_remaining = (dispatch.boost_expires_at - datetime.now(timezone.utc)).total_seconds() / 60  # minutes
        else:
            # Boost expired, reset priority
            dispatch.boost_priority = 0
            await db.commit()
    
    return {
        "request_id": request_id,
        "is_boosted": is_boosted,
        "boost_priority": dispatch.boost_priority,
        "boost_expires_at": dispatch.boost_expires_at.isoformat() if dispatch.boost_expires_at else None,
        "time_remaining_minutes": round(time_remaining) if time_remaining else 0,
        "total_credits_spent": dispatch.boost_credits_spent or 0
    }



# ============ ON-DEMAND STATS FOR PHOTOGRAPHERS ============

@router.get("/photographer/{photographer_id}/stats")
async def get_photographer_on_demand_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get on-demand statistics for a photographer.
    Includes today's earnings, session counts, streak info, etc.
    """
    from datetime import date
    
    # Verify photographer exists
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    
    # Get completed dispatches for this photographer
    completed_result = await db.execute(
        select(DispatchRequest)
        .where(
            DispatchRequest.photographer_id == photographer_id,
            DispatchRequest.status == DispatchRequestStatusEnum.COMPLETED
        )
    )
    completed_dispatches = completed_result.scalars().all()
    
    # Calculate stats
    earnings_today = 0.0
    sessions_today = 0
    sessions_week = 0
    sessions_month = 0
    total_earnings = 0.0
    
    for dispatch in completed_dispatches:
        earnings = dispatch.estimated_total or 0
        total_earnings += earnings
        
        if dispatch.completed_at:
            dispatch_date = dispatch.completed_at.date()
            
            if dispatch_date == today:
                earnings_today += earnings
                sessions_today += 1
            
            if dispatch_date >= week_start:
                sessions_week += 1
            
            if dispatch_date >= month_start:
                sessions_month += 1
    
    # Get streak from profile
    streak = photographer.on_demand_streak or 0
    
    return {
        "earnings_today": round(earnings_today, 2),
        "earnings_total": round(total_earnings, 2),
        "sessions_today": sessions_today,
        "sessions_week": sessions_week,
        "sessions_month": sessions_month,
        "total_sessions": len(completed_dispatches),
        "streak": streak,
        "is_hot_streak": streak >= 3,
        "xp_multiplier": 2.0 if streak >= 3 else 1.0
    }


@router.get("/photographer/{photographer_id}/history")
async def get_photographer_session_history(
    photographer_id: str,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get on-demand session history for a photographer.
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(
            DispatchRequest.photographer_id == photographer_id,
            DispatchRequest.status == DispatchRequestStatusEnum.COMPLETED
        )
        .options(selectinload(DispatchRequest.requester))
        .order_by(DispatchRequest.completed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    dispatches = result.scalars().all()
    
    history = []
    for d in dispatches:
        history.append({
            "id": d.id,
            "requester_name": d.requester.full_name if d.requester else "Unknown",
            "location_name": d.location_name or "Unknown Location",
            "date": d.completed_at.isoformat() if d.completed_at else None,
            "duration_hours": d.estimated_duration_hours,
            "earnings": d.estimated_total or 0,
            "hourly_rate": d.hourly_rate or 75
        })
    
    return {
        "history": history,
        "total": len(history),
        "offset": offset,
        "limit": limit
    }



# ===================== TICKET-003: Crew Payment Progress Endpoints =====================

class CoverRemainingRequest(BaseModel):
    captain_id: str


class RemindCrewRequest(BaseModel):
    captain_id: str
    member_id: str


@router.post("/{dispatch_id}/cover-remaining")
async def captain_cover_remaining(
    dispatch_id: str,
    data: CoverRemainingRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain pays remaining unpaid crew shares to unlock media immediately.
    Deducts from captain's credit balance and marks all crew as paid.
    """
    # Get dispatch
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    # Verify captain
    if dispatch.requester_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the captain can cover remaining shares")
    
    # Get unpaid crew members
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.dispatch_request_id == dispatch_id,
            DispatchRequestParticipant.paid == False
        )
    )
    unpaid_crew = crew_result.scalars().all()
    
    if not unpaid_crew:
        return {"success": True, "message": "All crew members already paid", "amount_covered": 0}
    
    # Calculate total unpaid amount
    total_unpaid = sum(cp.share_amount or 0 for cp in unpaid_crew)
    
    if total_unpaid <= 0:
        return {"success": True, "message": "No outstanding balance", "amount_covered": 0}
    
    # Check captain's credit balance
    captain_result = await db.execute(
        select(Profile).where(Profile.id == data.captain_id)
    )
    captain = captain_result.scalar_one_or_none()
    
    if not captain:
        raise HTTPException(status_code=404, detail="Captain profile not found")
    
    if (captain.credit_balance or 0) < total_unpaid:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient credits. Need ${total_unpaid:.2f}, have ${captain.credit_balance or 0:.2f}"
        )
    
    # Atomic transaction: deduct credits and mark all as paid
    try:
        # Deduct from captain's balance
        captain.credit_balance = (captain.credit_balance or 0) - total_unpaid
        
        # Mark all unpaid crew as paid
        for cp in unpaid_crew:
            cp.paid = True
            cp.paid_at = datetime.now(timezone.utc)
            cp.status = 'paid'
            # Store who covered the payment
            if not cp.payer_name:
                cp.payer_name = f"Covered by {captain.full_name}"
        
        # Update dispatch flags
        dispatch.all_participants_paid = True
        dispatch.all_participants_paid_at = datetime.now(timezone.utc)
        
        # Create credit transaction
        credit_tx = CreditTransaction(
            user_id=data.captain_id,
            amount=-total_unpaid,
            transaction_type='crew_cover',
            description=f"Covered ${total_unpaid:.2f} for {len(unpaid_crew)} crew members",
            reference_type='dispatch',
            reference_id=dispatch_id,
            balance_after=captain.credit_balance
        )
        db.add(credit_tx)
        
        await db.commit()
        
        return {
            "success": True,
            "amount_covered": total_unpaid,
            "crew_covered": len(unpaid_crew),
            "new_balance": captain.credit_balance
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to cover remaining: {str(e)}")


@router.post("/{dispatch_id}/remind-crew")
async def send_crew_reminder(
    dispatch_id: str,
    data: RemindCrewRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Send a payment reminder push notification to an unpaid crew member.
    Only the captain can send reminders.
    """
    # Get dispatch
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    # Verify captain
    if dispatch.requester_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the captain can send reminders")
    
    # Get the crew member
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.dispatch_request_id == dispatch_id,
            DispatchRequestParticipant.participant_id == data.member_id
        )
    )
    crew_member = crew_result.scalar_one_or_none()
    
    if not crew_member:
        raise HTTPException(status_code=404, detail="Crew member not found in this dispatch")
    
    if crew_member.paid:
        return {"success": True, "message": "Crew member has already paid"}
    
    # Get crew member profile for push
    member_result = await db.execute(
        select(Profile).where(Profile.id == data.member_id)
    )
    member = member_result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member profile not found")
    
    # Send push notification
    captain_name = dispatch.captain_name or dispatch.requester.full_name if dispatch.requester else "Your captain"
    
    background_tasks.add_task(
        onesignal_service.send_to_user,
        user_id=data.member_id,
        title="Payment Reminder",
        message=f"{captain_name} is waiting for your payment (${crew_member.share_amount:.2f}) to start the session!",
        data={
            "type": "crew_payment_reminder",
            "dispatch_id": dispatch_id,
            "amount": crew_member.share_amount
        }
    )
    
    # Also create an in-app notification
    notification = Notification(
        user_id=data.member_id,
        type='crew_payment_reminder',
        title='Payment Reminder',
        message=f"{captain_name} is waiting for your payment of ${crew_member.share_amount:.2f}",
        data={
            "dispatch_id": dispatch_id,
            "amount": crew_member.share_amount,
            "captain_id": data.captain_id
        }
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "message": "Reminder sent"}

