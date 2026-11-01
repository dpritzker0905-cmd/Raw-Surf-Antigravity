"""Public support messages and transactional, content-free owner notices. No provider I/O here."""
import json
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from models import Notification, NotificationPreferences, Profile, TicketMessage
from services.mailer import enqueue_email


def support_request_id(kind, owner_id, request_id):
    try:
        request_id = str(uuid.UUID(request_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid support request ID")
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"support:{kind}:{owner_id}:{request_id}"))


async def save_support_message(db, ticket_id, sender_id, text, internal=False, client_message_id=None):
    if client_message_id:
        try:
            request_id = str(uuid.UUID(client_message_id))
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=422, detail="Invalid message request ID")
        message_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"support:{ticket_id}:{sender_id}:{request_id}"))
    else:
        message_id = str(uuid.uuid4())
    insert = {"postgresql": pg_insert, "sqlite": sqlite_insert}[db.get_bind().dialect.name]
    result = await db.execute(insert(TicketMessage).values(
        id=message_id, ticket_id=ticket_id, sender_id=sender_id, message=text,
        is_internal_note=bool(internal),
    ).on_conflict_do_nothing(index_elements=[TicketMessage.id]).returning(TicketMessage.id))
    if result.scalar_one_or_none() is not None:
        return message_id, True
    existing = (await db.execute(select(TicketMessage).where(TicketMessage.id == message_id))).scalar_one()
    if (existing.ticket_id, existing.sender_id, existing.message, existing.is_internal_note) != (
            ticket_id, sender_id, text, bool(internal)):
        raise HTTPException(status_code=409, detail="Message request ID already used for different content")
    return message_id, False


async def queue_support_reply_notice(db, ticket, message_id):
    """Caller commits message, owner notification and outbox together. Defaults preserve email opt-in."""
    prefs = (await db.execute(select(NotificationPreferences).where(
        NotificationPreferences.user_id == ticket.user_id))).scalar_one_or_none()
    if prefs is None or prefs.push_messages:
        db.add(Notification(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, "support_notice:" + message_id)),
            user_id=ticket.user_id, type="support_reply", title="New support reply",
            body="Open your support ticket to read the reply.",
            data=json.dumps({"ticket_id": ticket.id, "message_id": message_id, "recipient_id": ticket.user_id}),
        ))
    return await _queue_owner_email(db, ticket.user_id, ticket.id, prefs, "support_reply", "support_reply:" + message_id)


async def queue_support_creation_notice(db, ticket_id, user_id):
    """Queue one generic receipt in the new ticket's transaction, preserving email opt-in."""
    prefs = (await db.execute(select(NotificationPreferences).where(
        NotificationPreferences.user_id == user_id))).scalar_one_or_none()
    return await _queue_owner_email(db, user_id, ticket_id, prefs, "support_created", "support_created:" + ticket_id)


async def _queue_owner_email(db, user_id, ticket_id, prefs, template, key):
    if prefs is None or not prefs.email_messages:
        return "opted_out"
    owner = (await db.execute(select(Profile).where(Profile.id == user_id))).scalar_one_or_none()
    if owner is None or not owner.email:
        return "unavailable"
    queued = await enqueue_email(db, template, owner.email, {"ticket_id": ticket_id}, idempotency_key=key)
    if queued.status == "duplicate" and not queued.outbox_id:
        raise RuntimeError("Support email enqueue failed")
    return queued.status
