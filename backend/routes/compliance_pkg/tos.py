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
from core.security import get_user_id_from_jwt_or_query, get_current_user_id
from services import legal_identity, surf_truth_consent

# The legal documents an admin edits (Compliance > Legal documents). 'forecast_consent' is the opt-in wording for using
# a person's wave reports to improve forecasts: ONE section whose title is the checkbox label and whose body is its
# description (services/surf_truth_consent.py reads it). 'company_details' holds the legal entity name and the
# privacy-notice link (services/legal_identity.py); the other documents may use its tokens ({company}, {privacy_url},
# {privacy_contact}), which are filled when a document is served to people and left as written for the admin editor.
DOC_TYPES = ('tos', 'company_details', 'privacy', 'forecast_consent')

router = APIRouter(prefix="/compliance", tags=["compliance"])


# ============ SCHEMAS ============

class AcknowledgeTosRequest(BaseModel):
    tos_version: str
    section: Optional[str] = None


class TosContentRequest(BaseModel):
    doc_type: str  # one of DOC_TYPES
    version: str
    sections: list  # [{title, body}]
    effective_date: Optional[str] = None
    set_active: bool = True
    # Company details only: True = a CORRECTION (a typo, same meaning): every consent and export stands. False = a
    # CHANGE (a different company or privacy notice): a new consent revision, everyone is asked again.
    correction: bool = False


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
    # Appended 2026-11-18 (T1 legal research): who the controller is, and the forecast-data opt-in. The sections above
    # are unchanged. DRAFT: counsel has not reviewed this wording.
    {"title": "10. Who We Are", "body": "Raw Surf is operated by {company}, which is responsible for your personal data. Questions about your data: use Settings > Legal or Support in the app."},
    {"title": "11. Forecast Data From Your Wave Reports", "body": "If you turn on \"Use my wave reports to improve Raw Surf's forecasts\" (off unless you turn it on), {company} uses the wave heights and surf quality you report to measure how far off our surf forecasts are and to correct them, on the basis of your consent. Each report is used with its spot, its time to the minute, roughly how far you and your photo were from the spot (in wide bands, never closer than 1 km), your app version and how we rated the report, under a code instead of your name. That code is pseudonymous, not anonymous: we can trace it back to your account. You can turn it off any time with the same switch; checks and corrections already made stay, new checks leave out all your reports, and copies made before you turned it off are deleted within 7 days."},
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
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Check if user has acknowledged the current ToS version"""
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
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
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Return all ToS acceptance records for a user (for Settings > Legal)"""
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
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
    raw: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    """Public endpoint: fetch the active ToS or Privacy content.
    Falls back to hardcoded defaults if nothing in DB.
    Company tokens ({company}, {privacy_url}, {privacy_contact}) are filled from Company details, except with raw=true
    (the admin editor, which must edit the template, not the filled words). Company details are public facts."""
    result = await db.execute(
        select(TosContent)
        .where(TosContent.doc_type == doc_type, TosContent.is_active == True)
        .limit(1)
    )
    content = result.scalar_one_or_none()

    if content:
        out = {
            "doc_type": content.doc_type,
            "version": content.version,
            "sections": content.sections,
            "effective_date": content.effective_date,
            "updated_at": content.updated_at.isoformat() if content.updated_at else None
        }
    elif doc_type == surf_truth_consent.DOC_TYPE:
        out = {"doc_type": doc_type, "version": surf_truth_consent.CONSENT_VERSION,
               "sections": surf_truth_consent.DEFAULT_SECTIONS, "effective_date": None, "updated_at": None}
    elif doc_type == legal_identity.DOC_TYPE:
        out = {"doc_type": doc_type, "version": legal_identity.DEFAULT_VERSION,
               "sections": legal_identity.default_sections(), "effective_date": None, "updated_at": None}
    else:
        defaults = DEFAULT_TOS_SECTIONS if doc_type == 'tos' else DEFAULT_PRIVACY_SECTIONS
        out = {
            "doc_type": doc_type,
            "version": "1.0",
            "sections": defaults,
            "effective_date": "May 2026",
            "updated_at": None
        }
    if not raw and doc_type != legal_identity.DOC_TYPE:
        details = await legal_identity.current(db)
        out["sections"] = legal_identity.fill_sections(out["sections"], details)
        out["company"] = details["legal_name"]
        if doc_type == surf_truth_consent.DOC_TYPE:
            out["version"] = (await surf_truth_consent.wording(db))["version"]   # the version names the FILLED words
    return out


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


@router.get("/forecast-consent/summary")
async def forecast_consent_summary(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Admin: counts of people opted in under the current consent version, waiting to agree again after a new
    version, and opted out. No identities."""
    return await surf_truth_consent.summary(db)


@router.put("/tos-content")
async def save_tos_content(
    data: TosContentRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin: create or update ToS/Privacy content. If set_active=True,
    deactivates all other versions of the same doc_type."""
    if data.doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="doc_type must be one of: " + ", ".join(DOC_TYPES))
    if not data.version.strip():
        raise HTTPException(status_code=400, detail="version is required")
    if data.doc_type == surf_truth_consent.DOC_TYPE:
        # The consent is a checkbox label plus its description: exactly one section, both parts filled.
        ok = (len(data.sections) == 1 and isinstance(data.sections[0], dict)
              and str(data.sections[0].get('title') or '').strip() and str(data.sections[0].get('body') or '').strip())
        if not ok:
            raise HTTPException(status_code=400,
                                detail="The forecast data consent needs exactly one section with a label and a text")
        # A draft placeholder ([COMPANY], [PRIVACY NOTICE LINK]) must never become the text people agree to.
        left = surf_truth_consent.unfilled(str(data.sections[0].get('body') or '') + str(data.sections[0].get('title')))
        if data.set_active and left:
            raise HTTPException(status_code=400, detail=(
                "Fill in " + " and ".join(left) + " before making this consent text active."))
    company_before = None
    if data.doc_type == legal_identity.DOC_TYPE:
        problem = legal_identity.validate(data.sections)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if data.set_active:
            # What people see now, before this publish (for the append-only company_details_changes record)
            company_before = (await legal_identity.current(db), await surf_truth_consent.wording(db),
                              await legal_identity.current_revision(db))

    # Check if this version already exists
    existing = await db.execute(
        select(TosContent)
        .where(TosContent.doc_type == data.doc_type, TosContent.version == data.version)
    )
    content = existing.scalar_one_or_none()
    if data.doc_type == surf_truth_consent.DOC_TYPE:
        # People agreed to a TEXT under a version, so a version's text never changes (advisor hold on #1026). Any
        # change is a new version, which asks everyone again. The built-in default's version is reserved likewise.
        def _words(sections):
            return [(str(s.get('title') or '').strip(), str(s.get('body') or '').strip()) for s in sections or []]
        prior = (content.sections if content else
                 surf_truth_consent.DEFAULT_SECTIONS if data.version.strip() == surf_truth_consent.CONSENT_VERSION
                 else None)
        if prior is not None and _words(prior) != _words(data.sections):
            raise HTTPException(status_code=409, detail=(
                f"Version {data.version} is already published with different wording, and people agreed to that text. "
                "Publish the change as a new version; everyone will be asked again."))
    if (data.doc_type == legal_identity.DOC_TYPE and content is not None and content.is_active
            and not data.set_active
            and legal_identity.from_sections(content.sections) != legal_identity.from_sections(data.sections)):
        # Advisor hold on #1048: the ACTIVE company details are what people see. Changing them without set_active
        # would skip the change/correction decision and the append-only company_details_changes record, and keep
        # every consent valid under different words. Any change to them goes through a recorded publish.
        raise HTTPException(status_code=409, detail=(
            f"Company details {data.version} are in use. Publish the edit (as a change or a correction) so it is "
            "recorded; it cannot be saved in place without publishing."))

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

    company = None
    if company_before is not None:
        company = await _record_company_publish(db, data, admin, *company_before)

    await db.commit()
    
    out = {
        "message": f"{data.doc_type.upper()} content saved",
        "version": data.version,
        "is_active": data.set_active,
        "section_count": len(data.sections)
    }
    if company is not None:
        out.update(company)
    return out


async def _record_company_publish(db, data, admin, details_before, consent_before, revision_before) -> dict:
    """A Company details publish: decide the consent revision and append the record (owner, 2026-11-18: "Yes,
    correction option"; "Only real name changes").
    - The consent's FILLED words unchanged (e.g. only the privacy contact, which the default consent does not use):
      the revision stays, so no one is asked again and retention sees no revocation, whatever the admin chose.
    - A CORRECTION: the revision stays; the new words are served under the same version, and the record keeps both.
    - A CHANGE: a new revision, so a new consent version: everyone is asked again, and retention replaces exports."""
    import uuid
    details_after = legal_identity.from_sections(data.sections)
    same_rev_after = await surf_truth_consent.wording(db, details=details_after, revision=revision_before)
    words_changed = (same_rev_after["title"], same_rev_after["text"]) != (consent_before["title"],
                                                                         consent_before["text"])
    kind = "correction" if data.correction else "change"
    revision = revision_before
    if words_changed and kind == "change":
        revision = f"{data.version.strip()[:20]}-{uuid.uuid4().hex[:8]}"
    consent_after = (same_rev_after if revision == revision_before
                     else await surf_truth_consent.wording(db, details=details_after, revision=revision))
    row = await legal_identity.record_publish(
        db, doc_version=data.version.strip(), kind=kind, before=details_before, after=details_after,
        consent_before=consent_before, consent_after=consent_after, revision=revision, actor_id=admin.id)
    return {"kind": kind, "consent_version_changed": row.consent_version_changed,
            "consent_version": consent_after["version"]}
