"""
Cancellation exception requests and resolution.

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

# ============ CANCELLATION EXCEPTION REQUESTS ============

class ExceptionRequestBody(BaseModel):
    reason: str
    category: str = 'other'  # 'emergency', 'weather', 'injury', 'other'

class ExceptionResolveBody(BaseModel):
    approved: bool
    resolution_note: Optional[str] = None
    custom_refund_amount: Optional[float] = None  # Photographer can grant partial refund


@router.post("/{dispatch_id}/request-exception")
async def request_cancellation_exception(
    dispatch_id: str,
    user_id: str,
    data: ExceptionRequestBody,
    db: AsyncSession = Depends(get_db)
):
    """
    Surfer submits an emergency exception request to waive cancellation fees.
    Only available for cancelled on-demand sessions that had a fee applied.
    """
    # Get the dispatch
    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
    )
    dispatch = result.scalar_one_or_none()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    if dispatch.requester_id != user_id:
        raise HTTPException(status_code=403, detail="Only the requester can submit an exception")
    
    if dispatch.status != DispatchRequestStatusEnum.CANCELLED:
        raise HTTPException(status_code=400, detail="Can only request exception for cancelled sessions")
    
    if not dispatch.photographer_id:
        raise HTTPException(status_code=400, detail="No photographer assigned — no fee to dispute")
    
    # Check for existing pending exception
    existing = await db.execute(
        select(CancellationExceptionRequest).where(
            CancellationExceptionRequest.dispatch_request_id == dispatch_id,
            CancellationExceptionRequest.status == 'pending'
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An exception request is already pending")
    
    deposit = dispatch.deposit_amount or 0
    refund_given = dispatch.refund_amount or 0
    fee_charged = deposit - refund_given
    
    if fee_charged <= 0:
        raise HTTPException(status_code=400, detail="No cancellation fee was charged — nothing to dispute")
    
    exception_req = CancellationExceptionRequest(
        dispatch_request_id=dispatch_id,
        requester_id=user_id,
        photographer_id=dispatch.photographer_id,
        reason=data.reason,
        category=data.category,
        deposit_amount=deposit,
        fee_amount=fee_charged,
        refund_requested=fee_charged,  # Request full fee back
    )
    db.add(exception_req)
    
    # Notify photographer
    notif = Notification(
        user_id=dispatch.photographer_id,
        type='cancellation_exception',
        title='Fee Waiver Request',
        body=f'A surfer is requesting a cancellation fee waiver (${fee_charged:.2f}).',
        data=json.dumps({
            'dispatch_id': dispatch_id,
            'exception_id': exception_req.id,
            'action': 'exception_request'
        })
    )
    db.add(notif)
    
    await db.commit()
    
    return {
        "success": True,
        "exception_id": exception_req.id,
        "fee_amount": fee_charged,
        "message": "Exception request submitted. The photographer will review it."
    }


@router.post("/{dispatch_id}/resolve-exception")
async def resolve_cancellation_exception(
    dispatch_id: str,
    user_id: str,
    data: ExceptionResolveBody,
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer approves or denies a cancellation fee exception request.
    If approved, the withheld fee is refunded to the surfer.
    """
    # Get pending exception
    result = await db.execute(
        select(CancellationExceptionRequest).where(
            CancellationExceptionRequest.dispatch_request_id == dispatch_id,
            CancellationExceptionRequest.status == 'pending'
        )
    )
    exception_req = result.scalar_one_or_none()
    if not exception_req:
        raise HTTPException(status_code=404, detail="No pending exception request found")
    
    if exception_req.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only the assigned photographer can resolve this")
    
    now = datetime.now(timezone.utc)
    
    if data.approved:
        # Determine refund amount (photographer can set custom partial amount)
        refund = data.custom_refund_amount if data.custom_refund_amount is not None else exception_req.fee_amount
        refund = min(refund, exception_req.fee_amount)  # Cannot exceed original fee
        refund = max(0, refund)
        
        exception_req.status = 'approved'
        exception_req.final_refund_amount = refund
        
        # Process the refund
        if refund > 0:
            requester_result = await db.execute(
                select(Profile).where(Profile.id == exception_req.requester_id)
            )
            requester = requester_result.scalar_one_or_none()
            if requester:
                tx = CreditTransaction(
                    user_id=exception_req.requester_id,
                    amount=refund,
                    balance_before=requester.credit_balance,
                    balance_after=requester.credit_balance + refund,
                    transaction_type='exception_refund',
                    reference_type='dispatch_request',
                    reference_id=dispatch_id
                )
                db.add(tx)
                requester.credit_balance += refund
        
        # Notify surfer
        notif = Notification(
            user_id=exception_req.requester_id,
            type='exception_approved',
            title='Fee Waiver Approved',
            body=f'Your cancellation fee waiver was approved! ${refund:.2f} has been refunded.',
            data=json.dumps({'dispatch_id': dispatch_id, 'refund': refund})
        )
        db.add(notif)
    else:
        exception_req.status = 'denied'
        exception_req.final_refund_amount = 0
        
        notif = Notification(
            user_id=exception_req.requester_id,
            type='exception_denied',
            title='Fee Waiver Denied',
            body='Your cancellation fee waiver request was denied by the photographer.',
            data=json.dumps({'dispatch_id': dispatch_id})
        )
        db.add(notif)
    
    exception_req.resolution_note = data.resolution_note
    exception_req.resolved_at = now
    
    await db.commit()
    
    return {
        "success": True,
        "status": exception_req.status,
        "refund_amount": exception_req.final_refund_amount,
        "message": f"Exception {'approved' if data.approved else 'denied'}."
    }


@router.get("/photographer/{photographer_id}/exception-requests")
async def get_exception_requests(
    photographer_id: str,
    status_filter: str = "pending",
    db: AsyncSession = Depends(get_db)
):
    """Get cancellation exception requests for a photographer's dashboard."""
    query = select(CancellationExceptionRequest).where(
        CancellationExceptionRequest.photographer_id == photographer_id
    )
    if status_filter != 'all':
        query = query.where(CancellationExceptionRequest.status == status_filter)
    query = query.order_by(CancellationExceptionRequest.created_at.desc())
    
    result = await db.execute(query)
    exceptions = result.scalars().all()
    
    items = []
    for exc in exceptions:
        # Fetch requester info
        req_result = await db.execute(
            select(Profile).where(Profile.id == exc.requester_id)
        )
        requester = req_result.scalar_one_or_none()
        
        items.append({
            "id": exc.id,
            "dispatch_id": exc.dispatch_request_id,
            "requester_name": requester.full_name if requester else "Unknown",
            "requester_avatar": requester.avatar_url if requester else None,
            "reason": exc.reason,
            "category": exc.category,
            "deposit_amount": exc.deposit_amount,
            "fee_amount": exc.fee_amount,
            "refund_requested": exc.refund_requested,
            "status": exc.status,
            "resolution_note": exc.resolution_note,
            "final_refund_amount": exc.final_refund_amount,
            "created_at": exc.created_at.isoformat() if exc.created_at else None,
            "resolved_at": exc.resolved_at.isoformat() if exc.resolved_at else None,
        })
    
    return {"exception_requests": items, "count": len(items)}


