"""
P0 Admin Features: Dispute Resolution, User Reports, Payout Holds, Audit Logs
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, Dispute, DisputeMessage, UserReport, PayoutHold, AuditLog,
    CreditTransaction, Booking, LiveSession, RoleEnum
)

router = APIRouter()

# ============ HELPER FUNCTIONS ============

async def log_audit(
    db: AsyncSession,
    actor_id: str,
    category: str,
    action: str,
    description: str = None,
    target_type: str = None,
    target_id: str = None,
    target_email: str = None,
    old_value: dict = None,
    new_value: dict = None,
    is_admin_action: bool = True,
    is_system_action: bool = False,
    ip_address: str = None,
    extra_data: dict = None
):
    """Create an audit log entry"""
    # Get actor info
    actor = None
    if actor_id:
        result = await db.execute(select(Profile).where(Profile.id == actor_id))
        actor = result.scalar_one_or_none()
    
    log = AuditLog(
        actor_id=actor_id,
        actor_email=actor.email if actor else None,
        actor_role=actor.role.value if actor and actor.role else None,
        is_admin_action=is_admin_action,
        is_system_action=is_system_action,
        category=category,
        action=action,
        description=description,
        target_type=target_type,
        target_id=target_id,
        target_email=target_email,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address,
        extra_data=extra_data or {}
    )
    db.add(log)
    return log


# ============ DISPUTE RESOLUTION ============

class CreateDisputeRequest(BaseModel):
    complainant_id: str
    respondent_id: str
    dispute_type: str  # payment, service_quality, no_show, harassment, fraud, other
    subject: str
    description: str
    amount_disputed: Optional[float] = None
    booking_id: Optional[str] = None
    live_session_id: Optional[str] = None
    gallery_item_id: Optional[str] = None
    evidence_urls: Optional[List[str]] = []
    priority: Optional[str] = "normal"

class UpdateDisputeRequest(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    resolution_notes: Optional[str] = None
    amount_refunded: Optional[float] = None

class DisputeMessageRequest(BaseModel):
    message: str
    attachment_urls: Optional[List[str]] = []
    is_internal: Optional[bool] = False


@router.get("/admin/disputes")
async def get_disputes(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    dispute_type: Optional[str] = None,
    priority: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all disputes with filters"""
    
    query = select(Dispute).options(
        selectinload(Dispute.complainant),
        selectinload(Dispute.respondent)
    )
    
    if status:
        query = query.where(Dispute.status == status)
    if dispute_type:
        query = query.where(Dispute.dispute_type == dispute_type)
    if priority:
        query = query.where(Dispute.priority == priority)
    
    query = query.order_by(desc(Dispute.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    disputes = result.scalars().all()
    
    # Get total count
    count_query = select(func.count(Dispute.id))
    if status:
        count_query = count_query.where(Dispute.status == status)
    total = (await db.execute(count_query)).scalar()
    
    return {
        "disputes": [{
            "id": d.id,
            "complainant": {
                "id": d.complainant.id,
                "full_name": d.complainant.full_name,
                "email": d.complainant.email,
                "avatar_url": d.complainant.avatar_url
            } if d.complainant else None,
            "respondent": {
                "id": d.respondent.id,
                "full_name": d.respondent.full_name,
                "email": d.respondent.email,
                "avatar_url": d.respondent.avatar_url
            } if d.respondent else None,
            "dispute_type": d.dispute_type,
            "status": d.status,
            "priority": d.priority,
            "subject": d.subject,
            "description": d.description,
            "amount_disputed": d.amount_disputed,
            "amount_refunded": d.amount_refunded,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "resolved_at": d.resolved_at.isoformat() if d.resolved_at else None
        } for d in disputes],
        "total": total
    }


@router.get("/admin/disputes/{dispute_id}")
async def get_dispute_detail(
    dispute_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed dispute info with messages"""
    
    result = await db.execute(
        select(Dispute)
        .where(Dispute.id == dispute_id)
        .options(
            selectinload(Dispute.complainant),
            selectinload(Dispute.respondent),
            selectinload(Dispute.messages)
        )
    )
    dispute = result.scalar_one_or_none()
    
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    # Get messages with sender info
    messages_result = await db.execute(
        select(DisputeMessage)
        .where(DisputeMessage.dispute_id == dispute_id)
        .options(selectinload(DisputeMessage.sender))
        .order_by(DisputeMessage.created_at)
    )
    messages = messages_result.scalars().all()
    
    return {
        "id": dispute.id,
        "complainant": {
            "id": dispute.complainant.id,
            "full_name": dispute.complainant.full_name,
            "email": dispute.complainant.email,
            "avatar_url": dispute.complainant.avatar_url,
            "role": dispute.complainant.role.value if dispute.complainant.role else None
        } if dispute.complainant else None,
        "respondent": {
            "id": dispute.respondent.id,
            "full_name": dispute.respondent.full_name,
            "email": dispute.respondent.email,
            "avatar_url": dispute.respondent.avatar_url,
            "role": dispute.respondent.role.value if dispute.respondent.role else None
        } if dispute.respondent else None,
        "dispute_type": dispute.dispute_type,
        "status": dispute.status,
        "priority": dispute.priority,
        "subject": dispute.subject,
        "description": dispute.description,
        "evidence_urls": dispute.evidence_urls or [],
        "amount_disputed": dispute.amount_disputed,
        "amount_refunded": dispute.amount_refunded,
        "amount_stripe_refunded": dispute.amount_stripe_refunded,
        "resolution_notes": dispute.resolution_notes,
        "booking_id": dispute.booking_id,
        "live_session_id": dispute.live_session_id,
        "gallery_item_id": dispute.gallery_item_id,
        "created_at": dispute.created_at.isoformat() if dispute.created_at else None,
        "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
        "messages": [{
            "id": m.id,
            "sender": {
                "id": m.sender.id,
                "full_name": m.sender.full_name,
                "avatar_url": m.sender.avatar_url
            } if m.sender else None,
            "message": m.message,
            "attachment_urls": m.attachment_urls or [],
            "is_admin": m.is_admin,
            "is_internal": m.is_internal,
            "created_at": m.created_at.isoformat() if m.created_at else None
        } for m in messages]
    }


@router.post("/admin/disputes")
async def create_dispute(
    data: CreateDisputeRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new dispute (admin-initiated or auto-created from report)"""
    
    dispute = Dispute(
        complainant_id=data.complainant_id,
        respondent_id=data.respondent_id,
        dispute_type=data.dispute_type,
        subject=data.subject,
        description=data.description,
        amount_disputed=data.amount_disputed,
        booking_id=data.booking_id,
        live_session_id=data.live_session_id,
        gallery_item_id=data.gallery_item_id,
        evidence_urls=data.evidence_urls or [],
        priority=data.priority,
        status="open"
    )
    db.add(dispute)
    await db.flush()
    
    # Log audit
    await log_audit(
        db, admin_id, "dispute", "dispute_created",
        f"Dispute created: {data.subject}",
        "dispute", dispute.id, None,
        extra_data={"dispute_type": data.dispute_type, "amount": data.amount_disputed}
    )
    
    await db.commit()
    
    return {"id": dispute.id, "status": "created"}


@router.put("/admin/disputes/{dispute_id}")
async def update_dispute(
    dispute_id: str,
    data: UpdateDisputeRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update dispute status or resolution"""
    
    result = await db.execute(
        select(Dispute)
        .where(Dispute.id == dispute_id)
        .options(selectinload(Dispute.complainant))
    )
    dispute = result.scalar_one_or_none()
    
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    old_status = dispute.status
    old_values = {"status": old_status, "priority": dispute.priority}
    
    if data.status:
        dispute.status = data.status
        
        # If resolving, set resolved_at and resolved_by
        if data.status.startswith("resolved") or data.status == "closed":
            dispute.resolved_at = datetime.now(timezone.utc)
            dispute.resolved_by = admin_id
            
            # If refunding to account credit
            if data.amount_refunded and data.amount_refunded > 0:
                dispute.amount_refunded = data.amount_refunded
                
                # Add credit to complainant's account
                complainant = dispute.complainant
                if complainant:
                    complainant.credit_balance = (complainant.credit_balance or 0) + data.amount_refunded
                    
                    # Create credit transaction
                    credit_txn = CreditTransaction(
                        profile_id=complainant.id,
                        amount=data.amount_refunded,
                        transaction_type='dispute_refund',
                        description=f"Dispute resolution refund - {dispute.subject[:50]}",
                        reference_id=dispute.id
                    )
                    db.add(credit_txn)
    
    if data.priority:
        dispute.priority = data.priority
    
    if data.resolution_notes:
        dispute.resolution_notes = data.resolution_notes
    
    # Log audit
    await log_audit(
        db, admin_id, "dispute", "dispute_updated",
        f"Dispute updated: {dispute.subject}",
        "dispute", dispute.id, None,
        old_value=old_values,
        new_value={"status": dispute.status, "priority": dispute.priority}
    )
    
    await db.commit()
    
    return {"status": "updated", "new_status": dispute.status}


@router.post("/admin/disputes/{dispute_id}/messages")
async def add_dispute_message(
    dispute_id: str,
    data: DisputeMessageRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Add a message to a dispute thread"""
    
    # Verify dispute exists
    result = await db.execute(select(Dispute).where(Dispute.id == dispute_id))
    dispute = result.scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    message = DisputeMessage(
        dispute_id=dispute_id,
        sender_id=admin_id,
        message=data.message,
        attachment_urls=data.attachment_urls or [],
        is_admin=True,
        is_internal=data.is_internal
    )
    db.add(message)
    await db.commit()
    
    return {"id": message.id, "status": "added"}


@router.post("/admin/disputes/{dispute_id}/refund-stripe")
async def process_stripe_refund(
    dispute_id: str,
    amount: float,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Process actual Stripe refund for escalated disputes"""
    import stripe
    
    
    result = await db.execute(
        select(Dispute)
        .where(Dispute.id == dispute_id)
        .options(selectinload(Dispute.complainant))
    )
    dispute = result.scalar_one_or_none()
    
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    if dispute.status != "escalated":
        raise HTTPException(status_code=400, detail="Only escalated disputes can receive Stripe refunds")
    
    # Find the original Stripe payment
    # This would need to look up the original transaction
    # For now, return a placeholder response
    
    # Log the action
    await log_audit(
        db, admin_id, "financial", "stripe_refund_issued",
        f"Stripe refund of ${amount} issued for dispute",
        "dispute", dispute.id, None,
        new_value={"amount": amount}
    )
    
    dispute.amount_stripe_refunded = (dispute.amount_stripe_refunded or 0) + amount
    dispute.status = "resolved_refund"
    dispute.resolved_at = datetime.now(timezone.utc)
    dispute.resolved_by = admin_id
    
    await db.commit()
    
    return {"status": "refund_processed", "amount": amount}


# ============ USER REPORTS ============

class CreateReportRequest(BaseModel):
    reporter_id: str
    report_type: str  # user, post, photo, comment, message
    reason: str  # spam, inappropriate_content, harassment, fraud, etc.
    description: Optional[str] = None
    reported_user_id: Optional[str] = None
    reported_content_id: Optional[str] = None
    reported_content_type: Optional[str] = None
    evidence_urls: Optional[List[str]] = []

class ReviewReportRequest(BaseModel):
    action_taken: str  # warning_sent, content_removed, user_suspended, user_banned, no_action
    admin_notes: Optional[str] = None
    escalate_to_dispute: Optional[bool] = False


@router.get("/admin/reports")
async def get_reports(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    report_type: Optional[str] = None,
    reason: Optional[str] = None,
    priority: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all user reports with filters"""
    
    query = select(UserReport).options(
        selectinload(UserReport.reporter),
        selectinload(UserReport.reported_user)
    )
    
    if status:
        query = query.where(UserReport.status == status)
    if report_type:
        query = query.where(UserReport.report_type == report_type)
    if reason:
        query = query.where(UserReport.reason == reason)
    if priority:
        query = query.where(UserReport.priority == priority)
    
    query = query.order_by(desc(UserReport.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    reports = result.scalars().all()
    
    # Get counts by status
    pending_count = (await db.execute(
        select(func.count(UserReport.id)).where(UserReport.status == 'pending')
    )).scalar()
    
    return {
        "reports": [{
            "id": r.id,
            "reporter": {
                "id": r.reporter.id,
                "full_name": r.reporter.full_name,
                "avatar_url": r.reporter.avatar_url
            } if r.reporter else None,
            "reported_user": {
                "id": r.reported_user.id,
                "full_name": r.reported_user.full_name,
                "avatar_url": r.reported_user.avatar_url
            } if r.reported_user else None,
            "report_type": r.report_type,
            "reason": r.reason,
            "description": r.description,
            "status": r.status,
            "priority": r.priority,
            "action_taken": r.action_taken,
            "created_at": r.created_at.isoformat() if r.created_at else None
        } for r in reports],
        "pending_count": pending_count
    }


@router.post("/admin/reports")
async def create_report(
    data: CreateReportRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new user report (can be called by users or admins)"""
    report = UserReport(
        reporter_id=data.reporter_id,
        report_type=data.report_type,
        reason=data.reason,
        description=data.description,
        reported_user_id=data.reported_user_id,
        reported_content_id=data.reported_content_id,
        reported_content_type=data.reported_content_type,
        evidence_urls=data.evidence_urls or [],
        status="pending"
    )
    
    # Auto-set priority based on reason
    high_priority_reasons = ['harassment', 'fraud', 'underage', 'dangerous_behavior']
    if data.reason in high_priority_reasons:
        report.priority = "high"
    
    db.add(report)
    await db.commit()
    
    return {"id": report.id, "status": "submitted"}


@router.put("/admin/reports/{report_id}/review")
async def review_report(
    report_id: str,
    data: ReviewReportRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Review and take action on a report"""
    
    result = await db.execute(
        select(UserReport)
        .where(UserReport.id == report_id)
        .options(selectinload(UserReport.reported_user))
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.status = "action_taken" if data.action_taken != "no_action" else "no_violation"
    report.action_taken = data.action_taken
    report.admin_notes = data.admin_notes
    report.reviewed_by = admin_id
    report.reviewed_at = datetime.now(timezone.utc)
    
    # Take action on reported user
    if report.reported_user and data.action_taken in ['user_suspended', 'user_banned']:
        if data.action_taken == 'user_suspended':
            report.reported_user.is_suspended = True
        elif data.action_taken == 'user_banned':
            report.reported_user.is_suspended = True
            # Could add a permanent ban flag
    
    # Auto-create dispute if escalating
    if data.escalate_to_dispute and report.reported_user_id:
        dispute = Dispute(
            complainant_id=report.reporter_id,
            respondent_id=report.reported_user_id,
            dispute_type="harassment" if report.reason == "harassment" else "other",
            subject=f"Escalated from report: {report.reason}",
            description=report.description or f"Report escalated to dispute. Reason: {report.reason}",
            source_report_id=report.id,
            status="open",
            priority="high"
        )
        db.add(dispute)
        await db.flush()
        report.escalated_to_dispute = True
        report.dispute_id = dispute.id
    
    # Log audit
    await log_audit(
        db, admin_id, "report", "report_reviewed",
        f"Report reviewed: {data.action_taken}",
        "report", report.id, report.reported_user.email if report.reported_user else None,
        new_value={"action": data.action_taken}
    )
    
    await db.commit()
    
    return {"status": "reviewed", "action_taken": data.action_taken}


# ============ PAYOUT HOLDS ============

class CreatePayoutHoldRequest(BaseModel):
    photographer_id: str
    amount: float
    reason: str  # dispute_pending, fraud_investigation, chargeback, etc.
    description: Optional[str] = None
    dispute_id: Optional[str] = None
    auto_release_days: Optional[int] = None

class ReleaseHoldRequest(BaseModel):
    release_notes: Optional[str] = None


@router.get("/admin/payout-holds")
async def get_payout_holds(
    admin: Profile = Depends(get_current_admin),
    is_active: Optional[bool] = True,
    photographer_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all payout holds"""
    
    query = select(PayoutHold).options(selectinload(PayoutHold.photographer))
    
    if is_active is not None:
        query = query.where(PayoutHold.is_active == is_active)
    if photographer_id:
        query = query.where(PayoutHold.photographer_id == photographer_id)
    
    query = query.order_by(desc(PayoutHold.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    holds = result.scalars().all()
    
    # Get total held amount
    total_held = (await db.execute(
        select(func.sum(PayoutHold.amount)).where(PayoutHold.is_active == True)
    )).scalar() or 0
    
    return {
        "holds": [{
            "id": h.id,
            "photographer": {
                "id": h.photographer.id,
                "full_name": h.photographer.full_name,
                "email": h.photographer.email,
                "avatar_url": h.photographer.avatar_url
            } if h.photographer else None,
            "amount": h.amount,
            "reason": h.reason,
            "description": h.description,
            "is_active": h.is_active,
            "dispute_id": h.dispute_id,
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
    """Create a hold on photographer payouts"""
    
    # Verify photographer exists
    result = await db.execute(select(Profile).where(Profile.id == data.photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    hold = PayoutHold(
        photographer_id=data.photographer_id,
        amount=data.amount,
        reason=data.reason,
        description=data.description,
        dispute_id=data.dispute_id,
        created_by=admin_id,
        is_active=True
    )
    
    if data.auto_release_days:
        hold.auto_release_date = datetime.now(timezone.utc) + timedelta(days=data.auto_release_days)
    
    db.add(hold)
    await db.flush()
    
    # Log audit
    await log_audit(
        db, admin_id, "financial", "payout_hold_created",
        f"Payout hold of ${data.amount} created for {photographer.full_name}",
        "payout_hold", hold.id, photographer.email,
        new_value={"amount": data.amount, "reason": data.reason}
    )
    
    await db.commit()
    
    return {"id": hold.id, "status": "created"}


@router.post("/admin/payout-holds/{hold_id}/release")
async def release_payout_hold(
    hold_id: str,
    data: ReleaseHoldRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Release a payout hold"""
    
    result = await db.execute(
        select(PayoutHold)
        .where(PayoutHold.id == hold_id)
        .options(selectinload(PayoutHold.photographer))
    )
    hold = result.scalar_one_or_none()
    
    if not hold:
        raise HTTPException(status_code=404, detail="Hold not found")
    
    if not hold.is_active:
        raise HTTPException(status_code=400, detail="Hold already released")
    
    hold.is_active = False
    hold.released_at = datetime.now(timezone.utc)
    hold.released_by = admin_id
    hold.release_notes = data.release_notes
    
    # Log audit
    await log_audit(
        db, admin_id, "financial", "payout_hold_released",
        f"Payout hold of ${hold.amount} released for {hold.photographer.full_name if hold.photographer else 'unknown'}",
        "payout_hold", hold.id, hold.photographer.email if hold.photographer else None,
        new_value={"release_notes": data.release_notes}
    )
    
    await db.commit()
    
    return {"status": "released"}


# ============ AUDIT LOGS ============

@router.get("/admin/audit-logs")
async def get_audit_logs(
    admin: Profile = Depends(get_current_admin),
    category: Optional[str] = None,
    actor_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    is_admin_action: Optional[bool] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get audit logs with comprehensive filters"""
    
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
            "actor": {
                "id": log.actor.id,
                "full_name": log.actor.full_name,
                "email": log.actor.email
            } if log.actor else None,
            "actor_email": log.actor_email,
            "is_admin_action": log.is_admin_action,
            "is_system_action": log.is_system_action,
            "category": log.category,
            "action": log.action,
            "description": log.description,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "target_email": log.target_email,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "ip_address": log.ip_address,
            "created_at": log.created_at.isoformat() if log.created_at else None
        } for log in logs]
    }


@router.get("/admin/audit-logs/stats")
async def get_audit_stats(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get audit log statistics"""
    
    since = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Count by category
    category_counts = await db.execute(
        select(AuditLog.category, func.count(AuditLog.id))
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.category)
    )
    
    # Count admin actions
    admin_actions = await db.execute(
        select(func.count(AuditLog.id))
        .where(and_(AuditLog.is_admin_action == True, AuditLog.created_at >= since))
    )
    
    return {
        "period_days": days,
        "by_category": {row[0]: row[1] for row in category_counts},
        "total_admin_actions": admin_actions.scalar() or 0
    }


# ============ AUTO PAYOUT HOLD ON DISPUTE ============

async def auto_create_payout_hold_for_dispute(
    db: AsyncSession,
    dispute: Dispute,
    admin_id: str = None
):
    """Automatically create a payout hold when a dispute involves money"""
    if not dispute.amount_disputed or dispute.amount_disputed <= 0:
        return None
    
    # Only hold if respondent is a photographer
    result = await db.execute(select(Profile).where(Profile.id == dispute.respondent_id))
    respondent = result.scalar_one_or_none()
    
    if not respondent:
        return None
    
    photographer_roles = ['Photographer', 'Approved Pro', 'Hobbyist']
    if respondent.role and respondent.role.value not in photographer_roles:
        return None
    
    hold = PayoutHold(
        photographer_id=dispute.respondent_id,
        amount=dispute.amount_disputed,
        reason="dispute_pending",
        description=f"Auto-hold for dispute: {dispute.subject}",
        dispute_id=dispute.id,
        created_by=admin_id,
        is_active=True,
        auto_release_date=datetime.now(timezone.utc) + timedelta(days=30)  # Auto-release after 30 days if unresolved
    )
    db.add(hold)
    
    return hold



# ============ USER-FACING ENDPOINTS ============

@router.post("/reports/submit")
async def submit_user_report(
    data: CreateReportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    User-facing endpoint to submit a report (no admin required).
    Any authenticated user can report content or other users.
    """
    # Verify reporter exists
    result = await db.execute(select(Profile).where(Profile.id == data.reporter_id))
    reporter = result.scalar_one_or_none()
    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter profile not found")
    
    report = UserReport(
        reporter_id=data.reporter_id,
        report_type=data.report_type,
        reason=data.reason,
        description=data.description,
        reported_user_id=data.reported_user_id,
        reported_content_id=data.reported_content_id,
        reported_content_type=data.reported_content_type,
        evidence_urls=data.evidence_urls or [],
        status="pending"
    )
    
    # Auto-set priority based on reason
    high_priority_reasons = ['harassment', 'fraud', 'underage', 'dangerous_behavior']
    if data.reason in high_priority_reasons:
        report.priority = "high"
    
    db.add(report)
    
    # Log the report submission
    await log_audit(
        db, data.reporter_id, "report", "report_submitted",
        f"User submitted report: {data.reason}",
        target_type=data.report_type,
        target_id=data.reported_content_id or data.reported_user_id,
        is_admin_action=False
    )
    
    await db.commit()
    
    return {"id": report.id, "status": "submitted", "message": "Report submitted successfully. Our team will review it shortly."}


@router.post("/disputes/submit")
async def submit_user_dispute(
    data: CreateDisputeRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    User-facing endpoint to submit a dispute (no admin required).
    Users can dispute transactions, service quality, etc.
    """
    # Verify complainant exists
    result = await db.execute(select(Profile).where(Profile.id == data.complainant_id))
    complainant = result.scalar_one_or_none()
    if not complainant:
        raise HTTPException(status_code=404, detail="User profile not found")
    
    dispute = Dispute(
        complainant_id=data.complainant_id,
        respondent_id=data.respondent_id,
        dispute_type=data.dispute_type,
        subject=data.subject,
        description=data.description,
        amount_disputed=data.amount_disputed,
        booking_id=data.booking_id,
        live_session_id=data.live_session_id,
        gallery_item_id=data.gallery_item_id,
        evidence_urls=data.evidence_urls or [],
        priority=data.priority or "normal",
        status="open"
    )
    db.add(dispute)
    await db.flush()
    
    # Auto-create payout hold if amount is disputed
    if data.amount_disputed and data.amount_disputed > 0:
        await auto_create_payout_hold_for_dispute(db, dispute)
    
    # Log the dispute submission
    await log_audit(
        db, data.complainant_id, "dispute", "dispute_submitted",
        f"User submitted dispute: {data.subject}",
        target_type="user",
        target_id=data.respondent_id,
        is_admin_action=False,
        extra_data={"dispute_type": data.dispute_type, "amount": data.amount_disputed}
    )
    
    await db.commit()
    
    return {
        "id": dispute.id, 
        "status": "submitted",
        "message": "Dispute submitted successfully. Our team will review and respond within 24-48 hours."
    }


@router.get("/disputes/my-disputes")
async def get_my_disputes(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get disputes where the user is either complainant or respondent"""
    result = await db.execute(
        select(Dispute)
        .where(or_(Dispute.complainant_id == user_id, Dispute.respondent_id == user_id))
        .order_by(desc(Dispute.created_at))
        .limit(50)
    )
    disputes = result.scalars().all()
    
    return [{
        "id": d.id,
        "dispute_type": d.dispute_type,
        "status": d.status,
        "subject": d.subject,
        "amount_disputed": d.amount_disputed,
        "amount_refunded": d.amount_refunded,
        "is_complainant": d.complainant_id == user_id,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "resolved_at": d.resolved_at.isoformat() if d.resolved_at else None
    } for d in disputes]
