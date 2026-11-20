from sqlalchemy import func, or_, select

from models import LiveSession, Profile


def resolve_live_buyin(live_price: float | None, session_price: float | None = None) -> float:
    if live_price is not None:
        return live_price
    return session_price if session_price is not None else 25.0


def current_live_session(photographer_id, selection=LiveSession):
    """Use the same session for the displayed quote, charge and seat."""
    return (
        select(selection)
        .where(
            LiveSession.photographer_id == photographer_id,
            LiveSession.status == "active",
            or_(LiveSession.session_mode == "live_join", LiveSession.session_mode.is_(None)),
        )
        .order_by(LiveSession.created_at.desc().nulls_last(), LiveSession.id.desc())
        .limit(1)
    )


def listed_live_buyin():
    """Select the session rate alongside each profile in one directory query."""
    recorded = (
        current_live_session(Profile.id, LiveSession.buyin_price)
        .where(Profile.is_shooting.is_(True))
        .correlate(Profile)
    )
    return func.coalesce(recorded.scalar_subquery(), Profile.live_buyin_price)


def session_buyin(photographer, active_session):
    if active_session is not None and active_session.buyin_price is not None:
        return active_session.buyin_price
    return resolve_live_buyin(photographer.live_buyin_price, photographer.session_price)
