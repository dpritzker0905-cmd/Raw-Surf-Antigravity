"""Dedicated crew-card receipts and settlement; callers own commit and rollback."""
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import stripe
from fastapi import HTTPException
from sqlalchemy import select

from services.shared_quick_book_hold import PENDING_SETTLEMENT
from utils.credits import add_credits
from models import Booking, CreditTransaction, DispatchRequest, DispatchRequestParticipant, DispatchRequestStatusEnum, PaymentTransaction, Profile

CLOSED_STATES = frozenset({DispatchRequestStatusEnum.ARRIVED, DispatchRequestStatusEnum.COMPLETED,
                          DispatchRequestStatusEnum.CANCELLED, DispatchRequestStatusEnum.REFUNDED,
                          DispatchRequestStatusEnum.NO_PRO_FOUND})


def captain_confirmation_pending(dispatch):
    return (dispatch.is_shared and dispatch.target_photographer_id
            and dispatch.status == DispatchRequestStatusEnum.PENDING_PAYMENT)


def crew_card_metadata(transaction):
    try:
        value = json.loads(transaction.transaction_metadata or '{}')
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def is_crew_card_payment(transaction):
    return crew_card_metadata(transaction).get('type') == 'crew_share'


def crew_share_cents(value):
    try:
        amount = Decimal(str(value))
        cents = amount * 100
        if not amount.is_finite() or amount <= 0 or cents != cents.to_integral_value():
            raise ValueError('Invalid crew share')
        return int(cents)
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail='Crew share must be a positive amount in whole cents') from None


def _outcome(status, receipt, message):
    return {'status': status, 'success': status == 'completed', 'message': message,
            'participant_id': receipt.get('participant_id'), 'dispatch_id': receipt.get('dispatch_id')}


def valid_crew_receipt(transaction, receipt):
    cents = receipt.get('amount_cents')
    return (receipt.get('type') == 'crew_share' and type(receipt.get('version')) is int and receipt.get('version') == 1
            and receipt.get('payer_id') == transaction.user_id
            and all(isinstance(receipt.get(key), str) and receipt[key] for key in ('participant_id', 'dispatch_id', 'payer_id'))
            and isinstance(cents, int) and not isinstance(cents, bool) and cents > 0
            and receipt.get('currency') == 'usd' and str(transaction.currency).lower() == 'usd'
            and Decimal(str(transaction.amount)) * 100 == cents)


def _review(transaction, receipt, message, paid=False):
    if paid:
        transaction.payment_status = 'paid'
    transaction.status = 'review_required'
    receipt = dict(receipt, review_reason=message)
    transaction.transaction_metadata = json.dumps(receipt)
    return _outcome('review_required', receipt, message)


async def credit_cancelled_crew_card(db, transaction, marker=None):
    """The caller holds the receipt lock and has verified the captured payment."""
    ok, _, _ = await add_credits(
        transaction.user_id, transaction.amount, 'crew_card_wallet_credit', db,
        reference_type='payment_transaction', reference_id=transaction.id,
        refund_of_transaction_id=marker.id if marker else None,
        description='Crew card payment returned as Raw Surf wallet credit',
    )
    if not ok:
        raise HTTPException(409, 'Could not return the crew payment to its payer.')
    transaction.status = 'wallet_credited'
    transaction.payment_status = 'paid'


async def fulfill_crew_card_payment(db, transaction, *, checkout=None):
    """Verify one saved crew card receipt and settle it once.

    Payment, dispatch, participant and profile locks are acquired in that order.
    Distinct paid checkouts for an already paid share are held for review, never
    guessed refunded or used to grant a second participation.
    """
    result = await db.execute(select(PaymentTransaction).where(PaymentTransaction.id == transaction.id)
                              .with_for_update().execution_options(populate_existing=True))
    transaction = result.scalar_one()
    receipt = crew_card_metadata(transaction)
    raw_status = str(transaction.payment_status).lower()
    local_status = str(transaction.status).lower()
    refund_states = {raw_status, local_status}
    if refund_states.intersection({'refunded', 'partially_refunded'}):
        refund_status = 'partially_refunded' if 'partially_refunded' in refund_states else 'refunded'
        return _outcome(refund_status, receipt, 'A refund is recorded for this payment; no crew participation was added.')
    if any('refund' in status for status in refund_states):
        return _outcome('review_required', receipt, 'The refund is unconfirmed. This crew payment needs review.')
    if local_status == PENDING_SETTLEMENT:
        return _outcome(PENDING_SETTLEMENT, receipt, 'Your card payment is held for settlement of the cancelled session.')
    if local_status == "wallet_credited":
        return _outcome("wallet_credited", receipt, "This card payment was returned to your Raw Surf wallet.")
    if local_status == 'review_required':
        return _outcome('review_required', receipt, receipt.get('review_reason') or 'This crew payment needs review.')
    try:
        valid = valid_crew_receipt(transaction, receipt)
    except (InvalidOperation, TypeError, ValueError):
        valid = False
    if not valid:
        return _review(transaction, receipt, 'The saved crew payment receipt needs review.')

    # A completed receipt does not need another provider read or another write.
    completed = local_status == 'completed' and raw_status == 'paid'
    if not completed:
        try:
            if checkout is None:
                checkout = stripe.checkout.Session.retrieve(transaction.session_id)
        except Exception:
            raise HTTPException(status_code=503, detail='Crew payment verification is temporarily unavailable. Refresh to retry.') from None
        provider_paid = getattr(checkout, 'payment_status', None) == 'paid'
        if not provider_paid:
            if getattr(checkout, 'status', None) == 'expired':
                transaction.status = 'expired'
                transaction.payment_status = getattr(checkout, 'payment_status', None) or 'unpaid'
                return _outcome('expired', receipt, 'This checkout expired without confirming the crew payment.')
            return _outcome('pending', receipt, 'Payment has not been confirmed yet. Refresh to check again.')
        metadata = getattr(checkout, 'metadata', None) or {}
        intent = getattr(checkout, 'payment_intent', None)
        intent = intent if isinstance(intent, str) else getattr(intent, 'id', None)
        amount_total = getattr(checkout, 'amount_total', None)
        if (getattr(checkout, 'id', None) != transaction.session_id or getattr(checkout, 'status', None) != 'complete'
                or getattr(checkout, 'mode', None) != 'payment' or str(getattr(checkout, 'currency', '')).lower() != 'usd'
                or not isinstance(amount_total, int) or isinstance(amount_total, bool) or amount_total != receipt['amount_cents']
                or not isinstance(intent, str) or not intent or any(metadata.get(key) != str(receipt[key]) for key in
                                     ('type', 'version', 'participant_id', 'dispatch_id', 'payer_id', 'amount_cents', 'currency'))):
            return _review(transaction, receipt, 'The paid checkout does not match its saved crew receipt.', paid=True)
    else:
        intent = (receipt.get('fulfillment') or {}).get('payment_intent_id')

    result = await db.execute(select(DispatchRequest).where(DispatchRequest.id == receipt['dispatch_id'])
                              .with_for_update().execution_options(populate_existing=True))
    dispatch = result.scalar_one_or_none()
    result = await db.execute(select(DispatchRequestParticipant).where(DispatchRequestParticipant.id == receipt['participant_id'])
                              .with_for_update().execution_options(populate_existing=True))
    participant = result.scalar_one_or_none()
    result = await db.execute(select(CreditTransaction).where(CreditTransaction.reference_type == 'payment_transaction',
                              CreditTransaction.reference_id == transaction.id, CreditTransaction.transaction_type == 'crew_session_card'))
    records = result.scalars().all()
    linked = (dispatch is not None and participant is not None and participant.dispatch_request_id == dispatch.id
              and participant.participant_id == transaction.user_id)
    if completed:
        if (linked and dispatch.status not in CLOSED_STATES and participant.paid and participant.status == 'paid' and intent
                and participant.stripe_payment_intent_id == intent and len(records) == 1 and records[0].amount == 0
                and records[0].spend_only_amount == 0 and records[0].user_id == transaction.user_id):
            return _outcome('completed', receipt, 'Crew payment confirmed. Your share is paid.')
        return _outcome('review_required', receipt, 'Payment was recorded, but the current crew participation needs review.')
    if (linked and dispatch.status == DispatchRequestStatusEnum.CANCELLED
            and dispatch.refund_type == PENDING_SETTLEMENT and not records
            and local_status in ('pending', 'expired') and raw_status in ('pending', 'unpaid', 'paid')
            and crew_share_cents(participant.share_amount) == receipt['amount_cents']):
        if participant.paid or participant.stripe_payment_intent_id:
            return _review(transaction, receipt, 'This seat was already funded. The additional card payment needs review.', paid=True)
        booking = await db.get(Booking, dispatch.booking_id, with_for_update=True, populate_existing=True)
        if booking is None or booking.escrow_status != PENDING_SETTLEMENT:
            return _review(transaction, receipt, 'The closed booking needs reconciliation.', paid=True)
        # Reserve the funding reference without granting participation in a cancelled session.
        participant.stripe_payment_intent_id = intent
        booking.escrow_amount = round((booking.escrow_amount or 0) + transaction.amount, 2)
        transaction.payment_status = 'paid'
        transaction.status = PENDING_SETTLEMENT
        transaction.transaction_metadata = json.dumps(dict(receipt, fulfillment={
            'payment_intent_id': intent, 'booking_id': booking.id, 'held_at': datetime.now(timezone.utc).isoformat(),
        }))
        return _outcome(PENDING_SETTLEMENT, receipt, 'Your card payment is held for settlement of the cancelled session.')
    if (linked and dispatch.is_shared and dispatch.target_photographer_id
            and dispatch.status == DispatchRequestStatusEnum.CANCELLED and dispatch.cancelled_at
            and dispatch.accepted_at is None and dispatch.photographer_id is None
            and raw_status in ('pending', 'unpaid', 'paid') and local_status in ('pending', 'expired')
            and not records and crew_share_cents(participant.share_amount) == receipt['amount_cents']):
        # The verified payment settled after closure. Credit this receipt without granting a seat.
        await credit_cancelled_crew_card(db, transaction)
        transaction.transaction_metadata = json.dumps(dict(receipt, fulfillment={'payment_intent_id': intent}))
        return _outcome('wallet_credited', receipt, 'This card payment was returned to your Raw Surf wallet.')
    if (not linked or captain_confirmation_pending(dispatch) or dispatch.status in CLOSED_STATES or participant.status not in ('invited', 'pending', 'confirmed')
            or participant.paid or records):
        return _review(transaction, receipt, 'This share is already paid or the crew session is no longer eligible.', paid=True)
    try:
        same_share = crew_share_cents(participant.share_amount) == receipt['amount_cents']
    except HTTPException:
        same_share = False
    if not same_share:
        return _review(transaction, receipt, 'The crew share changed after checkout; this payment needs review.', paid=True)
    result = await db.execute(select(Profile).where(Profile.id == transaction.user_id).with_for_update()
                              .execution_options(populate_existing=True))
    payer = result.scalar_one_or_none()
    if payer is None:
        return _review(transaction, receipt, 'The crew payer profile needs review.', paid=True)

    now = datetime.now(timezone.utc)
    participant.paid = True
    participant.status = 'paid'
    participant.paid_at = now
    participant.stripe_payment_intent_id = intent
    if receipt.get('selfie_url'):
        participant.selfie_url = receipt['selfie_url']
    participant.payer_name = receipt.get('payer_name')
    participant.payer_username = receipt.get('payer_username')
    participant.payer_avatar_url = receipt.get('payer_avatar_url')
    balance = payer.credit_balance or 0
    db.add(CreditTransaction(user_id=transaction.user_id, amount=0, spend_only_amount=0,
                             balance_before=balance, balance_after=balance, transaction_type='crew_session_card',
                             reference_type='payment_transaction', reference_id=transaction.id,
                             description=f"Crew share paid by card (${receipt['amount_cents'] / 100:.2f})"))
    transaction.payment_status = 'paid'
    transaction.status = 'completed'
    transaction.transaction_metadata = json.dumps(dict(receipt, fulfillment={'payment_intent_id': intent, 'paid_at': now.isoformat()}))
    result = await db.execute(select(DispatchRequestParticipant).where(DispatchRequestParticipant.dispatch_request_id == dispatch.id))
    crew = result.scalars().all()
    if dispatch.deposit_paid and all(member.paid for member in crew):
        dispatch.all_participants_paid = True
        dispatch.all_participants_paid_at = now
    return _outcome('completed', receipt, 'Crew payment confirmed. Your share is paid.')
