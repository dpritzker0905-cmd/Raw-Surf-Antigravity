"""
admin/p2_campaigns.py — Notification campaigns and funnel analytics.
Extracted from p2.py (v93 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, NotificationCampaign, PaymentTransaction, Booking, RoleEnum
)
from .moderation import log_audit
from utils.campaign_delivery import resolve_campaign_recipients, send_campaign

router = APIRouter()


# ============ NOTIFICATION CAMPAIGNS ============

class CreateCampaignRequest(BaseModel):
    name: str
    description: Optional[str] = None
    title: str
    body: str
    image_url: Optional[str] = None
    action_url: Optional[str] = None
    target_all_users: bool = False
    target_roles: Optional[List[str]] = []
    target_segments: Optional[List[str]] = []
    scheduled_at: Optional[str] = None


@router.get("/admin/notification-campaigns")
async def get_notification_campaigns(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get all notification campaigns"""
    query = select(NotificationCampaign)
    if status:
        query = query.where(NotificationCampaign.status == status)
    query = query.order_by(desc(NotificationCampaign.created_at)).limit(limit)
    result = await db.execute(query)
    campaigns = result.scalars().all()
    return {
        "campaigns": [{
            "id": c.id, "name": c.name, "title": c.title,
            "body": c.body[:100] + "..." if len(c.body) > 100 else c.body,
            "status": c.status, "target_all_users": c.target_all_users,
            "target_roles": c.target_roles, "target_segments": c.target_segments,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "sent_at": c.sent_at.isoformat() if c.sent_at else None,
            "stats": {
                "targeted": c.total_targeted, "sent": c.total_sent,
                "delivered": c.total_delivered, "opened": c.total_opened,
                "clicked": c.total_clicked,
                "open_rate": round((c.total_opened / c.total_sent * 100) if c.total_sent > 0 else 0, 1),
                "click_rate": round((c.total_clicked / c.total_opened * 100) if c.total_opened > 0 else 0, 1)
            },
            "created_at": c.created_at.isoformat() if c.created_at else None
        } for c in campaigns]
    }


@router.post("/admin/notification-campaigns")
async def create_notification_campaign(
    data: CreateCampaignRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new notification campaign"""
    campaign = NotificationCampaign(
        name=data.name, description=data.description, title=data.title,
        body=data.body, image_url=data.image_url, action_url=data.action_url,
        target_all_users=data.target_all_users,
        target_roles=data.target_roles or [],
        target_segments=data.target_segments or [],
        scheduled_at=datetime.fromisoformat(data.scheduled_at) if data.scheduled_at else None,
        status='draft' if not data.scheduled_at else 'scheduled',
        created_by=admin.id
    )
    db.add(campaign)
    if data.target_all_users:
        count_result = await db.execute(select(func.count(Profile.id)))
        campaign.total_targeted = count_result.scalar() or 0
    elif data.target_roles:
        count_result = await db.execute(
            select(func.count(Profile.id))
            .where(Profile.role.in_([RoleEnum(r) for r in data.target_roles if r in [e.value for e in RoleEnum]]))
        )
        campaign.total_targeted = count_result.scalar() or 0
    await log_audit(
        db, admin.id, "admin", "notification_campaign_created",
        f"Created notification campaign: {data.name}",
        "notification_campaign", campaign.id, None
    )
    await db.commit()
    return {"id": campaign.id, "name": campaign.name, "status": campaign.status}


@router.post("/admin/notification-campaigns/{campaign_id}/send")
async def send_notification_campaign(
    campaign_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Send a notification campaign immediately"""
    result = await db.execute(
        select(NotificationCampaign).where(NotificationCampaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status == 'sent':
        raise HTTPException(status_code=400, detail="Campaign already sent")

    recipients = await resolve_campaign_recipients(
        db, target_roles=campaign.target_roles, target_all_users=campaign.target_all_users
    )
    delivery = await send_campaign(
        db, recipients=recipients, title=campaign.title, body=campaign.body,
        channels=["push", "in_app"], action_url=campaign.action_url
    )
    push = delivery["push"]

    campaign.status = 'sent'
    campaign.sent_at = datetime.now(timezone.utc)
    campaign.total_sent = push["sent"] + push["failed"]
    campaign.total_delivered = push["sent"]

    audit_note = f"Sent notification campaign: {campaign.name} — {push['sent']} delivered via push"
    if not push["configured"]:
        audit_note += f" (OneSignal not configured — {push['failed']} could not be sent)"
    await log_audit(
        db, admin.id, "admin", "notification_campaign_sent", audit_note,
        "notification_campaign", campaign.id, None
    )
    await db.commit()
    return {
        "status": "sent",
        "total_sent": campaign.total_sent,
        "total_delivered": campaign.total_delivered,
        "push_configured": push["configured"]
    }


@router.put("/admin/notification-campaigns/{campaign_id}/cancel")
async def cancel_notification_campaign(
    campaign_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Cancel a scheduled notification campaign"""
    result = await db.execute(
        select(NotificationCampaign).where(NotificationCampaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status not in ['draft', 'scheduled']:
        raise HTTPException(status_code=400, detail="Can only cancel draft or scheduled campaigns")
    campaign.status = 'cancelled'
    await db.commit()
    return {"status": "cancelled"}


# ============ FUNNEL ANALYTICS ============

@router.get("/admin/funnel/detailed")
async def get_detailed_funnel(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Detailed booking funnel with drop-off analysis"""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    booking_stats = await db.execute(
        select(Booking.status, func.count(Booking.id).label('count'))
        .where(Booking.created_at >= start_date)
        .group_by(Booking.status)
    )
    stats_by_status = {row.status: row.count for row in booking_stats.fetchall()}
    total_initiated = sum(stats_by_status.values())
    confirmed = stats_by_status.get('confirmed', 0) + stats_by_status.get('completed', 0)
    completed = stats_by_status.get('completed', 0)
    cancelled = stats_by_status.get('cancelled', 0)

    payments = await db.execute(
        select(func.count(PaymentTransaction.id))
        .where(and_(
            PaymentTransaction.payment_status == 'completed',
            PaymentTransaction.created_at >= start_date
        ))
    )
    successful_payments = payments.scalar() or 0

    funnel = [
        {"stage": "Bookings Initiated", "count": total_initiated, "conversion_rate": 100},
        {"stage": "Bookings Confirmed", "count": confirmed,
         "conversion_rate": round((confirmed / total_initiated * 100) if total_initiated > 0 else 0, 1),
         "drop_off": total_initiated - confirmed},
        {"stage": "Payments Completed", "count": successful_payments,
         "conversion_rate": round((successful_payments / total_initiated * 100) if total_initiated > 0 else 0, 1),
         "drop_off": confirmed - successful_payments},
        {"stage": "Sessions Completed", "count": completed,
         "conversion_rate": round((completed / total_initiated * 100) if total_initiated > 0 else 0, 1),
         "drop_off": successful_payments - completed}
    ]

    drop_off_reasons = {
        "payment_failed": stats_by_status.get('payment_failed', 0),
        "user_cancelled": cancelled,
        "photographer_cancelled": stats_by_status.get('photographer_cancelled', 0),
        "expired": stats_by_status.get('expired', 0),
        "no_show": stats_by_status.get('no_show', 0)
    }

    return {
        "period_days": days, "funnel": funnel,
        "overall_conversion_rate": round((completed / total_initiated * 100) if total_initiated > 0 else 0, 1),
        "drop_off_reasons": drop_off_reasons,
        "booking_stats": stats_by_status
    }
