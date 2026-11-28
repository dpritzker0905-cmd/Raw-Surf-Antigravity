"""Return collected guest money to its actual payers when a targeted request ends before acceptance."""
import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from models import CreditTransaction, DispatchRequestParticipant, DispatchRequestStatusEnum, PaymentTransaction
from utils.credits import refund_credits
from utils.crew_card_fulfillment import credit_cancelled_crew_card, crew_share_cents, valid_crew_receipt


def needs_review():
    return HTTPException(409, "A crew payment needs reconciliation before this request can close.")


async def return_guest_payments(db, dispatch):
    # Both callers hold the dispatch lock until the terminal status and all credits commit together.
    if not (dispatch.is_shared and dispatch.target_photographer_id
            and dispatch.status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO):
        return
    seats = {p.id: p for p in (await db.scalars(select(DispatchRequestParticipant).where(
        DispatchRequestParticipant.dispatch_request_id == dispatch.id, DispatchRequestParticipant.paid.is_(True),
        DispatchRequestParticipant.share_amount > 0))).all()}
    if not seats:
        return

    # Original wallet ledger entries preserve both the payer and any promotional component.
    debits = (await db.scalars(select(CreditTransaction).where(
        ((CreditTransaction.reference_type == "dispatch_participant")
         & CreditTransaction.reference_id.in_(seats) & (CreditTransaction.transaction_type == "crew_session_payment"))
        | ((CreditTransaction.reference_type == "dispatch") & (CreditTransaction.reference_id == dispatch.id)
           & (CreditTransaction.transaction_type == "crew_cover") & (CreditTransaction.user_id == dispatch.requester_id))
    ).order_by(CreditTransaction.user_id, CreditTransaction.id))).all()
    funded = set()
    cover_cents = 0
    for debit in debits:
        cents = crew_share_cents(-debit.amount)
        if debit.transaction_type == "crew_cover":
            cover_cents += cents
        else:
            seat = seats[debit.reference_id]
            if (seat.id in funded or seat.participant_id != debit.user_id
                    or seat.stripe_payment_intent_id or cents != crew_share_cents(seat.share_amount)):
                raise needs_review()
            funded.add(seat.id)

    card_seats = {k: v for k, v in seats.items() if v.stripe_payment_intent_id}
    cards = []
    if card_seats:
        # Card fulfilment takes the receipt lock first. Fail fast if its transaction is still active.
        try:
            cards = (await db.execute(select(PaymentTransaction, CreditTransaction).join(
                CreditTransaction, (CreditTransaction.reference_id == PaymentTransaction.id)
                & (CreditTransaction.reference_type == "payment_transaction")
                & (CreditTransaction.transaction_type == "crew_session_card")
            ).where(PaymentTransaction.user_id.in_([p.participant_id for p in card_seats.values()]),
                    PaymentTransaction.transaction_metadata.contains(dispatch.id, autoescape=True))
              .order_by(PaymentTransaction.id).with_for_update(of=PaymentTransaction, nowait=True))).all()
        except DBAPIError as error:
            if getattr(error.orig, "sqlstate", None) == "55P03":
                raise needs_review() from None
            raise

    for receipt, marker in cards:
        try:
            details = json.loads(receipt.transaction_metadata)
        except (ValueError, TypeError):
            raise needs_review() from None
        if not isinstance(details, dict):
            raise needs_review()
        seat = card_seats.get(details.get("participant_id"))
        if (seat is None or seat.id in funded or details.get("dispatch_id") != dispatch.id
                or not valid_crew_receipt(receipt, details) or receipt.user_id != seat.participant_id
                or marker.user_id != receipt.user_id or marker.amount != 0 or marker.spend_only_amount != 0
                or details.get("amount_cents") != crew_share_cents(seat.share_amount)
                or (details.get("fulfillment") or {}).get("payment_intent_id") != seat.stripe_payment_intent_id
                or (receipt.status, receipt.payment_status) != ("completed", "paid")):
            raise needs_review()
        funded.add(seat.id)
    if (not card_seats.keys() <= funded
            or cover_cents != sum(crew_share_cents(p.share_amount) for k, p in seats.items() if k not in funded)):
        raise needs_review()

    for debit in debits:
        ok, _, _ = await refund_credits(debit.user_id, -debit.amount, db, original_transaction_id=debit.id,
            reference_type=debit.reference_type, reference_id=debit.reference_id,
            transaction_type="crew_wallet_return", description="Crew payment returned to Raw Surf wallet")
        if not ok:
            raise needs_review()
    for receipt, marker in cards:
        previous = await db.scalar(select(CreditTransaction.id).where(CreditTransaction.refund_of_transaction_id == marker.id))
        if previous is not None:
            raise needs_review()
        await credit_cancelled_crew_card(db, receipt, marker)
    for seat in seats.values():
        seat.status = "wallet_credited"
