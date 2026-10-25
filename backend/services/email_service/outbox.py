"""Outbox: enqueue (inside the caller's transaction) and deliver (after the caller commits).

    result = await enqueue_email(db, "guardian_invite", to, params, idempotency_key="guardian_invite:<invite id>")
    await db.commit()
    if result.queued:
        background_tasks.add_task(deliver_outbox_entry, result.outbox_id)

Nothing here runs in the request path beyond one INSERT; the HTTP call to the provider is the worker's.
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from . import config
from .base import EmailMessage, EmailSender, address_hash, is_valid_address, log_ref, normalize_address
from .senders import build_sender
from .templates import TemplateError, render

logger = logging.getLogger(__name__)

BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 30.0
CLAIM_SECONDS = 300
MAX_KEY_LENGTH = 200


@dataclass(frozen=True)
class EnqueueResult:
    """`status`: queued | duplicate | suppressed | rate_limited | not_configured | invalid."""

    status: str
    outbox_id: Optional[str] = None
    detail: str = ""

    @property
    def queued(self) -> bool:
        """True only when a NEW message is waiting for a worker: schedule `deliver_outbox_entry` for it."""
        return self.status == "queued"

    @property
    def ok(self) -> bool:
        """The message is, or already was, accepted for delivery. False for every refusal."""
        return self.status in ("queued", "duplicate")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _default_session_factory():
    from database import AsyncSessionLocal  # lazy: importing it builds the engine
    return AsyncSessionLocal


async def is_suppressed(db, recipient_hash: str) -> bool:
    from models.email_outbox import EmailSuppression
    row = await db.execute(select(EmailSuppression.id).where(EmailSuppression.recipient_hash == recipient_hash))
    return row.first() is not None


async def enqueue_email(
    db,
    template: str,
    to: str,
    params: Optional[dict],
    idempotency_key: str,
    sender: Optional[EmailSender] = None,
) -> EnqueueResult:
    """Validate, apply the safety checks and INSERT one outbox row. The caller commits."""
    from models.email_outbox import EmailOutbox

    if not idempotency_key or len(idempotency_key) > MAX_KEY_LENGTH:
        return EnqueueResult("invalid", detail="bad_idempotency_key")
    sender = sender or build_sender()
    if not sender.configured:
        return EnqueueResult("not_configured", detail="email is not configured; nothing was sent")
    address = normalize_address(to)
    if not is_valid_address(address):
        return EnqueueResult("invalid", detail="bad_recipient")
    try:
        render(template, params)  # fail fast on a bad template or params; the worker renders again
    except TemplateError as exc:
        return EnqueueResult("invalid", detail=str(exc))

    existing = (await db.execute(
        select(EmailOutbox.id, EmailOutbox.status).where(EmailOutbox.idempotency_key == idempotency_key)
    )).first()
    if existing:
        return EnqueueResult("duplicate", outbox_id=existing[0], detail=existing[1])

    recipient_hash = address_hash(address)
    if await is_suppressed(db, recipient_hash):
        row = EmailOutbox(template=template, recipient_hash=recipient_hash, status="suppressed",
                          idempotency_key=idempotency_key, last_error="suppressed")
        return await _insert(db, row, "suppressed")

    since = _now() - timedelta(hours=1)
    counted = EmailOutbox.status.in_(("queued", "sent", "failed"))
    per_recipient = (await db.execute(select(func.count()).select_from(EmailOutbox).where(
        EmailOutbox.recipient_hash == recipient_hash, EmailOutbox.created_at >= since, counted))).scalar_one()
    if per_recipient >= config.rate_per_recipient_per_hour():
        logger.warning("[email] rate limit (recipient) template=%s to_ref=%s", template, log_ref(address))
        return EnqueueResult("rate_limited", detail="recipient")
    overall = (await db.execute(select(func.count()).select_from(EmailOutbox).where(
        EmailOutbox.created_at >= since, counted))).scalar_one()
    if overall >= config.rate_global_per_hour():
        logger.warning("[email] rate limit (global) template=%s", template)
        return EnqueueResult("rate_limited", detail="global")

    row = EmailOutbox(template=template, recipient_hash=recipient_hash, recipient_address=address,
                      payload=dict(params or {}), status="queued", idempotency_key=idempotency_key)
    return await _insert(db, row, "queued")


async def _insert(db, row, status: str) -> EnqueueResult:
    """INSERT under a savepoint: a concurrent twin with the same idempotency key loses the UNIQUE race and
    is reported as a duplicate instead of poisoning the caller's transaction."""
    from models.email_outbox import EmailOutbox
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        found = (await db.execute(
            select(EmailOutbox.id, EmailOutbox.status).where(EmailOutbox.idempotency_key == row.idempotency_key)
        )).first()
        return EnqueueResult("duplicate", outbox_id=found[0] if found else None, detail=found[1] if found else "")
    return EnqueueResult(status, outbox_id=row.id)


async def suppress_address(db, address: str, reason: str) -> bool:
    """Add to the suppression list (idempotent) and cancel anything still queued for it. The caller commits."""
    from models.email_outbox import EmailOutbox, EmailSuppression
    recipient_hash = address_hash(address)
    created = False
    if not await is_suppressed(db, recipient_hash):
        try:
            async with db.begin_nested():
                db.add(EmailSuppression(recipient_hash=recipient_hash, reason=reason))
                await db.flush()
            created = True
        except IntegrityError:
            pass
    await db.execute(
        update(EmailOutbox)
        .where(EmailOutbox.recipient_hash == recipient_hash, EmailOutbox.status == "queued")
        .values(status="suppressed", recipient_address=None, payload=None, last_error="suppressed")
    )
    return created


def _backoff(attempt: int, base: float) -> float:
    return min(BACKOFF_CAP_SECONDS, base * (2 ** max(0, attempt - 1)))


async def deliver_outbox_entry(
    outbox_id: str,
    *,
    sender: Optional[EmailSender] = None,
    session_factory=None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    backoff_base: float = BACKOFF_BASE_SECONDS,
) -> str:
    """Send one queued message with bounded retries and exponential backoff. Safe to call twice: a second
    worker cannot claim a row another holds, and a terminal row is never touched. Returns the row's status
    (`queued` also means "nothing done": not configured, or claimed elsewhere)."""
    from models.email_outbox import EmailOutbox

    sender = sender or build_sender()
    if not sender.configured:
        logger.info("[email] worker skipped: email not configured outbox=%s", outbox_id)
        return "queued"
    factory = session_factory or _default_session_factory()
    max_attempts = config.max_attempts()

    async with factory() as db:
        claim = await db.execute(
            update(EmailOutbox)
            .where(EmailOutbox.id == outbox_id, EmailOutbox.status == "queued",
                   or_(EmailOutbox.claimed_until.is_(None), EmailOutbox.claimed_until < _now()))
            .values(claimed_until=_now() + timedelta(seconds=CLAIM_SECONDS))
        )
        await db.commit()
        if claim.rowcount != 1:
            row = (await db.execute(select(EmailOutbox.status).where(EmailOutbox.id == outbox_id))).first()
            return row[0] if row else "missing"

        while True:
            row = (await db.execute(select(EmailOutbox).where(EmailOutbox.id == outbox_id))).scalar_one()
            if await is_suppressed(db, row.recipient_hash):
                return await _finish(db, row, "suppressed", error="suppressed")
            if row.attempts >= max_attempts:
                return await _finish(db, row, "failed", error=row.last_error or "max_attempts")
            try:
                rendered = render(row.template, row.payload or {})
            except TemplateError as exc:
                return await _finish(db, row, "failed", error=("template:" + str(exc))[:64])

            message = EmailMessage(to=row.recipient_address or "", subject=rendered.subject, html=rendered.html,
                                   text=rendered.text, template=row.template)
            result = await sender.send(message, row.idempotency_key)
            row.attempts += 1
            if result.ok:
                return await _finish(db, row, "sent", provider_message_id=result.provider_message_id)
            row.last_error = (result.error or "error")[:64]
            logger.warning("[email] send failed template=%s to_ref=%s attempt=%s error=%s",
                           row.template, log_ref(row.recipient_address or ""), row.attempts, row.last_error)
            if not result.retryable or row.attempts >= max_attempts:
                return await _finish(db, row, "failed", error=row.last_error)
            await db.commit()
            await sleep(_backoff(row.attempts, backoff_base))


async def _finish(db, row, status: str, *, error: Optional[str] = None, provider_message_id: Optional[str] = None) -> str:
    row.status = status
    row.claimed_until = None
    if error:
        row.last_error = error[:64]
    if provider_message_id:
        row.provider_message_id = provider_message_id
    # Terminal: keep neither the address nor the single-use token.
    row.recipient_address = None
    row.payload = None
    await db.commit()
    logger.info("[email] outbox=%s template=%s status=%s attempts=%s", row.id, row.template, status, row.attempts)
    return status


async def sweep_queued(limit: int = 50, *, sender: Optional[EmailSender] = None, session_factory=None,
                       min_age_seconds: int = 60) -> int:
    """Re-drive rows stuck in `queued` (a restart killed their worker). Not scheduled by this PR."""
    from models.email_outbox import EmailOutbox
    factory = session_factory or _default_session_factory()
    cutoff = _now() - timedelta(seconds=min_age_seconds)
    async with factory() as db:
        ids = [r[0] for r in (await db.execute(
            select(EmailOutbox.id)
            .where(EmailOutbox.status == "queued", EmailOutbox.created_at <= cutoff,
                   or_(EmailOutbox.claimed_until.is_(None), EmailOutbox.claimed_until < _now()))
            .order_by(EmailOutbox.created_at).limit(limit)
        )).all()]
    for outbox_id in ids:
        await deliver_outbox_entry(outbox_id, sender=sender, session_factory=factory)
    return len(ids)
