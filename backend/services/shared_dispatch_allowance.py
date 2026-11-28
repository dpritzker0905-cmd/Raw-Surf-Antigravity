"""Return a shared Quick Book session to its original subscription in the closing transaction."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, BackgroundTasks
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


def checkout_expiration(started):
    # Keep the timestamp stable across retries, including SQLite's naive UTC reads.
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return int((started + timedelta(hours=2)).timestamp())


def find_attempt(provider, dispatch_id, started, now):
    """Search every page in the original attempt window. A partial scan is never proof of absence."""
    end = checkout_expiration(started)
    results = provider.list(limit=100, created={"gte": end - 7500, "lte": end + 300})
    matches = [s for s in results.auto_paging_iter()
               if (s.metadata or {}).get("dispatch_id") == dispatch_id
               and s.metadata.get("type") == "on_demand_dispatch"]
    if len(matches) == 1:
        return matches[0]
    if matches or now.timestamp() < end + 300:
        raise ValueError("Checkout creation is still uncertain")
    return None


def resolve_checkout(provider, row, now):
    if not row.stripe_checkout_session_id and not row.included_checkout_started_at:
        return None
    if provider is None:
        raise ValueError("Provider unavailable")
    linked = row.stripe_checkout_session_id
    checkout = provider.retrieve(linked) if linked else find_attempt(provider, row.id, row.included_checkout_started_at, now)
    if checkout is None and not linked:
        return None
    metadata = checkout.metadata or {}
    if ((linked and checkout.id != linked) or metadata.get("type") != "on_demand_dispatch"
            or metadata.get("dispatch_id") != row.id or metadata.get("user_id") != row.requester_id
            or checkout.currency != "usd" or checkout.amount_total != round(row.captain_share_amount * 100)):
        raise ValueError("Checkout identity or amount does not match")
    if checkout.status == "open":
        session_id = checkout.id
        try:
            checkout = provider.expire(session_id)
        except Exception:
            checkout = provider.retrieve(session_id)  # Payment may have beaten expiry.
        if checkout.id != session_id:
            raise ValueError("Checkout identity changed")
    if (checkout.status, checkout.payment_status) not in {("complete", "paid"), ("expired", "unpaid")}:
        raise ValueError("Checkout outcome is still uncertain")
    return checkout


async def expire_due_included_sessions(maker, provider, now):
    """Resolve the provider outcome outside the closing transaction, then lock and recheck."""
    from routes.dispatch.dispatch_matching import settle_paid_dispatch

    due = (DispatchRequest.included_subscription_id.is_not(None), DispatchRequest.included_session_restored_at.is_(None),
           DispatchRequest.status == Status.PENDING_PAYMENT, DispatchRequest.deposit_paid.is_(False),
           DispatchRequest.pending_payment_expires_at <= now)
    async with maker() as db:
        candidates = (await db.execute(select(DispatchRequest.id, DispatchRequest.requester_id,
            DispatchRequest.captain_share_amount, DispatchRequest.stripe_checkout_session_id,
            DispatchRequest.included_checkout_started_at).where(*due))).all()
    for row in candidates:
        try:
            checkout = await asyncio.to_thread(resolve_checkout, provider, row, now)
            tasks = BackgroundTasks()
            async with maker() as db:
                dispatch = await db.scalar(select(DispatchRequest).where(
                    DispatchRequest.id == row.id, *due,
                    DispatchRequest.stripe_checkout_session_id == row.stripe_checkout_session_id,
                    DispatchRequest.included_checkout_started_at == row.included_checkout_started_at,
                ).with_for_update())
                if dispatch is None:
                    continue
                if checkout and checkout.payment_status == "paid":
                    await settle_paid_dispatch(db, dispatch, checkout.id, checkout, tasks)
                else:
                    await return_included_session(db, dispatch, now)
                    if checkout:
                        dispatch.stripe_checkout_session_id = checkout.id
                        await mark_checkout_expired(db, checkout.id)
                    dispatch.status = Status.CANCELLED
                    dispatch.cancelled_at = dispatch.status_changed_at = now
                    dispatch.cancellation_reason = "Payment deadline expired"
                    await db.commit()
            await tasks()
        except Exception as error:
            logger.warning("Deferring Quick Book reconciliation for %s (%s)", row.id, type(error).__name__)
