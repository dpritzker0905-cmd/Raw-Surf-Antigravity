"""Escrow for a live-session buy-in: the photographer's share is held until the buyer acts.

Owner policy (2026-10-08):
  * A surfer who leaves within EARLY_LEAVE_MINUTES gets the full buy-in back as credits.
  * The photographer's share (PHOTOGRAPHER_SHARE of the buy-in) is HELD from the join instead of paid.
  * It is RELEASED when the buyer acts on the media delivered to their gallery for that session:
    confirms or rejects a match, favourites, changes visibility, downloads, or selects included
    photos/videos. Opening or viewing the gallery is not an action.
  * If the buyer never acts, it is released AUTO_RELEASE_AFTER the join (the same 7 days bookings use).
  * An early-leave refund CANCELS the hold, at most once per surfer per session; a hold that was
    already released (the buyer acted on delivered media) is not refunded.

Every state change claims the row with a conditional UPDATE (held -> released/cancelled), so two
concurrent callers can never both pay or both refund. A NULL escrow_status marks a row created
before escrow existed, whose share was paid at join.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, or_, select, update

from models import (
    CreditTransaction, LiveSessionParticipant, Notification, Profile, SurferGalleryItem, SurferSelectionQuota,
)

logger = logging.getLogger(__name__)

PHOTOGRAPHER_SHARE = 0.80
EARLY_LEAVE_MINUTES = 10
AUTO_RELEASE_AFTER = timedelta(days=7)
SAME_SESSION_WINDOW = timedelta(hours=24)  # when a participant has no live_session_id
HELD, RELEASED, CANCELLED = "held", "released", "cancelled"


def _aware(moment):
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def hold(participant, price):
    """Hold the photographer's share of a paid buy-in on a new participant row."""
    amount = round(float(price or 0) * PHOTOGRAPHER_SHARE, 2)
    participant.escrow_amount = amount
    participant.escrow_status = HELD if amount > 0 else None


async def _claim(db, participant, to_status, now):
    """held -> to_status, exactly once across concurrent callers."""
    values = {"escrow_status": to_status}
    if to_status == RELEASED:
        values["escrow_released_at"] = now
    result = await db.execute(
        update(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == participant.id, LiveSessionParticipant.escrow_status == HELD)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        return False
    for key, value in values.items():
        setattr(participant, key, value)
    return True


async def release(db, participant, reason, now=None):
    """Pay the held share to the photographer. Returns False if it was not held (nothing paid)."""
    now = now or datetime.now(timezone.utc)
    if not await _claim(db, participant, RELEASED, now):
        return False
    amount = float(participant.escrow_amount or 0)
    photographer = (await db.execute(
        select(Profile).where(Profile.id == participant.photographer_id).with_for_update()
    )).scalar_one_or_none()
    if photographer is None or amount <= 0:
        return True

    from utils.revenue_routing import is_hobbyist_creator, is_pro_creator

    # The same routing the join used to apply: pros earn withdrawable credits, hobbyists gear credits,
    # and credit_balance always grows by the earning (never replaced by a bucket total).
    before = photographer.credit_balance or 0
    if is_pro_creator(photographer.role):
        photographer.withdrawable_credits = (photographer.withdrawable_credits or 0) + amount
    elif is_hobbyist_creator(photographer.role):
        photographer.gear_only_credits = (photographer.gear_only_credits or 0) + amount
    photographer.credit_balance = before + amount
    db.add(CreditTransaction(
        user_id=photographer.id, amount=amount, balance_before=before, balance_after=photographer.credit_balance,
        transaction_type="live_session_earning",
        description="Live session buy-in released" + (" (buyer reviewed the photos)" if reason == "acted" else ""),
        reference_type="live_session", reference_id=participant.id, counterparty_id=participant.surfer_id,
    ))
    db.add(Notification(
        user_id=photographer.id, type="escrow_released", title="Payment Released!",
        body=f"${amount:.2f} from a live session has been added to your account.",
        data=json.dumps({"participant_id": participant.id, "amount": amount, "reason": reason}),
    ))
    return True


async def cancel_for_early_leave(db, participant, now=None):
    """Cancel a held share so the buy-in can be refunded. False if it was not held."""
    return await _claim(db, participant, CANCELLED, now or datetime.now(timezone.utc))


def _same_session(model, participant, delivered_column):
    if participant.live_session_id:
        return model.live_session_id == participant.live_session_id
    return delivered_column >= participant.joined_at


async def already_refunded_early(db, participant):
    """True if this surfer already had an early-leave refund in the same session."""
    joined = _aware(participant.joined_at)
    query = select(exists(select(LiveSessionParticipant.id).where(
        LiveSessionParticipant.id != participant.id,
        LiveSessionParticipant.surfer_id == participant.surfer_id,
        LiveSessionParticipant.photographer_id == participant.photographer_id,
        LiveSessionParticipant.escrow_status == CANCELLED,
        (LiveSessionParticipant.live_session_id == participant.live_session_id) if participant.live_session_id
        else (LiveSessionParticipant.joined_at >= joined - SAME_SESSION_WINDOW),
    )))
    return bool((await db.execute(query)).scalar())


async def buyer_has_acted(db, participant):
    """True once the buyer has acted on media delivered to them for this participant's session."""
    item_acted = select(SurferGalleryItem.id).where(
        SurferGalleryItem.surfer_id == participant.surfer_id,
        SurferGalleryItem.photographer_id == participant.photographer_id,
        _same_session(SurferGalleryItem, participant, SurferGalleryItem.added_at),
        or_(
            SurferGalleryItem.surfer_confirmed.is_(True),
            SurferGalleryItem.surfer_rejected.is_(True),
            SurferGalleryItem.is_favorite.is_(True),
            SurferGalleryItem.visibility_changed_at.isnot(None),
            SurferGalleryItem.downloaded_at.isnot(None),
        ),
    )
    selected = select(SurferSelectionQuota.id).where(
        SurferSelectionQuota.surfer_id == participant.surfer_id,
        SurferSelectionQuota.photographer_id == participant.photographer_id,
        _same_session(SurferSelectionQuota, participant, SurferSelectionQuota.created_at),
        or_(SurferSelectionQuota.photos_selected > 0, SurferSelectionQuota.videos_selected > 0),
    )
    for query in (item_acted, selected):
        if (await db.execute(select(exists(query)))).scalar():
            return True
    return False


async def release_due(db, now=None):
    """Release every held share whose buyer has acted, or whose join is AUTO_RELEASE_AFTER old."""
    now = now or datetime.now(timezone.utc)
    held = (await db.execute(
        select(LiveSessionParticipant).where(LiveSessionParticipant.escrow_status == HELD)
    )).scalars().all()
    counts = {"acted": 0, "auto_7d": 0}
    for participant in held:
        joined = _aware(participant.joined_at)
        if joined is not None and now - joined >= AUTO_RELEASE_AFTER:
            reason = "auto_7d"
        elif await buyer_has_acted(db, participant):
            reason = "acted"
        else:
            continue
        if await release(db, participant, reason, now=now):
            counts[reason] += 1
    return counts
