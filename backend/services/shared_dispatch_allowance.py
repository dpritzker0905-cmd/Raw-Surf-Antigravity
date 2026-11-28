"""Return a shared Quick Book session to its original subscription in the closing transaction."""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update

from models import DispatchRequest, DispatchRequestStatusEnum as Status, PaymentTransaction, SurferPhotoSubscription
from utils.checkout_recovery import _close_untracked_checkout

logger = logging.getLogger(__name__)


def payment_deadline_passed(dispatch):
    deadline = dispatch.pending_payment_expires_at
    if deadline is None:
        return False
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return deadline <= datetime.now(timezone.utc)


async def return_included_session(db, dispatch, now):
    """Caller owns the dispatch lock. An atomic claim also guards repeated calls in the transaction."""
    if not dispatch.included_subscription_id:
        return
    source = await db.scalar(update(DispatchRequest).where(
        DispatchRequest.id == dispatch.id,
        DispatchRequest.included_session_restored_at.is_(None),
    ).values(included_session_restored_at=now).returning(DispatchRequest.included_subscription_id))
    if source is not None:
        result = await db.execute(update(SurferPhotoSubscription).where(
            SurferPhotoSubscription.id == source
        ).values(sessions_remaining=SurferPhotoSubscription.sessions_remaining + 1))
        if result.rowcount != 1:
            raise RuntimeError("Original subscription unavailable during session restoration")


async def mark_checkout_expired(db, session_id):
    await db.execute(update(PaymentTransaction).where(
        PaymentTransaction.session_id == session_id, PaymentTransaction.payment_status == "Pending",
    ).values(payment_status="Expired", status="Expired"))


async def cancel_included_session(db, dispatch, now):
    """A request with an open card checkout may still collect a payment."""
    if not dispatch.included_subscription_id:
        return
    linked = dispatch.stripe_checkout_session_id
    if dispatch.status == Status.PENDING_PAYMENT and dispatch.included_checkout_started_at and not linked:
        raise HTTPException(409, "Card checkout is still being reconciled. No session has been returned.")
    if dispatch.status == Status.PENDING_PAYMENT and linked:
        if not await asyncio.to_thread(_close_untracked_checkout, linked):
            raise HTTPException(409, "Card checkout has not confirmed cancellation. Please check its payment status.")
        await mark_checkout_expired(db, linked)
    await return_included_session(db, dispatch, now)


async def expire_due_included_sessions(maker, read_checkout, now):
    """Probe outside the write transaction, then recheck deadline, status and checkout under lock."""
    due = (
        DispatchRequest.included_subscription_id.is_not(None),
        DispatchRequest.included_session_restored_at.is_(None),
        DispatchRequest.status == Status.PENDING_PAYMENT,
        DispatchRequest.deposit_paid.is_(False),
        # A lost provider response can leave a real checkout without a local session ID.
        DispatchRequest.included_checkout_started_at.is_(None) | DispatchRequest.stripe_checkout_session_id.is_not(None),
        DispatchRequest.pending_payment_expires_at <= now,
    )
    async with maker() as db:
        candidates = (await db.execute(select(DispatchRequest.id, DispatchRequest.stripe_checkout_session_id)
                                       .where(*due))).all()
    for dispatch_id, linked in candidates:
        if linked:
            if read_checkout is None:
                continue
            try:
                checkout = await asyncio.to_thread(read_checkout, linked)
            except Exception as error:
                logger.warning("Deferring Quick Book expiry for %s (%s)", dispatch_id, type(error).__name__)
                continue
            if (getattr(checkout, "id", None) != linked or getattr(checkout, "status", None) != "expired"
                    or getattr(checkout, "payment_status", None) != "unpaid"):
                continue
        async with maker.begin() as db:
            dispatch = await db.scalar(select(DispatchRequest).where(
                DispatchRequest.id == dispatch_id, DispatchRequest.stripe_checkout_session_id == linked, *due,
            ).with_for_update())
            if dispatch is None:
                continue
            await return_included_session(db, dispatch, now)
            if linked:
                await mark_checkout_expired(db, linked)
            dispatch.status = Status.CANCELLED
            dispatch.cancelled_at = dispatch.status_changed_at = now
            dispatch.cancellation_reason = "Payment deadline expired"
