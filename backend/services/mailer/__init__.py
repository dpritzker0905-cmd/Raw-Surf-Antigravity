"""Transactional email foundation (outbox, priority classes, templates, bounce webhook).

NOTE the package name `mailer`, chosen on purpose:
  * not `email`: fetchers run as `python backend/services/x.py`, which puts this directory at sys.path[0]; a
    `services/email` package would shadow the standard library's `email` there and break `http.client` / `urllib`.
  * not `email_service`: `services/email_service.py` already exists (the SendGrid session-recap helper) and a package
    of the same name would shadow it and break its importers.
  * not `*_service` / `*fetcher*`: tests/scripts/ci_test_lanes.py sends any test importing `services.<x>_service` to
    the forecast-chain lane, which has its own floors and timeout. `mailer` leaves these tests in the estate lane.

Nothing sends until the owner sets EMAIL_PROVIDER (+ EMAIL_API_KEY, EMAIL_FROM for a real provider).
See docs/runbooks/EMAIL-SETUP.md.
"""
from .base import EmailMessage, EmailSender, SendResult, address_hash, log_ref  # noqa: F401
from .outbox import EnqueueResult, deliver_outbox_entry, enqueue_email, suppress_address, sweep_queued  # noqa: F401
from .senders import CONSOLE, ConsoleSender, DisabledSender, ResendSender, build_sender  # noqa: F401
from .templates import TEMPLATES, TemplateError, render  # noqa: F401
