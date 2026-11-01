"""split_lock.py -- a crew member who has PAID owns that share: the captain cannot re-price it afterwards.

Both split editors (update-splits and crew-hub/update-splits) let the captain re-divide the booking price among
the crew. Before this, nothing stopped the captain from lowering (or raising) the share of someone who had already
paid, which makes the paid amount disagree with the share it was paid against and lets the unpaid balance be
moved onto, or off, a member behind their back. The rules, applied identically by both editors:

  * a member whose payment_status is "Paid" (and who is not simply covered by the captain) keeps the share they
    paid: the submitted amount must equal it (to the cent);
  * nobody's share may be set below what they have already paid.

Everything else is unchanged: unpaid members can be re-divided freely as long as the total is preserved.
"""
import math

from fastapi import HTTPException

from utils.booking_payout import CLAIMABLE_STATUSES

CENT = 0.01


def check_splits(booking, members, splits, captain_share=0.0, required=None):
    """Shape and total rules both split editors share (2026-10-25); raises 400 and changes nothing.

    * the booking must still be waiting for money (Pending / PendingPayment), not Confirmed or Cancelled;
    * every split names a member of THIS booking, once, with a finite, non-negative amount; `captain_share`
      (crew hub only) is finite and non-negative and is counted once, in the total;
    * every id in `required` appears (so no member keeps a stale share that pushes the real total away from the
      price);
    * the total equals the booking price in whole cents. The sum is rounded as a whole (not each share), so three
      equal thirds of a price still pass, while a NaN, an offsetting negative or a missing share cannot.

    `members` maps participant_id -> BookingParticipant.
    """
    if booking.status not in CLAIMABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Splits can only be changed while the booking awaits payment")
    seen = set()
    for split in splits:
        if not math.isfinite(split.share_amount) or split.share_amount < 0:
            raise HTTPException(status_code=400, detail="Split amounts must be non-negative numbers")
        if split.participant_id not in members or split.participant_id in seen:
            raise HTTPException(status_code=400, detail="Splits must name each crew member of this booking once")
        seen.add(split.participant_id)
    if required is not None and not set(required) <= seen:
        raise HTTPException(status_code=400, detail="Splits must name each crew member of this booking once")
    if not math.isfinite(captain_share) or captain_share < 0:
        raise HTTPException(status_code=400, detail="The captain share must be a non-negative number")
    total = sum(s.share_amount for s in splits) + captain_share
    if round(total * 100) != round(booking.total_price * 100):
        raise HTTPException(
            status_code=400,
            detail=f"Split total (${total:.2f}) must equal booking price (${booking.total_price:.2f})")


def locked_share(participant):
    """The amount a paid member's share is frozen at, or None when the share is still free to change."""
    if participant.payment_status != "Paid" or participant.covered_by_captain:
        return None
    share = participant.share_amount or 0.0
    return share if share > 0 else (participant.paid_amount or 0.0)


def enforce_paid_shares(members, splits):
    """Raise 400 when `splits` would re-price a paid member or push a share under what was already paid.

    `members` maps participant_id -> BookingParticipant; `splits` carry .participant_id and .share_amount.
    """
    for split in splits:
        member = members[split.participant_id]
        frozen = locked_share(member)
        if frozen is not None and abs(split.share_amount - frozen) > CENT:
            raise HTTPException(status_code=400, detail="A crew member who has already paid keeps their share")
        if split.share_amount + CENT < (member.paid_amount or 0.0):
            raise HTTPException(status_code=400, detail="A share cannot be set below what the member has already paid")
