"""Read durable funding evidence for a cancelled Quick Book. No provider calls or writes."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import and_, or_, select

from models import CreditTransaction, DispatchRequestParticipant, Dispute, PaymentTransaction, RefundRequest, RefundStatusEnum
from services.shared_quick_book_hold import PENDING_SETTLEMENT
from utils.crew_card_fulfillment import crew_card_metadata, valid_crew_receipt


def reconcile():
    return HTTPException(409, "Funding records need reconciliation before a settlement can be previewed.")


def cents(value):
    try:
        n = Decimal(str(value)) * 100
        if n.is_finite() and n == n.to_integral_value() and n >= 0:
            return int(n)
    except (TypeError, ValueError, InvalidOperation):
        pass
    raise reconcile()


@dataclass(frozen=True)
class Funding:
    payer: str
    source: str
    kind: str
    amount: int
    promo: int = 0
    confirmed_after_cancellation: bool = False


def wallet(debit):
    amount, promo = cents(-debit.amount), cents(-(debit.spend_only_amount or 0))
    if not amount or promo > amount:
        raise reconcile()
    return Funding(debit.user_id, debit.id, "wallet", amount, promo)


async def funding_snapshot(db, dispatch, booking):
    captain = dispatch.requester_id
    crew = list(await db.scalars(select(DispatchRequestParticipant).where(
        DispatchRequestParticipant.dispatch_request_id == dispatch.id).order_by(DispatchRequestParticipant.id)))
    seats = {s.participant_id: cents(s.share_amount) for s in crew}
    intents = [s.stripe_payment_intent_id for s in crew if s.stripe_payment_intent_id]
    if len(seats) != len(crew) or captain in seats or len(set(intents)) != len(intents):
        raise reconcile()
    seats[captain] = cents(dispatch.deposit_amount)
    by_id = {s.id: s for s in crew}
    receipt_matches = [PaymentTransaction.transaction_metadata.contains(dispatch.id, autoescape=True)]
    if dispatch.stripe_checkout_session_id:
        receipt_matches.append(PaymentTransaction.session_id == dispatch.stripe_checkout_session_id)
    receipts = list(await db.scalars(select(PaymentTransaction).where(or_(*receipt_matches))))
    refs = [r.id for r in receipts]
    rows = list(await db.scalars(select(CreditTransaction).where(or_(
        and_(CreditTransaction.reference_id == dispatch.id,
             CreditTransaction.reference_type.in_(("dispatch", "dispatch_request"))),
        and_(CreditTransaction.reference_type == "dispatch_participant", CreditTransaction.reference_id.in_(by_id)),
        and_(CreditTransaction.reference_type == "payment_transaction", CreditTransaction.reference_id.in_(refs)),
        and_(CreditTransaction.reference_type == "booking", CreditTransaction.reference_id == booking.id)))))
    row_ids = [r.id for r in rows]
    existing_refund = await db.scalar(select(RefundRequest.id).where(
        or_(RefundRequest.booking_id == booking.id, RefundRequest.transaction_id.in_(row_ids)),
        or_(RefundRequest.status != RefundStatusEnum.REJECTED, RefundRequest.status.is_(None),
            RefundRequest.stripe_refund_id.is_not(None))).limit(1))
    if existing_refund:
        raise reconcile()
    disputes = list(await db.scalars(select(Dispute).where(or_(
        Dispute.booking_id == booking.id, Dispute.transaction_id.in_(row_ids)))))
    blocked_sources = set()
    booking_disputed = False
    for dispute in disputes:
        if dispute.amount_refunded or dispute.amount_stripe_refunded or dispute.status in ("resolved_refund", "resolved_partial"):
            raise reconcile()
        if dispute.status == "resolved_no_action":
            continue
        if dispute.transaction_id in row_ids:
            blocked_sources.add(dispute.transaction_id)
        else:
            booking_disputed = True
    returned = await db.scalar(select(CreditTransaction.id).where(
        CreditTransaction.refund_of_transaction_id.in_(row_ids)).limit(1))
    if returned or booking.escrow_released_at or booking.refund_amount:
        raise reconcile()

    funded, covers, markers, review = {}, [], {}, []
    captain_card_marker = None

    def assign(member, source):
        if member in funded or member not in seats or source.amount != seats[member]:
            raise reconcile()
        funded[member] = source

    for row in rows:
        tag = (row.reference_type, row.transaction_type)
        if tag == ("dispatch_request", "dispatch_deposit") and row.user_id == captain and dispatch.deposit_paid:
            assign(captain, wallet(row))
        elif tag == ("dispatch_request", "dispatch_deposit_card"):
            if captain_card_marker or row.user_id != captain or row.amount != 0 or row.spend_only_amount:
                raise reconcile()
            captain_card_marker = row.id
        elif tag == ("dispatch_participant", "crew_session_payment"):
            seat = by_id[row.reference_id]
            if row.user_id != seat.participant_id or not seat.paid or seat.stripe_payment_intent_id:
                raise reconcile()
            assign(seat.participant_id, wallet(row))
        elif tag == ("dispatch", "crew_cover") and row.user_id == captain:
            covers.append(wallet(row))
        elif tag == ("payment_transaction", "crew_session_card") and row.amount == 0 and not row.spend_only_amount:
            if row.reference_id in markers:
                raise reconcile()
            markers[row.reference_id] = row.user_id
            if row.id in blocked_sources:
                blocked_sources.add(row.reference_id)
        else:
            raise reconcile()

    for tx in receipts:
        meta = crew_card_metadata(tx)
        if tx.id in markers and tx.status != "completed":
            raise reconcile()
        if meta.get("dispatch_id") != dispatch.id:
            raise reconcile()
        if (str(tx.status or "").lower(), str(tx.payment_status or "").lower()) == ("expired", "unpaid") and tx.id not in markers:
            continue
        if meta.get("type") == "on_demand_dispatch":
            if not (captain_card_marker and dispatch.deposit_paid and tx.session_id == dispatch.stripe_checkout_session_id
                    and tx.user_id == captain and meta.get("user_id", captain) == captain
                    and str(tx.currency or "").lower() == "usd" and (tx.status, tx.payment_status) == ("Completed", "Completed")):
                raise reconcile()
            assign(captain, Funding(captain, tx.id, "card", cents(tx.amount)))
            if captain_card_marker in blocked_sources:
                blocked_sources.add(tx.id)
            captain_card_marker = None
            continue
        if meta.get("type") != "crew_share":
            raise reconcile()
        try:
            valid = valid_crew_receipt(tx, meta)
        except (InvalidOperation, TypeError, ValueError):
            valid = False
        if not valid:
            raise reconcile()
        seat = by_id.get(meta["participant_id"])
        if not seat or tx.user_id != seat.participant_id:
            raise reconcile()
        if (tx.status in ("pending", "review_required") and tx.id not in markers
                and tx.payment_status in ("pending", "unpaid", "paid")):
            review.append({"seat": seat.participant_id, "receipt_id": tx.id, "status": tx.status,
                           "amount_cents": cents(tx.amount), "payer_id": tx.user_id})
            continue
        if tx.payment_status != "paid" or tx.status not in ("completed", PENDING_SETTLEMENT):
            raise reconcile()
        fulfillment = meta.get("fulfillment") or {}
        if not isinstance(fulfillment, dict) or not seat.stripe_payment_intent_id or fulfillment.get("payment_intent_id") != seat.stripe_payment_intent_id:
            raise reconcile()
        if tx.status == "completed":
            if markers.pop(tx.id, None) != tx.user_id or not seat.paid:
                raise reconcile()
        elif fulfillment.get("booking_id") != booking.id or seat.paid:
            raise reconcile()
        assign(seat.participant_id, Funding(tx.user_id, tx.id, "card", cents(tx.amount),
                                           confirmed_after_cancellation=tx.status == PENDING_SETTLEMENT))

    remaining = [s for s in crew if s.paid and seats[s.participant_id] and s.participant_id not in funded]
    if captain_card_marker or markers or any(s.stripe_payment_intent_id and s.participant_id not in funded for s in crew):
        raise reconcile()
    if covers or remaining:
        if len(covers) != 1 or covers[0].amount != sum(seats[s.participant_id] for s in remaining):
            raise reconcile()
        for seat in remaining:
            funded[seat.participant_id] = covers[0]
    if dispatch.deposit_paid and seats[captain] and captain not in funded:
        raise reconcile()
    if sum(seats[k] for k in funded) != cents(booking.escrow_amount):
        raise reconcile()
    return seats, funded, review, blocked_sources, booking_disputed
