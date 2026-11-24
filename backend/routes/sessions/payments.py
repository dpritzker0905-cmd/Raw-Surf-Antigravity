"""Sessions payments â€” complete payment flow."""
import asyncio
import json
import logging
import os
import stripe
import stripe_mcp_server
import sqlite3
from uuid import uuid4
from fastapi import Depends, HTTPException, APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from core.security import dev_identity_allowed, get_current_user_id
from models import Notification, Profile
from models import LiveSession, LiveSessionParticipant, PaymentTransaction
from services.support_tickets import is_paid_seat_review, paid_seat_ticket
from services import live_session_escrow
from utils.credits import clean_amount
from .join import CompletePaymentRequest
from utils.live_buyin import current_live_session
from .card_session import REVIEW_MESSAGE

STRIPE_API_KEY = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY
logger = logging.getLogger(__name__)

router = APIRouter()


async def save_paid_seat_review(db, tx):
    try:
        ticket_id = await paid_seat_ticket(db, tx)
        await db.commit()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not confirm the payment review. Check with support before paying again.") from exc
    return JSONResponse(status_code=409, content={"detail": REVIEW_MESSAGE, "support_ticket_id": ticket_id})


async def mark_paid_seat_review(db, tx, metadata, reason):
    tx.payment_status = "Paid"
    tx.status = "review_required"
    tx.transaction_metadata = json.dumps({**metadata, "review_reason": reason})
    return await save_paid_seat_review(db, tx)


async def refund_live_seat(db, tx, metadata, checkout_id, intent, emulated):
    """Called while holding the checkout lock, before any seat commit."""
    try:
        if emulated:
            refund = stripe_mcp_server.stripe_refund_payment(intent)
            succeeded = refund.get("status") == "succeeded"
        else:
            refund = await asyncio.to_thread(
                stripe.Refund.create, payment_intent=intent,
                idempotency_key=f"live-session-refund-{checkout_id}",
            )
            succeeded = refund.status == "succeeded"
    except Exception:
        logger.exception("Live session refund could not be confirmed")
        succeeded = False
    try:
        if not succeeded:
            await db.refresh(tx)
            return await mark_paid_seat_review(db, tx, metadata, "refund_unconfirmed")
        tx.payment_status = tx.status = "Refunded"
        await db.commit()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not confirm the payment outcome. Contact support before paying again.") from exc
    return None


def checkout_emulation_allowed() -> bool:
    """Whether the local checkout emulator may stand in for Stripe verification.

    Only in a process that positively identifies itself as local or test (the same fail-closed
    signal the development identity uses) and never with a live key. Everywhere else a checkout
    session is verified with Stripe, whatever its id looks like.
    """
    key = STRIPE_API_KEY or ""
    return dev_identity_allowed() and not key.startswith(("sk_live_", "rk_live_"))


@router.post("/sessions/complete-payment")
async def complete_session_payment(
    data: CompletePaymentRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await settle_live_seat(db, data.checkout_session_id, current_user_id)


async def settle_live_seat(db, checkout_id, current_user_id, *, unattended=False):
    """Verify the saved buyer's checkout and serialize all fulfillment on its row."""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Payment processing not configured")

    # Only the surfer who started this checkout may complete it; checked before any verification.
    owner_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == checkout_id)
    )
    owner_tx = owner_result.scalar_one_or_none()
    if not owner_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if owner_tx.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot complete another user's payment")

    try:
        saved_checkout = json.loads(owner_tx.transaction_metadata or "{}")
    except (TypeError, ValueError):
        raise HTTPException(status_code=409, detail="Invalid saved checkout")
    if not isinstance(saved_checkout, dict):
        raise HTTPException(status_code=409, detail="Invalid saved checkout")
    provider = saved_checkout.get("checkout_provider")
    if unattended and (provider == "emulator" or saved_checkout.get("emulator_payment_intent")):
        return {"status": "local_checkout"}
    used_emulator = (
        not unattended
        and checkout_emulation_allowed()
        and (provider == "emulator" or (provider is None and checkout_id.startswith("cs_test_")))
    )
    if provider == "emulator" and not used_emulator:
        raise HTTPException(status_code=409, detail="Test checkout must be restarted")
    payment_intent_id = None
    refund_successful = False
    
    try:
        if used_emulator:
            # Emulate checkout retrieve through mock stripe-mcp server tool path
            payment_status = 'paid'
            
            # Look up surfer and photographer details from our PaymentTransaction table first
            # since it contains transaction_metadata
            tx_lookup = await db.execute(
                select(PaymentTransaction).where(PaymentTransaction.session_id == checkout_id)
            )
            tx_record = tx_lookup.scalar_one_or_none()
            
            if not tx_record or not tx_record.transaction_metadata:
                raise HTTPException(status_code=404, detail="Transaction details not found in PaymentTransaction")
                
            metadata = json.loads(tx_record.transaction_metadata)
            
            payment_intent_id = metadata.get("emulator_payment_intent")
            if not payment_intent_id:
                raise HTTPException(status_code=409, detail="Test checkout must be restarted")

            from contextlib import closing

            with closing(sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)) as conn, conn:
                settled = conn.execute(
                    "UPDATE stripe_payments SET status = 'succeeded' WHERE payment_intent_id = ? "
                    "AND status IN ('requires_payment_method', 'succeeded')",
                    (payment_intent_id,),
                )
                if settled.rowcount != 1:
                    raise HTTPException(status_code=400, detail="Test payment is unavailable")

            # Create a mock session object
            class MockSession:
                def __init__(self, metadata, payment_status, payment_intent):
                    self.metadata = metadata
                    self.payment_status = payment_status
                    self.payment_intent = payment_intent
            checkout_session = MockSession(metadata, payment_status, payment_intent_id)
        else:
            # Retrieve the Stripe checkout session
            checkout_session = await asyncio.to_thread(stripe.checkout.Session.retrieve, checkout_id)
            
            if checkout_session.payment_status != 'paid':
                if unattended:
                    if getattr(checkout_session, "status", None) == "expired":
                        await db.execute(update(PaymentTransaction).where(
                            PaymentTransaction.session_id == checkout_id,
                            PaymentTransaction.user_id == current_user_id,
                            PaymentTransaction.payment_status.in_(("Pending", "Abandoned")),
                        ).values(payment_status="Expired", status="Expired"))
                        await db.commit()
                    return {"status": "unpaid"}
                raise HTTPException(status_code=400, detail="Payment not completed")
                
            payment_intent_id = getattr(checkout_session, 'payment_intent', None)
            if not payment_intent_id and isinstance(checkout_session, dict):
                payment_intent_id = checkout_session.get("payment_intent")
        
        # ============ ATOMIC IDEMPOTENCY CHECK WITH ROW LOCK ============
        # Use FOR UPDATE to lock the row while we check and update status
        # This prevents concurrent requests from both passing the check
        tx_result = await db.execute(
            select(PaymentTransaction)
            .where(PaymentTransaction.session_id == checkout_id)
            .with_for_update().execution_options(populate_existing=True)
        )
        tx = tx_result.scalar_one_or_none()
        if tx is None:
            raise HTTPException(status_code=409, detail="Could not confirm the saved checkout")
        locked_checkout = json.loads(tx.transaction_metadata or "{}")
        
        if tx.user_id != current_user_id:
            raise HTTPException(status_code=403, detail="Cannot complete another user's payment")
        if locked_checkout.get("type") != "live_session_join":
            raise HTTPException(status_code=409, detail="Invalid saved live checkout")
        # If already completed, return success (idempotent)
        if tx.payment_status == 'Completed':
            receipt = {"success": True, "message": "Session already activated"}
            participant_id = locked_checkout.get("settled_participant_id")
            if not participant_id:
                return await mark_paid_seat_review(db, tx, locked_checkout, "missing_seat_receipt")
            receipt["session_id"] = participant_id
            return receipt
            
        # If already refunded, raise error
        if tx.payment_status == 'Refunded':
            if unattended:
                return {"status": "refunded"}
            raise HTTPException(status_code=400, detail="Payment has been refunded")
        if tx.status == 'review_required':
            if is_paid_seat_review(tx, locked_checkout):
                return await save_paid_seat_review(db, tx)
            raise HTTPException(status_code=409, detail=REVIEW_MESSAGE)
        metadata = checkout_session.metadata or {}
        surfer_id = metadata.get("surfer_id")
        photographer_id = metadata.get("photographer_id")
        amount = clean_amount(metadata.get("amount"))
        bound_session_id = locked_checkout.get("live_session_id")
        provider = locked_checkout.get("checkout_provider")
        if not used_emulator and provider != "stripe":
            return await mark_paid_seat_review(db, tx, locked_checkout, "unverified_binding")
        if (
            metadata.get("type") != "live_session_join"
            or surfer_id != current_user_id or not photographer_id or amount is None
            or photographer_id != locked_checkout.get("photographer_id")
            or bound_session_id != metadata.get("live_session_id")
        ):
            return await mark_paid_seat_review(db, tx, locked_checkout, "checkout_mismatch")
        if provider == "stripe" and (
            checkout_session.id != checkout_id
            or checkout_session.mode != "payment"
            or not locked_checkout.get("checkout_reference")
            or checkout_session.client_reference_id != locked_checkout["checkout_reference"]
            or checkout_session.amount_total != int(round(amount * 100))
            or amount != clean_amount(tx.amount)
            or checkout_session.currency != tx.currency
            or not isinstance(payment_intent_id, str) or not payment_intent_id
        ):
            return await mark_paid_seat_review(db, tx, locked_checkout, "checkout_mismatch")

        if not used_emulator:
            # A paid Checkout Session stays paid even after a refund. Recheck the
            # intent under the checkout lock before granting a fresh seat.
            refunds = await asyncio.to_thread(stripe.Refund.list, payment_intent=payment_intent_id, limit=1)
            if refunds.data:
                return await mark_paid_seat_review(db, tx, locked_checkout, "refund_unconfirmed")

        # Lock in the same order on each completion: checkout, photographer, session.
        # Until the binding can be checked, a database failure is retryable.
        surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == photographer_id).options(selectinload(Profile.current_spot)).with_for_update()
        )
        photographer = photographer_result.scalar_one_or_none()
        if surfer and photographer:
            active_live_session = await db.scalar(current_live_session(photographer_id).with_for_update(read=True))
            if (
                not bound_session_id or not photographer.is_shooting
                or active_live_session is None or active_live_session.id != bound_session_id
            ):
                original_status = None
                if bound_session_id:
                    original_status = await db.scalar(select(LiveSession.status).where(
                        LiveSession.id == bound_session_id, LiveSession.photographer_id == photographer_id,
                    ).with_for_update(read=True))
                if original_status in ("ended", "completed"):
                    review = await refund_live_seat(db, tx, locked_checkout, checkout_id, payment_intent_id, used_emulator)
                    if review is not None:
                        return review
                    if unattended:
                        return {"status": "refunded"}
                    raise HTTPException(status_code=409, detail="The original live session ended. Payment refunded.")
                reason = "original_session_unavailable" if bound_session_id else "missing_original_session"
                return await mark_paid_seat_review(db, tx, locked_checkout, reason)
        
        # Use a nested transaction (savepoint) to isolate mutations while keeping the outer row lock active.
        try:
            async with db.begin_nested():
                # ============ CLAIM THE TRANSACTION IMMEDIATELY ============
                # Mark as Completed BEFORE creating participant to win any race
                tx.payment_status = 'Completed'
                tx.status = 'Completed'
                await db.flush()
                
                if not surfer or not photographer:
                    raise HTTPException(status_code=404, detail="User or photographer not found")
                
                active_seat = await db.scalar(
                    select(LiveSessionParticipant.id).where(
                        LiveSessionParticipant.surfer_id == surfer_id,
                        LiveSessionParticipant.photographer_id == photographer_id,
                        LiveSessionParticipant.status == 'active',
                    ).limit(1)
                )
                if active_seat is not None:
                    raise HTTPException(status_code=409, detail="Already in this session")

                # Get selfie_url from our stored transaction
                selfie_url = locked_checkout.get('selfie_url')
                
                # CaptureSession: Calculate photos included in buy-in
                photos_included = 0
                if active_live_session.photos_included:
                    photos_included = active_live_session.photos_included
                else:
                    photos_included = photographer.live_session_photos_included or 3
                
                # Lock pricing at join time (same as credit path)
                locked_web = active_live_session.session_price_web or photographer.photo_price_web or photographer.live_photo_price_web or 3.0
                locked_standard = active_live_session.session_price_standard or photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0
                locked_high = active_live_session.session_price_high or photographer.photo_price_high or photographer.live_photo_price_high or 10.0
                
                # Create the session participant
                participant = LiveSessionParticipant(
                    id=str(uuid4()),
                    surfer_id=surfer_id,
                    photographer_id=photographer_id,
                    spot_id=active_live_session.surf_spot_id,
                    live_session_id=bound_session_id,
                    selfie_url=selfie_url,
                    participant_role='participant',
                    status='active',
                    amount_paid=amount,
                    payment_method='card',
                    # CaptureSession fields (previously missing for card payments!)
                    photos_credit_remaining=photos_included,
                    resolution_preference='standard',
                    locked_price_web=locked_web,
                    locked_price_standard=locked_standard,
                    locked_price_high=locked_high,
                )
                # The photographer's share is held, not paid: it is released when the buyer acts on
                # the delivered media, or after 7 days (services/live_session_escrow.py).
                live_session_escrow.hold(participant, amount)
                db.add(participant)
                tx.transaction_metadata = json.dumps({**locked_checkout, "settled_participant_id": str(participant.id)})

                # Notify photographer (card payment path was missing this)
                card_notification = Notification(
                    user_id=photographer_id,
                    type='session_join',
                    title=f"{surfer.full_name} joined your session!",
                    body=f"${amount:.2f} (card) \u2022 {photographer.current_spot.name if photographer.current_spot else 'Current location'}",
                    data=json.dumps({
                        "surfer_id": surfer_id,
                        "surfer_name": surfer.full_name,
                        "selfie_url": selfie_url,
                        "amount_paid": amount
                    })
                )
                db.add(card_notification)
                
                # Flush to check database constraints within savepoint
                await db.flush()
                
        except Exception as nested_err:
            # The nested transaction is automatically rolled back, releasing any locks acquired inside it
            # (but the outer transaction's row-level lock on PaymentTransaction remains active).
            # Perform Stripe refund rollback
            if payment_intent_id:
                review = await refund_live_seat(db, tx, locked_checkout, checkout_id, payment_intent_id, used_emulator)
                if review is not None:
                    return review
                if unattended:
                    return {"status": "refunded"}
                refund_successful = True

            # Re-raise or wrap nested exception
            if isinstance(nested_err, HTTPException):
                if refund_successful:
                    if isinstance(nested_err.detail, dict):
                        nested_err.detail["refunded"] = True
                        nested_err.detail["message"] = f"{nested_err.detail.get('message', nested_err.detail.get('error', ''))}. Payment refunded."
                    else:
                        nested_err.detail = f"{nested_err.detail}. Payment refunded."
                raise nested_err
            else:
                logger.exception("Live session seat creation failed")
                detail_msg = "Failed to complete session"
                if refund_successful:
                    detail_msg += ". Payment refunded."
                raise HTTPException(status_code=500, detail=detail_msg)

        # Notify photographer via real-time push (non-blocking / outside nested transaction)
        try:
            from routes.notifications.push_payloads import notify_session_join

            await notify_session_join(
                photographer_id=photographer_id,
                surfer_name=surfer.full_name,
                amount=amount,
                spot_name=photographer.current_spot.name if photographer.current_spot else 'Current location',
                db=db
            )
        except Exception as push_err:
            logger.warning(f"Failed to send card session join push: {push_err}")
        
        receipt = {
            "success": True,
            "message": "Successfully joined session",
            "session_id": str(participant.id),
            "photographer_name": photographer.full_name
        }
        try:
            await db.commit()
        except Exception as exc:
            try:
                await db.rollback()
                durable_result = await db.execute(
                    select(PaymentTransaction.payment_status, PaymentTransaction.transaction_metadata).where(
                        PaymentTransaction.session_id == checkout_id,
                        PaymentTransaction.user_id == current_user_id,
                    )
                )
                durable = durable_result.one_or_none()
                if durable is not None and durable.payment_status == 'Completed':
                    settled_id = json.loads(durable.transaction_metadata).get("settled_participant_id")
                    if settled_id:
                        return {**receipt, "session_id": settled_id}
            except Exception:
                logger.exception("Could not confirm the card join transaction")
            raise HTTPException(
                status_code=503,
                detail="Could not confirm the session join. Check your session before retrying.",
            ) from exc
        return receipt
        
    except HTTPException:
        await db.rollback()
        raise
    except stripe.error.StripeError as exc:
        await db.rollback()
        logger.exception("Live session payment verification failed")
        raise HTTPException(status_code=500, detail="Payment verification failed") from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Live session payment completion failed")
        raise HTTPException(status_code=500, detail="Failed to complete session") from exc
