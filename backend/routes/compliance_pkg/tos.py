"""
ToS Content Management & Acknowledgement
Handles:
- ToS/Privacy content CRUD (admin-managed, DB-backed)
- ToS acknowledgement recording
- Acceptance history
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, TosAcknowledgement, TosContent
from core.security import get_user_id_from_jwt_or_query

router = APIRouter(prefix="/compliance", tags=["compliance"])


# ============ SCHEMAS ============

class AcknowledgeTosRequest(BaseModel):
    tos_version: str
    section: Optional[str] = None


class TosContentRequest(BaseModel):
    doc_type: str  # 'tos' or 'privacy'
    version: str
    sections: list  # [{title, body}]
    effective_date: Optional[str] = None
    set_active: bool = True


# ============ DEFAULT FALLBACK CONTENT ============

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
