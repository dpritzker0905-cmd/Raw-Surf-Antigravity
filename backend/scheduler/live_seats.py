"""Recover live-seat payments missed by the buyer redirect and Stripe webhook."""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from database import async_session_maker
from models import PaymentTransaction

logger = logging.getLogger(__name__)


async def recover_live_seats(maker=async_session_maker):
    from utils.payment_fulfillment import is_live_seat_checkout
    from routes.sessions.payments import settle_live_seat

    tx = PaymentTransaction
    now = datetime.now(timezone.utc)
    stale = now - timedelta(minutes=5)
    last_checked = func.coalesce(tx.updated_at, tx.created_at, datetime(1970, 1, 1, tzinfo=timezone.utc))
    eligible = tx.status.is_distinct_from("verification_required") & or_(
        tx.payment_status.in_(("Pending", "Abandoned")),
        (tx.payment_status == "Completed") & ~tx.transaction_metadata.contains('"settled_participant_id"'),
    )
    async with maker() as db:
        ids = (await db.scalars(select(tx.id).where(
            eligible, tx.transaction_metadata.contains('"live_session_join"'),
            last_checked <= stale,
        ).order_by(last_checked, tx.id).limit(100))).all()

    failures = 0
    for tx_id in ids:
        try:
            async with maker() as db:
                # Rotate attempted rows to the back even on provider failure. A crash
                # after this short claim makes the row eligible again in five minutes.
                claimed = await db.scalar(update(tx).where(
                    tx.id == tx_id, eligible, last_checked <= stale,
                ).values(updated_at=now).returning(tx))
                if claimed is None:
                    continue
                valid = is_live_seat_checkout(claimed)
                checkout_id, buyer_id = claimed.session_id, claimed.user_id
                await db.commit()
                if valid:
                    await settle_live_seat(db, checkout_id, buyer_id, unattended=True)
        except Exception:
            failures += 1
            logger.exception("Could not recover live checkout transaction %s", tx_id)
    if failures:
        raise RuntimeError(f"{failures} live checkout recoveries need retry")
