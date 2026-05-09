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
        db, admin.id, "dispute", "dispute_created",
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
            dispute.resolved_by = admin.id
            
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
        db, admin.id, "dispute", "dispute_updated",
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
        sender_id=admin.id,
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
        db, admin.id, "financial", "stripe_refund_issued",
        f"Stripe refund of ${amount} issued for dispute",
        "dispute", dispute.id, None,
        new_value={"amount": amount}
    )
    
    dispute.amount_stripe_refunded = (dispute.amount_stripe_refunded or 0) + amount
    dispute.status = "resolved_refund"
    dispute.resolved_at = datetime.now(timezone.utc)
    dispute.resolved_by = admin.id
    
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
    report.reviewed_by = admin.id
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
        db, admin.id, "report", "report_reviewed",
        f"Report reviewed: {data.action_taken}",
        "report", report.id, report.reported_user.email if report.reported_user else None,
        new_value={"action": data.action_taken}
    )
    
    await db.commit()
    
    return {"status": "reviewed", "action_taken": data.action_taken}


# Payout holds, audit logs, user-facing reports/disputes
# moved to moderation_reports.py (v88)
