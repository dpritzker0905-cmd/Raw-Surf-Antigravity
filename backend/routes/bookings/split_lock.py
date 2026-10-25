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
from fastapi import HTTPException

CENT = 0.01


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
