"""Recover an existing scheduled checkout from the buyer's bookings list."""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.security import get_current_user_id
from database import get_db
from models import Booking, BookingParticipant, CreditTransaction, PaymentTransaction
from utils.credits import refund_credits
from . import stripe_checkout

router = APIRouter()


class CheckoutAction(BaseModel):
    action: Literal["resume", "cancel"]


def _check_booking(booking):
    if booking is None or booking.booking_type not in (None, "scheduled"):
        raise HTTPException(404, "Scheduled checkout not found.")
    if booking.status in ("Confirmed", "Cancelled"):
        return {"status": booking.status}
    if booking.status != "Pending Payment":
        raise HTTPException(409, "This booking is no longer awaiting card checkout.")


def _check_session(session, session_id, booking_id, buyer, amount, currency):
    if not (session.get("id") == session_id and session.get("mode") == "payment"
            and session.get("currency") == currency == "usd"
            and stripe_checkout._booking_session_matches(session, booking_id, buyer, amount)
            and session.amount_total == round(amount * 100)):
        raise HTTPException(409, "Checkout details could not be verified.")


async def _provider_state(action, session_id, booking_id, buyer, amount, currency):
    if not stripe_checkout.STRIPE_API_KEY:
        raise HTTPException(503, "Checkout is temporarily unavailable.")
    timeout = stripe_checkout.CHECKOUT_TIMEOUT_SECONDS
    transport = stripe.HTTPXClient(timeout=timeout)
    try:
        sessions = stripe.StripeClient(stripe_checkout.STRIPE_API_KEY, http_client=transport,
                                      max_network_retries=0).checkout.sessions
        async with asyncio.timeout(timeout):
            session = await sessions.retrieve_async(session_id)
            _check_session(session, session_id, booking_id, buyer, amount, currency)
            if action == "cancel" and (session.get("status"), session.get("payment_status")) == ("open", "unpaid"):
                try:
                    session = await sessions.expire_async(session_id, options={
                        "idempotency_key": f"cancel_scheduled_checkout_{session_id}"})
                except stripe.StripeError:
                    # Expiry can lose to payment or succeed after its response is lost.
                    session = await sessions.retrieve_async(session_id)
                _check_session(session, session_id, booking_id, buyer, amount, currency)
            return session
    except (TimeoutError, stripe.StripeError):
        raise HTTPException(503, "Payment status is unavailable. Try again from Scheduled Bookings.") from None
    finally:
        await transport.close_async()


async def _reservation(db, booking, card_amount):
    participant = (await db.scalars(select(BookingParticipant).where(
        BookingParticipant.booking_id == booking.id, BookingParticipant.participant_id == booking.creator_id
    ))).one_or_none()
    if (participant is None or participant.paid_amount is None or participant.paid_amount < 0
            or participant.paid_amount != round(booking.total_price - card_amount, 2)):
        raise HTTPException(409, "Reserved credits could not be verified.")
    debit_id = None
    if participant.paid_amount:
        debits = (await db.scalars(select(CreditTransaction.id).where(
            CreditTransaction.user_id == booking.creator_id, CreditTransaction.reference_type == "booking",
            CreditTransaction.reference_id == booking.id, CreditTransaction.transaction_type == "booking_payment",
            CreditTransaction.amount == -participant.paid_amount
        ))).all()
        if len(debits) != 1:
            raise HTTPException(409, "Reserved credits could not be verified.")
        debit_id = debits[0]
    return participant, debit_id


async def _cancel_unpaid(db, booking, transaction, participant, debit_id):
    if debit_id is not None:
        ok, _, _ = await refund_credits(booking.creator_id, participant.paid_amount, db,
                                      reference_type="booking", reference_id=booking.id,
                                      original_transaction_id=debit_id, transaction_type="booking_refund",
                                      counterparty_id=booking.photographer_id)
        if not ok:
            raise HTTPException(409, "Reserved credits could not be released.")
    participant.status = "cancelled"
    participant.paid_amount = 0
    participant.payment_status = "Cancelled"
    transaction.status = transaction.payment_status = "expired"
    booking.status = "Cancelled"
    booking.cancelled_at = datetime.now(timezone.utc)
    booking.cancellation_reason = "Buyer cancelled unpaid checkout"
    await db.commit()
    return {"status": "Cancelled"}


@router.post("/bookings/{booking_id}/pending-checkout")
async def recover_pending_checkout(booking_id: str, data: CheckoutAction, buyer: str = Depends(get_current_user_id),
                                   db: AsyncSession = Depends(get_db)):
    owned = select(Booking).where(Booking.id == booking_id, Booking.creator_id == buyer)
    booking = await db.scalar(owned)
    terminal = _check_booking(booking)
    if terminal:
        return terminal
    # Older receipts store the booking ID in text JSON. Ignore malformed unrelated receipts.
    candidates = (await db.execute(select(PaymentTransaction.id, PaymentTransaction.session_id,
        PaymentTransaction.amount, PaymentTransaction.currency, PaymentTransaction.transaction_metadata
    ).where(PaymentTransaction.user_id == buyer, PaymentTransaction.payment_status.in_(("pending", "Pending"))))).all()
    linked = []
    for row in candidates:
        try:
            metadata = json.loads(row.transaction_metadata or "{}")
        except (TypeError, ValueError):
            continue
        if isinstance(metadata, dict) and metadata.get("booking_id") == booking_id:
            linked.append(row)
    if len(linked) != 1:
        raise HTTPException(409, "A unique checkout receipt could not be found.")
    receipt = linked[0]
    await _reservation(db, booking, receipt.amount)
    await db.rollback()  # Release the read transaction and pool connection before provider I/O.
    session = await _provider_state(data.action, receipt.session_id, booking_id, buyer, receipt.amount, receipt.currency)

    try:
        if db.get_bind().dialect.name == "sqlite":
            await db.execute(text("UPDATE bookings SET status = status WHERE 0"))
        # Same order as payment-success. Re-read after remote I/O, including terminal states.
        transaction = await db.scalar(select(PaymentTransaction).where(
            PaymentTransaction.id == receipt.id, PaymentTransaction.user_id == buyer
        ).with_for_update(nowait=True))
        booking = await db.scalar(owned.options(selectinload(Booking.photographer)).with_for_update(of=Booking, nowait=True))
    except DBAPIError as error:
        if (getattr(error.orig, "sqlstate", None) == "55P03"
                or (getattr(error.orig, "sqlite_errorcode", 0) & 255) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)):
            raise HTTPException(503, "Checkout is being updated. Try again.") from None
        raise
    terminal = _check_booking(booking)
    if terminal:
        return terminal
    if (not transaction or transaction.payment_status not in ("pending", "Pending")
            or (transaction.session_id, transaction.amount, transaction.currency, transaction.transaction_metadata)
            != (receipt.session_id, receipt.amount, receipt.currency, receipt.transaction_metadata)):
        raise HTTPException(409, "The checkout receipt changed. Refresh Scheduled Bookings.")
    participant, debit_id = await _reservation(db, booking, transaction.amount)
    state = (session.get("status"), session.get("payment_status"))
    if state == ("complete", "paid"):
        return await stripe_checkout.confirm_verified_booking(db, booking, transaction)
    if data.action == "cancel" and state == ("expired", "unpaid"):
        return await _cancel_unpaid(db, booking, transaction, participant, debit_id)
    deadline = booking.pending_payment_expires_at
    if deadline and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    if data.action == "resume" and (state == ("expired", "unpaid") or
                                    (state == ("open", "unpaid") and deadline and deadline <= datetime.now(timezone.utc))):
        raise HTTPException(409, "Checkout has expired. Cancel checkout to release the booking.")
    if data.action == "resume" and state == ("open", "unpaid"):
        try:
            url = urlsplit(session.get("url") or "")
        except (ValueError, TypeError):
            raise HTTPException(409, "Checkout link is unavailable.") from None
        if url.scheme == "https" and url.hostname and not url.username and not url.password:
            return {"status": "open", "checkout_url": session.url}
    raise HTTPException(409, "Checkout could not be confirmed. Try again from Scheduled Bookings.")
