"""Outbox: enqueue (inside the caller's transaction) and deliver (after the caller commits).

    result = await enqueue_email(db, "guardian_invite", to, params, idempotency_key="guardian_invite:<invite id>")
    await db.commit()
    if result.queued:
        background_tasks.add_task(deliver_outbox_entry, result.outbox_id)

Nothing here runs in the request path beyond one INSERT; the HTTP call to the provider is the worker's.

PRIORITY CLASSES (built for a free plan with a hard daily cap, e.g. Resend's 100/day):
  * `security` mail (guardian invites, sign-in and lockout notices, password reset) is never delayed by the
    daily budget and is never merged into a digest. Its rate limits are counted apart from low-priority mail, so
    a flood of notices to one address cannot use up that address's allowance for a guardian invite.
  * `low` mail (routine notices) waits EMAIL_DIGEST_WINDOW_MINUTES, is merged with that recipient's other
    waiting notices into ONE email, and is held back (to the next UTC day) once the day's sends reach 80% of
    EMAIL_DAILY_CAP. That 20% is the reserve security mail draws on.
"""
import asyncio
import hashlib
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, List, Optional

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from . import config
from .base import EmailMessage, EmailSender, address_hash, is_valid_address, log_ref, normalize_address
from .senders import build_sender
from .templates import LOW, MAX_DIGEST_ITEMS, SECURITY, TEMPLATES, TemplateError, priority_of, render

logger = logging.getLogger(__name__)

BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 30.0
CLAIM_SECONDS = 300
MAX_KEY_LENGTH = 200
LOW_PRIORITY_SHARE = 0.8  # low-priority mail may use this share of the daily cap; the rest is security's

_warned_on: Optional[date] = None  # the UTC day the 80% warning was last logged (once a day, not per send)


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


def _next_utc_midnight(now: datetime) -> datetime:
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1)


def _default_session_factory():
    from database import AsyncSessionLocal  # lazy: importing it builds the engine
    return AsyncSessionLocal


async def is_suppressed(db, recipient_hash: str) -> bool:
    from models.email_outbox import EmailSuppression
    row = await db.execute(select(EmailSuppression.id).where(EmailSuppression.recipient_hash == recipient_hash))
    return row.first() is not None


async def sent_today(db, now: Optional[datetime] = None) -> int:
    """EMAILS sent in the current UTC day (the provider's quota day). A digest of several rows is one email."""
    from models.email_outbox import EmailOutbox
    now = now or _now()
    midnight = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return (await db.execute(
        select(func.count(func.distinct(EmailOutbox.provider_message_id)))
        .where(EmailOutbox.status == "sent", EmailOutbox.updated_at >= midnight,
               EmailOutbox.provider_message_id.is_not(None))
    )).scalar_one()


def _note_budget(used: int, cap: int, now: datetime) -> None:
    global _warned_on
    if used * 5 >= cap * 4 and _warned_on != now.date():  # >= 80%
        _warned_on = now.date()
        logger.warning("[email] daily send budget at %s of %s (80%% or more): low-priority mail is held until "
                       "the next UTC day, security mail continues", used, cap)


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

    priority = priority_of(template)
    recipient_hash = address_hash(address)
    if await is_suppressed(db, recipient_hash):
        row = EmailOutbox(template=template, recipient_hash=recipient_hash, priority=priority, status="suppressed",
                          idempotency_key=idempotency_key, last_error="suppressed")
        return await _insert(db, row, "suppressed")

    # Limits are counted per priority class, so routine notices can never use up the allowance security mail needs.
    since = _now() - timedelta(hours=1)
    counted = (EmailOutbox.status.in_(("queued", "sent", "failed")), EmailOutbox.priority == priority,
               EmailOutbox.created_at >= since)
    per_recipient = (await db.execute(select(func.count()).select_from(EmailOutbox).where(
        EmailOutbox.recipient_hash == recipient_hash, *counted))).scalar_one()
    if per_recipient >= config.rate_per_recipient_per_hour():
        logger.warning("[email] rate limit (recipient) template=%s to_ref=%s", template, log_ref(address))
        return EnqueueResult("rate_limited", detail="recipient")
    overall = (await db.execute(select(func.count()).select_from(EmailOutbox).where(*counted))).scalar_one()
    if overall >= config.rate_global_per_hour():
        logger.warning("[email] rate limit (global) template=%s priority=%s", template, priority)
        return EnqueueResult("rate_limited", detail="global")

    not_before = None
    if priority == LOW:  # let the recipient's other notices arrive, so they go out as one email
        not_before = _now() + timedelta(minutes=config.digest_window_minutes())
    row = EmailOutbox(template=template, recipient_hash=recipient_hash, recipient_address=address,
                      payload=dict(params or {}), priority=priority, not_before=not_before, status="queued",
                      idempotency_key=idempotency_key)
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


async def _claim(db, outbox_id: str) -> bool:
    """Atomically take a queued, due, unclaimed row. A second worker (or a restart) cannot take the same one."""
    from models.email_outbox import EmailOutbox
    now = _now()
    claim = await db.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == outbox_id, EmailOutbox.status == "queued",
               or_(EmailOutbox.claimed_until.is_(None), EmailOutbox.claimed_until < now),
               or_(EmailOutbox.not_before.is_(None), EmailOutbox.not_before <= now))
        .values(claimed_until=now + timedelta(seconds=CLAIM_SECONDS))
        .execution_options(synchronize_session=False)  # a pure SQL compare-and-set; callers refresh what they hold
    )
    await db.commit()
    return claim.rowcount == 1


async def _release(db, rows) -> None:
    for row in rows:
        row.claimed_until = None
    await db.commit()


async def _gather_digest_mates(db, row) -> List:
    """Other due, unclaimed low-priority rows for the same recipient, claimed so no other worker takes them."""
    from models.email_outbox import EmailOutbox
    now = _now()
    candidates = (await db.execute(
        select(EmailOutbox).where(
            EmailOutbox.recipient_hash == row.recipient_hash, EmailOutbox.priority == LOW,
            EmailOutbox.status == "queued", EmailOutbox.id != row.id,
            or_(EmailOutbox.not_before.is_(None), EmailOutbox.not_before <= now),
            or_(EmailOutbox.claimed_until.is_(None), EmailOutbox.claimed_until < now),
        ).order_by(EmailOutbox.created_at).limit(MAX_DIGEST_ITEMS - 1)
    )).scalars().all()
    mates = []
    for mate in candidates:
        if mate.template in TEMPLATES and TEMPLATES[mate.template].summary and await _claim(db, mate.id):
            await db.refresh(mate)
            mates.append(mate)
    return mates


def _build_message(group) -> tuple:
    """(EmailMessage, provider idempotency key) for one row, or one digest of several."""
    primary = group[0]
    if len(group) == 1:
        rendered = render(primary.template, primary.payload or {})
        key = primary.idempotency_key
        template = primary.template
    else:
        items = [{"summary": TEMPLATES[g.template].summary(g.payload or {})} for g in group]
        rendered = render("notice_digest", {"items": items})
        # A digest's content is decided by its members, so its provider-side key is too (a different set of
        # rows must never reuse another set's key: the provider would replay the earlier content).
        key = "digest:" + hashlib.sha256("|".join(sorted(g.idempotency_key for g in group)).encode()).hexdigest()[:40]
        template = "notice_digest"
    return EmailMessage(to=primary.recipient_address or "", subject=rendered.subject, html=rendered.html,
                        text=rendered.text, template=template), key


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
    (`queued` also means "nothing sent": not configured, not due yet, held by the daily budget, or claimed
    elsewhere). A low-priority row may go out merged with the recipient's other waiting notices."""
    from models.email_outbox import EmailOutbox

    sender = sender or build_sender()
    if not sender.configured:
        logger.info("[email] worker skipped: email not configured outbox=%s", outbox_id)
        return "queued"
    factory = session_factory or _default_session_factory()
    max_attempts = config.max_attempts()

    async with factory() as db:
        if not await _claim(db, outbox_id):
            row = (await db.execute(select(EmailOutbox.status).where(EmailOutbox.id == outbox_id))).first()
            return row[0] if row else "missing"
        row = (await db.execute(select(EmailOutbox).where(EmailOutbox.id == outbox_id))).scalar_one()

        group = [row]
        if row.priority == LOW:
            now, cap = _now(), config.daily_cap()
            used = await sent_today(db, now)
            _note_budget(used, cap, now)
            if used >= int(cap * LOW_PRIORITY_SHARE):
                row.not_before = _next_utc_midnight(now)  # held for the next quota day; security mail is not
                await _release(db, [row])
                logger.info("[email] low-priority held by the daily budget outbox=%s", outbox_id)
                return "queued"
            group += await _gather_digest_mates(db, row)

        while True:
            if await is_suppressed(db, row.recipient_hash):
                return await _finish(db, group, "suppressed", error="suppressed")
            if row.attempts >= max_attempts:
                return await _finish(db, group, "failed", error=row.last_error or "max_attempts")
            try:
                message, key = _build_message(group)
            except TemplateError as exc:
                return await _finish(db, group, "failed", error=("template:" + str(exc))[:64])

            result = await sender.send(message, key)
            for member in group:
                member.attempts += 1
            if result.ok:
                return await _finish(db, group, "sent", provider_message_id=result.provider_message_id)
            row.last_error = (result.error or "error")[:64]
            logger.warning("[email] send failed template=%s to_ref=%s attempt=%s error=%s",
                           message.template, log_ref(row.recipient_address or ""), row.attempts, row.last_error)
            if not result.retryable or row.attempts >= max_attempts:
                return await _finish(db, group, "failed", error=row.last_error)
            await db.commit()
            await sleep(_backoff(row.attempts, backoff_base))


async def _finish(db, group, status: str, *, error: Optional[str] = None,
                  provider_message_id: Optional[str] = None) -> str:
    for row in group:
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
    logger.info("[email] outbox=%s template=%s status=%s attempts=%s rows=%s", group[0].id, group[0].template,
                status, group[0].attempts, len(group))
    return status


async def sweep_queued(limit: int = 50, *, sender: Optional[EmailSender] = None, session_factory=None,
                       min_age_seconds: int = 60) -> int:
    """Re-drive queued rows that are due: ones a restart stranded, and low-priority ones whose wait has ended.
    Security mail goes first, so a backlog of notices can never sit in front of a guardian invite."""
    from models.email_outbox import EmailOutbox
    factory = session_factory or _default_session_factory()
    now = _now()
    cutoff = now - timedelta(seconds=min_age_seconds)
    ids: List[str] = []
    async with factory() as db:
        for priority in (SECURITY, LOW):
            ids += [r[0] for r in (await db.execute(
                select(EmailOutbox.id)
                .where(EmailOutbox.status == "queued", EmailOutbox.priority == priority,
                       EmailOutbox.created_at <= cutoff,
                       or_(EmailOutbox.not_before.is_(None), EmailOutbox.not_before <= now),
                       or_(EmailOutbox.claimed_until.is_(None), EmailOutbox.claimed_until < now))
                .order_by(EmailOutbox.created_at).limit(max(0, limit - len(ids)))
            )).all()]
    for outbox_id in ids:
        await deliver_outbox_entry(outbox_id, sender=sender, session_factory=factory)
    return len(ids)
