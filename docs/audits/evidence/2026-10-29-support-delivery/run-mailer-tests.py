"""Existing mailer regressions under the qualified fixture mappings; no repository conftest/app startup."""
import importlib
import importlib.util
import sys
import os
import types

from pathlib import Path
spec = importlib.util.spec_from_file_location("delivery_fixture", Path(__file__).with_name("verify-delivery.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

database = types.ModuleType("database")
database.Base = fixture.p.Base
database.get_db = fixture.get_db
sys.modules["database"] = database
importlib.reload(fixture.config)
from services.mailer import senders  # noqa: E402
fixture.outbox.build_sender = senders.build_sender
routes = types.ModuleType("routes")
routes.__path__ = [str(fixture.ROOT / "backend/routes")]
sys.modules["routes"] = routes
fixture.models.EmailOutbox = fixture.mail_models.EmailOutbox
fixture.models.EmailSuppression = fixture.mail_models.EmailSuppression
os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
import pytest  # noqa: E402

raise SystemExit(pytest.main(["--noconftest", "-p", "pytest_asyncio.plugin", "-o", "asyncio_mode=auto", "-q",
                             str(fixture.ROOT / "backend/tests/test_email_service.py"),
                             str(fixture.ROOT / "backend/tests/test_email_templates_and_webhook.py"),
                             "--junitxml=" + str(fixture.OUT / "mailer-junit.xml")]))
