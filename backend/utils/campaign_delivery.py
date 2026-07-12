"""
Real recipient resolution + real multi-channel delivery for admin bulk/notification
campaigns. Replaces the old "simulate a 95% delivery rate" placeholder with genuine
sends via the app's existing OneSignal (push) and Resend (email) integrations, plus
real in-app Notification rows - the same channels utils/admin_notifications.py
already uses for pro-application alerts.
"""
from typing import List, Optional
from datetime import datetime, timezone
import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Profile, RoleEnum, Notification
from services.onesignal_service import onesignal_service

try:
    import resend
    RESEND_AVAILABLE = True
except ImportError:
    RESEND_AVAILABLE = False

logger = logging.getLogger(__name__)

ONESIGNAL_BATCH_SIZE = 2000  # OneSignal's per-request recipient cap


async def resolve_campaign_recipients(
    db: AsyncSession,
    target_segment: Optional[str] = None,
    target_roles: Optional[List[str]] = None,
    target_all_users: bool = False
) -> List[Profile]:
    """
    Resolve the real Profile rows a campaign should reach, using the same
    segment/role logic already used to COUNT recipients at campaign-creation time
    (see admin/communications.py::create_bulk_campaign) - now used to actually fetch
    them for sending, not just count them.
    """
    query = select(Profile)

    if target_all_users:
        pass  # no filter - everyone
    elif target_segment == "photographers":
        query = query.where(Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]))
    elif target_segment == "surfers":
        query = query.where(Profile.role.in_([RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]))
    elif target_segment == "inactive":
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        query = query.where(Profile.last_login_at < cutoff)
    elif target_roles:
        # Case-insensitive match against both the enum name and value (RoleEnum's values
        # are capitalized, e.g. "Photographer" - a caller sending lowercase "photographer"
        # should still match rather than silently falling through to "no filter").
        by_lower = {}
        for e in RoleEnum:
            by_lower[e.name.lower()] = e
            by_lower[e.value.lower()] = e
        valid_roles = [by_lower[r.lower()] for r in target_roles if r.lower() in by_lower]
        # Fail closed: if roles were specified but none are recognized, target nobody
        # rather than silently falling through to an unfiltered (everyone) query.
        query = query.where(Profile.role.in_(valid_roles)) if valid_roles else query.where(False)
    # target_segment == "all" (or unrecognized, with no target_roles) falls through with
    # no filter, matching the create-time counting logic's behavior for "all"/unmatched segments.

    result = await db.execute(query)
    return list(result.scalars().all())


async def send_campaign(
    db: AsyncSession,
    recipients: List[Profile],
    title: str,
    body: str,
    channels: List[str],
    action_url: Optional[str] = None,
    subject: Optional[str] = None,
    from_email: str = "Raw Surf <noreply@rawsurf.io>"
) -> dict:
    """
    Actually deliver a campaign across the requested channels and return REAL counts
    (not a simulated percentage). channels: any of 'push', 'email', 'in_app'.
    """
    result = {
        "total_recipients": len(recipients),
        "push": {"attempted": 0, "sent": 0, "failed": 0, "configured": bool(onesignal_service.app_id and onesignal_service.api_key)},
        "email": {"attempted": 0, "sent": 0, "failed": 0, "configured": RESEND_AVAILABLE and bool(getattr(resend, "api_key", None))},
        "in_app": {"attempted": 0, "sent": 0, "failed": 0}
    }

    if not recipients:
        return result

    if "push" in channels:
        result["push"]["attempted"] = len(recipients)
        if result["push"]["configured"]:
            external_ids = [r.id for r in recipients]
            for i in range(0, len(external_ids), ONESIGNAL_BATCH_SIZE):
                batch = external_ids[i:i + ONESIGNAL_BATCH_SIZE]
                res = await onesignal_service.send_notification(
                    external_user_ids=batch, title=title, message=body, url=action_url
                )
                if res.get("success"):
                    result["push"]["sent"] += len(batch)
                else:
                    result["push"]["failed"] += len(batch)
                    logger.warning(f"OneSignal campaign batch failed: {res.get('error')}")
        else:
            result["push"]["failed"] = len(recipients)

    if "email" in channels:
        result["email"]["attempted"] = len(recipients)
        if result["email"]["configured"]:
            for r in recipients:
                if not r.email:
                    result["email"]["failed"] += 1
                    continue
                try:
                    resend.Emails.send({
                        "from": from_email,
                        "to": r.email,
                        "subject": subject or title,
                        "html": body
                    })
                    result["email"]["sent"] += 1
                except Exception as e:
                    result["email"]["failed"] += 1
                    logger.warning(f"Resend campaign send failed for {r.id}: {e}")
        else:
            result["email"]["failed"] = len(recipients)

    if "in_app" in channels:
        result["in_app"]["attempted"] = len(recipients)
        for r in recipients:
            try:
                db.add(Notification(
                    user_id=r.id,
                    type="admin_campaign",
                    title=title,
                    body=body,
                    data=json.dumps({"action_url": action_url}) if action_url else None
                ))
                result["in_app"]["sent"] += 1
            except Exception as e:
                result["in_app"]["failed"] += 1
                logger.warning(f"In-app notification creation failed for {r.id}: {e}")

    return result
