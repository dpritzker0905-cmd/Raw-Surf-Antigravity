"""
notifications.py — Shared notification service for the Raw Surf backend.

Previously, Notification() objects were created inline 82 times across 30+ route files.
Using this service ensures consistent field usage and makes it easy to add
new notification fields (priority, ttl, deep_link) in one place.

Usage:
    from utils.notifications import send_notification, NotificationType
    await send_notification(
        db, user_id=target.id,
        type=NotificationType.NEW_BOOKING,
        title="New Booking Request",
        body=f"{requester.full_name} wants to book you",
        data={"booking_id": booking.id}
    )
"""

import json
import logging
from enum import Enum
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class NotificationType(str, Enum):
    """Canonical notification type strings. Add new types here — not inline."""

    # Auth / account
    GROM_LINK_REQUEST     = "grom_link_request"
    APPEAL_APPROVED       = "appeal_approved"
    APPEAL_DENIED         = "appeal_denied"
    TOS_VIOLATION         = "tos_violation"

    # Booking / dispatch
    NEW_BOOKING           = "new_booking"
    BOOKING_CONFIRMED     = "booking_confirmed"
    BOOKING_CANCELLED     = "booking_cancelled"
    BOOKING_REMINDER      = "booking_reminder"
    DISPATCH_ACCEPTED     = "dispatch_accepted"
    DISPATCH_CANCELLED    = "dispatch_cancelled"
    CREW_INVITE           = "crew_invite"

    # Social
    NEW_FOLLOWER          = "new_follower"
    POST_LIKE             = "post_like"
    POST_COMMENT          = "post_comment"
    COMMENT_REPLY         = "comment_reply"
    MENTION               = "mention"
    GO_LIVE               = "go_live"

    # Gallery / media
    GALLERY_PUBLISHED     = "gallery_published"
    PHOTO_PURCHASED       = "photo_purchased"

    # Photographer requests
    PHOTOGRAPHER_REQUEST           = "photographer_request"
    PHOTOGRAPHER_REQUEST_ACCEPTED   = "photographer_request_accepted"

    # Alerts
    SURF_ALERT            = "surf_alert"
    ALERT_SHARED          = "alert_shared"

    # Verification
    PRO_VERIFICATION_RESULT = "pro_verification_result"

    # Payments
    PAYMENT_RECEIVED      = "payment_received"
    PAYOUT_PROCESSED      = "payout_processed"


async def send_notification(
    db: AsyncSession,
    *,
    user_id: str,
    type: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    action_url: Optional[str] = None,
) -> None:
    """
    Create and persist a single in-app notification.

    Args:
        db:         Active async SQLAlchemy session.
        user_id:    Recipient profile ID.
        type:       Notification type string (use NotificationType enum).
        title:      Short notification title (< 80 chars).
        body:       Notification body text.
        data:       Optional dict of structured payload data. Serialized to JSON.
        action_url: Optional deep-link path (e.g. "/bookings/123").
    """
    try:
        from models import Notification  # Import here to avoid circular imports

        payload = data or {}
        if action_url:
            payload["action_url"] = action_url

        notification = Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            data=json.dumps(payload),
        )
        db.add(notification)
        # Caller is responsible for db.commit()

    except Exception as exc:
        logger.error(
            f"[notifications] Failed to create notification for user {user_id}: {exc}",
            exc_info=True,
        )


async def send_bulk_notifications(
    db: AsyncSession,
    *,
    user_ids: List[str],
    type: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    action_url: Optional[str] = None,
) -> int:
    """
    Create in-app notifications for multiple users at once.

    Args:
        db:       Active async SQLAlchemy session.
        user_ids: List of recipient profile IDs.
        (other args same as send_notification)

    Returns:
        Number of notifications created.
    """
    count = 0
    for user_id in user_ids:
        await send_notification(
            db,
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            data=data,
            action_url=action_url,
        )
        count += 1
    return count
