"""dispute_rules.py -- who may open a dispute, about what, and for how much.

A dispute opens a 30-day payout hold on the other party, so it must be anchored to a real transaction the
complainant took part in. Before this the submit route trusted everything in the request: the other party, the
amount and the (optional, unchecked) booking / session / item, so any signed-in user could open a dispute for any
amount against any photographer. The owner approved six rules (2026-10-24):

  1. a dispute names exactly ONE transaction the complainant actually paid in or took part in (a booking, a live
     session or a gallery purchase); anything that is not about a transaction belongs on the reports route;
  2. the other party is DERIVED from that transaction; a client-supplied one must match or the request is refused;
  3. the disputed amount cannot exceed what the complainant paid in it, so a hold can never exceed it either;
  4. the dispute must be opened within 90 days of the transaction;
  5. one open dispute per transaction per complainant;
  6. evidence links are https only (at most 10) and the text fields have length limits.

Rule order is cheapest first: the request itself is checked before any query, then the transaction, then the
window, the amount and the duplicate. A refusal writes nothing.
"""
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from models import Booking, BookingParticipant, Dispute, GalleryPurchase, LiveSessionParticipant
from models.enums import DisputeTypeEnum

WINDOW_DAYS = 90
MAX_EVIDENCE_LINKS = 10
MAX_LINK_LENGTH = 2048
MAX_SUBJECT = 200
MAX_DESCRIPTION = 5000
OPEN_STATUSES = ("open", "under_review", "awaiting_response", "escalated")
DISPUTE_TYPES = frozenset(t.value for t in DisputeTypeEnum)
CENT = 0.005


@dataclass(frozen=True)
class Transaction:
    kind: str                 # "booking" | "live_session" | "gallery_item"
    reference_id: str
    respondent_id: str
    paid: float
    at: Optional[datetime]

    @property
    def column(self):
        return {"booking": Dispute.booking_id, "live_session": Dispute.live_session_id,
                "gallery_item": Dispute.gallery_item_id}[self.kind]


def _aware(moment):
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _bad(detail):
    return HTTPException(status_code=400, detail=detail)


def validate_submission(data):
    """Rules 1 (shape), 3 (amount is a real number) and 6, from the request alone. Returns (kind, id, amount)."""
    if data.dispute_type not in DISPUTE_TYPES:
        raise _bad("Unknown dispute type")
    named = [(kind, value) for kind, value in (("booking", data.booking_id), ("live_session", data.live_session_id),
                                               ("gallery_item", data.gallery_item_id)) if value]
    if len(named) != 1:
        raise _bad("A dispute must name exactly one booking, live session or gallery item; "
                   "other complaints belong in a report")
    if not data.subject.strip() or len(data.subject) > MAX_SUBJECT:
        raise _bad(f"Subject is required and limited to {MAX_SUBJECT} characters")
    if not data.description.strip() or len(data.description) > MAX_DESCRIPTION:
        raise _bad(f"Description is required and limited to {MAX_DESCRIPTION} characters")
    amount = 0.0 if data.amount_disputed is None else data.amount_disputed
    if not math.isfinite(amount) or amount < 0:
        raise _bad("The disputed amount must be a non-negative number")
    links = data.evidence_urls or []
    if len(links) > MAX_EVIDENCE_LINKS:
        raise _bad(f"At most {MAX_EVIDENCE_LINKS} evidence links")
    for link in links:
        parsed = urlparse(link) if isinstance(link, str) and len(link) <= MAX_LINK_LENGTH else None
        if parsed is None or parsed.scheme != "https" or not parsed.netloc or any(ch.isspace() for ch in link):
            raise _bad("Evidence links must be https URLs")
    kind, reference_id = named[0]
    return kind, reference_id, amount


async def resolve_transaction(db, caller_id, kind, reference_id) -> Transaction:
    """Rule 1 (the caller is a party) and the source of rule 2's respondent. 404 for 'not yours' and 'not there'."""
    missing = HTTPException(status_code=404, detail="Transaction not found")
    if kind == "booking":
        booking = (await db.execute(select(Booking).where(Booking.id == reference_id)
                                    .options(selectinload(Booking.participants)))).scalar_one_or_none()
        if booking is None:
            raise missing
        mine = next((p for p in booking.participants or [] if p.participant_id == caller_id), None)
        if mine is None and booking.creator_id != caller_id:
            raise missing
        return Transaction(kind, reference_id, booking.photographer_id,
                           (mine.paid_amount or 0.0) if mine is not None else 0.0, _aware(booking.session_date))
    if kind == "live_session":
        row = (await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == reference_id,
                   or_(LiveSessionParticipant.surfer_id == caller_id,
                       LiveSessionParticipant.parent_buyer_id == caller_id))
            .order_by(LiveSessionParticipant.joined_at.desc()).limit(1))).scalar_one_or_none()
        if row is None:
            raise missing
        return Transaction(kind, reference_id, row.photographer_id, row.amount_paid or 0.0, _aware(row.joined_at))
    row = (await db.execute(
        select(GalleryPurchase)
        .where(GalleryPurchase.gallery_item_id == reference_id, GalleryPurchase.buyer_id == caller_id)
        .order_by(GalleryPurchase.purchased_at.desc()).limit(1))).scalar_one_or_none()
    if row is None:
        raise missing
    return Transaction(kind, reference_id, row.photographer_id, row.amount_paid or 0.0, _aware(row.purchased_at))


def check_against_transaction(data, txn: Transaction, amount: float, now=None):
    """Rules 2, 4 and 3, in that order."""
    if data.respondent_id and data.respondent_id != txn.respondent_id:
        raise _bad("The other party does not match this transaction")
    now = now or datetime.now(timezone.utc)
    if txn.at is not None and now - txn.at > timedelta(days=WINDOW_DAYS):
        raise _bad(f"Disputes must be opened within {WINDOW_DAYS} days of the transaction")
    if amount > txn.paid + CENT:
        raise _bad(f"The disputed amount cannot exceed what you paid in this transaction (${txn.paid:.2f})")


async def ensure_no_open_dispute(db, caller_id, txn: Transaction):
    """Rule 5."""
    existing = await db.execute(
        select(Dispute.id).where(Dispute.complainant_id == caller_id, txn.column == txn.reference_id,
                                 Dispute.status.in_(OPEN_STATUSES)).limit(1))
    if existing.first() is not None:
        raise HTTPException(status_code=409, detail="You already have an open dispute for this transaction")
