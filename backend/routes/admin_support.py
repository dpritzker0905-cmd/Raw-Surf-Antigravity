"""
Admin Support Ticketing System
- Centralized ticket management
- Ticket routing, prioritization, SLA tracking
- Response time metrics and CSAT tracking
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, update
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from models import (
    Profile, SupportTicket, TicketMessage, 
    TicketCategoryEnum, TicketPriorityEnum, TicketStatusEnum
)
from routes.admin_moderation import require_admin

router = APIRouter()


# --- Pydantic Models ---
class CreateTicketRequest(BaseModel):
    subject: str
    description: str
    category: Optional[str] = "other"
    priority: Optional[str] = "medium"
    related_booking_id: Optional[str] = None
    tags: Optional[List[str]] = []

class TicketMessageRequest(BaseModel):
    message: str
    is_internal_note: Optional[bool] = False

class UpdateTicketRequest(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None


# --- Helper Functions ---
async def generate_ticket_number(db: AsyncSession) -> str:
    result = await db.execute(select(func.count(SupportTicket.id)))
    count = result.scalar() or 0
    return f"TKT-{str(count + 1).zfill(5)}"

def calculate_sla_due(priority: TicketPriorityEnum) -> datetime:
    now = datetime.now(timezone.utc)
    hours = {
        TicketPriorityEnum.URGENT: 1,
        TicketPriorityEnum.HIGH: 4,
        TicketPriorityEnum.MEDIUM: 24,
        TicketPriorityEnum.LOW: 72
    }
    return now + timedelta(hours=hours.get(priority, 24))


# --- Endpoints ---
@router.get("/admin/support/tickets")
async def get_support_tickets(
    admin_id: str,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all support tickets with filters"""
    await require_admin(admin_id, db)
    
    query = select(SupportTicket).order_by(desc(SupportTicket.created_at))
    
    if status and status != 'all':
        query = query.where(SupportTicket.status == TicketStatusEnum(status))
    if priority and priority != 'all':
        query = query.where(SupportTicket.priority == TicketPriorityEnum(priority))
    if category and category != 'all':
        query = query.where(SupportTicket.category == TicketCategoryEnum(category))
    if assigned_to:
        query = query.where(SupportTicket.assigned_to == assigned_to)
    if search:
        query = query.where(or_(
            SupportTicket.subject.ilike(f"%{search}%"),
            SupportTicket.ticket_number.ilike(f"%{search}%")
        ))
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0
    
    # Apply pagination
    result = await db.execute(query.limit(limit).offset(offset))
    tickets = result.scalars().all()
    
    # Fetch user info for each ticket
    ticket_data = []
    for t in tickets:
        user = await db.execute(select(Profile.full_name, Profile.email).where(Profile.id == t.user_id))
        user_info = user.fetchone()
        
        assignee_name = None
        if t.assigned_to:
            assignee = await db.execute(select(Profile.full_name).where(Profile.id == t.assigned_to))
            assignee_info = assignee.fetchone()
            assignee_name = assignee_info[0] if assignee_info else None
        
        ticket_data.append({
            "id": t.id,
            "ticket_number": t.ticket_number,
            "subject": t.subject,
            "category": t.category.value if t.category else None,
            "priority": t.priority.value if t.priority else None,
            "status": t.status.value if t.status else None,
            "user_id": t.user_id,
            "user_name": user_info[0] if user_info else None,
            "user_email": user_info[1] if user_info else None,
            "assigned_to": t.assigned_to,
            "assignee_name": assignee_name,
            "sla_due_at": t.sla_due_at.isoformat() if t.sla_due_at else None,
            "is_sla_breached": t.sla_due_at and datetime.now(timezone.utc) > t.sla_due_at and t.status not in [TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED],
            "first_response_at": t.first_response_at.isoformat() if t.first_response_at else None,
            "tags": t.tags or [],
            "created_at": t.created_at.isoformat() if t.created_at else None
        })
    
    return {
        "tickets": ticket_data,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/admin/support/tickets/{ticket_id}")
async def get_ticket_detail(
    ticket_id: str,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get ticket details with messages"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    # Get messages
    msgs_result = await db.execute(
        select(TicketMessage)
        .where(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at)
    )
    messages = msgs_result.scalars().all()
    
    # Get user info
    user = await db.execute(select(Profile).where(Profile.id == ticket.user_id))
    user_info = user.scalar_one_or_none()
    
    message_data = []
    for m in messages:
        sender = await db.execute(select(Profile.full_name, Profile.avatar_url).where(Profile.id == m.sender_id))
        sender_info = sender.fetchone()
        message_data.append({
            "id": m.id,
            "message": m.message,
            "is_internal_note": m.is_internal_note,
            "sender_id": m.sender_id,
            "sender_name": sender_info[0] if sender_info else "System",
            "sender_avatar": sender_info[1] if sender_info else None,
            "attachments": m.attachments or [],
            "created_at": m.created_at.isoformat() if m.created_at else None
        })
    
    return {
        "id": ticket.id,
        "ticket_number": ticket.ticket_number,
        "subject": ticket.subject,
        "description": ticket.description,
        "category": ticket.category.value if ticket.category else None,
        "priority": ticket.priority.value if ticket.priority else None,
        "status": ticket.status.value if ticket.status else None,
        "user": {
            "id": user_info.id if user_info else None,
            "name": user_info.full_name if user_info else None,
            "email": user_info.email if user_info else None,
            "avatar_url": user_info.avatar_url if user_info else None
        },
        "assigned_to": ticket.assigned_to,
        "sla_due_at": ticket.sla_due_at.isoformat() if ticket.sla_due_at else None,
        "first_response_at": ticket.first_response_at.isoformat() if ticket.first_response_at else None,
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "csat_rating": ticket.csat_rating,
        "csat_feedback": ticket.csat_feedback,
        "tags": ticket.tags or [],
        "related_booking_id": ticket.related_booking_id,
        "messages": message_data,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None
    }


@router.put("/admin/support/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    admin_id: str,
    request: UpdateTicketRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update ticket status, priority, assignment"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    updates = {"updated_at": datetime.now(timezone.utc)}
    
    if request.status:
        updates["status"] = TicketStatusEnum(request.status)
        if request.status == "resolved":
            updates["resolved_at"] = datetime.now(timezone.utc)
    
    if request.priority:
        updates["priority"] = TicketPriorityEnum(request.priority)
        updates["sla_due_at"] = calculate_sla_due(TicketPriorityEnum(request.priority))
    
    if request.assigned_to is not None:
        updates["assigned_to"] = request.assigned_to if request.assigned_to else None
    
    if request.tags is not None:
        updates["tags"] = request.tags
    
    await db.execute(update(SupportTicket).where(SupportTicket.id == ticket_id).values(**updates))
    await db.commit()
    
    return {"success": True, "message": "Ticket updated"}


@router.post("/admin/support/tickets/{ticket_id}/reply")
async def reply_to_ticket(
    ticket_id: str,
    admin_id: str,
    request: TicketMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """Add a reply or internal note to a ticket"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    # Create message
    message = TicketMessage(
        ticket_id=ticket_id,
        sender_id=admin_id,
        message=request.message,
        is_internal_note=request.is_internal_note
    )
    db.add(message)
    
    # Update first response time if this is first admin reply
    if not ticket.first_response_at and not request.is_internal_note:
        await db.execute(
            update(SupportTicket)
            .where(SupportTicket.id == ticket_id)
            .values(
                first_response_at=datetime.now(timezone.utc),
                status=TicketStatusEnum.IN_PROGRESS,
                updated_at=datetime.now(timezone.utc)
            )
        )
    
    await db.commit()
    
    return {"success": True, "message_id": message.id}


@router.get("/admin/support/metrics")
async def get_support_metrics(
    admin_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get support metrics: response times, resolution rates, CSAT"""
    await require_admin(admin_id, db)
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Total tickets in period
    total = await db.execute(
        select(func.count(SupportTicket.id))
        .where(SupportTicket.created_at >= start_date)
    )
    total_tickets = total.scalar() or 0
    
    # Open tickets
    open_tickets = await db.execute(
        select(func.count(SupportTicket.id))
        .where(SupportTicket.status.in_([TicketStatusEnum.OPEN, TicketStatusEnum.IN_PROGRESS, TicketStatusEnum.WAITING_USER]))
    )
    open_count = open_tickets.scalar() or 0
    
    # Resolved tickets
    resolved = await db.execute(
        select(func.count(SupportTicket.id))
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.status.in_([TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED])
        ))
    )
    resolved_count = resolved.scalar() or 0
    
    # Avg first response time (in hours)
    avg_response = await db.execute(
        select(func.avg(
            func.extract('epoch', SupportTicket.first_response_at) - 
            func.extract('epoch', SupportTicket.created_at)
        ) / 3600)
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.first_response_at.isnot(None)
        ))
    )
    avg_response_hours = avg_response.scalar() or 0
    
    # Avg resolution time (in hours)
    avg_resolution = await db.execute(
        select(func.avg(
            func.extract('epoch', SupportTicket.resolved_at) - 
            func.extract('epoch', SupportTicket.created_at)
        ) / 3600)
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.resolved_at.isnot(None)
        ))
    )
    avg_resolution_hours = avg_resolution.scalar() or 0
    
    # CSAT average
    csat = await db.execute(
        select(func.avg(SupportTicket.csat_rating))
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.csat_rating.isnot(None)
        ))
    )
    avg_csat = csat.scalar() or 0
    
    # SLA breached count
    sla_breached = await db.execute(
        select(func.count(SupportTicket.id))
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.sla_due_at < datetime.now(timezone.utc),
            SupportTicket.status.notin_([TicketStatusEnum.RESOLVED, TicketStatusEnum.CLOSED])
        ))
    )
    sla_breached_count = sla_breached.scalar() or 0
    
    # By category
    by_category = await db.execute(
        select(SupportTicket.category, func.count(SupportTicket.id))
        .where(SupportTicket.created_at >= start_date)
        .group_by(SupportTicket.category)
    )
    category_breakdown = {row[0].value if row[0] else 'unknown': row[1] for row in by_category.fetchall()}
    
    # By priority
    by_priority = await db.execute(
        select(SupportTicket.priority, func.count(SupportTicket.id))
        .where(SupportTicket.created_at >= start_date)
        .group_by(SupportTicket.priority)
    )
    priority_breakdown = {row[0].value if row[0] else 'unknown': row[1] for row in by_priority.fetchall()}
    
    return {
        "period_days": days,
        "total_tickets": total_tickets,
        "open_tickets": open_count,
        "resolved_tickets": resolved_count,
        "resolution_rate": round((resolved_count / total_tickets * 100) if total_tickets > 0 else 0, 1),
        "avg_first_response_hours": round(float(avg_response_hours), 1),
        "avg_resolution_hours": round(float(avg_resolution_hours), 1),
        "avg_csat": round(float(avg_csat), 1),
        "sla_breached_count": sla_breached_count,
        "by_category": category_breakdown,
        "by_priority": priority_breakdown
    }


# User-facing endpoint to create tickets
@router.post("/support/tickets")
async def create_ticket(
    request: CreateTicketRequest,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new support ticket (user-facing)"""
    ticket_number = await generate_ticket_number(db)
    priority = TicketPriorityEnum(request.priority) if request.priority else TicketPriorityEnum.MEDIUM
    
    ticket = SupportTicket(
        ticket_number=ticket_number,
        user_id=user_id,
        subject=request.subject,
        description=request.description,
        category=TicketCategoryEnum(request.category) if request.category else TicketCategoryEnum.OTHER,
        priority=priority,
        sla_due_at=calculate_sla_due(priority),
        tags=request.tags or [],
        related_booking_id=request.related_booking_id
    )
    
    db.add(ticket)
    await db.commit()
    
    return {"success": True, "ticket_number": ticket_number, "ticket_id": ticket.id}
