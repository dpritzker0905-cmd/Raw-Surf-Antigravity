"""Email provider bounce/complaint webhook -> suppression list.

POST /api/email/webhook is public by design (the provider has no user token): it is authorised by the
provider signature and FAILS CLOSED while EMAIL_WEBHOOK_SECRET is unset (503), exactly like the Stripe webhook.
It never logs an address, only a short hash reference.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.email_service import config
from services.email_service.base import is_valid_address, log_ref, normalize_address
from services.email_service.outbox import suppress_address
from services.email_service.webhook import verify

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_BODY_BYTES = 256 * 1024

# event type -> suppression reason. A TRANSIENT bounce (mailbox full, greylisting) is not a reason to stop
# sending; a permanent bounce, a spam complaint or the provider's own suppression is.
_REASONS = {"email.bounced": "bounce", "email.complained": "complaint", "email.suppressed": "bounce"}


def _is_permanent(event_type: str, data: dict) -> bool:
    if event_type != "email.bounced":
        return True
    kind = str((data.get("bounce") or {}).get("type") or "").lower()
    return kind in ("", "permanent", "hard")  # unknown -> treat as permanent: the safe direction


@router.post("/email/webhook")
async def email_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    secret = config.webhook_secret()
    if not secret:
        logger.critical("Email webhook rejected because EMAIL_WEBHOOK_SECRET is not configured")
        raise HTTPException(status_code=503, detail="Webhook verification is not configured")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    if not verify(secret, request.headers.get("svix-id", ""), request.headers.get("svix-timestamp", ""),
                  request.headers.get("svix-signature", ""), body):
        raise HTTPException(status_code=400, detail="Invalid signature")
    try:
        event = json.loads(body)
        event_type = str(event.get("type") or "")
        data = event.get("data") or {}
        recipients = data.get("to") or []
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Malformed payload")

    reason = _REASONS.get(event_type)
    if not reason or not _is_permanent(event_type, data) or not isinstance(recipients, list):
        return {"ok": True, "suppressed": 0}  # a verified event we deliberately ignore
    added = 0
    for raw in recipients:
        address = normalize_address(str(raw))
        if not is_valid_address(address):
            continue
        if await suppress_address(db, address, reason):
            added += 1
        logger.warning("[email] suppressed to_ref=%s reason=%s", log_ref(address), reason)
    await db.commit()
    return {"ok": True, "suppressed": added}
