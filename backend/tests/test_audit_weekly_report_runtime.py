"""Weekly report runtime controls; delivery is mocked and persistence uses SQLite."""
import asyncio
import datetime
import json
import sys
import types

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import database
from models import Notification
from scheduler import financial

NOW = datetime.datetime(2026, 10, 3, 12, tzinfo=datetime.timezone.utc)


class Clock:
    @classmethod
    def now(cls, tz=None):
        return NOW


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


class ReportDB:
    """Mock query reads, but exercise the real Notification column binding."""
    def __init__(self, results):
        self.results = list(results)
        self.added = []
        self.commits = 0
        self.persisted = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def execute(self, *args, **kwargs):
        assert self.results, "Unexpected report query"
        return Result(self.results.pop(0))

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        engine = create_engine("sqlite://")
        Notification.__table__.create(engine)
        try:
            with Session(engine) as session:
                session.add_all(self.added)
                session.commit()
                self.persisted = list(session.scalars(select(Notification.data)))
            self.commits += 1
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    "configured,earnings,has_account",
    [(False, 100, True), (True, 100, True), (True, 0, True), (True, 100, False)],
)
def test_weekly_report_runtime_and_no_email_controls(
    monkeypatch, caplog, configured, earnings, has_account,
):
    calls = []
    monkeypatch.setattr(financial, "datetime", Clock)
    if configured:
        monkeypatch.setenv("RESEND_API_KEY", "configured-not-a-key")
    else:
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setitem(
        sys.modules, "resend",
        types.SimpleNamespace(Emails=types.SimpleNamespace(send=lambda payload: calls.append(payload))),
    )
    photographer = types.SimpleNamespace(
        id="fixture-photographer", email="fixture@example.invalid", full_name="Fixture",
    )
    results = [[photographer] if has_account else []]
    if has_account:
        results.append([types.SimpleNamespace(
            total=earnings, gallery_sales=earnings, live_sessions=0, bookings=0,
        )])
    if has_account and earnings > 0:
        results.append([])
    db = ReportDB(results)
    monkeypatch.setattr(database, "async_session_maker", lambda: db)

    asyncio.run(financial.send_weekly_sales_reports_task())

    active = has_account and earnings > 0
    assert not db.results, "Expected report queries were not reached"
    assert db.commits == 1
    assert len(db.persisted) == int(active)
    assert len(calls) == int(active and configured)
    assert not any("not defined" in row.message for row in caplog.records)
    if active:
        assert json.loads(db.persisted[0])["total_earnings"] == earnings
        if configured:
            assert calls[0]["to"] == ["fixture@example.invalid"]
