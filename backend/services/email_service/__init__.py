"""Transactional email foundation.

NOTE the package name: it is `email_service`, not `email`. Fetchers run as `python backend/services/x.py`,
which puts this directory at sys.path[0]; a `services/email` package would shadow the standard library's
`email` there and break `http.client` / `urllib` in every fetcher subprocess.

Nothing sends until the owner sets EMAIL_PROVIDER (+ EMAIL_API_KEY, EMAIL_FROM for a real provider).
See docs/runbooks/EMAIL-SETUP.md.
"""
from .base import EmailMessage, EmailSender, SendResult, address_hash, log_ref  # noqa: F401
from .outbox import EnqueueResult, deliver_outbox_entry, enqueue_email, suppress_address, sweep_queued  # noqa: F401
from .senders import CONSOLE, ConsoleSender, DisabledSender, ResendSender, build_sender  # noqa: F401
from .templates import TEMPLATES, TemplateError, render  # noqa: F401
