"""
Stripe Checkout Integration for Request a Pro deposits
Supports photographer-configurable session prices
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import datetime, timezone
import os
import logging

from database import get_db
from models import Profile, PaymentTransaction

router = APIRouter()
logger = logging.getLogger(__name__)

# Stripe Configuration
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')

# Default deposit packages (used when photographer hasn't set custom prices)
DEFAULT_DEPOSIT_PACKAGES = {
    "small": {"amount": 25.00, "description": "1-hour photo session deposit", "duration_hours": 1},
    "medium": {"amount": 35.00, "description": "2-hour photo session deposit", "duration_hours": 2},
    "large": {"amount": 50.00, "description": "3-hour photo session deposit", "duration_hours": 3},
}


class CheckoutRequest(BaseModel):
    package_id: str  # "1hr", "2hr", "3hr" or custom duration
    origin_url: str  # Frontend origin for success/cancel URLs
    user_id: str
    spot_id: Optional[str] = None
    photographer_id: Optional[str] = None
    duration_hours: Optional[int] = None  # For custom duration
    notes: Optional[str] = None


class CheckoutStatusRequest(BaseModel):
    session_id: str


class PhotographerPricingUpdate(BaseModel):
    hourly_rate: Optional[float] = None  # On-demand hourly rate
    deposit_percentage: Optional[float] = None  # Deposit % (default 50%)
    min_booking_hours: Optional[int] = None  # Minimum booking duration


@router.post("/payments/checkout")
async def create_checkout_session(
    request: Request,
    data: CheckoutRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a Stripe Checkout session for Request a Pro deposit.
    Uses photographer's custom pricing if available, otherwise defaults.
    """
    from emergentintegrations.payments.stripe.checkout import (
        StripeCheckout, CheckoutSessionRequest, CheckoutSessionResponse
    )
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == data.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get photographer's custom pricing if photographer_id is provided
    photographer = None
    hourly_rate = 50.0  # Default rate
    deposit_pct = 0.50  # Default 50% deposit
    
    if data.photographer_id:
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == data.photographer_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        
        if photographer:
            # Use photographer's custom hourly rate if set
            hourly_rate = photographer.on_demand_hourly_rate or photographer.booking_hourly_rate or 50.0
    
    # Determine duration from package_id or custom duration
    duration_hours = data.duration_hours or 1
    if data.package_id in ["1hr", "small"]:
        duration_hours = 1
    elif data.package_id in ["2hr", "medium"]:
        duration_hours = 2
    elif data.package_id in ["3hr", "large"]:
        duration_hours = 3
    
    # Calculate deposit amount based on photographer's rate
    total_amount = hourly_rate * duration_hours
    deposit_amount = round(total_amount * deposit_pct, 2)
    
    description = f"{duration_hours}-hour photo session deposit"
    if photographer:
        description = f"{duration_hours}hr session with {photographer.full_name}"
    
    # Build URLs from frontend origin
    success_url = f"{data.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{data.origin_url}/map"
    
    # Webhook URL
    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    
    # Initialize Stripe
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    # Build metadata
    metadata = {
        "user_id": data.user_id,
        "user_email": user.email,
        "package_id": data.package_id,
        "type": "request_a_pro_deposit",
        "duration_hours": str(duration_hours),
        "hourly_rate": str(hourly_rate),
        "deposit_pct": str(deposit_pct)
    }
    
    if data.spot_id:
        metadata["spot_id"] = data.spot_id
    if data.photographer_id:
        metadata["photographer_id"] = data.photographer_id
    if data.notes:
        metadata["notes"] = data.notes[:200]
    
    try:
        # Create checkout session
        checkout_request = CheckoutSessionRequest(
            amount=deposit_amount,
            currency="usd",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=metadata
        )
        
        session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(checkout_request)
        
        # Create payment transaction record (PENDING status)
        transaction = PaymentTransaction(
            user_id=data.user_id,
            session_id=session.session_id,
            amount=deposit_amount,
            currency="usd",
            status="Pending",
            payment_status="Pending",
            transaction_metadata=str(metadata)
        )
        db.add(transaction)
        await db.commit()
        
        logger.info(f"Checkout session created: {session.session_id} for user {data.user_id}")
        
        return {
            "url": session.url,
            "session_id": session.session_id,
            "deposit_amount": deposit_amount,
            "total_amount": total_amount,
            "hourly_rate": hourly_rate,
            "duration_hours": duration_hours,
            "description": description,
            "photographer_name": photographer.full_name if photographer else None
        }
    
    except Exception as e:
        logger.error(f"Error creating checkout session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create checkout: {str(e)}")


@router.get("/payments/checkout/status/{session_id}")
async def get_checkout_status(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Check payment status and update database"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    try:
        # Get checkout status from Stripe
        status = await stripe_checkout.get_checkout_status(session_id)
        
        # Find the transaction in our database
        result = await db.execute(
            select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
        )
        transaction = result.scalar_one_or_none()
        
        if transaction:
            # Only update if not already processed
            if transaction.status != "completed" and status.payment_status == "paid":
                transaction.status = "completed"
                transaction.payment_status = status.payment_status
                transaction.updated_at = datetime.now(timezone.utc)
                
                # Add credits to user wallet
                user_result = await db.execute(
                    select(Profile).where(Profile.id == transaction.user_id)
                )
                user = user_result.scalar_one_or_none()
                if user:
                    user.credits = (user.credits or 0) + int(status.amount_total / 100)  # Amount is in cents
                    logger.info(f"Added {status.amount_total / 100} credits to user {user.id}")
                
                await db.commit()
                logger.info(f"Payment completed for session {session_id}")
            
            elif status.status == "expired":
                transaction.status = "expired"
                transaction.payment_status = status.payment_status
                transaction.updated_at = datetime.now(timezone.utc)
                await db.commit()
        
        return {
            "status": status.status,
            "payment_status": status.payment_status,
            "amount_total": status.amount_total,
            "currency": status.currency,
            "metadata": status.metadata
        }
    
    except Exception as e:
        logger.error(f"Error checking checkout status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to check status: {str(e)}")


@router.post("/webhook/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Handle Stripe webhook events"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    try:
        body = await request.body()
        signature = request.headers.get("Stripe-Signature")
        
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        
        logger.info(f"Stripe webhook: {webhook_response.event_type} for session {webhook_response.session_id}")
        
        # Handle Identity Verification events
        if webhook_response.event_type == "identity.verification_session.verified":
            # User identity has been verified
            verification_session = webhook_response.raw_event.get("data", {}).get("object", {})
            user_metadata = verification_session.get("metadata", {})
            user_id = user_metadata.get("user_id")
            
            if user_id:
                result = await db.execute(select(Profile).where(Profile.id == user_id))
                user = result.scalar_one_or_none()
                if user:
                    user.is_verified = True
                    user.identity_verified_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.info(f"Identity verified for user {user_id}")
            
            return {"status": "received", "event": "identity_verified"}
        
        # Handle Subscription events
        if webhook_response.event_type == "customer.subscription.deleted":
            # Subscription was canceled or expired
            subscription = webhook_response.raw_event.get("data", {}).get("object", {})
            subscription_metadata = subscription.get("metadata", {})
            user_id = subscription_metadata.get("user_id")
            
            if user_id:
                result = await db.execute(select(Profile).where(Profile.id == user_id))
                user = result.scalar_one_or_none()
                if user:
                    # Revert to ad-supported (free tier)
                    user.is_ad_supported = True
                    user.subscription_status = "canceled"
                    user.subscription_ended_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.info(f"Subscription canceled for user {user_id}, reverted to ad-supported")
            
            return {"status": "received", "event": "subscription_deleted"}
        
        if webhook_response.event_type == "customer.subscription.updated":
            # Subscription was updated (could be payment failure)
            subscription = webhook_response.raw_event.get("data", {}).get("object", {})
            status = subscription.get("status")
            subscription_metadata = subscription.get("metadata", {})
            user_id = subscription_metadata.get("user_id")
            
            if user_id and status in ["past_due", "unpaid", "canceled"]:
                result = await db.execute(select(Profile).where(Profile.id == user_id))
                user = result.scalar_one_or_none()
                if user:
                    user.is_ad_supported = True
                    user.subscription_status = status
                    await db.commit()
                    logger.info(f"Subscription status changed to {status} for user {user_id}")
            
            return {"status": "received", "event": "subscription_updated"}
        
        # Update transaction based on checkout event
        if webhook_response.session_id:
            result = await db.execute(
                select(PaymentTransaction).where(
                    PaymentTransaction.session_id == webhook_response.session_id
                )
            )
            transaction = result.scalar_one_or_none()
            
            if transaction:
                if webhook_response.payment_status == "paid" and transaction.status != "completed":
                    transaction.status = "completed"
                    transaction.payment_status = "paid"
                    transaction.updated_at = datetime.now(timezone.utc)
                    
                    # Add credits
                    user_result = await db.execute(
                        select(Profile).where(Profile.id == transaction.user_id)
                    )
                    user = user_result.scalar_one_or_none()
                    if user:
                        user.credits = (user.credits or 0) + int(transaction.amount)
                    
                    await db.commit()
                    logger.info(f"Webhook: Payment completed for {webhook_response.session_id}")
        
        return {"status": "received"}
    
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error", "detail": str(e)}


@router.get("/payments/packages")
async def get_deposit_packages(
    photographer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get available deposit packages.
    If photographer_id is provided, returns packages with that photographer's custom pricing.
    """
    hourly_rate = 50.0  # Default
    photographer_name = None
    deposit_pct = 0.50
    
    if photographer_id:
        result = await db.execute(select(Profile).where(Profile.id == photographer_id))
        photographer = result.scalar_one_or_none()
        if photographer:
            hourly_rate = photographer.on_demand_hourly_rate or photographer.booking_hourly_rate or 50.0
            photographer_name = photographer.full_name
    
    # Generate packages based on hourly rate
    packages = [
        {
            "id": "1hr",
            "duration_hours": 1,
            "total_amount": hourly_rate * 1,
            "deposit_amount": round(hourly_rate * 1 * deposit_pct, 2),
            "description": f"1-hour session{' with ' + photographer_name if photographer_name else ''}"
        },
        {
            "id": "2hr",
            "duration_hours": 2,
            "total_amount": hourly_rate * 2,
            "deposit_amount": round(hourly_rate * 2 * deposit_pct, 2),
            "description": f"2-hour session{' with ' + photographer_name if photographer_name else ''}"
        },
        {
            "id": "3hr",
            "duration_hours": 3,
            "total_amount": hourly_rate * 3,
            "deposit_amount": round(hourly_rate * 3 * deposit_pct, 2),
            "description": f"3-hour session{' with ' + photographer_name if photographer_name else ''}"
        }
    ]
    
    return {
        "packages": packages,
        "hourly_rate": hourly_rate,
        "photographer_name": photographer_name,
        "deposit_percentage": deposit_pct * 100
    }


@router.get("/payments/history/{user_id}")
async def get_payment_history(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get payment history for a user"""
    result = await db.execute(
        select(PaymentTransaction)
        .where(PaymentTransaction.user_id == user_id)
        .order_by(PaymentTransaction.created_at.desc())
        .limit(50)
    )
    transactions = result.scalars().all()
    
    return [
        {
            "id": t.id,
            "amount": t.amount,
            "currency": t.currency,
            "status": t.status,
            "payment_status": t.payment_status,
            "created_at": t.created_at
        }
        for t in transactions
    ]


@router.put("/payments/photographer/{photographer_id}/pricing")
async def update_photographer_pricing(
    photographer_id: str,
    pricing: PhotographerPricingUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a photographer's session pricing in their toolkit"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if user is a photographer role (compare enum values)
    role_value = photographer.role.value if hasattr(photographer.role, 'value') else photographer.role
    if role_value not in ['Hobbyist', 'Photographer', 'Approved Pro', 'Grom Parent']:
        raise HTTPException(status_code=403, detail="Only photographers can set pricing")
    
    # Update pricing fields
    if pricing.hourly_rate is not None:
        photographer.on_demand_hourly_rate = pricing.hourly_rate
        photographer.booking_hourly_rate = pricing.hourly_rate  # Keep both in sync
    
    await db.commit()
    
    return {
        "message": "Pricing updated successfully",
        "hourly_rate": photographer.on_demand_hourly_rate,
        "booking_hourly_rate": photographer.booking_hourly_rate
    }


@router.get("/payments/photographer/{photographer_id}/pricing")
async def get_photographer_pricing(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a photographer's current pricing settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    return {
        "photographer_id": photographer.id,
        "name": photographer.full_name,
        "on_demand_hourly_rate": photographer.on_demand_hourly_rate or 75.0,
        "booking_hourly_rate": photographer.booking_hourly_rate or 50.0,
        "live_photo_price": photographer.live_photo_price or 5.0,
        "deposit_percentage": 50  # Default 50% deposit
    }



# ============================================================
# STRIPE IDENTITY VERIFICATION
# ============================================================

@router.post("/payments/identity/create-session")
async def create_identity_verification_session(
    user_id: str,
    return_url: str = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a Stripe Identity verification session.
    Used for verifying users (Guardian/Pro badges).
    """
    try:
        import stripe
        
        # Use STRIPE_API_KEY (same key works for Identity API)
        stripe_key = os.environ.get('STRIPE_API_KEY') or os.environ.get('STRIPE_SECRET_KEY')
        if not stripe_key:
            raise HTTPException(status_code=503, detail="Stripe not configured")
        
        stripe.api_key = stripe_key
        
        # Get user
        result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Already verified?
        if user.is_verified:
            return {"status": "already_verified", "message": "User is already verified"}
        
        # Get host URL
        host_url = os.environ.get('FRONTEND_URL') or return_url or 'https://raw-surf-os.preview.emergentagent.com'
        
        # Create Identity verification session
        verification_session = stripe.identity.VerificationSession.create(
            type="document",
            metadata={
                "user_id": user_id,
                "email": user.email
            },
            return_url=f"{host_url}/settings?tab=verification&status=complete"
        )
        
        # Store session ID on user profile
        user.identity_session_id = verification_session.id
        await db.commit()
        
        logger.info(f"Created identity verification session for user {user_id}")
        
        return {
            "session_id": verification_session.id,
            "url": verification_session.url,
            "status": verification_session.status
        }
    
    except stripe.error.StripeError as e:
        logger.error(f"Stripe identity error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Identity verification error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create verification session")


@router.get("/payments/identity/status/{user_id}")
async def get_identity_verification_status(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the current identity verification status for a user"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user_id": user_id,
        "is_verified": user.is_verified or False,
        "identity_verified_at": user.identity_verified_at.isoformat() if hasattr(user, 'identity_verified_at') and user.identity_verified_at else None,
        "session_id": getattr(user, 'identity_session_id', None)
    }
