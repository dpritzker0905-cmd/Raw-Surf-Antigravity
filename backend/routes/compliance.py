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
    Profile, TosViolation, TosAcknowledgement, FraudAlert,
    Notification, Booking, DispatchRequest, LiveSession
)

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
    reporter_id: str = Query(...),
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
    user_id: str = Query(...),
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
    user_id: str = Query(...),
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
                "action_taken": v.action_taken,
                "appeal_status": v.appeal_status,
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

