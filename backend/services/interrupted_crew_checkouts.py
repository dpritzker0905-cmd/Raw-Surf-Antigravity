"""Close outstanding guest checkouts after a shared session is interrupted."""
import asyncio
import logging
import os

import stripe
from sqlalchemy import select

from models import DispatchRequest, DispatchRequestParticipant, PaymentTransaction
from services.shared_quick_book_hold import PENDING_SETTLEMENT
from utils.crew_card_fulfillment import crew_card_metadata, fulfill_crew_card_payment, valid_crew_receipt

logger = logging.getLogger(__name__)


def _test_mode_key():
    # Crew checkout creation is test-mode only. Bind each request to the same account explicitly.
    key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY") or ""
    return key if key.startswith(("sk_test_", "rk_test_")) else None


async def close_after_hold(maker, dispatch_id):
    try:
        await asyncio.wait_for(close_interrupted_checkouts(maker, dispatch_id), timeout=3)
    except Exception as error:
        # The hold is already durable. The periodic sweep retries outstanding receipts.
        logger.warning("Checkout closure deferred after interruption: %s", type(error).__name__)


async def close_interrupted_checkouts(maker, dispatch_id=None):
    key = _test_mode_key()
    if not key:
        return
    async with maker() as db:
        query = (select(PaymentTransaction, DispatchRequest.id, DispatchRequestParticipant.id)
                 .select_from(DispatchRequest)
                 .join(DispatchRequestParticipant, DispatchRequestParticipant.dispatch_request_id == DispatchRequest.id)
                 .join(PaymentTransaction, PaymentTransaction.user_id == DispatchRequestParticipant.participant_id)
                 .where(DispatchRequest.refund_type == PENDING_SETTLEMENT,
                        PaymentTransaction.status == "pending",
                        PaymentTransaction.transaction_metadata.contains(DispatchRequestParticipant.id)))
        if dispatch_id is not None:
            query = query.where(DispatchRequest.id == dispatch_id)
        candidates = (await db.execute(query)).all()

    for tx, did, seat in candidates:
        try:
            receipt = crew_card_metadata(tx)
            if (receipt.get("dispatch_id") != did or receipt.get("participant_id") != seat
                    or not valid_crew_receipt(tx, receipt)):
                continue
            # No database transaction spans provider I/O. Only close a matching open, unpaid checkout.
            session = await asyncio.to_thread(stripe.checkout.Session.retrieve, tx.session_id, api_key=key)
            metadata = getattr(session, "metadata", None) or {}
            if (session.id != tx.session_id or getattr(session, "livemode", None) is not False
                    or getattr(session, "mode", None) != "payment"
                    or getattr(session, "currency", None) != receipt["currency"]
                    or getattr(session, "amount_total", None) != receipt["amount_cents"]
                    or any(metadata.get(k) != str(receipt[k]) for k in
                           ("type", "version", "dispatch_id", "participant_id", "payer_id", "amount_cents", "currency"))):
                continue
            if session.status == "open" and session.payment_status == "unpaid":
                session = await asyncio.to_thread(stripe.checkout.Session.expire, tx.session_id, api_key=key)
            if session.id != tx.session_id or getattr(session, "livemode", None) is not False:
                continue
            if session.status not in ("complete", "expired"):
                continue
            async with maker.begin() as db:
                locked = await db.get(PaymentTransaction, tx.id, with_for_update=True)
                if locked and locked.status == "pending" and locked.session_id == tx.session_id:
                    await fulfill_crew_card_payment(db, locked, checkout=session)
        except Exception as error:
            # The durable hold and pending receipt are picked up on the next cleanup pass.
            logger.warning("Interrupted crew checkout deferred: receipt=%s error=%s", tx.id, type(error).__name__)
