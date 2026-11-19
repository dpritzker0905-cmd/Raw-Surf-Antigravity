"""The restore-link email for a scheduled account deletion (services/account_deletion). Same sender and service as the
password-reset email (Resend; RESEND_API_KEY). Neither the link (it IS the credential) nor the address is logged."""
from __future__ import annotations

import html
import logging
import os

logger = logging.getLogger(__name__)


def restore_link(token: str) -> str:
    base = (os.environ.get("APP_URL") or os.environ.get("FRONTEND_URL") or "https://raw.surf").rstrip("/")
    return f"{base}/restore-account?token={token}"


async def send_restore_email(email: str, token: str, name: str = None, purge_after_iso: str = "") -> bool:
    """Best effort: False when email is not configured or the send fails (the deletion is scheduled either way)."""
    key = os.environ.get("RESEND_API_KEY")
    if not key or not email:
        logger.warning("Restore email not sent: email is not configured")
        return False
    try:
        import resend
        resend.api_key = key
        link = html.escape(restore_link(token), quote=True)
        who = html.escape(name or email.split("@")[0])
        until = html.escape(purge_after_iso[:10]) if purge_after_iso else "30 days from now"
        resend.Emails.send({
            "from": "Raw Surf <noreply@raw.surf>",
            "to": [email],
            "subject": "Your Raw Surf account is scheduled for deletion",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;
                        margin: 0 auto; padding: 20px; color: #0f172a;">
              <h1 style="font-size: 20px;">Your account is scheduled for deletion</h1>
              <p>Hi {who},</p>
              <p>We received a request to delete your Raw Surf account. It is locked now, and it will be permanently
                 deleted on <strong>{until}</strong>.</p>
              <p>If you change your mind before then, you can restore it:</p>
              <p><a href="{link}" style="display: inline-block; padding: 12px 20px; background: #0f172a; color: #fff;
                    text-decoration: none; border-radius: 8px;">Restore my account</a></p>
              <p style="font-size: 13px; color: #475569;">If you asked for this deletion, you don't need to do
                 anything. This link works once, until the deletion date.</p>
            </div>""",
            "text": (f"Hi {name or ''},\n\nYour Raw Surf account is locked and will be permanently deleted on {until}.\n"
                     f"To restore it before then, open: {restore_link(token)}\n\n"
                     "If you asked for this deletion, you don't need to do anything."),
        })
        return True
    except Exception as exc:  # noqa: BLE001 - the deletion stands; only the email failed
        logger.error("Restore email failed (%s)", type(exc).__name__)
        return False
