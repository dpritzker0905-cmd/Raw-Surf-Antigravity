"""Persist pending checkout-only records, with bounded provider compensation.

Do not use for booking reservations or other staged wallet/entitlement writes.
A commit acknowledgement can be lost after the row is durable; read it back
before deciding whether an open provider checkout is safe to expire.
"""
import logging
from decimal import Decimal

import stripe
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, DataError

from models import PaymentTransaction

logger = logging.getLogger(__name__)


def _recovery_error(outcome):
    message = ('Checkout could not be confirmed and was closed. Please try again.' if outcome == 'closed' else
               'Checkout needs review. Contact support before starting another payment.')
    return HTTPException(status_code=503 if outcome == 'closed' else 409, detail=message,
                         headers={'X-Checkout-Recovery': outcome})


async def _rollback(db):
    try:
        await db.rollback()
        return True
    except Exception as error:
        logger.error('Checkout rollback unavailable; error_type=%s', type(error).__name__)
        return False


def _quote(row):
    return (row.user_id, Decimal(str(row.amount)), str(row.currency).lower(), row.transaction_metadata)


def _close_untracked_checkout(session_id):
    """Return true only when the provider confirms expired and not paid."""
    try:
        checkout = stripe.checkout.Session.expire(session_id)
    except Exception as error:
        logger.error('Checkout expiry unavailable; session=%s error_type=%s', session_id, type(error).__name__)
        try:
            checkout = stripe.checkout.Session.retrieve(session_id)
        except Exception:
            return False
    return (getattr(checkout, 'status', None) == 'expired' and
            getattr(checkout, 'payment_status', None) in ('unpaid', 'no_payment_required'))


async def persist_pending_checkout(db, session_id, transaction_factory):
    """Never create/retry/refund a provider session; return only after local proof.

    Definite local staging/constraint failures can close an untracked checkout.
    Unknown commit/readback outcomes require review; do not blindly cancel a
    session that may already have a durable transaction or a completed payment.
    """
    stage = 'prepare'
    expected = None
    try:
        transaction = transaction_factory()
        if transaction.session_id != session_id:
            raise ValueError('Checkout receipt identity mismatch')
        expected = _quote(transaction)
        stage = 'add'
        db.add(transaction)
        stage = 'commit'
        await db.commit()
        return transaction
    except Exception as error:
        logger.error('Checkout persistence failed; session=%s stage=%s error_type=%s',
                     session_id, stage, type(error).__name__)
        rolled_back = await _rollback(db)
        if stage != 'commit':
            closed = _close_untracked_checkout(session_id)
            raise _recovery_error('closed' if closed else 'review-required') from None
        if not rolled_back:
            raise _recovery_error('review-required') from None
        try:
            result = await db.execute(select(PaymentTransaction).where(
                PaymentTransaction.session_id == session_id).execution_options(populate_existing=True))
            retained = result.scalar_one_or_none()
            if retained is not None:
                if _quote(retained) == expected:
                    return retained
                logger.error('Checkout retained receipt differs; session=%s', session_id)
                await _rollback(db)
                raise _recovery_error('review-required')
        except HTTPException:
            raise
        except Exception as probe_error:
            logger.error('Checkout readback unavailable; session=%s error_type=%s',
                         session_id, type(probe_error).__name__)
            await _rollback(db)
            raise _recovery_error('review-required') from None
        if not await _rollback(db):
            raise _recovery_error('review-required') from None
        if not isinstance(error, (IntegrityError, DataError)):
            # An absent row on one read is not proof that an uncertain COMMIT failed.
            raise _recovery_error('review-required') from None
        closed = _close_untracked_checkout(session_id)
        raise _recovery_error('closed' if closed else 'review-required') from None
