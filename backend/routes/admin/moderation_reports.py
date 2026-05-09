"""
moderation_reports.py — Payout holds, audit logs, user-facing reports/disputes.

Extracted from moderation.py (v88 decomposition). Contains:
  - Payout hold management (create, release, auto-hold on dispute)
  - Audit log viewing and stats
  - User-facing report/dispute submission endpoints
  - User dispute history
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, Dispute, UserReport, PayoutHold, AuditLog

router = APIRouter()
logger = logging.getLogger(__name__)


# Import log_audit from parent moderation module
from .moderation import log_audit


# ============ PYDANTIC MODELS ============

class CreatePayoutHoldRequest(BaseModel):
    photographer_id: str
    amount: float
    reason: str
    description: Optional[str] = None
    dispute_id: Optional[str] = None
    auto_release_days: Optional[int] = None

class ReleaseHoldRequest(BaseModel):
    release_notes: Optional[str] = None

class CreateReportRequest(BaseModel):
    reporter_id: str
    report_type: str
    reason: str
    description: Optional[str] = None
    reported_user_id: Optional[str] = None
    reported_content_id: Optional[str] = None
    reported_content_type: Optional[str] = None
    evidence_urls: Optional[List[str]] = None

class CreateDisputeRequest(BaseModel):
    complainant_id: str
    respondent_id: Optional[str] = None
    dispute_type: str
    subject: str
    description: str
    amount_disputed: Optional[float] = None
    booking_id: Optional[str] = None
    live_session_id: Optional[str] = None
    gallery_item_id: Optional[str] = None
    evidence_urls: Optional[List[str]] = None
    priority: Optional[str] = None


# ============ PAYOUT HOLDS ============

@router.get("/admin/payout-holds")
async def get_payout_holds(
    admin: Profile = Depends(get_current_admin),
    is_active: Optional[bool] = True,
    photographer_id: Optional[str] = None,
    limit: int = 50, offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all payout holds."""
    query = select(PayoutHold).options(selectinload(PayoutHold.photographer))
    if is_active is not None:
        query = query.where(PayoutHold.is_active == is_active)
    if photographer_id:
        query = query.where(PayoutHold.photographer_id == photographer_id)
    query = query.order_by(desc(PayoutHold.created_at)).limit(limit).offset(offset)

    result = await db.execute(query)
    holds = result.scalars().all()
    total_held = (await db.execute(
        select(func.sum(PayoutHold.amount)).where(PayoutHold.is_active == True)
    )).scalar() or 0

    return {
        "holds": [{
            "id": h.id,
            "photographer": {"id": h.photographer.id, "full_name": h.photographer.full_name,
                              "email": h.photographer.email, "avatar_url": h.photographer.avatar_url}
            if h.photographer else None,
            "amount": h.amount, "reason": h.reason, "description": h.description,
            "is_active": h.is_active, "dispute_id": h.dispute_id,
            "auto_release_date": h.auto_release_date.isoformat() if h.auto_release_date else None,
            "created_at": h.created_at.isoformat() if h.created_at else None,
            "released_at": h.released_at.isoformat() if h.released_at else None
        } for h in holds],
        "total_held_amount": total_held
    }


@router.post("/admin/payout-holds")
async def create_payout_hold(
    data: CreatePayoutHoldRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a hold on photographer payouts."""
    result = await db.execute(select(Profile).where(Profile.id == data.photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    hold = PayoutHold(
        photographer_id=data.photographer_id, amount=data.amount, reason=data.reason,
        description=data.description, dispute_id=data.dispute_id,
        created_by=admin.id, is_active=True
    )
    if data.auto_release_days:
        hold.auto_release_date = datetime.now(timezone.utc) + timedelta(days=data.auto_release_days)
    db.add(hold)
    await db.flush()

    await log_audit(db, admin.id, "financial", "payout_hold_created",
                    f"Payout hold of ${data.amount} created for {photographer.full_name}",
                    "payout_hold", hold.id, photographer.email,
                    new_value={"amount": data.amount, "reason": data.reason})
    await db.commit()
    return {"id": hold.id, "status": "created"}


@router.post("/admin/payout-holds/{hold_id}/release")
async def release_payout_hold(
    hold_id: str, data: ReleaseHoldRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Release a payout hold."""
    result = await db.execute(
        select(PayoutHold).where(PayoutHold.id == hold_id)
        .options(selectinload(PayoutHold.photographer))
    )
    hold = result.scalar_one_or_none()
    if not hold:
        raise HTTPException(status_code=404, detail="Hold not found")
    if not hold.is_active:
        raise HTTPException(status_code=400, detail="Hold already released")

    hold.is_active = False
    hold.released_at = datetime.now(timezone.utc)
    hold.released_by = admin.id
    hold.release_notes = data.release_notes

    await log_audit(db, admin.id, "financial", "payout_hold_released",
                    f"Payout hold of ${hold.amount} released for {hold.photographer.full_name if hold.photographer else 'unknown'}",
                    "payout_hold", hold.id, hold.photographer.email if hold.photographer else None,
                    new_value={"release_notes": data.release_notes})
    await db.commit()
    return {"status": "released"}


# ============ AUDIT LOGS ============

@router.get("/admin/audit-logs")
async def get_audit_logs(
    admin: Profile = Depends(get_current_admin),
    category: Optional[str] = None, actor_id: Optional[str] = None,
    target_type: Optional[str] = None, target_id: Optional[str] = None,
    is_admin_action: Optional[bool] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    limit: int = 100, offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get audit logs with comprehensive filters."""
    query = select(AuditLog).options(selectinload(AuditLog.actor))
    if category:
        query = query.where(AuditLog.category == category)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
    if target_type:
        query = query.where(AuditLog.target_type == target_type)
    if target_id:
        query = query.where(AuditLog.target_id == target_id)
    if is_admin_action is not None:
        query = query.where(AuditLog.is_admin_action == is_admin_action)
    if start_date:
        query = query.where(AuditLog.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.where(AuditLog.created_at <= datetime.fromisoformat(end_date))
    query = query.order_by(desc(AuditLog.created_at)).limit(limit).offset(offset)

    result = await db.execute(query)
    logs = result.scalars().all()
    return {
        "logs": [{
            "id": log.id,
            "actor": {"id": log.actor.id, "full_name": log.actor.full_name, "email": log.actor.email}
            if log.actor else None,
            "actor_email": log.actor_email, "is_admin_action": log.is_admin_action,
            "is_system_action": log.is_system_action, "category": log.category,
            "action": log.action, "description": log.description,
            "target_type": log.target_type, "target_id": log.target_id,
            "target_email": log.target_email, "old_value": log.old_value,
            "new_value": log.new_value, "ip_address": log.ip_address,
            "created_at": log.created_at.isoformat() if log.created_at else None
        } for log in logs]
    }


@router.get("/admin/audit-logs/stats")
async def get_audit_stats(
    admin: Profile = Depends(get_current_admin),
    days: int = 30, db: AsyncSession = Depends(get_db)
):
    """Get audit log statistics."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    category_counts = await db.execute(
        select(AuditLog.category, func.count(AuditLog.id))
        .where(AuditLog.created_at >= since).group_by(AuditLog.category)
    )
    admin_actions = await db.execute(
        select(func.count(AuditLog.id))
        .where(and_(AuditLog.is_admin_action == True, AuditLog.created_at >= since))
    )
    return {"period_days": days, "by_category": {row[0]: row[1] for row in category_counts},
            "total_admin_actions": admin_actions.scalar() or 0}


# ============ AUTO PAYOUT HOLD ON DISPUTE ============

async def auto_create_payout_hold_for_dispute(db: AsyncSession, dispute: Dispute, admin_id: str = None):
    """Automatically create a payout hold when a dispute involves money."""
    if not dispute.amount_disputed or dispute.amount_disputed <= 0:
        return None
    result = await db.execute(select(Profile).where(Profile.id == dispute.respondent_id))
    respondent = result.scalar_one_or_none()
    if not respondent:
        return None
    photographer_roles = ['Photographer', 'Approved Pro', 'Hobbyist']
    if respondent.role and respondent.role.value not in photographer_roles:
        return None
    hold = PayoutHold(
        photographer_id=dispute.respondent_id, amount=dispute.amount_disputed,
        reason="dispute_pending", description=f"Auto-hold for dispute: {dispute.subject}",
        dispute_id=dispute.id, created_by=admin_id, is_active=True,
        auto_release_date=datetime.now(timezone.utc) + timedelta(days=30)
    )
    db.add(hold)
    return hold


# ============ USER-FACING ENDPOINTS ============

@router.post("/reports/submit")
async def submit_user_report(data: CreateReportRequest, db: AsyncSession = Depends(get_db)):
    """User-facing endpoint to submit a report (no admin required)."""
    result = await db.execute(select(Profile).where(Profile.id == data.reporter_id))
    reporter = result.scalar_one_or_none()
    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter profile not found")

    report = UserReport(
        reporter_id=data.reporter_id, report_type=data.report_type,
        reason=data.reason, description=data.description,
        reported_user_id=data.reported_user_id,
        reported_content_id=data.reported_content_id,
        reported_content_type=data.reported_content_type,
        evidence_urls=data.evidence_urls or [], status="pending"
    )
    high_priority_reasons = ['harassment', 'fraud', 'underage', 'dangerous_behavior']
    if data.reason in high_priority_reasons:
        report.priority = "high"
    db.add(report)

    await log_audit(db, data.reporter_id, "report", "report_submitted",
                    f"User submitted report: {data.reason}",
                    target_type=data.report_type,
                    target_id=data.reported_content_id or data.reported_user_id,
                    is_admin_action=False)
    await db.commit()
    return {"id": report.id, "status": "submitted",
            "message": "Report submitted successfully. Our team will review it shortly."}


@router.post("/disputes/submit")
async def submit_user_dispute(data: CreateDisputeRequest, db: AsyncSession = Depends(get_db)):
    """User-facing endpoint to submit a dispute (no admin required)."""
    result = await db.execute(select(Profile).where(Profile.id == data.complainant_id))
    complainant = result.scalar_one_or_none()
    if not complainant:
        raise HTTPException(status_code=404, detail="User profile not found")

    dispute = Dispute(
        complainant_id=data.complainant_id, respondent_id=data.respondent_id,
        dispute_type=data.dispute_type, subject=data.subject, description=data.description,
        amount_disputed=data.amount_disputed, booking_id=data.booking_id,
        live_session_id=data.live_session_id, gallery_item_id=data.gallery_item_id,
        evidence_urls=data.evidence_urls or [], priority=data.priority or "normal", status="open"
    )
    db.add(dispute)
    await db.flush()

    if data.amount_disputed and data.amount_disputed > 0:
        await auto_create_payout_hold_for_dispute(db, dispute)

    await log_audit(db, data.complainant_id, "dispute", "dispute_submitted",
                    f"User submitted dispute: {data.subject}",
                    target_type="user", target_id=data.respondent_id,
                    is_admin_action=False,
                    extra_data={"dispute_type": data.dispute_type, "amount": data.amount_disputed})
    await db.commit()
    return {"id": dispute.id, "status": "submitted",
            "message": "Dispute submitted successfully. Our team will review and respond within 24-48 hours."}


@router.get("/disputes/my-disputes")
async def get_my_disputes(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get disputes where the user is either complainant or respondent."""
    result = await db.execute(
        select(Dispute).where(or_(Dispute.complainant_id == user_id, Dispute.respondent_id == user_id))
        .order_by(desc(Dispute.created_at)).limit(50)
    )
    disputes = result.scalars().all()
    return [{
        "id": d.id, "dispute_type": d.dispute_type, "status": d.status,
        "subject": d.subject, "amount_disputed": d.amount_disputed,
        "amount_refunded": d.amount_refunded, "is_complainant": d.complainant_id == user_id,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "resolved_at": d.resolved_at.isoformat() if d.resolved_at else None
    } for d in disputes]
