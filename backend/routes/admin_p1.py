"""
P1 Admin Features: Identity Verification, Impersonation Mode, Fraud Detection, User Journey
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, VerificationRequest, ImpersonationSession, FraudAlert, 
    UserActivityLog, AuditLog, RoleEnum
)
from routes.admin_moderation import log_audit

router = APIRouter()


# ============ IDENTITY VERIFICATION ============

class ProSurferVerificationRequest(BaseModel):
    user_id: str
    wsl_athlete_id: str
    wsl_profile_url: str
    competition_history_urls: Optional[List[str]] = []
    photo_id_url: Optional[str] = None
    additional_notes: Optional[str] = None

class ProPhotographerVerificationRequest(BaseModel):
    user_id: str
    instagram_url: Optional[str] = None
    portfolio_website: Optional[str] = None
    other_social_urls: Optional[List[str]] = []
    media_mentions: Optional[List[str]] = []  # URLs to articles/features
    professional_equipment: Optional[str] = None
    years_experience: Optional[int] = None
    sample_work_urls: Optional[List[str]] = []
    business_registration: Optional[str] = None
    photo_id_url: Optional[str] = None
    additional_notes: Optional[str] = None

class ReviewVerificationRequest(BaseModel):
    status: str  # approved, rejected, more_info_needed
    approve_as: Optional[str] = 'pro'  # 'pro' or 'legend' — only applies when status='approved' on pro_surfer type
    admin_notes: Optional[str] = None
    rejection_reason: Optional[str] = None


@router.post("/verification/pro-surfer/submit")
async def submit_pro_surfer_verification(
    data: ProSurferVerificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Submit a Pro Surfer verification request (WSL verification)"""
    # Check for existing pending request
    existing = await db.execute(
        select(VerificationRequest).where(
            and_(
                VerificationRequest.user_id == data.user_id,
                VerificationRequest.verification_type == 'pro_surfer',
                VerificationRequest.status.in_(['pending', 'under_review'])
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a pending verification request")
    
    request = VerificationRequest(
        user_id=data.user_id,
        verification_type='pro_surfer',
        status='pending',
        wsl_athlete_id=data.wsl_athlete_id,
        wsl_profile_url=data.wsl_profile_url,
        competition_history_urls=data.competition_history_urls or [],
        photo_id_url=data.photo_id_url,
        additional_notes=data.additional_notes
    )
    db.add(request)
    
    # Log activity
    activity = UserActivityLog(
        user_id=data.user_id,
        activity_type='verification_submitted',
        activity_category='settings',
        description='Submitted Pro Surfer (WSL) verification request'
    )
    db.add(activity)
    
    await db.commit()
    
    return {
        "id": request.id,
        "status": "submitted",
        "message": "Your Pro Surfer verification request has been submitted. Our team will review it within 24-48 hours."
    }


@router.post("/verification/pro-photographer/submit")
async def submit_pro_photographer_verification(
    data: ProPhotographerVerificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Submit an Approved Pro Photographer verification request"""
    # Check for existing pending request
    existing = await db.execute(
        select(VerificationRequest).where(
            and_(
                VerificationRequest.user_id == data.user_id,
                VerificationRequest.verification_type == 'approved_pro_photographer',
                VerificationRequest.status.in_(['pending', 'under_review'])
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a pending verification request")
    
    # Validate at least some verification info is provided
    if not any([data.instagram_url, data.portfolio_website, data.media_mentions, data.sample_work_urls]):
        raise HTTPException(
            status_code=400, 
            detail="Please provide at least one form of verification: Instagram, portfolio, media mentions, or sample work"
        )
    
    request = VerificationRequest(
        user_id=data.user_id,
        verification_type='approved_pro_photographer',
        status='pending',
        instagram_url=data.instagram_url,
        portfolio_website=data.portfolio_website,
        other_social_urls=data.other_social_urls or [],
        media_mentions=data.media_mentions or [],
        professional_equipment=data.professional_equipment,
        years_experience=data.years_experience,
        sample_work_urls=data.sample_work_urls or [],
        business_registration=data.business_registration,
        photo_id_url=data.photo_id_url,
        additional_notes=data.additional_notes
    )
    db.add(request)
    
    # Log activity
    activity = UserActivityLog(
        user_id=data.user_id,
        activity_type='verification_submitted',
        activity_category='settings',
        description='Submitted Approved Pro Photographer verification request'
    )
    db.add(activity)
    
    await db.commit()
    
    return {
        "id": request.id,
        "status": "submitted",
        "message": "Your Approved Pro Photographer verification request has been submitted. Our team will review it within 24-48 hours."
    }


@router.get("/verification/my-requests")
async def get_my_verification_requests(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's own verification requests"""
    result = await db.execute(
        select(VerificationRequest)
        .where(VerificationRequest.user_id == user_id)
        .order_by(desc(VerificationRequest.created_at))
    )
    requests = result.scalars().all()
    
    return [{
        "id": r.id,
        "verification_type": r.verification_type,
        "status": r.status,
        "rejection_reason": r.rejection_reason,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None
    } for r in requests]


@router.get("/admin/verification/queue")
async def get_verification_queue(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    verification_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get verification requests queue for admin review"""
    
    query = select(VerificationRequest).options(selectinload(VerificationRequest.user))
    
    if status:
        query = query.where(VerificationRequest.status == status)
    else:
        # Default to showing pending/under_review
        query = query.where(VerificationRequest.status.in_(['pending', 'under_review']))
    
    if verification_type:
        query = query.where(VerificationRequest.verification_type == verification_type)
    
    query = query.order_by(VerificationRequest.created_at).limit(limit).offset(offset)
    
    result = await db.execute(query)
    requests = result.scalars().all()
    
    # Get counts
    pending_count = (await db.execute(
        select(func.count(VerificationRequest.id))
        .where(VerificationRequest.status == 'pending')
    )).scalar()
    
    return {
        "requests": [{
            "id": r.id,
            "user": {
                "id": r.user.id,
                "full_name": r.user.full_name,
                "email": r.user.email,
                "avatar_url": r.user.avatar_url,
                "role": r.user.role.value if r.user.role else None
            } if r.user else None,
            "verification_type": r.verification_type,
            "status": r.status,
            # Pro Surfer fields
            "wsl_athlete_id": r.wsl_athlete_id,
            "wsl_profile_url": r.wsl_profile_url,
            "competition_history_urls": r.competition_history_urls,
            # Pro Photographer fields
            "instagram_url": r.instagram_url,
            "portfolio_website": r.portfolio_website,
            "other_social_urls": r.other_social_urls,
            "media_mentions": r.media_mentions,
            "professional_equipment": r.professional_equipment,
            "years_experience": r.years_experience,
            "sample_work_urls": r.sample_work_urls,
            "business_registration": r.business_registration,
            # Common fields
            "photo_id_url": r.photo_id_url,
            "additional_notes": r.additional_notes,
            "admin_notes": r.admin_notes,
            "created_at": r.created_at.isoformat() if r.created_at else None
        } for r in requests],
        "pending_count": pending_count
    }


@router.put("/admin/verification/{request_id}/review")
async def review_verification_request(
    request_id: str,
    data: ReviewVerificationRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Review and approve/reject a verification request"""
    
    result = await db.execute(
        select(VerificationRequest)
        .where(VerificationRequest.id == request_id)
        .options(selectinload(VerificationRequest.user))
    )
    request = result.scalar_one_or_none()
    
    if not request:
        raise HTTPException(status_code=404, detail="Verification request not found")
    
    old_status = request.status
    request.status = data.status
    request.reviewed_by = admin_id
    request.reviewed_at = datetime.now(timezone.utc)
    request.admin_notes = data.admin_notes
    
    if data.status == 'rejected':
        request.rejection_reason = data.rejection_reason
    
    # If approved, update user's role
    if data.status == 'approved' and request.user:
        if request.verification_type == 'pro_surfer':
            request.user.role = RoleEnum.PRO
            request.user.is_wsl_verified = True
            request.user.surf_mode = 'pro'
            if data.approve_as == 'legend':
                # Legend: retired/non-competing pro — same feature access as Pro but distinct badge
                request.user.elite_tier = 'legend'
            else:
                # Active competing Pro
                request.user.elite_tier = 'pro_elite'
        elif request.verification_type == 'approved_pro_photographer':
            request.user.role = RoleEnum.APPROVED_PRO
            request.user.is_approved_pro = True
        
        # Send approval notification to user
        from services.admin_notifications import admin_notification_service
        await admin_notification_service.notify_verification_approved(
            db=db,
            user_id=request.user.id,
            user_email=request.user.email,
            user_name=request.user.full_name or "there",
            verification_type=request.verification_type
        )
    
    # Log audit
    await log_audit(
        db, admin_id, "user_mgmt", "verification_reviewed",
        f"Verification {data.status}: {request.verification_type} for {request.user.full_name if request.user else 'unknown'}",
        "verification", request.id, request.user.email if request.user else None,
        old_value={"status": old_status},
        new_value={"status": data.status}
    )
    
    # Log user activity
    if request.user:
        activity = UserActivityLog(
            user_id=request.user.id,
            activity_type=f'verification_{data.status}',
            activity_category='settings',
            description=f'Verification request {data.status}: {request.verification_type}',
            related_type='verification_request',
            related_id=request.id
        )
        db.add(activity)
    
    await db.commit()
    
    return {"status": "reviewed", "new_status": data.status}


# ============ IMPERSONATION MODE ============

class StartImpersonationRequest(BaseModel):
    target_user_id: str
    reason: Optional[str] = None
    is_read_only: bool = True

@router.post("/admin/impersonate/start")
async def start_impersonation(
    data: StartImpersonationRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Start an impersonation session to view app as another user"""
    
    # Get target user
    result = await db.execute(
        select(Profile).where(Profile.id == data.target_user_id)
    )
    target_user = result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    
    # Can't impersonate other admins
    if target_user.is_admin:
        raise HTTPException(status_code=403, detail="Cannot impersonate other administrators")
    
    # Create impersonation session
    session = ImpersonationSession(
        admin_id=admin.id,
        target_user_id=data.target_user_id,
        reason=data.reason,
        is_read_only=data.is_read_only,
        started_at=datetime.now(timezone.utc)
    )
    db.add(session)
    await db.flush()
    
    # Log audit
    await log_audit(
        db, admin_id, "admin", "impersonation_started",
        f"Started impersonating user: {target_user.full_name}",
        "user", target_user.id, target_user.email,
        extra_data={"reason": data.reason, "read_only": data.is_read_only}
    )
    
    await db.commit()
    
    # Return the target user's profile data for frontend to use
    return {
        "session_id": session.id,
        "target_user": {
            "id": target_user.id,
            "email": target_user.email,
            "full_name": target_user.full_name,
            "avatar_url": target_user.avatar_url,
            "role": target_user.role.value if target_user.role else None,
            "is_admin": target_user.is_admin,
            "credit_balance": target_user.credit_balance,
            "subscription_tier": target_user.subscription_tier
        },
        "is_read_only": data.is_read_only,
        "message": f"Now viewing as {target_user.full_name}"
    }


@router.post("/admin/impersonate/{session_id}/end")
async def end_impersonation(
    session_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """End an impersonation session"""
    
    result = await db.execute(
        select(ImpersonationSession)
        .where(and_(
            ImpersonationSession.id == session_id,
            ImpersonationSession.admin_id == admin_id,
            ImpersonationSession.ended_at.is_(None)
        ))
        .options(selectinload(ImpersonationSession.target_user))
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Active impersonation session not found")
    
    session.ended_at = datetime.now(timezone.utc)
    
    # Log audit
    await log_audit(
        db, admin_id, "admin", "impersonation_ended",
        f"Ended impersonation of: {session.target_user.full_name if session.target_user else 'unknown'}",
        "user", session.target_user_id, session.target_user.email if session.target_user else None
    )
    
    await db.commit()
    
    return {"status": "ended", "message": "Returned to admin view"}


@router.get("/admin/impersonate/history")
async def get_impersonation_history(
    admin: Profile = Depends(get_current_admin),
    target_user_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get impersonation session history"""
    
    query = select(ImpersonationSession).options(
        selectinload(ImpersonationSession.admin),
        selectinload(ImpersonationSession.target_user)
    )
    
    if target_user_id:
        query = query.where(ImpersonationSession.target_user_id == target_user_id)
    
    query = query.order_by(desc(ImpersonationSession.started_at)).limit(limit)
    
    result = await db.execute(query)
    sessions = result.scalars().all()
    
    return [{
        "id": s.id,
        "admin": {
            "id": s.admin.id,
            "full_name": s.admin.full_name
        } if s.admin else None,
        "target_user": {
            "id": s.target_user.id,
            "full_name": s.target_user.full_name,
            "email": s.target_user.email
        } if s.target_user else None,
        "reason": s.reason,
        "is_read_only": s.is_read_only,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        "duration_minutes": (
            (s.ended_at - s.started_at).total_seconds() / 60 
            if s.ended_at and s.started_at else None
        )
    } for s in sessions]


# ============ FRAUD DETECTION ============

class CreateFraudAlertRequest(BaseModel):
    user_id: str
    alert_type: str
    severity: str = "medium"
    title: str
    description: str
    evidence: Optional[dict] = {}
    risk_score: int = 50

class ResolveFraudAlertRequest(BaseModel):
    resolution_notes: str
    action_taken: str  # none, warning, suspended, banned


@router.get("/admin/fraud/alerts")
async def get_fraud_alerts(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    severity: Optional[str] = None,
    alert_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get fraud alerts dashboard"""
    
    query = select(FraudAlert).options(selectinload(FraudAlert.user))
    
    if status:
        query = query.where(FraudAlert.status == status)
    else:
        query = query.where(FraudAlert.status.in_(['open', 'investigating']))
    
    if severity:
        query = query.where(FraudAlert.severity == severity)
    if alert_type:
        query = query.where(FraudAlert.alert_type == alert_type)
    
    # Order by severity (critical first) then created_at
    query = query.order_by(
        case(
            (FraudAlert.severity == 'critical', 1),
            (FraudAlert.severity == 'high', 2),
            (FraudAlert.severity == 'medium', 3),
            else_=4
        ),
        desc(FraudAlert.created_at)
    ).limit(limit).offset(offset)
    
    result = await db.execute(query)
    alerts = result.scalars().all()
    
    # Get counts by severity
    severity_counts = {}
    for sev in ['critical', 'high', 'medium', 'low']:
        count = (await db.execute(
            select(func.count(FraudAlert.id))
            .where(and_(FraudAlert.severity == sev, FraudAlert.status.in_(['open', 'investigating'])))
        )).scalar()
        severity_counts[sev] = count
    
    return {
        "alerts": [{
            "id": a.id,
            "user": {
                "id": a.user.id,
                "full_name": a.user.full_name,
                "email": a.user.email,
                "avatar_url": a.user.avatar_url,
                "role": a.user.role.value if a.user.role else None
            } if a.user else None,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "title": a.title,
            "description": a.description,
            "risk_score": a.risk_score,
            "status": a.status,
            "is_automated": a.is_automated,
            "evidence": a.evidence,
            "action_taken": a.action_taken,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in alerts],
        "severity_counts": severity_counts
    }


@router.post("/admin/fraud/alerts")
async def create_fraud_alert(
    data: CreateFraudAlertRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Manually create a fraud alert"""
    
    alert = FraudAlert(
        user_id=data.user_id,
        alert_type=data.alert_type,
        severity=data.severity,
        title=data.title,
        description=data.description,
        evidence=data.evidence or {},
        risk_score=data.risk_score,
        is_automated=False,
        status='open'
    )
    db.add(alert)
    await db.flush()
    
    # Log audit
    await log_audit(
        db, admin_id, "admin", "fraud_alert_created",
        f"Created fraud alert: {data.title}",
        "fraud_alert", alert.id, None,
        extra_data={"alert_type": data.alert_type, "severity": data.severity}
    )
    
    await db.commit()
    
    return {"id": alert.id, "status": "created"}


@router.put("/admin/fraud/alerts/{alert_id}/resolve")
async def resolve_fraud_alert(
    alert_id: str,
    data: ResolveFraudAlertRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Resolve a fraud alert with action"""
    
    result = await db.execute(
        select(FraudAlert)
        .where(FraudAlert.id == alert_id)
        .options(selectinload(FraudAlert.user))
    )
    alert = result.scalar_one_or_none()
    
    if not alert:
        raise HTTPException(status_code=404, detail="Fraud alert not found")
    
    alert.status = 'resolved'
    alert.resolved_by = admin_id
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolution_notes = data.resolution_notes
    alert.action_taken = data.action_taken
    
    # Apply action to user
    if alert.user and data.action_taken in ['suspended', 'banned']:
        alert.user.is_suspended = True
    
    # Log audit
    await log_audit(
        db, admin_id, "admin", "fraud_alert_resolved",
        f"Resolved fraud alert with action: {data.action_taken}",
        "fraud_alert", alert.id, alert.user.email if alert.user else None,
        new_value={"action": data.action_taken}
    )
    
    await db.commit()
    
    return {"status": "resolved", "action_taken": data.action_taken}


@router.get("/admin/fraud/user-risk/{user_id}")
async def get_user_risk_profile(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get comprehensive risk profile for a user"""
    
    # Get user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get fraud alerts for this user
    alerts_result = await db.execute(
        select(FraudAlert)
        .where(FraudAlert.user_id == user_id)
        .order_by(desc(FraudAlert.created_at))
    )
    alerts = alerts_result.scalars().all()
    
    # Calculate risk score
    open_alerts = [a for a in alerts if a.status in ['open', 'investigating']]
    risk_score = 0
    for alert in open_alerts:
        if alert.severity == 'critical':
            risk_score += 40
        elif alert.severity == 'high':
            risk_score += 25
        elif alert.severity == 'medium':
            risk_score += 15
        else:
            risk_score += 5
    risk_score = min(risk_score, 100)
    
    return {
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role.value if user.role else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "is_suspended": user.is_suspended
        },
        "risk_score": risk_score,
        "risk_level": "critical" if risk_score >= 80 else "high" if risk_score >= 50 else "medium" if risk_score >= 20 else "low",
        "open_alerts": len(open_alerts),
        "total_alerts": len(alerts),
        "alerts": [{
            "id": a.id,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "title": a.title,
            "status": a.status,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in alerts[:10]]
    }


# ============ USER JOURNEY TIMELINE ============

@router.get("/admin/user-journey/{user_id}")
async def get_user_journey(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    activity_type: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get complete user journey timeline for support debugging"""
    
    # Get user info
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Build activity query
    query = select(UserActivityLog).where(UserActivityLog.user_id == user_id)
    
    if activity_type:
        query = query.where(UserActivityLog.activity_type == activity_type)
    if category:
        query = query.where(UserActivityLog.activity_category == category)
    if start_date:
        query = query.where(UserActivityLog.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.where(UserActivityLog.created_at <= datetime.fromisoformat(end_date))
    
    query = query.order_by(desc(UserActivityLog.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    activities = result.scalars().all()
    
    # Get activity type counts
    type_counts = await db.execute(
        select(UserActivityLog.activity_category, func.count(UserActivityLog.id))
        .where(UserActivityLog.user_id == user_id)
        .group_by(UserActivityLog.activity_category)
    )
    
    return {
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "role": user.role.value if user.role else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "is_suspended": user.is_suspended
        },
        "activity_counts": {row[0]: row[1] for row in type_counts},
        "activities": [{
            "id": a.id,
            "activity_type": a.activity_type,
            "activity_category": a.activity_category,
            "description": a.description,
            "related_type": a.related_type,
            "related_id": a.related_id,
            "ip_address": a.ip_address,
            "extra_data": a.extra_data,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in activities]
    }


@router.get("/admin/user-journey/{user_id}/summary")
async def get_user_journey_summary(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get quick summary of user's journey for support"""
    
    # Get user with related data
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get various counts
    from models import Post, Booking, CreditTransaction, Dispute, UserReport
    
    posts_count = (await db.execute(
        select(func.count(Post.id)).where(Post.author_id == user_id)
    )).scalar() or 0
    
    bookings_count = (await db.execute(
        select(func.count(Booking.id)).where(
            or_(Booking.surfer_id == user_id, Booking.photographer_id == user_id)
        )
    )).scalar() or 0
    
    transactions_count = (await db.execute(
        select(func.count(CreditTransaction.id)).where(CreditTransaction.profile_id == user_id)
    )).scalar() or 0
    
    disputes_count = (await db.execute(
        select(func.count(Dispute.id)).where(
            or_(Dispute.complainant_id == user_id, Dispute.respondent_id == user_id)
        )
    )).scalar() or 0
    
    reports_count = (await db.execute(
        select(func.count(UserReport.id)).where(UserReport.reported_user_id == user_id)
    )).scalar() or 0
    
    # Get recent activity
    recent_activity = await db.execute(
        select(UserActivityLog)
        .where(UserActivityLog.user_id == user_id)
        .order_by(desc(UserActivityLog.created_at))
        .limit(5)
    )
    recent = recent_activity.scalars().all()
    
    return {
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role.value if user.role else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "credit_balance": user.credit_balance,
            "is_suspended": user.is_suspended,
            "is_approved_pro": user.is_approved_pro
        },
        "stats": {
            "posts": posts_count,
            "bookings": bookings_count,
            "transactions": transactions_count,
            "disputes": disputes_count,
            "reports_against": reports_count
        },
        "recent_activity": [{
            "activity_type": a.activity_type,
            "description": a.description,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in recent]
    }


# ============ HELPER: Log User Activity ============

async def log_user_activity(
    db: AsyncSession,
    user_id: str,
    activity_type: str,
    category: str,
    description: str,
    related_type: str = None,
    related_id: str = None,
    ip_address: str = None,
    extra_data: dict = None
):
    """Helper function to log user activity for journey tracking"""
    activity = UserActivityLog(
        user_id=user_id,
        activity_type=activity_type,
        activity_category=category,
        description=description,
        related_type=related_type,
        related_id=related_id,
        ip_address=ip_address,
        extra_data=extra_data or {}
    )
    db.add(activity)
    return activity


# ============ TEST ACCOUNT SEEDING ============

class TestAccountConfig(BaseModel):
    """Configuration for creating a test account"""
    role: str = "Surfer"  # Surfer, Photographer, Grom, Business, GromParent
    username_prefix: str = "test"
    with_content: bool = False  # Create with sample posts/gallery items
    subscription_tier: Optional[str] = None
    elite_tier: Optional[str] = None
    is_verified: bool = False
    is_approved_pro: bool = False
    custom_password: Optional[str] = None

class SeedTestAccountsRequest(BaseModel):
    """Request to seed multiple test accounts"""
    accounts: List[TestAccountConfig] = []
    seed_all_roles: bool = False  # Create one of each role type
    password: str = "Test123!"  # Default password for all accounts

@router.post("/admin/seed-test-accounts")
async def seed_test_accounts(
    request: SeedTestAccountsRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create test accounts for QA/testing purposes.
    
    - seed_all_roles=True: Creates one account for each role type
    - accounts: Specific account configurations
    
    All accounts use the same password (default: Test123!)
    """
    # Verify admin
    
    import hashlib
    import uuid
    
    def generate_uuid():
        return str(uuid.uuid4())
    
    def hash_password(password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()
    
    created_accounts = []
    password = request.password
    password_hash = hash_password(password)
    
    # Define role configurations
    role_configs = {
        "Surfer": {
            "role": RoleEnum.SURFER,
            "full_name": "Test Surfer",
            "bio": "Test surfer account for QA",
            "skill_level": "intermediate",
            "stance": "regular"
        },
        "Photographer": {
            "role": RoleEnum.PHOTOGRAPHER,
            "full_name": "Test Photographer", 
            "bio": "Test photographer account for QA",
            "is_approved_pro": False,
            "hourly_rate": 75.0
        },
        "Approved Pro": {
            "role": RoleEnum.PHOTOGRAPHER,
            "full_name": "Test Pro Photographer",
            "bio": "Test approved pro photographer for QA",
            "is_approved_pro": True,
            "is_verified": True,
            "hourly_rate": 150.0
        },
        "Grom": {
            "role": RoleEnum.GROM,
            "full_name": "Test Grom",
            "bio": "Test grom account for QA",
            "skill_level": "beginner"
        },
        "GromParent": {
            "role": RoleEnum.GROM_PARENT,
            "full_name": "Test Grom Parent",
            "bio": "Test grom parent account for QA"
        },
        "Competitive Surfer": {
            "role": RoleEnum.COMP_SURFER,
            "full_name": "Test Comp Surfer",
            "bio": "Test competitive surfer for QA",
            "skill_level": "advanced",
            "elite_tier": "competitive",
            "is_verified": True
        }
    }
    
    accounts_to_create = []
    
    if request.seed_all_roles:
        # Create one of each role type
        for role_name in role_configs.keys():
            accounts_to_create.append(TestAccountConfig(
                role=role_name,
                username_prefix="test"
            ))
    else:
        accounts_to_create = request.accounts
    
    # Generate unique timestamp suffix
    timestamp_suffix = datetime.now().strftime("%H%M%S")
    
    for idx, config in enumerate(accounts_to_create):
        role_name = config.role
        if role_name not in role_configs:
            # Default to Surfer if unknown role
            role_name = "Surfer"
        
        role_config = role_configs[role_name]
        
        # Generate unique identifiers
        username = f"{config.username_prefix}_{role_name.lower().replace(' ', '_')}_{timestamp_suffix}"
        email = f"{username}@test.rawsurf.io"
        user_id = generate_uuid()
        profile_id = generate_uuid()
        
        # Check if email already exists
        existing = await db.execute(
            select(Profile).where(Profile.email == email)
        )
        if existing.scalar_one_or_none():
            # Skip if already exists
            continue
        
        # Create profile
        profile = Profile(
            id=profile_id,
            user_id=user_id,
            email=email,
            password_hash=password_hash,
            full_name=role_config.get("full_name", f"Test {role_name}"),
            username=username[:30],  # Truncate to fit column limit
            role=role_config["role"],
            bio=role_config.get("bio", f"Test {role_name} account"),
            skill_level=role_config.get("skill_level"),
            stance=role_config.get("stance"),
            company_name=role_config.get("company_name"),
            hourly_rate=role_config.get("hourly_rate"),
            is_verified=config.is_verified or role_config.get("is_verified", False),
            is_approved_pro=config.is_approved_pro or role_config.get("is_approved_pro", False),
            subscription_tier=config.subscription_tier,
            elite_tier=config.elite_tier or role_config.get("elite_tier"),
            credit_balance=100.0,  # Give some test credits
            created_at=datetime.now(timezone.utc)
        )
        
        db.add(profile)
        
        created_accounts.append({
            "id": profile_id,
            "email": email,
            "username": username,
            "password": config.custom_password or password,
            "role": role_name,
            "full_name": profile.full_name,
            "is_verified": profile.is_verified,
            "is_approved_pro": profile.is_approved_pro
        })
    
    await db.commit()
    
    # Log the action
    await log_audit(
        db, admin_id, "system", "seed_test_accounts",
        f"Created {len(created_accounts)} test accounts",
        "test_accounts", "system", None,
        new_value={"accounts_created": len(created_accounts), "roles": [a["role"] for a in created_accounts]}
    )
    
    return {
        "success": True,
        "message": f"Created {len(created_accounts)} test accounts",
        "accounts": created_accounts,
        "default_password": password
    }


@router.get("/admin/test-accounts")
async def list_test_accounts(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """List all test accounts (accounts with @test.rawsurf.io email)"""
    
    result = await db.execute(
        select(Profile)
        .where(Profile.email.like('%@test.rawsurf.io'))
        .order_by(desc(Profile.created_at))
        .limit(100)
    )
    accounts = result.scalars().all()
    
    return {
        "total": len(accounts),
        "accounts": [
            {
                "id": a.id,
                "email": a.email,
                "username": a.username,
                "full_name": a.full_name,
                "role": a.role.value if a.role else None,
                "is_verified": a.is_verified,
                "is_approved_pro": a.is_approved_pro,
                "created_at": a.created_at.isoformat() if a.created_at else None
            }
            for a in accounts
        ]
    }


@router.delete("/admin/test-accounts/cleanup")
async def cleanup_test_accounts(
    admin: Profile = Depends(get_current_admin),
    older_than_days: int = 7,
    db: AsyncSession = Depends(get_db)
):
    """Delete test accounts older than specified days"""
    
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    result = await db.execute(
        select(Profile)
        .where(
            and_(
                Profile.email.like('%@test.rawsurf.io'),
                Profile.created_at < cutoff_date
            )
        )
    )
    accounts_to_delete = result.scalars().all()
    
    deleted_count = 0
    for account in accounts_to_delete:
        await db.delete(account)
        deleted_count += 1
    
    await db.commit()
    
    await log_audit(
        db, admin_id, "system", "cleanup_test_accounts",
        f"Deleted {deleted_count} test accounts older than {older_than_days} days",
        "test_accounts", "system", None
    )
    
    return {
        "success": True,
        "message": f"Deleted {deleted_count} test accounts older than {older_than_days} days"
    }

