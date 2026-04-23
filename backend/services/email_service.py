"""
Email Service — SendGrid Integration for Raw Surf OS
Handles session recap emails, notification emails, and transactional messages.
Requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
SENDGRID_FROM_EMAIL = os.getenv('SENDGRID_FROM_EMAIL', 'noreply@rawsurf.com')
SENDGRID_FROM_NAME = os.getenv('SENDGRID_FROM_NAME', 'Raw Surf OS')
APP_URL = os.getenv('FRONTEND_URL', 'https://rawsurf.netlify.app')


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    plain_text: Optional[str] = None
) -> bool:
    """Send an email via SendGrid. Returns True on success."""
    if not SENDGRID_API_KEY:
        logger.warning("[Email] SENDGRID_API_KEY not set — skipping email send")
        return False

    try:
        import httpx
        
        payload = {
            "personalizations": [{"to": [{"email": to_email}]}],
            "from": {"email": SENDGRID_FROM_EMAIL, "name": SENDGRID_FROM_NAME},
            "subject": subject,
            "content": []
        }
        
        if plain_text:
            payload["content"].append({"type": "text/plain", "value": plain_text})
        payload["content"].append({"type": "text/html", "value": html_content})

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={
                    "Authorization": f"Bearer {SENDGRID_API_KEY}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=10.0
            )
            
            if response.status_code in (200, 201, 202):
                logger.info(f"[Email] Sent to {to_email}: {subject}")
                return True
            else:
                logger.error(f"[Email] SendGrid error {response.status_code}: {response.text}")
                return False

    except ImportError:
        logger.warning("[Email] httpx not installed — pip install httpx for email support")
        return False
    except Exception as e:
        logger.error(f"[Email] Failed to send to {to_email}: {e}")
        return False


async def send_session_recap_email(
    to_email: str,
    photographer_name: str,
    spot_name: str,
    duration_mins: int,
    photo_count: int,
    gallery_id: Optional[str] = None,
    live_session_id: Optional[str] = None,
) -> bool:
    """Send a session recap email to a participant after a session ends."""
    gallery_url = f"{APP_URL}/photographer/galleries/{gallery_id}" if gallery_id else f"{APP_URL}/my-gallery"
    
    duration_str = f"{duration_mins // 60}h {duration_mins % 60}m" if duration_mins >= 60 else f"{duration_mins}m"
    
    subject = f"🏄 Your session with {photographer_name} is complete!"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="margin:0;padding:0;background-color:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:24px;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#0891b2,#059669);border-radius:16px 16px 0 0;padding:32px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">🏄 Session Complete!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">
            Your photos from {spot_name or 'the session'} are ready
          </p>
        </div>
        
        <!-- Stats -->
        <div style="background:#18181b;padding:24px;border-left:1px solid #27272a;border-right:1px solid #27272a;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:12px;text-align:center;border-bottom:1px solid #27272a;">
                <div style="color:#06b6d4;font-size:24px;font-weight:700;">{photographer_name}</div>
                <div style="color:#71717a;font-size:12px;margin-top:4px;">Photographer</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 12px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="text-align:center;padding:8px;">
                      <div style="color:#fff;font-size:20px;font-weight:700;">{spot_name or '—'}</div>
                      <div style="color:#71717a;font-size:11px;">Location</div>
                    </td>
                    <td style="text-align:center;padding:8px;">
                      <div style="color:#fff;font-size:20px;font-weight:700;">{duration_str}</div>
                      <div style="color:#71717a;font-size:11px;">Duration</div>
                    </td>
                    <td style="text-align:center;padding:8px;">
                      <div style="color:#fff;font-size:20px;font-weight:700;">{photo_count}</div>
                      <div style="color:#71717a;font-size:11px;">Photos</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
        
        <!-- CTA -->
        <div style="background:#18181b;padding:24px;text-align:center;border-left:1px solid #27272a;border-right:1px solid #27272a;border-bottom:1px solid #27272a;border-radius:0 0 16px 16px;">
          <a href="{gallery_url}" 
             style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#10b981);color:#000;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;">
            View Your Photos →
          </a>
          <p style="color:#52525b;font-size:12px;margin:16px 0 0;">
            Photos will be available in your gallery for 30 days.
          </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align:center;padding:24px 0;">
          <p style="color:#52525b;font-size:11px;margin:0;">
            Raw Surf OS — The Surf Photography Platform
          </p>
          <p style="color:#3f3f46;font-size:10px;margin:4px 0 0;">
            <a href="{APP_URL}/settings" style="color:#3f3f46;">Unsubscribe</a> · 
            <a href="{APP_URL}" style="color:#3f3f46;">rawsurf.com</a>
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    
    plain_text = (
        f"Session Complete! Your session with {photographer_name} at {spot_name or 'the spot'} "
        f"is finished. Duration: {duration_str}. View your photos: {gallery_url}"
    )
    
    return await send_email(to_email, subject, html_content, plain_text)
