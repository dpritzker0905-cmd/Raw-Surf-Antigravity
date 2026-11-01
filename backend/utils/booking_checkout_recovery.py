"""Recover the atomic booking/payment/participant/credit checkout transaction.

Read immutable snapshots of this transaction's rows, not today's wallet balance:
subsequent legitimate wallet activity must not invalidate a durable booking.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError, DataError

from models import PaymentTransaction
from utils.checkout_recovery import _close_untracked_checkout, _recovery_error, _rollback

logger = logging.getLogger(__name__)


def _value(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return value


def booking_checkout_snapshot(*rows):
    """Capture flushed column values before COMMIT can expire ORM attributes."""
    return [(type(row), row.id, {column.key: _value(getattr(row, column.key))
                                for column in inspect(type(row)).column_attrs}) for row in rows]


async def recover_booking_checkout(db, session_id, error, commit_attempted, expected):
    """Return only if every staged row survived exactly; never retry the writes.

    Missing/conflicting partial state and uncertain commits require review. Only
    a definite pre-commit/constraint failure with successful rollback may expire
    an untracked checkout. Provider closure must confirm expired and unpaid.
    """
    logger.error('Booking checkout persistence failed; session=%s commit_attempted=%s error_type=%s',
                 session_id, commit_attempted, type(error).__name__)
    if not await _rollback(db):
        raise _recovery_error('review-required') from None
    try:
        # A unique-session constraint can fail during flush before COMMIT.
        # Do not expire a checkout already owned by a retained receipt.
        linked_result = await db.execute(select(PaymentTransaction).where(PaymentTransaction.session_id == session_id))
        linked = linked_result.scalar_one_or_none()
    except Exception as probe_error:
        logger.error('Booking checkout session readback unavailable; session=%s error_type=%s',
                     session_id, type(probe_error).__name__)
        await _rollback(db)
        raise _recovery_error('review-required') from None
    if not commit_attempted:
        if linked is not None or not await _rollback(db):
            raise _recovery_error('review-required') from None
        closed = _close_untracked_checkout(session_id)
        raise _recovery_error('closed' if closed else 'review-required') from None
    if not expected:
        raise _recovery_error('review-required') from None
    try:
        payment_ids = {identity for model, identity, _ in expected if model is PaymentTransaction}
        present = [linked is not None]
        matches = [linked is not None and linked.id in payment_ids]
        for model, identity, columns in expected:
            result = await db.execute(select(model).where(model.id == identity)
                                      .execution_options(populate_existing=True))
            row = result.scalar_one_or_none()
            present.append(row is not None)
            matches.append(row is not None and all(_value(getattr(row, key)) == value for key, value in columns.items()))
    except Exception as probe_error:
        logger.error('Booking checkout readback unavailable; session=%s error_type=%s', session_id, type(probe_error).__name__)
        await _rollback(db)
        raise _recovery_error('review-required') from None
    if all(matches):
        return
    if not await _rollback(db):
        raise _recovery_error('review-required') from None
    if any(present) or not isinstance(error, (IntegrityError, DataError)):
        raise _recovery_error('review-required') from None
    closed = _close_untracked_checkout(session_id)
    raise _recovery_error('closed' if closed else 'review-required') from None
