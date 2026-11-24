"""Ticket creation for support requests and verified live-seat reviews."""
import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from models import SupportTicket, TicketCategoryEnum, TicketPriorityEnum
from services.support_delivery import queue_support_creation_notice, support_request_id


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


async def paid_seat_ticket(db, tx):
    """Called with the checkout locked. The ticket and payment review commit together."""
    ticket_id = support_request_id("paid-seat", tx.user_id, tx.id)
    existing = await db.get(SupportTicket, ticket_id)
    if existing is not None:
        if existing.user_id != tx.user_id or existing.related_transaction_id != tx.id:
            raise RuntimeError("Support case does not match the payment")
        return ticket_id

    priority = TicketPriorityEnum.HIGH
    db.add(SupportTicket(
        id=ticket_id, ticket_number=await generate_ticket_number(db), user_id=tx.user_id,
        related_transaction_id=tx.id, category=TicketCategoryEnum.BILLING, priority=priority,
        sla_due_at=calculate_sla_due(priority), tags=["live-seat", "paid-review"],
        subject="Paid for a live session but did not receive a seat",
        description=(f"We received your payment of {tx.amount:.2f} {tx.currency.upper()}. "
                     "Your original live session could not be confirmed. Support will follow up "
                     "in this ticket. Please do not pay again for this session."),
    ))
    await db.flush()
    await queue_support_creation_notice(db, ticket_id, tx.user_id)
    return ticket_id


def is_paid_seat_review(tx, metadata):
    return (
        tx.status == "review_required" and tx.payment_status in ("Paid", "paid")
        and isinstance(metadata, dict) and metadata.get("type") == "live_session_join"
        and metadata.get("review_reason") in (
            "original_session_unavailable", "missing_original_session", "refund_unconfirmed",
            "checkout_mismatch", "unverified_binding", "missing_seat_receipt",
        )
    )
