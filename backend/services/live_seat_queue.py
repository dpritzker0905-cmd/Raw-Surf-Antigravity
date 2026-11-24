"""The bounded work queue shared by live-seat settlement and its read-only worker."""
from datetime import datetime, timezone

from sqlalchemy import func, or_, select


def last_checked(tx):
    return func.coalesce(tx.updated_at, tx.created_at, datetime(1970, 1, 1, tzinfo=timezone.utc))


def needs_recovery(tx):
    return tx.status.is_distinct_from("verification_required") & or_(
        tx.payment_status.in_(("Pending", "Abandoned")),
        (tx.payment_status == "Completed") & ~tx.transaction_metadata.contains('"settled_participant_id"'),
    )


def pending_seat_ids(tx, stale):
    checked = last_checked(tx)
    return select(tx.id).where(
        needs_recovery(tx), tx.transaction_metadata.contains('"live_session_join"'), checked <= stale,
    ).order_by(checked, tx.id).limit(100)
