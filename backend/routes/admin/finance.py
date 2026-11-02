"""
Admin Financial Operations
- Refund processing dashboard
- Payout batch management
- Failed payment recovery
- Tax reporting exports
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update, desc, case
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import csv
import io
import math

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, CreditTransaction, PaymentTransaction, Booking, RoleEnum,
    RefundRequest, RefundStatusEnum, PayoutBatch, FailedPayment
)
from .moderation import log_audit
from utils.credits import refund_credits
from utils.refund_guard import assert_not_seller

router = APIRouter()


# --- Pydantic Models ---
class CreateRefundRequest(BaseModel):
    user_id: str
    amount: float
    reason: str
    reason_category: Optional[str] = None
    transaction_id: Optional[str] = None
    booking_id: Optional[str] = None

class ProcessRefundRequest(BaseModel):
    action: str  # 'approve', 'reject'
    rejection_reason: Optional[str] = None

class CreatePayoutBatchRequest(BaseModel):
    user_ids: Optional[List[str]] = None  # If empty, process all pending


# --- REFUND PROCESSING ---
@router.get("/admin/finance/refunds")
async def get_refund_requests(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get refund requests with filters"""
    
    query = select(RefundRequest).order_by(desc(RefundRequest.created_at))
    if status:
        query = query.where(RefundRequest.status == RefundStatusEnum(status))
    
    # Get total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0
    
    result = await db.execute(query.limit(limit).offset(offset))
    refunds = result.scalars().all()
    
    refund_data = []
    for r in refunds:
        user = await db.execute(select(Profile.full_name, Profile.email).where(Profile.id == r.user_id))
        user_info = user.fetchone()
        
        refund_data.append({
            "id": r.id,
            "user_id": r.user_id,
            "user_name": user_info[0] if user_info else None,
            "user_email": user_info[1] if user_info else None,
            "amount": r.amount,
            "currency": r.currency,
            "reason": r.reason,
            "reason_category": r.reason_category,
            "status": r.status.value if r.status else None,
            "transaction_id": r.transaction_id,
            "booking_id": r.booking_id,
            "processed_at": r.processed_at.isoformat() if r.processed_at else None,
            "rejection_reason": r.rejection_reason,
            "created_at": r.created_at.isoformat() if r.created_at else None
        })
    
    return {
        "refunds": refund_data,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.post("/admin/finance/refunds")
async def create_refund_request(
    request: CreateRefundRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a refund request (admin-initiated)"""
    
    refund = RefundRequest(
        user_id=request.user_id,
        amount=request.amount,
        reason=request.reason,
        reason_category=request.reason_category,
        transaction_id=request.transaction_id,
        booking_id=request.booking_id
    )
    
    db.add(refund)
    await log_audit(db, admin.id, "finance", f"Created refund request for ${request.amount}")
    await db.commit()
    
    return {"success": True, "refund_id": refund.id}


@router.post("/admin/finance/refunds/{refund_id}/process")
async def process_refund(
    refund_id: str,
    request: ProcessRefundRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Approve or reject a refund request"""
    
    result = await db.execute(select(RefundRequest).where(RefundRequest.id == refund_id))
    refund = result.scalar_one_or_none()
    
    if not refund:
        raise HTTPException(status_code=404, detail="Refund request not found")
    
    if refund.status != RefundStatusEnum.PENDING:
        raise HTTPException(status_code=400, detail="Refund already processed")
    
    if request.action == "approve":
        # A refund pays whoever PAID: never the seller of the booking / transaction it refunds (policy P1).
        # Checked before anything changes, so a refused approval leaves the request pending.
        if not math.isfinite(refund.amount) or refund.amount <= 0:
            raise HTTPException(status_code=400, detail="The refund amount must be a positive number")
        await assert_not_seller(db, refund.user_id, booking_id=refund.booking_id,
                                transaction_id=refund.transaction_id)

        # Claim the request first (conditional, so a double approval cannot credit twice) ...
        claimed = await db.execute(
            update(RefundRequest)
            .where(RefundRequest.id == refund_id, RefundRequest.status == RefundStatusEnum.PENDING)
            .values(
                status=RefundStatusEnum.COMPLETED,
                processed_by=admin.id,
                processed_at=datetime.now(timezone.utc)
            )
        )
        if claimed.rowcount != 1:
            raise HTTPException(status_code=400, detail="Refund already processed")

        # ... then credit through the shared helper, which moves the balance AND writes a complete ledger row.
        # (The old code wrote a row without balance_before/balance_after, which cannot be inserted, and never
        # changed the balance.) A failed credit raises, which rolls the claim back with it.
        # In production, this would initiate the actual Stripe refund
        ok, _balance, error = await refund_credits(
            user_id=refund.user_id, amount=refund.amount, db=db,
            description=f"Refund: {refund.reason}",
            reference_type="booking" if refund.booking_id else "refund_request",
            reference_id=refund.booking_id or refund.id,
            original_transaction_id=refund.transaction_id)
        if not ok:
            raise HTTPException(status_code=400, detail=error or "Could not credit the refund")

    elif request.action == "reject":
        await db.execute(
            update(RefundRequest)
            .where(RefundRequest.id == refund_id)
            .values(
                status=RefundStatusEnum.REJECTED,
                processed_by=admin.id,
                processed_at=datetime.now(timezone.utc),
                rejection_reason=request.rejection_reason
            )
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    await log_audit(db, admin.id, "finance", f"{request.action}d refund {refund_id}")
    await db.commit()
    
    return {"success": True, "status": request.action + "d"}


async def _eligible_payouts(db, user_ids=None):
    """Cap ledger cash eligibility by the remaining non-promotional wallet.

    Legacy earning paths do not always update the split cash pocket, so their
    signed ledger cash and stored cash pockets can each be incomplete. Use
    either source only up to the current total-minus-promo cap.
    """
    ledger_cash = select(
        CreditTransaction.user_id.label('user_id'),
        func.sum(CreditTransaction.amount - func.coalesce(CreditTransaction.spend_only_amount, 0)).label('cash')
    ).group_by(CreditTransaction.user_id).subquery()
    total = func.coalesce(Profile.credit_balance, 0)
    promo = func.coalesce(Profile.spend_only_credits, 0)
    cash = case((total > promo, total - promo), else_=0)
    # Legacy wallets can have a populated pocket but incomplete cash ledger,
    # or a valid cash ledger with a stale pocket. Neither may erase the other.
    recorded = func.coalesce(ledger_cash.c.cash, 0)
    stored = func.coalesce(Profile.withdrawable_credits, 0)
    pocket = case((recorded > stored, recorded), else_=stored)
    eligible = case((pocket < cash, pocket), else_=cash)
    query = select(Profile.id, Profile.full_name, Profile.email, eligible.label('balance')).outerjoin(
        ledger_cash, ledger_cash.c.user_id == Profile.id).where(
        Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]), eligible > 0).order_by(desc('balance'))
    if user_ids:
        query = query.where(Profile.id.in_(user_ids))
    result = await db.execute(query)
    return [{'user_id': row[0], 'name': row[1], 'email': row[2],
             'balance': round(float(row[3]), 2)} for row in result.fetchall()]


# --- PAYOUT BATCH MANAGEMENT ---
@router.get("/admin/finance/payouts")
async def get_payout_batches(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get payout batches"""
    
    query = select(PayoutBatch).order_by(desc(PayoutBatch.created_at))
    if status:
        query = query.where(PayoutBatch.status == status)
    
    result = await db.execute(query.limit(limit))
    batches = result.scalars().all()
    
    return {
        "batches": [{
            "id": b.id,
            "batch_number": b.batch_number,
            "total_amount": b.total_amount,
            "total_recipients": b.total_recipients,
            "currency": b.currency,
            "status": b.status,
            "initiated_at": b.initiated_at.isoformat() if b.initiated_at else None,
            "completed_at": b.completed_at.isoformat() if b.completed_at else None,
            "successful_count": b.successful_count,
            "failed_count": b.failed_count,
            "created_at": b.created_at.isoformat() if b.created_at else None
        } for b in batches]
    }


@router.get("/admin/finance/payouts/pending")
async def get_pending_payouts(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get photographers with pending payouts"""
    
    pending = await _eligible_payouts(db)

    total_pending = sum(p['balance'] for p in pending)
    
    return {
        "pending_payouts": pending,
        "total_pending_amount": round(total_pending, 2),
        "total_recipients": len(pending)
    }


@router.post("/admin/finance/payouts/create-batch")
async def create_payout_batch(
    request: CreatePayoutBatchRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new payout batch"""
    
    # Generate batch number
    count = await db.execute(select(func.count(PayoutBatch.id)))
    batch_count = count.scalar() or 0
    batch_number = f"PAY-{datetime.now().year}-{str(batch_count + 1).zfill(3)}"
    
    # Reuse cash-eligible wallet balances, not positive historical credits.
    recipients = await _eligible_payouts(db, request.user_ids)
    total_amount = round(sum(row['balance'] for row in recipients), 2)

    batch = PayoutBatch(
        batch_number=batch_number,
        total_amount=total_amount,
        total_recipients=len(recipients),
        status="pending",
        initiated_by=admin.id
    )
    
    db.add(batch)
    await log_audit(db, admin.id, "finance", f"Created payout batch {batch_number}")
    await db.commit()
    
    return {
        "success": True,
        "batch_id": batch.id,
        "batch_number": batch_number,
        "total_amount": batch.total_amount,
        "total_recipients": batch.total_recipients
    }


@router.post("/admin/finance/payouts/{batch_id}/process")
async def process_payout_batch(
    batch_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Process a payout batch"""
    
    result = await db.execute(select(PayoutBatch).where(PayoutBatch.id == batch_id))
    batch = result.scalar_one_or_none()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    if batch.status != "pending":
        raise HTTPException(status_code=400, detail="Batch already processed")
    
    # In production, this would initiate actual Stripe payouts
    # For now, simulate processing
    await db.execute(
        update(PayoutBatch)
        .where(PayoutBatch.id == batch_id)
        .values(
            status="completed",
            initiated_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
            successful_count=batch.total_recipients,
            failed_count=0
        )
    )
    
    await log_audit(db, admin.id, "finance", f"Processed payout batch {batch.batch_number}")
    await db.commit()
    
    return {"success": True, "status": "completed"}


# --- FAILED PAYMENT RECOVERY ---
@router.get("/admin/finance/failed-payments")
async def get_failed_payments(
    admin: Profile = Depends(get_current_admin),
    include_recovered: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get failed payments for recovery"""
    
    query = select(FailedPayment).order_by(desc(FailedPayment.created_at))
    if not include_recovered:
        query = query.where(FailedPayment.recovered == False)
    
    result = await db.execute(query.limit(limit))
    failures = result.scalars().all()
    
    failed_data = []
    for f in failures:
        user = await db.execute(select(Profile.full_name, Profile.email).where(Profile.id == f.user_id))
        user_info = user.fetchone()
        
        failed_data.append({
            "id": f.id,
            "user_id": f.user_id,
            "user_name": user_info[0] if user_info else None,
            "user_email": user_info[1] if user_info else None,
            "amount": f.amount,
            "currency": f.currency,
            "payment_type": f.payment_type,
            "failure_code": f.failure_code,
            "failure_message": f.failure_message,
            "recovery_attempts": f.recovery_attempts,
            "last_attempt_at": f.last_attempt_at.isoformat() if f.last_attempt_at else None,
            "recovered": f.recovered,
            "created_at": f.created_at.isoformat() if f.created_at else None
        })
    
    return {
        "failed_payments": failed_data,
        "total_amount": sum(f["amount"] for f in failed_data)
    }


@router.post("/admin/finance/failed-payments/{payment_id}/retry")
async def retry_failed_payment(
    payment_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retry a failed payment"""
    
    result = await db.execute(select(FailedPayment).where(FailedPayment.id == payment_id))
    failed = result.scalar_one_or_none()
    
    if not failed:
        raise HTTPException(status_code=404, detail="Failed payment not found")
    
    if failed.recovered:
        raise HTTPException(status_code=400, detail="Payment already recovered")
    
    # In production, this would retry the Stripe charge
    # For now, simulate recovery attempt
    success = True  # Simulated
    
    if success:
        await db.execute(
            update(FailedPayment)
            .where(FailedPayment.id == payment_id)
            .values(
                recovered=True,
                recovered_at=datetime.now(timezone.utc),
                recovery_attempts=failed.recovery_attempts + 1,
                last_attempt_at=datetime.now(timezone.utc)
            )
        )
    else:
        await db.execute(
            update(FailedPayment)
            .where(FailedPayment.id == payment_id)
            .values(
                recovery_attempts=failed.recovery_attempts + 1,
                last_attempt_at=datetime.now(timezone.utc)
            )
        )
    
    await db.commit()
    
    return {"success": success, "recovered": success}


# --- TAX REPORTING ---
@router.get("/admin/finance/tax-report")
async def get_tax_report(
    year: int,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get tax report data for a year"""
    
    start_date = datetime(year, 1, 1, tzinfo=timezone.utc)
    end_date = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    
    # Get photographers with earnings over $600 (1099 threshold)
    result = await db.execute(
        select(
            Profile.id,
            Profile.full_name,
            Profile.email,
            Profile.location,
            func.sum(case(
                (CreditTransaction.amount > 0, CreditTransaction.amount),
                else_=0
            )).label('total_earnings')
        )
        .join(CreditTransaction, CreditTransaction.user_id == Profile.id)
        .where(and_(
            CreditTransaction.created_at >= start_date,
            CreditTransaction.created_at < end_date,
            Profile.role.in_(['Photographer', 'Approved Pro'])
        ))
        .group_by(Profile.id, Profile.full_name, Profile.email, Profile.location)
        .having(func.sum(case(
            (CreditTransaction.amount > 0, CreditTransaction.amount),
            else_=0
        )) >= 600)
        .order_by(desc('total_earnings'))
    )
    
    recipients = [{
        "user_id": row[0],
        "name": row[1],
        "email": row[2],
        "location": row[3],
        "total_earnings": round(float(row[4]), 2)
    } for row in result.fetchall()]
    
    total_reportable = sum(r['total_earnings'] for r in recipients)
    
    return {
        "year": year,
        "threshold": 600,
        "recipients": recipients,
        "total_recipients": len(recipients),
        "total_reportable_amount": round(total_reportable, 2)
    }


@router.get("/admin/finance/stats")
async def get_finance_stats(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get financial statistics"""
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Pending refunds
    pending_refunds = await db.execute(
        select(func.count(RefundRequest.id), func.sum(RefundRequest.amount))
        .where(RefundRequest.status == RefundStatusEnum.PENDING)
    )
    refund_data = pending_refunds.fetchone()
    
    # Processed refunds in period
    processed_refunds = await db.execute(
        select(func.count(RefundRequest.id), func.sum(RefundRequest.amount))
        .where(and_(
            RefundRequest.processed_at >= start_date,
            RefundRequest.status == RefundStatusEnum.COMPLETED
        ))
    )
    processed_data = processed_refunds.fetchone()
    
    # Failed payments
    failed = await db.execute(
        select(func.count(FailedPayment.id), func.sum(FailedPayment.amount))
        .where(FailedPayment.recovered == False)
    )
    failed_data = failed.fetchone()
    
    # Recovery rate
    total_failed = await db.execute(
        select(func.count(FailedPayment.id))
        .where(FailedPayment.created_at >= start_date)
    )
    recovered = await db.execute(
        select(func.count(FailedPayment.id))
        .where(and_(
            FailedPayment.created_at >= start_date,
            FailedPayment.recovered == True
        ))
    )
    total_f = total_failed.scalar() or 0
    recovered_f = recovered.scalar() or 0
    
    return {
        "period_days": days,
        "pending_refunds": {
            "count": refund_data[0] or 0,
            "amount": round(float(refund_data[1] or 0), 2)
        },
        "processed_refunds": {
            "count": processed_data[0] or 0,
            "amount": round(float(processed_data[1] or 0), 2)
        },
        "failed_payments": {
            "count": failed_data[0] or 0,
            "amount": round(float(failed_data[1] or 0), 2)
        },
        "recovery_rate": round((recovered_f / total_f * 100) if total_f > 0 else 0, 1)
    }


# Need to import for the tax report query
from sqlalchemy import case, distinct
