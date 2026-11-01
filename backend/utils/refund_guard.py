"""refund_guard.py -- a refund is paid to whoever PAID, never to the seller of the transaction it refunds.

The owner's policy P1 is that refunds never reach the photographer. Two admin paths name the beneficiary of a
refund by a plain user id (the refund-request approval, and the dispute resolution refund) and nothing checked
who that user was relative to the transaction, so a refund could be credited to the photographer or seller. This is
the one check both use.

A user is the SELLER of a transaction when they are the photographer of the booking / live session / gallery item
it refers to, or the counterparty on the original ledger row, and they did not also pay into it (a photographer
who booked their own session did pay, and may be refunded that payment).
"""
from fastapi import HTTPException
from sqlalchemy import select

from models import Booking, BookingParticipant, CreditTransaction, GalleryItem, GalleryPurchase, LiveSession
from models import LiveSessionParticipant

SELLER_REFUSAL = "A refund cannot be credited to the seller of the transaction"


async def is_seller_of(db, user_id, *, booking_id=None, live_session_id=None, gallery_item_id=None,
                       transaction_id=None, respondent_id=None) -> bool:
    """True when `user_id` is on the selling side of any transaction named, and did not pay into it."""
    if respondent_id is not None and respondent_id == user_id:
        return True

    if booking_id:
        booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
        if booking is not None and booking.photographer_id == user_id:
            paid = (await db.execute(
                select(BookingParticipant.id).where(BookingParticipant.booking_id == booking_id,
                                                    BookingParticipant.participant_id == user_id,
                                                    BookingParticipant.paid_amount > 0).limit(1))).first()
            if paid is None:
                return True

    if live_session_id:
        session = (await db.execute(select(LiveSession).where(LiveSession.id == live_session_id))).scalar_one_or_none()
        if session is not None and session.photographer_id == user_id:
            paid = (await db.execute(
                select(LiveSessionParticipant.id).where(LiveSessionParticipant.live_session_id == live_session_id,
                                                        LiveSessionParticipant.surfer_id == user_id,
                                                        LiveSessionParticipant.amount_paid > 0).limit(1))).first()
            if paid is None:
                return True

    if gallery_item_id:
        item = (await db.execute(select(GalleryItem).where(GalleryItem.id == gallery_item_id))).scalar_one_or_none()
        if item is not None and item.photographer_id == user_id:
            bought = (await db.execute(
                select(GalleryPurchase.id).where(GalleryPurchase.gallery_item_id == gallery_item_id,
                                                 GalleryPurchase.buyer_id == user_id).limit(1))).first()
            if bought is None:
                return True

    if transaction_id:
        tx = (await db.execute(select(CreditTransaction).where(CreditTransaction.id == transaction_id))).scalar_one_or_none()
        if tx is not None and tx.counterparty_id == user_id and tx.user_id != user_id:
            return True

    return False


async def assert_not_seller(db, user_id, **transaction) -> None:
    """Raise 400 when the proposed refund beneficiary is the seller of the transaction being refunded."""
    if await is_seller_of(db, user_id, **transaction):
        raise HTTPException(status_code=400, detail=SELLER_REFUSAL)
