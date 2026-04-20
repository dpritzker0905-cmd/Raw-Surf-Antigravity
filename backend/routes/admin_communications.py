"""
Admin Communication Center
- Bulk email/push to user segments
- Announcement broadcasts
- In-app messaging templates
- Email delivery tracking
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, Announcement, AnnouncementTypeEnum, MessageTemplate, 
    BulkMessageCampaign, RoleEnum
)
from routes.admin_moderation import log_audit

router = APIRouter()


# --- Pydantic Models ---
class CreateAnnouncementRequest(BaseModel):
    title: str
    message: str
    announcement_type: Optional[str] = "banner"
    target_roles: Optional[List[str]] = []
    is_dismissible: Optional[bool] = True
    action_url: Optional[str] = None
    action_text: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None

class CreateTemplateRequest(BaseModel):
    name: str
    subject: Optional[str] = None
    body: str
    template_type: Optional[str] = "email"
    variables: Optional[List[str]] = []

class CreateBulkCampaignRequest(BaseModel):
    name: str
    message_type: str  # 'email', 'push', 'in_app'
    subject: Optional[str] = None
    body: str
    target_segment: Optional[str] = "all"
    target_roles: Optional[List[str]] = []
    scheduled_at: Optional[str] = None


# --- ANNOUNCEMENTS ---
@router.get("/admin/announcements")
async def get_announcements(
    admin: Profile = Depends(get_current_admin),
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Get all announcements"""
    
    query = select(Announcement).order_by(desc(Announcement.created_at))
    if not include_inactive:
        query = query.where(Announcement.is_active == True)
    
    result = await db.execute(query)
    announcements = result.scalars().all()
    
    return {
        "announcements": [{
            "id": a.id,
            "title": a.title,
            "message": a.message,
            "announcement_type": a.announcement_type.value if a.announcement_type else None,
            "target_roles": a.target_roles or [],
            "is_active": a.is_active,
            "is_dismissible": a.is_dismissible,
            "action_url": a.action_url,
            "action_text": a.action_text,
            "start_at": a.start_at.isoformat() if a.start_at else None,
            "end_at": a.end_at.isoformat() if a.end_at else None,
            "views_count": a.views_count,
            "clicks_count": a.clicks_count,
            "dismissals_count": a.dismissals_count,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in announcements]
    }


@router.post("/admin/announcements")
async def create_announcement(
    request: CreateAnnouncementRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new announcement"""
    
    announcement = Announcement(
        title=request.title,
        message=request.message,
        announcement_type=AnnouncementTypeEnum(request.announcement_type) if request.announcement_type else AnnouncementTypeEnum.BANNER,
        target_roles=request.target_roles or [],
        is_dismissible=request.is_dismissible,
        action_url=request.action_url,
        action_text=request.action_text,
        start_at=datetime.fromisoformat(request.start_at) if request.start_at else None,
        end_at=datetime.fromisoformat(request.end_at) if request.end_at else None,
        created_by=admin_id
    )
    
    db.add(announcement)
    await log_audit(db, admin_id, "communication", f"Created announcement: {request.title}")
    await db.commit()
    
    return {"success": True, "announcement_id": announcement.id}


@router.put("/admin/announcements/{announcement_id}/toggle")
async def toggle_announcement(
    announcement_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Toggle announcement active status"""
    
    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    
    await db.execute(
        update(Announcement)
        .where(Announcement.id == announcement_id)
        .values(is_active=not announcement.is_active)
    )
    await db.commit()
    
    return {"success": True, "is_active": not announcement.is_active}


# User-facing endpoint to get active announcements
@router.get("/announcements/active")
async def get_active_announcements(
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get active announcements for user"""
    now = datetime.now(timezone.utc)
    
    query = select(Announcement).where(and_(
        Announcement.is_active == True,
        or_(Announcement.start_at.is_(None), Announcement.start_at <= now),
        or_(Announcement.end_at.is_(None), Announcement.end_at >= now)
    ))
    
    result = await db.execute(query)
    announcements = result.scalars().all()
    
    # Filter by user role if provided
    filtered = []
    user_role = None
    if user_id:
        user = await db.execute(select(Profile.role).where(Profile.id == user_id))
        user_info = user.fetchone()
        user_role = user_info[0].value if user_info and user_info[0] else None
    
    for a in announcements:
        if not a.target_roles or (user_role and user_role in a.target_roles):
            filtered.append({
                "id": a.id,
                "title": a.title,
                "message": a.message,
                "announcement_type": a.announcement_type.value if a.announcement_type else "banner",
                "is_dismissible": a.is_dismissible,
                "action_url": a.action_url,
                "action_text": a.action_text
            })
    
    return {"announcements": filtered}


# --- MESSAGE TEMPLATES ---
@router.get("/admin/message-templates")
async def get_message_templates(
    admin: Profile = Depends(get_current_admin),
    template_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all message templates"""
    
    query = select(MessageTemplate).where(MessageTemplate.is_active == True)
    if template_type:
        query = query.where(MessageTemplate.template_type == template_type)
    
    result = await db.execute(query.order_by(MessageTemplate.name))
    templates = result.scalars().all()
    
    return {
        "templates": [{
            "id": t.id,
            "name": t.name,
            "subject": t.subject,
            "body": t.body,
            "template_type": t.template_type,
            "variables": t.variables or [],
            "created_at": t.created_at.isoformat() if t.created_at else None
        } for t in templates]
    }


@router.post("/admin/message-templates")
async def create_message_template(
    request: CreateTemplateRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a message template"""
    
    template = MessageTemplate(
        name=request.name,
        subject=request.subject,
        body=request.body,
        template_type=request.template_type or "email",
        variables=request.variables or []
    )
    
    db.add(template)
    await db.commit()
    
    return {"success": True, "template_id": template.id}


@router.delete("/admin/message-templates/{template_id}")
async def delete_message_template(
    template_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Soft delete a message template"""
    
    await db.execute(
        update(MessageTemplate)
        .where(MessageTemplate.id == template_id)
        .values(is_active=False)
    )
    await db.commit()
    
    return {"success": True}


# --- BULK MESSAGE CAMPAIGNS ---
@router.get("/admin/bulk-campaigns")
async def get_bulk_campaigns(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get bulk message campaigns"""
    
    query = select(BulkMessageCampaign).order_by(desc(BulkMessageCampaign.created_at))
    if status:
        query = query.where(BulkMessageCampaign.status == status)
    
    result = await db.execute(query.limit(limit))
    campaigns = result.scalars().all()
    
    return {
        "campaigns": [{
            "id": c.id,
            "name": c.name,
            "message_type": c.message_type,
            "subject": c.subject,
            "target_segment": c.target_segment,
            "target_roles": c.target_roles or [],
            "status": c.status,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "sent_at": c.sent_at.isoformat() if c.sent_at else None,
            "total_recipients": c.total_recipients,
            "sent_count": c.sent_count,
            "delivered_count": c.delivered_count,
            "opened_count": c.opened_count,
            "clicked_count": c.clicked_count,
            "bounced_count": c.bounced_count,
            "open_rate": round((c.opened_count / c.delivered_count * 100) if c.delivered_count > 0 else 0, 1),
            "click_rate": round((c.clicked_count / c.opened_count * 100) if c.opened_count > 0 else 0, 1),
            "created_at": c.created_at.isoformat() if c.created_at else None
        } for c in campaigns]
    }


@router.post("/admin/bulk-campaigns")
async def create_bulk_campaign(
    request: CreateBulkCampaignRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a bulk message campaign"""
    
    # Calculate target recipients
    query = select(func.count(Profile.id))
    
    if request.target_segment == "photographers":
        query = query.where(Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]))
    elif request.target_segment == "surfers":
        query = query.where(Profile.role.in_([RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]))
    elif request.target_segment == "inactive":
        # Users who haven't logged in for 30 days
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        query = query.where(Profile.last_login_at < cutoff)
    elif request.target_roles:
        role_enums = [RoleEnum(r) for r in request.target_roles]
        query = query.where(Profile.role.in_(role_enums))
    
    total = (await db.execute(query)).scalar() or 0
    
    campaign = BulkMessageCampaign(
        name=request.name,
        message_type=request.message_type,
        subject=request.subject,
        body=request.body,
        target_segment=request.target_segment or "all",
        target_roles=request.target_roles or [],
        status="scheduled" if request.scheduled_at else "draft",
        scheduled_at=datetime.fromisoformat(request.scheduled_at) if request.scheduled_at else None,
        total_recipients=total,
        created_by=admin_id
    )
    
    db.add(campaign)
    await log_audit(db, admin_id, "communication", f"Created bulk campaign: {request.name}")
    await db.commit()
    
    return {"success": True, "campaign_id": campaign.id, "total_recipients": total}


@router.post("/admin/bulk-campaigns/{campaign_id}/send")
async def send_bulk_campaign(
    campaign_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Send a bulk campaign immediately"""
    
    result = await db.execute(select(BulkMessageCampaign).where(BulkMessageCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    if campaign.status not in ["draft", "scheduled"]:
        raise HTTPException(status_code=400, detail="Campaign cannot be sent")
    
    # In production, this would queue the actual sending
    # For now, we simulate the send
    await db.execute(
        update(BulkMessageCampaign)
        .where(BulkMessageCampaign.id == campaign_id)
        .values(
            status="sent",
            sent_at=datetime.now(timezone.utc),
            sent_count=campaign.total_recipients,
            delivered_count=int(campaign.total_recipients * 0.95)  # Simulated 95% delivery
        )
    )
    
    await log_audit(db, admin_id, "communication", f"Sent bulk campaign: {campaign.name}")
    await db.commit()
    
    return {"success": True, "sent_count": campaign.total_recipients}


@router.get("/admin/communication/stats")
async def get_communication_stats(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get communication statistics"""
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Campaigns sent
    campaigns_sent = await db.execute(
        select(func.count(BulkMessageCampaign.id))
        .where(and_(
            BulkMessageCampaign.sent_at >= start_date,
            BulkMessageCampaign.status == "sent"
        ))
    )
    
    # Total messages sent
    total_sent = await db.execute(
        select(func.sum(BulkMessageCampaign.sent_count))
        .where(and_(
            BulkMessageCampaign.sent_at >= start_date,
            BulkMessageCampaign.status == "sent"
        ))
    )
    
    # Avg open rate
    avg_open = await db.execute(
        select(
            func.sum(BulkMessageCampaign.opened_count),
            func.sum(BulkMessageCampaign.delivered_count)
        )
        .where(and_(
            BulkMessageCampaign.sent_at >= start_date,
            BulkMessageCampaign.status == "sent"
        ))
    )
    open_data = avg_open.fetchone()
    
    # Active announcements
    active_announcements = await db.execute(
        select(func.count(Announcement.id))
        .where(Announcement.is_active == True)
    )
    
    return {
        "period_days": days,
        "campaigns_sent": campaigns_sent.scalar() or 0,
        "total_messages_sent": total_sent.scalar() or 0,
        "avg_open_rate": round((open_data[0] / open_data[1] * 100) if open_data[1] else 0, 1),
        "active_announcements": active_announcements.scalar() or 0
    }
