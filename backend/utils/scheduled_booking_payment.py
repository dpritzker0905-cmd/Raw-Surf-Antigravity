"""One verified scheduled-booking transition for signed events and owner status reads.

The caller verifies the Stripe session (SDK or signed webhook) and commits. This
module binds that evidence to local records and serializes durable effects; it
never interprets a session identifier as payment evidence or sends external push.
"""
import json
import ast
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import select

from models import Booking, BookingParticipant, Notification, PaymentTransaction
from utils.credits import add_credits, deduct_credits
from utils.payment_reconciliation import PaymentNeedsReconciliation


def cents(value):
    try:
        number = Decimal(str(value))
        if isinstance(value, bool) or not number.is_finite() or number < 0:
            raise ValueError('Invalid monetary value')
        return int((number * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(status_code=400, detail='Invalid payment amount') from exc


def metadata_of(transaction):
    try:
        raw = transaction.transaction_metadata or '{}'
        try:
            metadata = json.loads(raw)
        except json.JSONDecodeError:
            metadata = ast.literal_eval(raw)  # Legacy Request-a-Pro deposits.
    except (ValueError, TypeError, SyntaxError) as exc:
        raise HTTPException(status_code=400, detail='Invalid payment metadata') from exc
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail='Invalid payment metadata')
    return metadata


def is_scheduled_booking(transaction):
    metadata = metadata_of(transaction)
    return metadata.get('type') == 'scheduled_booking' or (
        not metadata.get('type') and all(k in metadata for k in ('booking_id', 'photographer_id', 'credits_applied'))
    )


def field(session, name, default=None):
    return session.get(name, default) if isinstance(session, dict) else getattr(session, name, default)


async def fulfill_scheduled_booking(db, transaction, session, booking_id=None):
    # Every producer takes locks in this order. Refresh instances loaded before
    # another transaction completed, rather than trusting the identity-map copy.
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == transaction.id)
                          .with_for_update().execution_options(populate_existing=True))).one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail='Transaction not found')
    metadata = metadata_of(tx)
    target = metadata.get('booking_id')
    if not is_scheduled_booking(tx) or not target or (booking_id is not None and target != booking_id):
        raise HTTPException(status_code=400, detail='Payment does not belong to this booking')
    booking = (await db.scalars(select(Booking).where(Booking.id == target).with_for_update()
                               .execution_options(populate_existing=True))).one_or_none()
    if booking is None:
        raise HTTPException(status_code=404, detail='Booking not found')
    evidence = field(session, 'metadata', {})
    expected = dict(type='scheduled_booking', booking_id=booking.id, user_id=booking.creator_id,
                    photographer_id=booking.photographer_id)
    amount, applied = cents(tx.amount), cents(metadata.get('credits_applied'))
    valid = (
        isinstance(evidence, dict) and all(evidence.get(k) == v for k, v in expected.items())
        and field(session, 'id') == tx.session_id and field(session, 'payment_status') == 'paid'
        and field(session, 'status') == 'complete' and field(session, 'currency') == tx.currency == 'usd'
        and type(field(session, 'amount_total')) is int and field(session, 'amount_total') == amount and amount > 0
        and tx.user_id == booking.creator_id and metadata.get('photographer_id') == booking.photographer_id
        and metadata.get('user_id', tx.user_id) == tx.user_id
        and cents(evidence.get('credits_applied')) == applied
        and cents(booking.total_price) == amount + applied
    )
    if not valid:
        raise HTTPException(status_code=400, detail='Payment evidence does not match booking')
    if booking.status not in ('Pending Payment', 'Confirmed'):
        raise PaymentNeedsReconciliation(tx.id, 'booking_unavailable', session)
    paid = tx.payment_status.lower() == 'paid' and tx.status.lower() == 'completed'
    if paid and booking.status == 'Confirmed':
        return booking, False
    if tx.payment_status.lower() != 'pending' or tx.status.lower() != 'pending' or booking.status != 'Pending Payment':
        raise PaymentNeedsReconciliation(tx.id, 'local_payment_state', session)
    # A paid receipt can arrive after checkout expires. Provider completion is
    # evidence of payment; delivery time is not. Cancelled bookings still fail above.
    participant = (await db.scalars(select(BookingParticipant).where(
        BookingParticipant.booking_id == booking.id, BookingParticipant.participant_id == booking.creator_id
    ).with_for_update().execution_options(populate_existing=True))).one_or_none()
    if participant is None or participant.payment_status != 'Pending' or cents(participant.paid_amount) != applied:
        raise PaymentNeedsReconciliation(tx.id, 'booking_participation', session)

    # Preserve the existing wallet accounting: provider funding followed by the
    # matching booking debit. Both entries and all entitlements share one commit.
    for operation, kind, description in (
        (add_credits, 'stripe_topup', 'Verified scheduled booking funding'),
        (deduct_credits, 'booking_payment', 'Scheduled booking payment'),
    ):
        ok, _, error = await operation(user_id=tx.user_id, amount=amount / 100, transaction_type=kind,
                                      db=db, description=description, reference_type='booking',
                                      reference_id=booking.id, counterparty_id=booking.photographer_id)
        if not ok:
            raise HTTPException(status_code=409, detail=error or 'Unable to apply booking payment')
    tx.payment_status, tx.status = 'paid', 'completed'
    booking.status, booking.escrow_status = 'Confirmed', 'held'
    booking.escrow_amount = float((Decimal(amount + applied) * Decimal('0.8') / 100).quantize(Decimal('0.01')))
    participant.payment_status, participant.status = 'Paid', 'confirmed'
    participant.paid_amount = (amount + applied) / 100
    payload = json.dumps({'booking_id': booking.id, 'location': booking.location,
                          'session_date': booking.session_date.isoformat()})
    for user_id, kind in ((booking.photographer_id, 'booking_confirmed'), (booking.creator_id, 'booking_confirmation')):
        db.add(Notification(user_id=user_id, type=kind, title='Booking Confirmed',
                            body=f'Your session at {booking.location} is confirmed.', data=payload))
    return booking, True
