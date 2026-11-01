"""
Admin Support Ticketing System
- Centralized ticket management
- Ticket routing, prioritization, SLA tracking
- Response time metrics and CSAT tracking
"""
from fastapi import APIRouter, Depends, HTTPException
from core.security import get_current_user_id, get_user_id_from_jwt_or_query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import secrets
import re
import hashlib
import json

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, SupportTicket, TicketMessage, 
    TicketCategoryEnum, TicketPriorityEnum, TicketStatusEnum
)
from services.support_delivery import save_support_message, queue_support_reply_notice, queue_support_creation_notice, support_request_id



router = APIRouter()


# --- Pydantic Models ---
class CreateTicketRequest(BaseModel):
    subject: str
    description: str
    category: Optional[str] = "other"
    priority: Optional[str] = "medium"
    related_booking_id: Optional[str] = None
    tags: Optional[List[str]] = []
    client_request_id: Optional[str] = None

class TicketMessageRequest(BaseModel):
    message: str
    is_internal_note: Optional[bool] = False
    client_message_id: Optional[str] = None


class OwnerMessageRequest(BaseModel):
    message: str
    client_message_id: str

    model_config = {"extra": "forbid"}

class UpdateTicketRequest(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None


# --- Helper Functions ---
async def generate_ticket_number(db: AsyncSession) -> str:
    return f"TKT-{secrets.token_hex(8).upper()}"

def calculate_sla_due(priority: TicketPriorityEnum, origin=None) -> datetime:
    origin = origin if origin is not None else datetime.now(timezone.utc)
    hours = {
        TicketPriorityEnum.URGENT: 1,
        TicketPriorityEnum.HIGH: 4,
        TicketPriorityEnum.MEDIUM: 24,
        TicketPriorityEnum.LOW: 72
    }
    return origin + timedelta(hours=hours.get(priority, 24))


def creation_request_fingerprint(user_id, request, category, priority):
    """Version-one exact creation intent, independent of later staff edits."""
    intent = [1, user_id, request.subject, request.description, category.value, priority.value,
              request.tags or [], request.related_booking_id]
    encoded = json.dumps(intent, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


# --- Endpoints ---
@router.get("/admin/support/tickets")
async def get_support_tickets(
    admin: Profile = Depends(get_current_admin),
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
    
    query = select(SupportTicket).order_by(desc(SupportTicket.created_at), desc(SupportTicket.id))
    
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
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get ticket details with messages"""
    
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
    request: UpdateTicketRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update ticket status, priority, assignment"""
    
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    updates = {"updated_at": datetime.now(timezone.utc)}
    
    if request.status:
        updates["status"] = TicketStatusEnum(request.status)
        if request.status == "resolved":
            updates["resolved_at"] = datetime.now(timezone.utc)
        elif request.status != "closed":
            updates["resolved_at"] = None
    
    if request.priority:
        if ticket.created_at is None:
            raise HTTPException(status_code=409, detail="Ticket creation time unavailable; SLA requires review")
        updates["priority"] = TicketPriorityEnum(request.priority)
        updates["sla_due_at"] = calculate_sla_due(TicketPriorityEnum(request.priority), ticket.created_at)
    
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
    request: TicketMessageRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Add a reply or internal note to a ticket"""
    
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id).with_for_update())
    ticket = result.scalar_one_or_none()
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    message_id, created = await save_support_message(
        db, ticket_id, admin.id, request.message, request.is_internal_note, request.client_message_id)
    if not created:
        return {"success": True, "message_id": message_id, "duplicate": True}
    
    # Update first response time if this is first admin reply
    if not ticket.first_response_at and not request.is_internal_note:
        await db.execute(
            update(SupportTicket)
            .where(SupportTicket.id == ticket_id, SupportTicket.first_response_at.is_(None))
            .values(
                first_response_at=datetime.now(timezone.utc),
                status=TicketStatusEnum.IN_PROGRESS,
                resolved_at=None,
                updated_at=datetime.now(timezone.utc)
            )
        )
    
    email_notice = "internal_note"
    if not request.is_internal_note:
        email_notice = await queue_support_reply_notice(db, ticket, message_id)
    await db.commit()
    
    return {"success": True, "message_id": message_id, "email_notice": email_notice}


@router.get("/admin/support/metrics")
async def get_support_metrics(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get support metrics: response times, resolution rates, CSAT"""
    
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
    response_seconds = (
        func.extract('epoch', SupportTicket.first_response_at) -
        func.extract('epoch', SupportTicket.created_at)
    )
    avg_response = await db.execute(
        select(func.avg(response_seconds) / 3600, func.count(response_seconds))
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.first_response_at.isnot(None)
        ))
    )
    avg_response_hours, response_sample_count = avg_response.one()
    avg_response_hours = avg_response_hours or 0
    
    # Avg resolution time (in hours)
    resolution_seconds = (
        func.extract('epoch', SupportTicket.resolved_at) -
        func.extract('epoch', SupportTicket.created_at)
    )
    avg_resolution = await db.execute(
        select(func.avg(resolution_seconds) / 3600, func.count(resolution_seconds))
        .where(and_(
            SupportTicket.created_at >= start_date,
            SupportTicket.resolved_at.isnot(None)
        ))
    )
    avg_resolution_hours, resolution_sample_count = avg_resolution.one()
    avg_resolution_hours = avg_resolution_hours or 0
    
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
        "first_response_sample_count": int(response_sample_count),
        "resolution_sample_count": int(resolution_sample_count),
        "avg_csat": round(float(avg_csat), 1),
        "sla_breached_count": sla_breached_count,
        "by_category": category_breakdown,
        "by_priority": priority_breakdown
    }


# User-facing endpoint to create tickets
@router.post("/support/tickets")
async def create_ticket(
    request: CreateTicketRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_user_id_from_jwt_or_query)
):
    """Create a new support ticket (user-facing)"""
    priority = TicketPriorityEnum(request.priority) if request.priority else TicketPriorityEnum.MEDIUM
    category = TicketCategoryEnum(request.category) if request.category else TicketCategoryEnum.OTHER
    insert_ticket = {"postgresql": pg_insert, "sqlite": sqlite_insert}[db.get_bind().dialect.name]
    request_id = support_request_id("create", user_id, request.client_request_id) if request.client_request_id else None
    fingerprint = creation_request_fingerprint(user_id, request, category, priority) if request_id else None

    async def existing_request():
        existing = (await db.execute(select(SupportTicket).where(SupportTicket.id == request_id))).scalar_one_or_none()
        if existing is None:
            return None
        if existing.creation_request_fingerprint is not None:
            same_intent = existing.user_id == user_id and existing.creation_request_fingerprint == fingerprint
        else:
            # Legacy rows have no recoverable original priority/tags; retain their conservative comparison.
            same_intent = (existing.user_id, existing.subject, existing.description, existing.category, existing.priority,
                           existing.tags, existing.related_booking_id) == (
                           user_id, request.subject, request.description, category, priority, request.tags or [], request.related_booking_id)
        if not same_intent:
            raise HTTPException(status_code=409, detail="Ticket request ID already used for different content")
        return {"success": True, "ticket_number": existing.ticket_number, "ticket_id": existing.id}

    if request_id:
        original = await existing_request()
        if original:
            return original

    for _ in range(3):
        ticket_number = await generate_ticket_number(db)
        statement = insert_ticket(SupportTicket).values(
                ticket_number=ticket_number,
                user_id=user_id,
                subject=request.subject,
                description=request.description,
                category=category,
                priority=priority,
                sla_due_at=calculate_sla_due(priority),
                tags=request.tags or [],
                related_booking_id=request.related_booking_id,
                **({"id": request_id, "creation_request_fingerprint": fingerprint} if request_id else {})
            )
        statement = statement.on_conflict_do_nothing() if request_id else statement.on_conflict_do_nothing(index_elements=[SupportTicket.ticket_number])
        result = await db.execute(statement.returning(SupportTicket.id))
        ticket_id = result.scalar_one_or_none()
        if ticket_id is not None:
            await queue_support_creation_notice(db, ticket_id, user_id)
            await db.commit()
            return {"success": True, "ticket_number": ticket_number, "ticket_id": ticket_id}
        if request_id:
            original = await existing_request()
            if original:
                return original

    raise HTTPException(status_code=503, detail="Unable to allocate a ticket number. Please retry.")


def public_ticket(ticket):
    return {
        "id": ticket.id, "ticket_number": ticket.ticket_number, "subject": ticket.subject,
        "status": ticket.status.value if ticket.status else None,
        "priority": ticket.priority.value if ticket.priority else None,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
    }


async def owned_ticket(db, ticket_id, user_id, lock=False):
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", ticket_id, re.IGNORECASE):
        ticket_id = ticket_id.lower()
    query = select(SupportTicket).where(SupportTicket.id == ticket_id, SupportTicket.user_id == user_id)
    if lock:
        query = query.with_for_update()
    ticket = (await db.execute(query)).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


@router.get("/support/tickets")
async def get_my_support_tickets(
    limit: int = 50, offset: int = 0,
    user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)
):
    limit, offset = max(1, min(limit, 50)), max(0, offset)
    owner = SupportTicket.user_id == user_id
    total = (await db.execute(select(func.count(SupportTicket.id)).where(owner))).scalar_one()
    rows = (await db.execute(select(SupportTicket).where(owner).order_by(
        desc(SupportTicket.created_at), desc(SupportTicket.id)).offset(offset).limit(limit))).scalars().all()
    return {"tickets": [public_ticket(ticket) for ticket in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/support/tickets/{ticket_id}")
async def get_my_support_ticket(
    ticket_id: str, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)
):
    ticket = await owned_ticket(db, ticket_id, user_id)
    rows = (await db.execute(select(TicketMessage).where(
        TicketMessage.ticket_id == ticket.id, TicketMessage.is_internal_note.is_(False)
    ).order_by(TicketMessage.created_at, TicketMessage.id))).scalars().all()
    return {**public_ticket(ticket), "description": ticket.description, "messages": [
        {"id": message.id, "message": message.message, "from_support": message.sender_id != ticket.user_id,
         "created_at": message.created_at.isoformat() if message.created_at else None} for message in rows
    ]}


@router.post("/support/tickets/{ticket_id}/messages")
async def reply_to_my_support_ticket(
    ticket_id: str, request: OwnerMessageRequest,
    user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)
):
    ticket = await owned_ticket(db, ticket_id, user_id, lock=True)
    text = request.message.strip()
    if not text or len(text) > 10000:
        raise HTTPException(status_code=422, detail="Reply must contain 1 to 10000 characters")
    message_id, created = await save_support_message(db, ticket.id, user_id, text, False, request.client_message_id)
    if created:
        await db.execute(update(SupportTicket).where(SupportTicket.id == ticket.id).values(updated_at=datetime.now(timezone.utc)))
        await db.commit()
    return {"success": True, "message_id": message_id, "duplicate": not created}
