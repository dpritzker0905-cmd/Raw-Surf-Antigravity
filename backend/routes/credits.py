from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
import os
import stripe
import json
import logging

from database import get_db
from models import Profile, PaymentTransaction, CreditTransaction
from utils.credits import get_balance, get_transaction_history, add_credits

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

class CreditPurchaseRequest(BaseModel):
    amount: float
    origin_url: str

@router.post("/credits/purchase")
async def purchase_credits(user_id: str, data: CreditPurchaseRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    success_url = f"{data.origin_url}/credits/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{data.origin_url}/credits/cancel"
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(data.amount * 100),
                    'product_data': {
                        'name': f"{int(data.amount)} Raw Surf Credits",
                        'description': f"Add {int(data.amount)} credits to your Raw Surf account",
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": user_id, "credits": str(int(data.amount))}
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")
    
    transaction = PaymentTransaction(
        user_id=user_id,
        session_id=checkout_session.id,
        amount=data.amount,
        currency="usd",
        payment_status="Pending",
        status="Pending",
        transaction_metadata=json.dumps({"credits": int(data.amount)})
    )
    
    db.add(transaction)
    await db.commit()
    
    return {"checkout_url": checkout_session.url, "session_id": checkout_session.id}

@router.get("/credits/status/{session_id}")
async def check_credit_status(session_id: str, db: AsyncSession = Depends(get_db)):
    try:
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        payment_status = checkout_session.payment_status
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment verification error: {str(e)}")
    
    result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
    )
    transaction = result.scalar_one_or_none()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    credits_added = 0
    new_balance = 0
    
    if payment_status == 'paid' and transaction.payment_status != 'paid':
        transaction.payment_status = 'paid'
        transaction.status = 'completed'
        
        profile_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
        profile = profile_result.scalar_one_or_none()
        if profile:
            # Log the credit transaction
            balance_before = profile.credit_balance
            profile.credit_balance += transaction.amount
            credits_added = transaction.amount
            new_balance = profile.credit_balance
            
            credit_tx = CreditTransaction(
                user_id=transaction.user_id,
                amount=transaction.amount,
                balance_before=balance_before,
                balance_after=profile.credit_balance,
                transaction_type='stripe_topup',
                reference_type='payment_transaction',
                reference_id=transaction.id,
                description=f'Purchased {int(transaction.amount)} credits via Stripe'
            )
            db.add(credit_tx)
        
        await db.commit()
    elif payment_status == 'paid':
        # Already processed, get current balance
        profile_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
        profile = profile_result.scalar_one_or_none()
        if profile:
            new_balance = profile.credit_balance
            credits_added = transaction.amount
    
    amount_total = checkout_session.amount_total if checkout_session.amount_total else int(transaction.amount * 100)
    
    # Return status field that frontend expects
    return {
        "status": "completed" if payment_status == 'paid' else "pending",
        "payment_status": payment_status, 
        "amount": amount_total / 100,
        "credits_added": credits_added,
        "new_balance": new_balance
    }


@router.get("/credits/balance/{user_id}")
async def get_user_balance(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get user's current credit balance"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user_id": user_id,
        "balance": profile.credit_balance,
        "currency": "credits",
        "note": "1 credit = $1 USD"
    }


@router.get("/credits/history/{user_id}")
async def get_credit_history(
    user_id: str,
    limit: int = Query(default=50, le=100),
    transaction_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get user's credit transaction history"""
    # Verify user
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    history = await get_transaction_history(
        user_id=user_id,
        db=db,
        limit=limit,
        transaction_type=transaction_type
    )
    
    return {
        "user_id": user_id,
        "transactions": history,
        "count": len(history)
    }


@router.get("/credits/summary/{user_id}")
async def get_credit_summary(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get summary of user's credit activity"""
    from sqlalchemy import func
    
    # Verify user
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get totals by transaction type
    totals_result = await db.execute(
        select(
            CreditTransaction.transaction_type,
            func.sum(CreditTransaction.amount).label('total')
        )
        .where(CreditTransaction.user_id == user_id)
        .group_by(CreditTransaction.transaction_type)
    )
    totals = {row[0]: row[1] for row in totals_result.all()}
    
    # Calculate summary
    total_earned = sum(v for k, v in totals.items() if v > 0 and 'earning' in k.lower())
    total_spent = abs(sum(v for k, v in totals.items() if v < 0))
    
    return {
        "user_id": user_id,
        "current_balance": profile.credit_balance,
        "total_earned": total_earned,
        "total_spent": total_spent,
        "breakdown": totals
    }

