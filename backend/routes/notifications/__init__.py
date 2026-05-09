"""Notifications package — notifications, preferences, push delivery, push payloads."""
from fastapi import APIRouter

from .notifications import router as notifications_router
from .notification_prefs import router as notification_prefs_router
from .notification_preferences import router as notification_preferences_router
from .push import router as push_router
# push_payloads has no router (helper functions only), but we import for re-export
from . import push_payloads  # noqa: F401 — ensure module is importable

# Re-export should_send_notification for use by other modules
from .notification_preferences import should_send_notification

router = APIRouter()
router.include_router(notifications_router)
router.include_router(notification_prefs_router)
router.include_router(notification_preferences_router)
router.include_router(push_router)
