"""Recover live-seat payments missed by the buyer redirect and Stripe webhook."""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from database import async_session_maker
from models import PaymentTransaction
from services.live_seat_queue import last_checked, needs_recovery, pending_seat_ids

logger = logging.getLogger(__name__)


async def recover_live_seats(maker=async_session_maker):
    from utils.payment_fulfillment import is_live_seat_checkout
    from routes.sessions.payments import settle_live_seat

    tx = PaymentTransaction
    now = datetime.now(timezone.utc)
    stale = now - timedelta(minutes=5)
    async with maker() as db:
        ids = (await db.scalars(pending_seat_ids(tx, stale))).all()

    failures = 0
    for tx_id in ids:
        try:
            async with maker() as db:
                # Rotate attempted rows to the back even on provider failure. A crash
                # after this short claim makes the row eligible again in five minutes.
                claimed = await db.scalar(update(tx).where(
                    tx.id == tx_id, needs_recovery(tx), last_checked(tx) <= stale,
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
