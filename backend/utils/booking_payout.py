"""booking_payout.py -- the photographer is paid for what was actually FUNDED, once, when the booking is confirmed.

Before this, every crew confirm path paid its own amount: crew-pay credited the photographer 0.80 x total_price
when the last member paid, cover credited 0.80 x the remaining balance, and the scheduler and the expiry route
confirmed a booking and credited nothing. Because the captain's split editor only checked that the shares summed
(and let NaN, duplicates, unknown ids and negatives through), a booking could be configured so that less than
total_price was ever collected and still pay the photographer 0.80 x total_price: credit minted from nothing.

The rules, shared by every confirm path:

  * ONE conditional claim moves the booking to Confirmed:
        UPDATE bookings SET status='Confirmed' WHERE id=:id AND status IN ('Pending','PendingPayment')
    The path that wins the claim (rowcount 1) pays the photographer; every later or concurrent path loses it and
    pays nothing, so the photographer is credited at most once however the booking gets confirmed;
  * the amount is floor(0.80 x funded) in integer cents, where funded is what members actually paid (their
    recorded paid_amount) plus what the captain's cover debited, never the configured price;
  * a failed credit is an error that rolls the claim back, never a silently ignored add_credits result.
"""
import logging

from sqlalchemy import update

from models import Booking
from utils.credits import add_credits

logger = logging.getLogger(__name__)

PHOTOGRAPHER_PERCENT = 80
# A booking that is still waiting for money. Anything else (Confirmed, Completed, Cancelled, ...) is not claimable.
# "Pending Payment" (with a space) is the spelling the card-checkout flow uses (stripe_checkout.payment-success
# accepts both); tests/test_pay08_crew_pay.py pays into one.
CLAIMABLE_STATUSES = ("Pending", "PendingPayment", "Pending Payment")


class PayoutError(Exception):
    """The photographer could not be credited; the surrounding transaction must not be committed."""


def to_cents(amount) -> int:
    return int(round(float(amount or 0) * 100))


def funded_cents(booking, extra_cents: int = 0) -> int:
    """Whole cents actually collected: every participant's recorded paid_amount plus `extra_cents` (a cover debit)."""
    return sum(to_cents(p.paid_amount) for p in booking.participants or []) + int(extra_cents)


def photographer_cents(funded: int) -> int:
    """floor(0.80 x funded), in integer cents (never rounds a fraction of a cent up)."""
    return max(0, int(funded)) * PHOTOGRAPHER_PERCENT // 100


async def claim_confirmation(db, booking_id: str) -> bool:
    """Move the booking to Confirmed iff it is still awaiting payment. True for exactly one caller."""
    claimed = await db.execute(
        update(Booking).where(Booking.id == booking_id, Booking.status.in_(CLAIMABLE_STATUSES))
        .values(status="Confirmed").execution_options(synchronize_session=False))
    return claimed.rowcount == 1


async def pay_photographer(db, booking, funded: int, description: str, counterparty_id=None) -> float:
    """Credit floor(0.80 x funded) to the photographer. Raises PayoutError when the credit is refused."""
    cents = photographer_cents(funded)
    if cents <= 0:
        return 0.0
    ok, _balance, error = await add_credits(
        user_id=booking.photographer_id, amount=cents / 100, transaction_type='booking_earning', db=db,
        description=description, reference_type='booking', reference_id=booking.id,
        counterparty_id=counterparty_id)
    if not ok:
        logger.error("booking %s: photographer credit refused: %s", booking.id, error)
        raise PayoutError(error or "photographer credit refused")
    return cents / 100


async def confirm_and_pay(db, booking, description: str, counterparty_id=None, extra_funded_cents: int = 0) -> bool:
    """Claim the confirmation and, if this call won it, pay the photographer on the funded basis.

    Returns False (and pays nothing) when the booking was no longer awaiting payment.
    """
    if not await claim_confirmation(db, booking.id):
        return False
    booking.status = "Confirmed"
    await pay_photographer(db, booking, funded_cents(booking, extra_funded_cents), description, counterparty_id)
    return True
