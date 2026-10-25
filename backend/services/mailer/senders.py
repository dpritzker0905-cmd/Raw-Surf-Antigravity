"""Sender implementations: Resend (HTTP), console/outbox (dev + tests), disabled (the default)."""
import logging
import os
import uuid
from typing import List, Optional

import httpx

from . import config
from .base import EmailMessage, EmailSender, SendResult, log_ref

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
RESEND_TIMEOUT_SECONDS = 10.0


class DisabledSender(EmailSender):
    """Default with no configuration. Never sends, and says so: callers must not treat this as success."""

    name = "disabled"
    configured = False

    async def send(self, message: EmailMessage, idempotency_key: str) -> SendResult:
        return SendResult(ok=False, error="not_configured", retryable=False, configured=False)


class ConsoleSender(EmailSender):
    """Dev/test sender. Keeps messages in memory (`.outbox`) and logs metadata only: a rendered body holds a
    single-use token and an address, so neither is logged. EMAIL_CONSOLE_DIR also writes each message to a
    local folder so a developer can open the link."""

    name = "console"

    def __init__(self) -> None:
        self.outbox: List[EmailMessage] = []

    async def send(self, message: EmailMessage, idempotency_key: str) -> SendResult:
        self.outbox.append(message)
        message_id = f"console-{uuid.uuid4()}"
        folder = config.console_dir()
        if folder:
            try:
                os.makedirs(folder, exist_ok=True)
                with open(os.path.join(folder, message_id + ".txt"), "w", encoding="utf-8") as fh:
                    fh.write(f"To: {message.to}\nSubject: {message.subject}\n\n{message.text}\n")
            except OSError:
                logger.warning("[email:console] could not write EMAIL_CONSOLE_DIR file")
        logger.info("[email:console] template=%s to_ref=%s id=%s", message.template, log_ref(message.to), message_id)
        return SendResult(ok=True, provider_message_id=message_id)


CONSOLE = ConsoleSender()  # one shared instance, so `CONSOLE.outbox` survives across build_sender() calls


class ResendSender(EmailSender):
    """Resend over plain httpx (no SDK). `transport` lets tests inject a fake and never touch the network."""

    name = "resend"

    def __init__(self, api_key: str, sender: str, transport: Optional[httpx.AsyncBaseTransport] = None,
                 reply_to: str = "") -> None:
        self._api_key = api_key
        self._from = sender
        self._transport = transport
        self._reply_to = reply_to

    async def send(self, message: EmailMessage, idempotency_key: str) -> SendResult:
        body = {
            "from": self._from,
            "to": [message.to],
            "subject": message.subject,
            "html": message.html,
            "text": message.text,
        }
        if self._reply_to:
            body["reply_to"] = self._reply_to
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key[:256],
        }
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=RESEND_TIMEOUT_SECONDS) as client:
                response = await client.post(RESEND_ENDPOINT, json=body, headers=headers)
        except httpx.TimeoutException:
            return SendResult(ok=False, error="timeout", retryable=True)
        except httpx.HTTPError as exc:
            # The class name only: str(exc) can embed the request URL or a header.
            return SendResult(ok=False, error="net_" + type(exc).__name__[:40], retryable=True)

        if response.status_code == 200 or response.status_code == 201:
            try:
                message_id = str(response.json().get("id") or "")[:128] or None
            except ValueError:
                message_id = None
            return SendResult(ok=True, provider_message_id=message_id)
        code = f"http_{response.status_code}"
        # 429 and 5xx are the provider's to recover from; any other 4xx (bad key, bad sender, bad address) will
        # fail identically on retry, so retrying only burns the rate limit.
        return SendResult(ok=False, error=code, retryable=response.status_code == 429 or response.status_code >= 500)


def build_sender(transport: Optional[httpx.AsyncBaseTransport] = None) -> EmailSender:
    """Choose the sender from the environment at call time. Anything incomplete is DisabledSender."""
    which = config.provider()
    if which == "console":
        return CONSOLE
    if which == "resend":
        key, sender = config.api_key(), config.email_from()
        if key and sender:
            return ResendSender(key, sender, transport=transport, reply_to=config.reply_to())
        logger.warning("[email] EMAIL_PROVIDER=resend but EMAIL_API_KEY or EMAIL_FROM is unset: email disabled")
    return DisabledSender()
