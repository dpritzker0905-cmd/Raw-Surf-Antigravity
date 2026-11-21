"""The live session a card checkout can fulfill."""
from sqlalchemy import or_, select

from models import LiveSession


REVIEW_MESSAGE = (
    "Payment received. We couldn't confirm your original live session. "
    "Contact support about this payment before paying again."
)


def active_card_session(photographer_id):
    return (
        select(LiveSession)
        .where(
            LiveSession.photographer_id == photographer_id,
            LiveSession.status == "active",
            or_(LiveSession.session_mode == "live_join", LiveSession.session_mode.is_(None)),
        )
        .order_by(LiveSession.created_at.desc().nulls_last(), LiveSession.id.desc())
        .limit(1)
    )
