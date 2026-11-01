"""Recover a dispatch's checkout link and pending payment as one transaction."""
import logging
from datetime import datetime, timezone

from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError, DataError

from models import DispatchRequest, PaymentTransaction
from utils.checkout_recovery import _close_untracked_checkout, _recovery_error, _rollback

logger = logging.getLogger(__name__)


def _value(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return value


def _snapshot(row):
    return {column.key: _value(getattr(row, column.key)) for column in inspect(type(row)).column_attrs}


def _matches(row, expected):
    return row is not None and expected is not None and all(_value(getattr(row, key)) == value for key, value in expected.items())


async def persist_dispatch_checkout(db, dispatch, session_id, transaction_factory):
    """Never repeat provider creation, financial writes, or guessed cancellation.

    The dispatch already exists: failed-save closure requires its original state
    plus no retained payment or dispatch reference to the new provider Session.
    """
    before = expected_dispatch = expected_payment = None
    dispatch_id = dispatch.id
    commit_attempted = False
    try:
        before = _snapshot(dispatch)
        dispatch.stripe_checkout_session_id = session_id
        transaction = transaction_factory()
        if transaction.session_id != session_id:
            raise ValueError('Checkout receipt identity mismatch')
        db.add(transaction)
        await db.flush()
        expected_dispatch, expected_payment = _snapshot(dispatch), _snapshot(transaction)
        commit_attempted = True
        await db.commit()
        return
    except Exception as error:
        logger.error('Dispatch checkout persistence failed; session=%s commit_attempted=%s error_type=%s',
                     session_id, commit_attempted, type(error).__name__)
        if not await _rollback(db):
            raise _recovery_error('review-required') from None
        try:
            result = await db.execute(select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
                                      .execution_options(populate_existing=True))
            payment = result.scalar_one_or_none()
            result = await db.execute(select(DispatchRequest).where(DispatchRequest.stripe_checkout_session_id == session_id)
                                      .execution_options(populate_existing=True))
            references = result.scalars().all()
            result = await db.execute(select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
                                      .execution_options(populate_existing=True))
            retained_dispatch = result.scalar_one_or_none()
            if (commit_attempted and _matches(payment, expected_payment) and _matches(retained_dispatch, expected_dispatch)
                    and len(references) == 1 and references[0].id == dispatch_id):
                return
            can_close = (payment is None and not references and _matches(retained_dispatch, before)
                         and (not commit_attempted or isinstance(error, (IntegrityError, DataError))))
        except Exception as probe_error:
            logger.error('Dispatch checkout readback unavailable; session=%s error_type=%s', session_id, type(probe_error).__name__)
            await _rollback(db)
            raise _recovery_error('review-required') from None
        if not await _rollback(db) or not can_close:
            raise _recovery_error('review-required') from None
        closed = _close_untracked_checkout(session_id)
        raise _recovery_error('closed' if closed else 'review-required') from None
