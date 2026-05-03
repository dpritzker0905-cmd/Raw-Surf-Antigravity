"""
ToS Compliance & Location Fraud Prevention Routes
Handles:
- ToS violation reporting and strike system
- Location fraud detection
- User appeals
- Compliance acknowledgements
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import math
from utils.geo import haversine_distance

import json

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, TosViolation, TosAcknowledgement, TosContent, FraudAlert,
    Notification, Booking, DispatchRequest, LiveSession,
    Post, Comment, Follow, CheckIn, GalleryPurchase, PaymentTransaction,
    Message, Review
)
from core.security import get_user_id_from_jwt_or_query

router = APIRouter(prefix="/compliance", tags=["compliance"])


# ============ PYDANTIC SCHEMAS ============

class ReportLocationFraudRequest(BaseModel):
    user_id: str
    claimed_latitude: float
    claimed_longitude: float
    actual_latitude: float
    actual_longitude: float
    related_type: Optional[str] = None  # booking, dispatch, live_session
    related_id: Optional[str] = None
    description: Optional[str] = None


class CreateTosViolationRequest(BaseModel):
    user_id: str
    violation_type: str  # location_fraud, fake_reviews, harassment, etc.
    severity: str = 'minor'  # minor, moderate, severe, critical
    title: str
    description: str
    evidence: Optional[dict] = None
    related_type: Optional[str] = None
    related_id: Optional[str] = None


class AppealViolationRequest(BaseModel):
    appeal_text: str


class ReviewAppealRequest(BaseModel):
    approved: bool
    notes: Optional[str] = None


class AcknowledgeTosRequest(BaseModel):
    tos_version: str
    section: Optional[str] = None


class BulkReviewAppealsRequest(BaseModel):
    violation_ids: List[str]
    approved: bool
    notes: Optional[str] = None


# ============ HELPER FUNCTIONS ============


def calculate_strike_action(total_strikes: int) -> tuple[str, Optional[datetime]]:
    """
    Determine action based on total strike count.
    Returns (action_taken, suspension_until)
    """
    now = datetime.now(timezone.utc)
    
    if total_strikes <= 1:
        return 'warning', None
    elif total_strikes == 2:
        return 'suspension_7d', now + timedelta(days=7)
    elif total_strikes == 3:
        return 'suspension_30d', now + timedelta(days=30)
    else:
        return 'permanent_ban', None


def get_severity_points(severity: str) -> int:
    """Get strike points for severity level"""
    severity_points = {
        'minor': 1,
        'moderate': 2,
        'severe': 3,
        'critical': 5
    }
    return severity_points.get(severity, 1)


# ============ LOCATION FRAUD DETECTION ============

@router.post("/report-location-fraud")
async def report_location_fraud(
    data: ReportLocationFraudRequest,
    reporter_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Report suspected location fraud. 
    Automatically calculates distance discrepancy and creates violation if significant.
    """
    # Get the accused user
    user_result = await db.execute(
        select(Profile).where(Profile.id == data.user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Calculate distance discrepancy
    distance = haversine_distance(
        data.claimed_latitude, data.claimed_longitude,
        data.actual_latitude, data.actual_longitude
    )
    
    # Threshold: 0.5 miles is suspicious, 2 miles is definite fraud
    if distance < 0.5:
        return {
            "flagged": False,
            "distance_miles": round(distance, 2),
            "message": "Location within acceptable range"
        }
    
    # Determine severity based on distance
    if distance < 2:
        severity = 'minor'
    elif distance < 10:
        severity = 'moderate'
    elif distance < 50:
        severity = 'severe'
    else:
        severity = 'critical'
    
    strike_points = get_severity_points(severity)
    new_total_strikes = (user.tos_strike_count or 0) + strike_points
    action, suspension_until = calculate_strike_action(new_total_strikes)
    
    # Create violation record
    violation = TosViolation(
        user_id=data.user_id,
        violation_type='location_fraud',
        severity=severity,
        strike_points=strike_points,
        title=f"Location Fraud: {round(distance, 1)} miles discrepancy",
        description=data.description or f"User claimed location {round(distance, 1)} miles from actual GPS coordinates.",
        evidence={
            "claimed_coords": [data.claimed_latitude, data.claimed_longitude],
            "actual_coords": [data.actual_latitude, data.actual_longitude],
            "distance_miles": round(distance, 2)
        },
        related_type=data.related_type,
        related_id=data.related_id,
        claimed_latitude=data.claimed_latitude,
        claimed_longitude=data.claimed_longitude,
        actual_latitude=data.actual_latitude,
        actual_longitude=data.actual_longitude,
        distance_discrepancy_miles=round(distance, 2),
        action_taken=action,
        suspension_until=suspension_until,
        reported_by=reporter_id
    )
    db.add(violation)
    
    # Update user's strike count
    user.tos_strike_count = new_total_strikes
    user.tos_last_violation_at = datetime.now(timezone.utc)
    
    # Apply action
    if action == 'permanent_ban':
        user.is_banned = True
        user.banned_at = datetime.now(timezone.utc)
        user.is_suspended = True
        user.suspended_reason = "Permanent ban due to repeated ToS violations"
    elif action in ['suspension_7d', 'suspension_30d']:
        user.is_suspended = True
        user.suspended_at = datetime.now(timezone.utc)
        user.suspended_reason = f"Location fraud violation: {round(distance, 1)} miles discrepancy"
        user.suspension_until = suspension_until
    
    # Create notification for user
    notification = Notification(
        user_id=data.user_id,
        type='tos_violation',
        title='Terms of Service Violation',
        body=f"A location fraud violation has been recorded on your account. {action.replace('_', ' ').title()}.",
        data=json.dumps({
            "violation_id": violation.id,
            "strike_points": strike_points,
            "total_strikes": new_total_strikes,
            "action": action
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "flagged": True,
        "violation_id": violation.id,
        "distance_miles": round(distance, 2),
        "severity": severity,
        "strike_points": strike_points,
        "total_strikes": new_total_strikes,
        "action_taken": action,
        "suspension_until": suspension_until.isoformat() if suspension_until else None
    }


# ============ VIOLATION MANAGEMENT ============

@router.post("/violations")
async def create_tos_violation(
    data: CreateTosViolationRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin creates a ToS violation manually (JWT verified)"""
    
    # Get the user
    user_result = await db.execute(
        select(Profile).where(Profile.id == data.user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    strike_points = get_severity_points(data.severity)
    new_total_strikes = (user.tos_strike_count or 0) + strike_points
    action, suspension_until = calculate_strike_action(new_total_strikes)
    
    violation = TosViolation(
        user_id=data.user_id,
        violation_type=data.violation_type,
        severity=data.severity,
        strike_points=strike_points,
        title=data.title,
        description=data.description,
        evidence=data.evidence or {},
        related_type=data.related_type,
        related_id=data.related_id,
        action_taken=action,
        suspension_until=suspension_until,
        reviewed_by=admin.id
    )
    db.add(violation)
    
    # Update user strikes
    user.tos_strike_count = new_total_strikes
    user.tos_last_violation_at = datetime.now(timezone.utc)
    
    # Apply action
    if action == 'permanent_ban':
        user.is_banned = True
        user.banned_at = datetime.now(timezone.utc)
        user.is_suspended = True
    elif action in ['suspension_7d', 'suspension_30d']:
        user.is_suspended = True
        user.suspended_at = datetime.now(timezone.utc)
        user.suspended_reason = data.title
        user.suspension_until = suspension_until
    
    # Notify user
    notification = Notification(
        user_id=data.user_id,
        type='tos_violation',
        title='Terms of Service Violation',
        body=f"A violation has been recorded: {data.title}",
        data=json.dumps({"violation_id": violation.id, "action": action})
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "violation_id": violation.id,
        "strike_points": strike_points,
        "total_strikes": new_total_strikes,
        "action_taken": action
    }


@router.get("/violations/user/{user_id}")
async def get_user_violations(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all violations for a user"""
    result = await db.execute(
        select(TosViolation)
        .where(TosViolation.user_id == user_id)
        .order_by(TosViolation.created_at.desc())
    )
    violations = result.scalars().all()
    
    # Get user's current strike count
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    
    return {
        "user_id": user_id,
        "total_strikes": user.tos_strike_count if user else 0,
        "is_suspended": user.is_suspended if user else False,
        "is_banned": user.is_banned if user else False,
        "suspension_until": user.suspension_until.isoformat() if user and user.suspension_until else None,
        "violations": [
            {
                "id": v.id,
                "violation_type": v.violation_type,
                "severity": v.severity,
                "strike_points": v.strike_points,
                "title": v.title,
                "description": v.description,
                "action_taken": v.action_taken,
                "status": v.status,
                "is_appealed": v.is_appealed,
                "appeal_status": v.appeal_status,
                "created_at": v.created_at.isoformat(),
                "distance_discrepancy_miles": v.distance_discrepancy_miles
            }
            for v in violations
        ]
    }


# ============ APPEALS ============

@router.post("/violations/{violation_id}/appeal")
async def appeal_violation(
    violation_id: str,
    data: AppealViolationRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """User appeals a ToS violation"""
    result = await db.execute(
        select(TosViolation).where(TosViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")
    
    if violation.user_id != user_id:
        raise HTTPException(status_code=403, detail="You can only appeal your own violations")
    
    if violation.is_appealed:
        raise HTTPException(status_code=400, detail="This violation has already been appealed")
    
    violation.is_appealed = True
    violation.appeal_text = data.appeal_text
    violation.appeal_status = 'pending'
    violation.status = 'appealed'
    
    await db.commit()
    
    return {
        "message": "Appeal submitted successfully",
        "violation_id": violation_id,
        "appeal_status": "pending"
    }


@router.put("/violations/{violation_id}/appeal/review")
async def review_appeal(
    violation_id: str,
    data: ReviewAppealRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin reviews a violation appeal (JWT verified)"""
    
    result = await db.execute(
        select(TosViolation).where(TosViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")
    
    if not violation.is_appealed or violation.appeal_status != 'pending':
        raise HTTPException(status_code=400, detail="No pending appeal for this violation")
    
    violation.appeal_status = 'approved' if data.approved else 'denied'
    violation.appeal_reviewed_by = admin.id
    violation.appeal_reviewed_at = datetime.now(timezone.utc)
    
    if data.approved:
        violation.status = 'overturned'
        
        # Restore user's strike count
        user_result = await db.execute(
            select(Profile).where(Profile.id == violation.user_id)
        )
        user = user_result.scalar_one_or_none()
        
        if user:
            user.tos_strike_count = max(0, (user.tos_strike_count or 0) - violation.strike_points)
            
            # Remove suspension if it was from this violation
            if violation.action_taken in ['suspension_7d', 'suspension_30d']:
                user.is_suspended = False
                user.suspended_at = None
                user.suspended_reason = None
                user.suspension_until = None
            elif violation.action_taken == 'permanent_ban':
                user.is_banned = False
                user.banned_at = None
                user.is_suspended = False
        
        # Notify user of successful appeal
        notification = Notification(
            user_id=violation.user_id,
            type='appeal_approved',
            title='Appeal Approved',
            body=f"Your appeal for violation '{violation.title}' has been approved. The strike has been removed.",
            data=json.dumps({"violation_id": violation_id})
        )
        db.add(notification)
    else:
        # Notify user of denied appeal
        notification = Notification(
            user_id=violation.user_id,
            type='appeal_denied',
            title='Appeal Denied',
            body=f"Your appeal for violation '{violation.title}' has been denied.",
            data=json.dumps({"violation_id": violation_id, "notes": data.notes})
        )
        db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Appeal reviewed",
        "approved": data.approved,
        "violation_id": violation_id
    }


# ============ TOS ACKNOWLEDGEMENT ============

@router.post("/acknowledge-tos")
async def acknowledge_tos(
    data: AcknowledgeTosRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Record user's acknowledgement of ToS version"""
    # Check if already acknowledged
    existing = await db.execute(
        select(TosAcknowledgement)
        .where(TosAcknowledgement.user_id == user_id)
        .where(TosAcknowledgement.tos_version == data.tos_version)
    )
    
    if existing.scalar_one_or_none():
        return {"message": "ToS already acknowledged", "tos_version": data.tos_version}
    
    ack = TosAcknowledgement(
        user_id=user_id,
        tos_version=data.tos_version,
        section=data.section,
        ip_address=ip_address,
        user_agent=user_agent
    )
    db.add(ack)
    await db.commit()
    
    return {
        "message": "ToS acknowledged",
        "tos_version": data.tos_version,
        "acknowledged_at": ack.acknowledged_at.isoformat()
    }


@router.get("/tos-status/{user_id}")
async def get_tos_status(
    user_id: str,
    current_version: str = Query("2.0"),
    db: AsyncSession = Depends(get_db)
):
    """Check if user has acknowledged the current ToS version"""
    result = await db.execute(
        select(TosAcknowledgement)
        .where(TosAcknowledgement.user_id == user_id)
        .where(TosAcknowledgement.tos_version == current_version)
    )
    ack = result.scalar_one_or_none()
    
    return {
        "user_id": user_id,
        "current_version": current_version,
        "acknowledged": ack is not None,
        "acknowledged_at": ack.acknowledged_at.isoformat() if ack else None
    }


@router.get("/acceptance-history/{user_id}")
async def get_acceptance_history(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Return all ToS acceptance records for a user (for Settings > Legal)"""
    result = await db.execute(
        select(TosAcknowledgement)
        .where(TosAcknowledgement.user_id == user_id)
        .order_by(TosAcknowledgement.acknowledged_at.desc())
    )
    records = result.scalars().all()
    
    history = []
    for r in records:
        # Mask IP for privacy: show first two octets only
        masked_ip = None
        if r.ip_address:
            parts = r.ip_address.split('.')
            if len(parts) == 4:
                masked_ip = f"{parts[0]}.{parts[1]}.x.x"
            else:
                masked_ip = "x.x.x.x"
        
        history.append({
            "version": r.tos_version,
            "accepted_at": r.acknowledged_at.isoformat() if r.acknowledged_at else None,
            "ip_address": masked_ip,
            "user_agent": r.user_agent,
            "section": r.section
        })
    
    return {"user_id": user_id, "history": history}


# ============ TOS CONTENT MANAGEMENT ============

# Default fallback content — used when no content exists in DB yet
DEFAULT_TOS_SECTIONS = [
    {"title": "1. Acceptance of Terms", "body": "By creating an account on Raw Surf, you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree, you may not use the platform."},
    {"title": "2. Account Eligibility", "body": "You must be at least 13 years old to create an account. Users under 18 (\"Groms\") must have a parent or guardian link their account."},
    {"title": "3. User Content", "body": "You retain ownership of all photos, videos, and content you upload. By posting content publicly, you grant Raw Surf a non-exclusive, royalty-free license to display and distribute that content within the platform."},
    {"title": "4. Photographer Services", "body": "Photographers set their own pricing and availability. Raw Surf facilitates connections between photographers and surfers but is not a party to the service agreement between them."},
    {"title": "5. Payments & Refunds", "body": "All payments are processed through Stripe. Refund eligibility is determined on a case-by-case basis."},
    {"title": "6. Location Data", "body": "Certain features use your location data. Falsifying your location is a violation of these Terms."},
    {"title": "7. Community Standards", "body": "Harassment, hate speech, spam, and fraud are prohibited. Violations follow a progressive strike system: warning, 7-day suspension, 30-day suspension, permanent ban."},
    {"title": "8. Privacy", "body": "We do not sell your personal information to third parties. You may request deletion of your data at any time."},
    {"title": "9. Limitation of Liability", "body": "Raw Surf is provided \"as is\" without warranties."},
    {"title": "10. Modifications", "body": "We may update these Terms from time to time. Material changes will be communicated via in-app notification."},
]

DEFAULT_PRIVACY_SECTIONS = [
    {"title": "1. Information We Collect", "body": "We collect information you provide directly: name, email, profile photo, surf spot check-ins, and uploaded content. We also collect device information, IP addresses, and usage analytics."},
    {"title": "2. How We Use Your Data", "body": "Your data is used to provide and improve Raw Surf's services: matching surfers with photos, processing payments, delivering notifications, and personalizing your experience."},
    {"title": "3. Location Data", "body": "Surf spot check-ins, on-demand booking, and live sessions use your location. You can disable location features in your device settings."},
    {"title": "4. Data Sharing", "body": "We do not sell your personal data to third parties. We share data with: Stripe (payments), Supabase (infrastructure), and OneSignal (push notifications)."},
    {"title": "5. Children's Privacy (Groms)", "body": "Users under 18 (\"Groms\") require parental consent via the Grom HQ parent-linking system."},
    {"title": "6. Data Retention", "body": "We retain your data for as long as your account is active. Deleted accounts have their personal data purged within 30 days."},
    {"title": "7. Your Rights", "body": "You have the right to: access your data, correct inaccuracies, request deletion, export your data, and withdraw consent."},
    {"title": "8. Cookies & Tracking", "body": "We use essential cookies for authentication and session management. We do not use third-party advertising trackers."},
    {"title": "9. Changes to This Policy", "body": "We may update this Privacy Policy from time to time. Material changes will be communicated via in-app notification."},
]


class TosContentRequest(BaseModel):
    doc_type: str  # 'tos' or 'privacy'
    version: str
    sections: list  # [{title, body}]
    effective_date: Optional[str] = None
    set_active: bool = True


@router.get("/tos-content/current")
async def get_current_tos_content(
    doc_type: str = Query("tos"),
    db: AsyncSession = Depends(get_db)
):
    """Public endpoint: fetch the active ToS or Privacy content.
    Falls back to hardcoded defaults if nothing in DB."""
    result = await db.execute(
        select(TosContent)
        .where(TosContent.doc_type == doc_type, TosContent.is_active == True)
        .limit(1)
    )
    content = result.scalar_one_or_none()
    
    if content:
        return {
            "doc_type": content.doc_type,
            "version": content.version,
            "sections": content.sections,
            "effective_date": content.effective_date,
            "updated_at": content.updated_at.isoformat() if content.updated_at else None
        }
    
    # Fallback defaults
    defaults = DEFAULT_TOS_SECTIONS if doc_type == 'tos' else DEFAULT_PRIVACY_SECTIONS
    return {
        "doc_type": doc_type,
        "version": "1.0",
        "sections": defaults,
        "effective_date": "May 2026",
        "updated_at": None
    }


@router.get("/tos-content/versions")
async def list_tos_versions(
    doc_type: str = Query("tos"),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin: list all versions of a document type."""
    result = await db.execute(
        select(TosContent)
        .where(TosContent.doc_type == doc_type)
        .order_by(TosContent.created_at.desc())
    )
    versions = result.scalars().all()
    
    return [{"id": v.id, "version": v.version, "is_active": v.is_active,
             "effective_date": v.effective_date,
             "section_count": len(v.sections) if v.sections else 0,
             "created_at": v.created_at.isoformat() if v.created_at else None,
             "updated_at": v.updated_at.isoformat() if v.updated_at else None}
            for v in versions]


@router.put("/tos-content")
async def save_tos_content(
    data: TosContentRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin: create or update ToS/Privacy content. If set_active=True,
    deactivates all other versions of the same doc_type."""
    if data.doc_type not in ('tos', 'privacy'):
        raise HTTPException(status_code=400, detail="doc_type must be 'tos' or 'privacy'")
    
    # Check if this version already exists
    existing = await db.execute(
        select(TosContent)
        .where(TosContent.doc_type == data.doc_type, TosContent.version == data.version)
    )
    content = existing.scalar_one_or_none()
    
    if content:
        # Update existing version
        content.sections = data.sections
        content.effective_date = data.effective_date
        content.updated_by = admin.id
        if data.set_active:
            content.is_active = True
    else:
        # Create new version
        content = TosContent(
            doc_type=data.doc_type,
            version=data.version,
            sections=data.sections,
            effective_date=data.effective_date,
            is_active=data.set_active,
            created_by=admin.id,
            updated_by=admin.id
        )
        db.add(content)
    
    # Deactivate all other versions of same doc_type if setting active
    if data.set_active:
        all_versions = await db.execute(
            select(TosContent)
            .where(TosContent.doc_type == data.doc_type, TosContent.version != data.version)
        )
        for v in all_versions.scalars().all():
            v.is_active = False
    
    await db.commit()
    
    return {
        "message": f"{data.doc_type.upper()} content saved",
        "version": data.version,
        "is_active": data.set_active,
        "section_count": len(data.sections)
    }


# ============ COMPLIANCE DASHBOARD ============

@router.get("/dashboard")
async def get_compliance_dashboard(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get compliance dashboard stats for admin (JWT verified)"""
    
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    
    # Count violations
    total_violations = await db.execute(
        select(func.count(TosViolation.id))
    )
    
    violations_this_week = await db.execute(
        select(func.count(TosViolation.id))
        .where(TosViolation.created_at >= week_ago)
    )
    
    location_fraud_count = await db.execute(
        select(func.count(TosViolation.id))
        .where(TosViolation.violation_type == 'location_fraud')
    )
    
    pending_appeals = await db.execute(
        select(func.count(TosViolation.id))
        .where(TosViolation.appeal_status == 'pending')
    )
    
    suspended_users = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.is_suspended.is_(True))
    )
    
    banned_users = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.is_banned.is_(True))
    )
    
    # Recent violations
    recent_violations = await db.execute(
        select(TosViolation)
        .order_by(TosViolation.created_at.desc())
        .limit(10)
    )
    
    # Location fraud data for map visualization
    location_fraud_data = await db.execute(
        select(TosViolation)
        .where(TosViolation.violation_type == 'location_fraud')
        .where(TosViolation.claimed_latitude.isnot(None))
        .order_by(TosViolation.created_at.desc())
        .limit(50)
    )
    
    return {
        "stats": {
            "total_violations": total_violations.scalar() or 0,
            "violations_this_week": violations_this_week.scalar() or 0,
            "location_fraud_count": location_fraud_count.scalar() or 0,
            "pending_appeals": pending_appeals.scalar() or 0,
            "suspended_users": suspended_users.scalar() or 0,
            "banned_users": banned_users.scalar() or 0
        },
        "recent_violations": [
            {
                "id": v.id,
                "user_id": v.user_id,
                "violation_type": v.violation_type,
                "severity": v.severity,
                "title": v.title,
                "description": v.description,
                "action_taken": v.action_taken,
                "appeal_status": v.appeal_status,
                "appeal_text": v.appeal_text,
                "is_appealed": v.is_appealed,
                "created_at": v.created_at.isoformat(),
                "distance_discrepancy_miles": v.distance_discrepancy_miles
            }
            for v in recent_violations.scalars().all()
        ],
        "location_fraud_map_data": [
            {
                "id": v.id,
                "claimed": [v.claimed_latitude, v.claimed_longitude],
                "actual": [v.actual_latitude, v.actual_longitude],
                "distance_miles": v.distance_discrepancy_miles,
                "severity": v.severity,
                "created_at": v.created_at.isoformat()
            }
            for v in location_fraud_data.scalars().all()
            if v.claimed_latitude and v.actual_latitude
        ]
    }


@router.post("/violations/bulk-review-appeals")
async def bulk_review_appeals(
    data: BulkReviewAppealsRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Bulk approve or deny multiple appeals at once (JWT verified)"""
    import json
    
    violation_ids = data.violation_ids
    approved = data.approved
    notes = data.notes
    
    processed = 0
    errors = []
    
    for violation_id in violation_ids:
        try:
            result = await db.execute(
                select(TosViolation).where(TosViolation.id == violation_id)
            )
            violation = result.scalar_one_or_none()
            
            if not violation:
                errors.append(f"{violation_id}: Not found")
                continue
            
            if not violation.is_appealed or violation.appeal_status != 'pending':
                errors.append(f"{violation_id}: No pending appeal")
                continue
            
            violation.appeal_status = 'approved' if approved else 'denied'
            violation.appeal_reviewed_by = admin.id
            violation.appeal_reviewed_at = datetime.now(timezone.utc)
            
            if approved:
                violation.status = 'overturned'
                
                # Restore user's strike count
                user_result = await db.execute(
                    select(Profile).where(Profile.id == violation.user_id)
                )
                user = user_result.scalar_one_or_none()
                
                if user:
                    user.tos_strike_count = max(0, (user.tos_strike_count or 0) - violation.strike_points)
                    
                    if violation.action_taken in ['suspension_7d', 'suspension_30d']:
                        user.is_suspended = False
                        user.suspended_at = None
                        user.suspended_reason = None
                        user.suspension_until = None
                    elif violation.action_taken == 'permanent_ban':
                        user.is_banned = False
                        user.banned_at = None
                        user.is_suspended = False
            
            # Notify user
            notification = Notification(
                user_id=violation.user_id,
                type='appeal_approved' if approved else 'appeal_denied',
                title='Appeal ' + ('Approved' if approved else 'Denied'),
                body=f"Your appeal for '{violation.title}' has been {'approved - strike removed' if approved else 'denied'}.",
                data=json.dumps({"violation_id": violation_id, "bulk_processed": True})
            )
            db.add(notification)
            
            processed += 1
            
        except Exception as e:
            errors.append(f"{violation_id}: {str(e)}")
    
    await db.commit()
    
    return {
        "processed": processed,
        "total": len(violation_ids),
        "approved": approved,
        "errors": errors if errors else None
    }


# ============ GDPR DATA MANAGEMENT ============

def _serialize_row(row, exclude_fields=None):
    """Convert a SQLAlchemy row to a safe dict, excluding sensitive fields."""
    exclude = set(exclude_fields or [])
    exclude.update({'password_hash', '_sa_instance_state'})
    result = {}
    for key in row.__table__.columns.keys():
        if key in exclude:
            continue
        val = getattr(row, key, None)
        if isinstance(val, datetime):
            result[key] = val.isoformat()
        elif hasattr(val, 'value'):  # Enum
            result[key] = val.value
        else:
            result[key] = val
    return result


@router.post("/data-export/{user_id}")
async def export_user_data(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """GDPR Article 20 — Data Portability. Export all user data as structured JSON.
    Admin-only. Collects data across all tables and returns a downloadable package."""
    
    # Verify user exists
    profile_result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    export = {
        "export_meta": {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "exported_by_admin": admin.id,
            "user_id": user_id,
            "format_version": "1.0"
        },
        "profile": _serialize_row(profile),
    }
    
    # Posts
    posts_result = await db.execute(
        select(Post).where(Post.author_id == user_id).order_by(Post.created_at.desc())
    )
    export["posts"] = [_serialize_row(p) for p in posts_result.scalars().all()]
    
    # Comments
    comments_result = await db.execute(
        select(Comment).where(Comment.author_id == user_id).order_by(Comment.created_at.desc())
    )
    export["comments"] = [_serialize_row(c) for c in comments_result.scalars().all()]
    
    # Bookings (as photographer or surfer)
    bookings_result = await db.execute(
        select(Booking).where(
            (Booking.photographer_id == user_id) | (Booking.surfer_id == user_id)
        ).order_by(Booking.created_at.desc())
    )
    export["bookings"] = [_serialize_row(b) for b in bookings_result.scalars().all()]
    
    # Gallery purchases
    purchases_result = await db.execute(
        select(GalleryPurchase).where(GalleryPurchase.buyer_id == user_id)
    )
    export["gallery_purchases"] = [_serialize_row(p) for p in purchases_result.scalars().all()]
    
    # Payment transactions
    payments_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.user_id == user_id)
    )
    export["payment_transactions"] = [_serialize_row(t) for t in payments_result.scalars().all()]
    
    # Messages sent
    messages_result = await db.execute(
        select(Message).where(Message.sender_id == user_id).order_by(Message.created_at.desc()).limit(500)
    )
    export["messages_sent"] = [_serialize_row(m) for m in messages_result.scalars().all()]
    
    # Check-ins
    checkins_result = await db.execute(
        select(CheckIn).where(CheckIn.user_id == user_id)
    )
    export["check_ins"] = [_serialize_row(c) for c in checkins_result.scalars().all()]
    
    # Follows (who they follow)
    follows_result = await db.execute(
        select(Follow).where(Follow.follower_id == user_id)
    )
    export["following"] = [_serialize_row(f) for f in follows_result.scalars().all()]
    
    # Followers
    followers_result = await db.execute(
        select(Follow).where(Follow.followed_id == user_id)
    )
    export["followers"] = [_serialize_row(f) for f in followers_result.scalars().all()]
    
    # Reviews (given and received)
    reviews_given = await db.execute(
        select(Review).where(Review.reviewer_id == user_id)
    )
    export["reviews_given"] = [_serialize_row(r) for r in reviews_given.scalars().all()]
    
    reviews_received = await db.execute(
        select(Review).where(Review.reviewed_id == user_id)
    )
    export["reviews_received"] = [_serialize_row(r) for r in reviews_received.scalars().all()]
    
    # ToS acknowledgements
    tos_result = await db.execute(
        select(TosAcknowledgement).where(TosAcknowledgement.user_id == user_id)
    )
    export["tos_acknowledgements"] = [_serialize_row(t) for t in tos_result.scalars().all()]
    
    # Violations
    violations_result = await db.execute(
        select(TosViolation).where(TosViolation.user_id == user_id)
    )
    export["tos_violations"] = [_serialize_row(v) for v in violations_result.scalars().all()]
    
    # Summary stats
    export["summary"] = {
        "total_posts": len(export["posts"]),
        "total_comments": len(export["comments"]),
        "total_bookings": len(export["bookings"]),
        "total_purchases": len(export["gallery_purchases"]),
        "total_payments": len(export["payment_transactions"]),
        "total_messages": len(export["messages_sent"]),
        "total_check_ins": len(export["check_ins"]),
        "total_following": len(export["following"]),
        "total_followers": len(export["followers"]),
    }
    
    return export


class DataDeletionRequest(BaseModel):
    confirm_phrase: str  # Must be "DELETE" to confirm
    reason: Optional[str] = None


@router.post("/data-deletion/{user_id}")
async def delete_user_data(
    user_id: str,
    data: DataDeletionRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """GDPR Article 17 — Right to Erasure. Anonymizes user PII while preserving
    financial records for regulatory compliance (7-year retention).
    Admin-only. Requires confirmation phrase 'DELETE'."""
    
    if data.confirm_phrase != "DELETE":
        raise HTTPException(status_code=400, detail="Confirmation phrase must be exactly 'DELETE'")
    
    # Verify user exists
    profile_result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent self-deletion or admin deletion
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account via this endpoint")
    if profile.is_admin:
        raise HTTPException(status_code=400, detail="Cannot delete admin accounts")
    
    original_username = profile.username
    original_email = profile.email
    
    # ── Anonymize PII fields ──────────────────────────────
    deleted_marker = f"deleted_{user_id[:8]}"
    profile.full_name = "Deleted User"
    profile.email = f"{deleted_marker}@deleted.rawsurf.com"
    profile.username = deleted_marker
    profile.bio = None
    profile.avatar_url = None
    profile.location = None
    profile.company_name = None
    profile.portfolio_url = None
    profile.instagram_url = None
    profile.website_url = None
    profile.home_break = None
    profile.wetsuit_color = None
    profile.rash_guard_color = None
    profile.home_location_name = None
    profile.home_latitude = None
    profile.home_longitude = None
    profile.meta_connections = None
    profile.password_hash = None  # Prevent login
    
    # Disable account
    profile.is_banned = True
    profile.banned_at = datetime.now(timezone.utc)
    profile.is_suspended = True
    profile.suspended_reason = f"Account deleted per GDPR request. Reason: {data.reason or 'User request'}"
    
    # ── Delete user-generated content ──────────────────────────────
    # Messages (soft-delete by clearing content)
    messages = await db.execute(select(Message).where(Message.sender_id == user_id))
    msg_count = 0
    for msg in messages.scalars().all():
        msg.content = "[Message deleted per data erasure request]"
        msg_count += 1
    
    # Comments (anonymize)
    comments = await db.execute(select(Comment).where(Comment.author_id == user_id))
    comment_count = 0
    for comment in comments.scalars().all():
        comment.content = "[Comment removed per data erasure request]"
        comment_count += 1
    
    # Delete posts
    posts = await db.execute(select(Post).where(Post.author_id == user_id))
    post_count = 0
    for post in posts.scalars().all():
        await db.delete(post)
        post_count += 1
    
    # Delete check-ins
    checkins = await db.execute(select(CheckIn).where(CheckIn.user_id == user_id))
    checkin_count = 0
    for ci in checkins.scalars().all():
        await db.delete(ci)
        checkin_count += 1
    
    # Delete follows
    follows_out = await db.execute(select(Follow).where(Follow.follower_id == user_id))
    follows_in = await db.execute(select(Follow).where(Follow.followed_id == user_id))
    follow_count = 0
    for f in follows_out.scalars().all():
        await db.delete(f)
        follow_count += 1
    for f in follows_in.scalars().all():
        await db.delete(f)
        follow_count += 1
    
    # Delete notifications
    notifs = await db.execute(select(Notification).where(Notification.user_id == user_id))
    notif_count = 0
    for n in notifs.scalars().all():
        await db.delete(n)
        notif_count += 1
    
    # NOTE: Payment transactions and bookings are PRESERVED for financial compliance
    
    await db.commit()
    
    return {
        "message": "User data deleted/anonymized successfully",
        "user_id": user_id,
        "original_username": original_username,
        "original_email": original_email,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "deleted_by": admin.id,
        "summary": {
            "profile_anonymized": True,
            "posts_deleted": post_count,
            "comments_anonymized": comment_count,
            "messages_anonymized": msg_count,
            "check_ins_deleted": checkin_count,
            "follows_deleted": follow_count,
            "notifications_deleted": notif_count,
            "payments_preserved": True,  # Financial compliance
            "bookings_preserved": True   # Financial compliance
        }
    }
