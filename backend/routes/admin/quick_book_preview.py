"""Support-only, hypothetical settlement for a held shared Quick Book."""
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user_id
from database import get_db
from deps.admin_auth import get_current_admin
from models import Booking, DispatchRequest, DispatchRequestStatusEnum, SurferPhotoSubscription
from services.quick_book_preview_funding import cents, funding_snapshot, reconcile
from services.shared_quick_book_hold import PENDING_SETTLEMENT

router = APIRouter()
Reference = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Amount = Annotated[int, Field(strict=True, ge=0, le=2**53-1)]


class SeatAssumption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seat: Reference
    outcome: Literal["no_service", "buyer_cancelled", "no_show", "partial", "delivered", "disputed"]
    evidence: Reference | None = None
    earned_cents: Amount | None = None
    accepted_fee_percent: Annotated[int, Field(strict=True, ge=0, le=100)] | None = None
    accepted_fee_cap_cents: Amount | None = None
    fee_terms_reference: Reference | None = None
    partial_unit_consent: Reference | None = None
    card_wallet_consent: Reference | None = None

    @model_validator(mode="after")
    def consistent(self):
        fee = (self.accepted_fee_percent, self.accepted_fee_cap_cents, self.fee_terms_reference)
        if any(v is not None for v in fee) and (
            self.outcome not in ("buyer_cancelled", "no_show") or None in fee or not self.evidence
        ):
            raise ValueError("A fee needs a buyer cancellation or verified no-show, evidence and exact accepted terms.")
        if (self.outcome == "partial") != (self.earned_cents is not None):
            raise ValueError("Enter the agreed earned cents only for partial delivery.")
        if self.outcome in ("partial", "delivered", "no_show") and not self.evidence:
            raise ValueError("A delivery or no-show needs an evidence reference.")
        if self.partial_unit_consent and self.outcome != "partial":
            raise ValueError("Partial unit consent applies only to partial delivery.")
        return self


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seats: list[SeatAssumption] = Field(default_factory=list, max_length=100)


async def preview_database(actor: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    async with db.begin():
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        await get_current_admin(actor, db)
        yield db


def allocate(amount, decision):
    if decision is None or decision.outcome == "disputed":
        return 0, 0, amount
    if decision.outcome == "delivered":
        return 0, amount, 0
    if decision.outcome == "partial":
        earned = decision.earned_cents
        if earned > amount:
            raise HTTPException(422, "Proposed earnings exceed this seat's collected payment.")
    elif decision.accepted_fee_percent is not None:
        earned = min((amount * decision.accepted_fee_percent + 50) // 100, decision.accepted_fee_cap_cents)
    else:
        earned = 0
    return amount - earned, earned, 0


async def unit_preview(db, dispatch, decision, as_of):
    source = dispatch.included_subscription_id
    if source is None:
        return {"action": "none"}
    plan = await db.get(SurferPhotoSubscription, source)
    if (not plan or plan.surfer_id != dispatch.requester_id or plan.photographer_id != dispatch.target_photographer_id
            or dispatch.included_session_restored_at):
        raise reconcile()
    if decision is None or decision.outcome == "disputed":
        action = "keep_reserved"
    elif decision.outcome == "delivered" or decision.partial_unit_consent:
        action = "consume_one"
    else:
        def utc(dt):
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        current_period = (plan.started_at and dispatch.created_at and plan.expires_at
                          and utc(plan.started_at) <= utc(dispatch.created_at) < utc(plan.expires_at))
        action = "restore_one" if current_period and plan.status == "active" and utc(plan.expires_at) > as_of else "replacement_review"
    return {"action": action, "subscriber_id": dispatch.requester_id, "subscription_id": source}


@router.post("/admin/support/quick-books/{dispatch_id}/settlement-preview")
async def settlement_preview(dispatch_id: str, body: PreviewRequest, response: Response,
                             db: AsyncSession = Depends(preview_database)):
    response.headers["Cache-Control"] = "no-store"
    as_of = (await db.scalar(text("SELECT transaction_timestamp()")) if db.get_bind().dialect.name == "postgresql"
             else datetime.now(timezone.utc))
    dispatch = await db.get(DispatchRequest, dispatch_id)
    if dispatch is None:
        raise HTTPException(404, "Quick Book not found.")
    booking = await db.get(Booking, dispatch.booking_id) if dispatch.booking_id else None
    if not (dispatch.is_shared and dispatch.target_photographer_id and dispatch.status == DispatchRequestStatusEnum.CANCELLED
            and dispatch.refund_type == PENDING_SETTLEMENT and booking and booking.status == "Cancelled"
            and booking.escrow_status == PENDING_SETTLEMENT and booking.booking_type == "on_demand"
            and booking.creator_id == dispatch.requester_id
            and booking.photographer_id == dispatch.target_photographer_id == dispatch.photographer_id):
        raise HTTPException(409, "This booking is not a cancelled shared Quick Book awaiting settlement.")
    seats, funded, review, blocked_sources, booking_disputed = await funding_snapshot(db, dispatch, booking)
    decisions = {d.seat: d for d in body.seats}
    if len(decisions) != len(body.seats) or decisions.keys() - seats.keys():
        raise HTTPException(422, "Identify each booking seat at most once.")
    captain = dispatch.requester_id
    captain_funding = funded.get(captain)
    unit_disputed = booking_disputed or (captain_funding and captain_funding.source in blocked_sources)
    unit = await unit_preview(db, dispatch, None if unit_disputed else decisions.get(captain), as_of)
    outcomes = {decisions[s].outcome if s in decisions else None for s in seats}
    common_result = outcomes in ({"no_service"}, {"delivered"}) and not (booking_disputed or blocked_sources)
    # A captain may have agreed to cover some or all of a friend's original quote.
    # Legacy records do not persist the seat breakdown of that combined debit.
    captain_breakdown_missing = bool(seats[captain] and len(seats) > 1)
    lines, sources = [], {}
    totals = dict(refund_cents=0, photographer_gross_cents=0, reserved_cents=0)
    for member, share in seats.items():
        decision = decisions.get(member)
        source = funded.get(member)
        amount = share if source else 0
        if decision and decision.partial_unit_consent and (member != captain or unit["action"] == "none"):
            raise HTTPException(422, "Only the subscriber may apply the included session.")
        dispute_hold = booking_disputed or (source is not None and source.source in blocked_sources)
        refund, earnings, reserve = allocate(amount, None if dispute_hold else decision)
        reason = None
        if reserve:
            reason = "Unresolved dispute" if dispute_hold or decision else "Seat outcome not supplied"
        if member == captain and captain_breakdown_missing and not common_result and not dispute_hold and amount:
            refund, earnings, reserve = 0, 0, amount
            reason = "Bundled captain payment needs a seat breakdown"
        if source and source.kind == "card" and refund and (member == captain or not decision.card_wallet_consent):
            reason = "Card return destination needs review"
            reserve += refund
            refund = 0
        if source:
            group = sources.setdefault(source.source, dict(source_id=source.source, payer_id=source.payer,
                method=source.kind, collected_cents=source.amount, refund_cents=0, promo_refund_cents=0))
            group["refund_cents"] += refund
            group["promo_refund_cents"] = min(group["refund_cents"], source.promo)
            group["cash_wallet_refund_cents"] = group["refund_cents"] - group["promo_refund_cents"]
        amounts = dict(refund_cents=refund, photographer_gross_cents=earnings, reserved_cents=reserve)
        for key, value in amounts.items():
            totals[key] += value
        lines.append(dict(seat=member, role="captain" if member == captain else "guest", collected_cents=amount,
                          payer_id=source.payer if source else None, method=source.kind if source else None,
                          confirmed_after_cancellation=bool(source and source.confirmed_after_cancellation),
                          reserve_reason=reason, **amounts))
    if sum(totals.values()) != cents(booking.escrow_amount):
        raise reconcile()
    return dict(preview_only=True, as_of=as_of, dispatch_id=dispatch.id, booking_id=booking.id, photographer_id=booking.photographer_id,
                currency="usd", collected_cents=cents(booking.escrow_amount), **totals, seats=lines,
                funding=list(sources.values()), separate_receipts=review, included_session=unit)
